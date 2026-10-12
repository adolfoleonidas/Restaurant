from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import uuid
from pymongo.errors import DuplicateKeyError
from database import db
from auth import get_current_user, require_roles, user_functions
from models import OrderCreate, OrderItemInput, OrderItemUpdate, OrderStatusUpdate, OrderItemStatusUpdate, KitchenBump, OrderReassign, OrderMerge, OrderMove, OrderSplit, OrderAlias, OrderNotes, OrderItemVoid, OrderItemMove
from billing import assert_can_cancel, guarded_totals, line_subtotal, split_group_totals, sum_line_subtotals
from order_flow import (
    DRAFT_STATUS,
    FlowError,
    assert_can_serve,
    assert_item_transition,
    assert_items_ready_to_finish,
    assert_kitchen_open,
    assert_order_transition,
    is_cancelled,
    is_draft,
    ticket_fields,
    VersionError,
    claim_order,
    version_conflict,
)
from routes.products import combo_components_for
from routes.reports import BUSINESS_TIMEZONE
from notify import emit_order, emit_notice
from payment_policy import kitchen_visible, payment_label
from attention import AttentionBlocked, open_table_attention, close_table_attention, reserve_table_opening, recover_opening_intent, discard_table_opening
from attention_acceptance import AttentionAcceptanceError, capture_attention_context, number_accepted_order
from branch_access import (
    assert_record_branch_access,
    read_branch_filter,
    record_branch_filter,
    validate_user_branch,
)

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


_KITCHEN_HIDE = {"discount": 0, "tip": 0, "total": 0, "paid_at": 0, "payment_proof_url": 0}


def _order_projection(user: dict) -> dict:
    proj = {"_id": 0, "payment_operation": 0}
    if user.get("role") == "cocina":
        proj.update(_KITCHEN_HIDE)
    if not {"cobro", "administracion"}.intersection(user_functions(user)):
        proj.update({
            "payment_proof_url": 0,
            "payment_proof_method": 0,
            "payment_proof_sha256": 0,
            "payment_proof_uploaded_by": 0,
            "payment_proof_uploaded_at": 0,
        })
    return proj


async def _order_lookup_scope(order_id: str, user: dict) -> dict:
    branch_id = await validate_user_branch(user, db.branches)
    scope = {"id": order_id, "restaurant_id": user["restaurant_id"]}
    if branch_id is not None:
        scope["branch_id"] = branch_id
    return scope


def _order_for_user(order: dict | None, user: dict) -> dict | None:
    if not order:
        return order
    safe = dict(order)
    safe.pop("payment_operation", None)
    safe.pop("account_operation", None)
    safe.pop("account_operation_ref", None)
    safe.pop("account_operation_id", None)
    safe.pop("last_account_operation", None)
    if {"cobro", "administracion"}.intersection(user_functions(user)):
        return safe
    for field in (
        "payment_proof_url", "payment_proof_method", "payment_proof_sha256",
        "payment_proof_uploaded_by", "payment_proof_uploaded_at",
    ):
        safe.pop(field, None)
    return safe


async def _current_order_response(order_id: str, user: dict) -> dict | None:
    order = await db.orders.find_one(
        await _order_lookup_scope(order_id, user), {"_id": 0}
    )
    return _order_for_user(order, user)


async def _audit(restaurant_id: str, user_id: str, action: str, entity: str, entity_id: str, details: dict = None):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": restaurant_id,
        "user_id": user_id,
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "details": details or {},
        "created_at": _now(),
    })


def _order_counter_key(now: datetime) -> str:
    """Daily counter key for the business day (Peru), so numbering resets at local midnight."""
    return f"order_{now.astimezone(BUSINESS_TIMEZONE).strftime('%Y-%m-%d')}"


async def _next_order_number(restaurant_id: str) -> int:
    key = _order_counter_key(datetime.now(BUSINESS_TIMEZONE))
    res = await db.counters.find_one_and_update(
        {"restaurant_id": restaurant_id, "key": key},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    # Some Motor versions need different return_document handling; fetch as fallback
    if not res or "value" not in (res or {}):
        res = await db.counters.find_one({"restaurant_id": restaurant_id, "key": key})
    return res.get("value", 1) if res else 1


async def _compute_total(items: list, restaurant_id: str):
    enriched = []
    for it in items:
        prod = await db.products.find_one(
            {"id": it["product_id"], "restaurant_id": restaurant_id},
            {"_id": 0}
        )
        if not prod:
            raise HTTPException(status_code=400, detail=f"Producto {it['product_id']} no existe")
        if not prod.get("is_available", True):
            raise HTTPException(status_code=400, detail=f"Producto agotado: {prod['name']}")
        line = line_subtotal(prod["price"], it["quantity"])
        combo_components = await combo_components_for(prod, restaurant_id)
        if prod.get("is_combo") and (not combo_components or any(not c.get("is_available", True) for c in combo_components)):
            raise HTTPException(status_code=400, detail=f"El combo {prod['name']} no está disponible: un componente está agotado")
        enriched.append({
            "id": it.get("id") or str(uuid.uuid4()),
            "product_id": prod["id"],
            "product_name": prod["name"],
            "quantity": it["quantity"],
            "unit_price": prod["price"],
            "subtotal": line,
            "notes": it.get("notes"),
            "status": it.get("status", "pendiente"),
            "added_at": it.get("added_at") or _now(),
            "prep_minutes": int(prod.get("preparation_time") or 15),
            "is_combo": bool(prod.get("is_combo")),
            "combo_components": combo_components,
        })
    return enriched, sum_line_subtotals(line["subtotal"] for line in enriched)


async def _save_order(order: dict, fields: dict):
    try:
        scoped_order = dict(order)
        scoped_order.setdefault("restaurant_id", order.get("restaurant_id"))
        await claim_order(db.orders, scoped_order, fields)
    except VersionError:
        raise HTTPException(status_code=409, detail=version_conflict(order))


async def _release_paid_table(order: dict, status: str):
    if status != "pagado" or not order.get("table_id") or order.get("attention_id"):
        return
    restaurant = await db.restaurants.find_one({"id": order["restaurant_id"]}, {"_id": 0})
    table_status = "disponible" if (restaurant or {}).get("auto_release_table") else "pagada"
    await db.tables.update_one(
        {"id": order["table_id"], "restaurant_id": order["restaurant_id"],
         **({"branch_id": order["branch_id"]} if order.get("branch_id") is not None else {})},
        {"$set": {"status": table_status, "updated_at": _now()}},
    )
    emit_notice(order["restaurant_id"], "table", table_id=order["table_id"], status=table_status, branch_id=order.get("branch_id"))


def _derive_kitchen_status(items: list, current: str) -> str:
    if current in ("pagado", "cancelado"):
        return current
    # Los borradores y los anulados no son trabajo de cocina: si sólo hay de
    # esos, el pedido se queda donde estaba.
    work = [i for i in items if i.get("status") not in ("entregado", "cancelado", DRAFT_STATUS)]
    if not work:
        return current
    if all(i.get("status") == "listo" for i in work):
        return "listo"
    if any(i.get("status") == "en_preparacion" for i in work):
        return "en_preparacion"
    return "enviado_cocina"


@router.get("")
async def list_orders(
    user: dict = Depends(get_current_user),
    status: Optional[str] = None,
    table_id: Optional[str] = None,
    active_only: bool = False,
    limit: int = 200,
    branch_id: Optional[str] = None,
    legacy_only: bool = False,
):
    branch_filter = await read_branch_filter(user, db.branches, branch_id, legacy_only=legacy_only)
    q = {"restaurant_id": user["restaurant_id"], **branch_filter}
    if status:
        q["status"] = status
    if table_id:
        q["table_id"] = table_id
    if active_only:
        active_filter = {"$or": [
            {"status": {"$nin": ["pagado", "cancelado"]}},
            {"attention_state": {"$in": ["opening", "open", "mutating", "closing"]}},
        ]}
        if "$or" in q:
            q = {"restaurant_id": user["restaurant_id"], "$and": [branch_filter, active_filter]}
            if status:
                q["status"] = status
            if table_id:
                q["table_id"] = table_id
        else:
            q.update(active_filter)
    items = await db.orders.find(q, _order_projection(user)).sort("created_at", -1).limit(limit).to_list(limit)
    return items


@router.get("/kitchen")
async def kitchen_orders(user: dict = Depends(require_roles(["admin", "mozo", "cocina"]))):
    """Orders relevant for kitchen board (no payment info)."""
    # Solo exclusiones: el ticket no expone importes ni el comprobante, pero sí
    # necesita saber cómo está el cobro para imprimir su etiqueta.
    projection = {"_id": 0, "payment_operation": 0, "discount": 0, "tip": 0, "total": 0, "paid_at": 0,
                  "payment_proof_url": 0, "payment_proof_method": 0, "payment_proof_sha256": 0,
                  "payment_proof_uploaded_by": 0, "payment_proof_uploaded_at": 0,
                  "amount_paid": 0, "request_fingerprint": 0}
    branch_id = await validate_user_branch(user, db.branches)
    branch_filter = {"branch_id": branch_id} if branch_id is not None else {}
    items = await db.orders.find(
        {
            "restaurant_id": user["restaurant_id"],
            "status": {"$nin": ["pagado", "cancelado"]},
            **branch_filter,
        },
        projection
    ).sort("created_at", 1).to_list(500)
    board = []
    for o in items:
        if o.get("status") == "entregado" or not kitchen_visible(o):
            continue
        if any(i.get("status") in ("pendiente", "en_preparacion", "listo", None) for i in (o.get("items") or [])):
            board.append(o)
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    delivered = await db.orders.find(
        {
            "restaurant_id": user["restaurant_id"],
            "status": "entregado",
            "updated_at": {"$gte": cutoff},
            **branch_filter,
        },
        projection
    ).sort("updated_at", -1).to_list(100)
    board.extend(delivered)
    items = [_order_for_user(order, user) for order in board]
    # Los borradores todavía no son comanda: cocina no los ve.
    for order in items:
        order["items"] = [i for i in (order.get("items") or []) if i.get("status") != DRAFT_STATUS]
    # The kitchen must know which table each ticket belongs to: the order only
    # stores table_id, so resolve the number here.
    table_ids = [order["table_id"] for order in items if order.get("table_id")]
    if table_ids:
        tables = await db.tables.find(
            {"restaurant_id": user["restaurant_id"], "id": {"$in": table_ids}},
            {"_id": 0, "id": 1, "number": 1},
        ).to_list(len(table_ids))
        numbers = {table["id"]: table.get("number") for table in tables}
        for order in items:
            if order.get("table_id"):
                order["table_number"] = numbers.get(order["table_id"])
    # El ticket dice cómo está el dinero sin exponer importes: si ya se cobró, si
    # se cobra al entregar, o si es una cuenta nueva de una mesa ya atendida
    # (para que el personal sepa que es un pedido adicional).
    attention_ids = [order["attention_id"] for order in items if order.get("attention_id")]
    siblings = {}
    if attention_ids:
        rows = await db.orders.find(
            {"restaurant_id": user["restaurant_id"], "attention_id": {"$in": attention_ids}},
            {"_id": 0, "id": 1, "attention_id": 1, "acceptance_status": 1,
             "status": 1, "created_at": 1},
        ).to_list(500)
        for row in rows:
            # Los pedidos que todavía esperan pago no cuentan como comanda.
            if row.get("status") in ("pagado", "cancelado") or not kitchen_visible(row):
                continue
            siblings.setdefault(row["attention_id"], []).append(row)
    for order in items:
        order["payment_label"] = payment_label(order)
        order["pay_at_counter"] = bool(order.get("pay_at_counter"))
        # Es adicional si la visita ya tenía otra comanda, no si este ticket es
        # el segundo de la lista.
        others = [row for row in (siblings.get(order.get("attention_id")) or []) if row["id"] != order["id"]]
        order["is_additional"] = bool(order.get("attention_id")) and bool(others)
    return items


@router.get("/{order_id}")
async def get_order(order_id: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one(
        await _order_lookup_scope(order_id, user),
        _order_projection(user),
    )
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return _order_for_user(o, user)


@router.post("")
async def create_order(data: OrderCreate, user: dict = Depends(require_roles(["admin", "mozo"]))):
    assigned_branch_id = await validate_user_branch(user, db.branches)
    if assigned_branch_id is not None and data.branch_id is not None and data.branch_id != assigned_branch_id:
        raise HTTPException(status_code=403, detail="No puede crear pedidos para otra sucursal")
    table = None
    reused_attention_id = None
    if data.order_type == "mesa" and not data.table_id:
        raise HTTPException(status_code=400, detail="Se requiere mesa")
    if data.order_type == "delivery" and not (data.customer_address or "").strip():
        raise HTTPException(status_code=400, detail="Se requiere la dirección para un envío")
    if data.table_id:
        table = await db.tables.find_one({"id": data.table_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
        if not table:
            raise HTTPException(status_code=404, detail="Mesa no encontrada")
        assert_record_branch_access(table, user, "Mesa no encontrada")
        if data.branch_id is not None and data.branch_id != table.get("branch_id"):
            raise HTTPException(status_code=400, detail="La sucursal del pedido no coincide con la mesa")
        if getattr(data, "new_account", False):
            # Cuenta adicional dentro de la visita ya abierta de la mesa.
            if not table.get("active_attention_id"):
                raise HTTPException(status_code=400, detail="La mesa no tiene una visita abierta para agregar una cuenta")
            if table.get("status") not in ("ocupada", "esperando_pago"):
                raise HTTPException(status_code=400, detail="La mesa no está ocupada")
            reused_attention_id = table["active_attention_id"]
        else:
            if table.get("active_attention_id"):
                raise HTTPException(status_code=400, detail="La mesa pertenece a una visita abierta")
            if table.get("status") not in ("disponible", "ocupada"):
                raise HTTPException(status_code=400, detail="La mesa no está disponible")
            existing = await db.orders.find_one({
                "restaurant_id": user["restaurant_id"], "table_id": data.table_id,
                "status": {"$nin": ["pagado", "cancelado"]},
                **record_branch_filter(user),
            })
            if existing:
                raise HTTPException(status_code=400, detail="La mesa ya tiene un pedido activo")
            try:
                await capture_attention_context(
                    db, tenant_id=user["restaurant_id"], branch_id=table.get("branch_id"), confirmed_at=_now()
                )
            except AttentionAcceptanceError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
    if table is not None:
        branch_id = table.get("branch_id")
    elif assigned_branch_id is not None:
        branch_id = assigned_branch_id
    else:
        branch_id = data.branch_id
        if not branch_id:
            raise HTTPException(status_code=400, detail="Se requiere sucursal para crear el pedido")
        registered_branch = await db.branches.find_one(
            {"id": branch_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0, "id": 1}
        )
        if not registered_branch:
            raise HTTPException(status_code=400, detail="La sucursal seleccionada no pertenece al restaurante")
    items = [it.model_dump() for it in data.items]
    enriched, subtotal = await _compute_total(items, user["restaurant_id"]) if items else ([], 0.0)
    order_no = await _next_order_number(user["restaurant_id"])
    order_id = str(uuid.uuid4())
    attention_id = reused_attention_id or (str(uuid.uuid4()) if data.table_id else None)
    o = {
        "id": order_id, "order_number": order_no, "restaurant_id": user["restaurant_id"],
        "table_id": data.table_id, "created_by": user["id"], "created_by_name": user["full_name"],
        "status": "nuevo", "order_type": data.order_type, "items": enriched,
        "subtotal": subtotal, "discount": 0.0, "tip": 0.0, "total": subtotal,
        "notes": data.notes, "cancellation_reason": None, "sent_to_kitchen_at": None,
        # Cuenta "Compartido": lo que pidió la mesa entera y no una persona.
        "shared": bool(getattr(data, "shared", False)),
        "ready_at": None, "paid_at": None, "created_at": _now(), "updated_at": _now(),
    }
    if branch_id is not None:
        o["branch_id"] = branch_id
    for field in ("customer_name", "customer_phone", "customer_address"):
        value = (getattr(data, field, None) or "").strip()
        if value:
            o[field] = value
    if attention_id:
        o.update({
            "attention_id": attention_id,
            "attention_state": "open" if reused_attention_id else "opening",
            "attention_open": bool(reused_attention_id),
        })
        o["_id"] = order_id
        if not reused_attention_id:
            try:
                await reserve_table_opening(
                    db, table=table, order_id=order_id, restaurant_id=user["restaurant_id"],
                    allowed_statuses=("disponible", "ocupada"), intent=o,
                )
            except AttentionBlocked as exc:
                raise HTTPException(status_code=409, detail=exc.detail)
    try:
        await db.orders.insert_one(o)
    except DuplicateKeyError:
        if attention_id:
            current = await db.tables.find_one({
                "id": data.table_id, "restaurant_id": user["restaurant_id"], "opening_order_id": order_id,
                **record_branch_filter(user),
            }, {"_id": 0})
            recovered = await recover_opening_intent(db, table=current or {}, order_id=order_id, restaurant_id=user["restaurant_id"])
            if recovered:
                await open_table_attention(db, order=recovered, user=user, now=_now())
                return await _current_order_response(order_id, user)
        raise HTTPException(status_code=400, detail="La mesa ya tiene un pedido activo")
    except Exception:
        # Keep the durable intent: an insert may have committed before its error reached us.
        raise
    if attention_id:
        if reused_attention_id:
            # Registra la nueva cuenta en la visita existente (no abre visita nueva).
            await db.attentions.update_one(
                {"id": reused_attention_id, "restaurant_id": user["restaurant_id"]},
                {"$addToSet": {"order_ids": order_id}},
            )
        else:
            try:
                await open_table_attention(db, order=o, user=user, now=_now())
            except AttentionBlocked as exc:
                raise HTTPException(status_code=409, detail=f"La apertura quedó pendiente; reintentá /orders/{order_id}/attention/open. {exc.detail}")
    await _audit(user["restaurant_id"], user["id"], "create", "order", order_id, {"order_number": order_no})
    emit_order(user["restaurant_id"], order_id, o["status"], source="staff", order_number=order_no, branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/attention/open")
async def resume_attention_open(order_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    order = await db.orders.find_one(await _order_lookup_scope(order_id, user), {"_id": 0})
    if not order:
        table = await db.tables.find_one({
            "restaurant_id": user["restaurant_id"], "opening_order_id": order_id,
            **record_branch_filter(user),
        }, {"_id": 0})
        if not table:
            raise HTTPException(status_code=404, detail="Pedido no encontrado")
        order = await recover_opening_intent(db, table=table, order_id=order_id, restaurant_id=user["restaurant_id"])
        if not order:
            raise HTTPException(status_code=409, detail="La apertura requiere conciliación")
    try:
        return await open_table_attention(db, order=order, user=user, now=_now())
    except AttentionBlocked as exc:
        raise HTTPException(status_code=409, detail=exc.detail)


@router.post("/{order_id}/attention/close")
async def close_attention(order_id: str, user: dict = Depends(require_roles(["admin", "mozo", "cajero"]))):
    order = await db.orders.find_one(await _order_lookup_scope(order_id, user), {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    was_closed = order.get("attention_state") == "closed"
    try:
        attention = await close_table_attention(db, order=order, user=user, now=_now())
    except AttentionBlocked as exc:
        raise HTTPException(status_code=400, detail=exc.detail)
    if not was_closed:
        emit_notice(user["restaurant_id"], "table", table_id=order["table_id"], status="disponible", branch_id=order.get("branch_id"))
    return attention
@router.post("/{order_id}/items")
async def add_items(order_id: str, items: List[OrderItemInput], user: dict = Depends(require_roles(["admin", "mozo"]))):
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user))
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if o["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="No se puede modificar un pedido cerrado")
    new_items = [it.model_dump() for it in items]
    enriched_new, _ = await _compute_total(new_items, user["restaurant_id"])
    for it in enriched_new:
        # Queda como borrador: el mozo todavía puede corregirlo y recién viaja a
        # cocina cuando pulsa "Enviar a cocina" / "Enviar adicionales".
        it["status"] = DRAFT_STATUS
        it["added_at"] = _now()
    combined = (o.get("items") or []) + enriched_new
    subtotal, total = guarded_totals(o, combined)
    # Cargar un producto no manda nada a cocina por sí solo: el pedido conserva
    # su estado hasta que el mozo envía.
    new_status = _derive_kitchen_status(combined, o["status"])
    if o["status"] in ("entregado", "pendiente_pago"):
        new_status = o["status"]
    patch = {"items": combined, "subtotal": subtotal, "total": total, "updated_at": _now()}
    patch.update(ticket_fields(o, new_status, o.get("amount_paid"), total))
    await _save_order(o, patch)
    emit_order(user["restaurant_id"], order_id, new_status, source=o.get("source"), extra="items_added", branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)


async def _resume_merge_operation(operation: dict, user: dict) -> None:
    target_filter = {"id": operation["target_id"], "restaurant_id": operation["restaurant_id"], "account_operation.id": operation["id"]}
    if operation.get("branch_id") is not None:
        target_filter["branch_id"] = operation["branch_id"]
    source_filter = {"id": operation["source_id"], "restaurant_id": operation["restaurant_id"]}
    if operation.get("source_branch_id") is not None:
        source_filter["branch_id"] = operation["source_branch_id"]
    source = await db.orders.find_one(source_filter, {"_id": 0})
    if not source:
        raise HTTPException(status_code=409, detail="No se pudo recuperar la operación de cuenta")
    if source.get("account_operation_ref") != operation["id"]:
        if source.get("status") == "cancelado" and source.get("cancellation_reason") == operation["source_patch"].get("cancellation_reason"):
            await db.orders.update_one(target_filter, {"$unset": {"account_operation": ""}})
            return
        if source.get("account_operation_ref"):
            raise HTTPException(status_code=409, detail="La cuenta está cambiando; volvé a cargarla")
        claim = {**source_filter, "updated_at": operation.get("source_updated_at"), "account_operation_ref": {"$exists": False}, "account_operation": {"$exists": False}, "payment_operation": {"$exists": False}}
        result = await db.orders.update_one(claim, {"$set": {"account_operation_ref": operation["id"]}})
        if getattr(result, "matched_count", 0) != 1:
            await db.orders.update_one(target_filter, {"$unset": {"account_operation": ""}})
            raise HTTPException(status_code=409, detail="La cuenta cambió mientras se preparaba la operación")
    await db.orders.update_one(target_filter, {"$set": operation["target_patch"]})
    await db.orders.update_one({**source_filter, "account_operation_ref": operation["id"]}, {"$set": operation["source_patch"]})
    await db.orders.update_one({**source_filter, "account_operation_ref": operation["id"]}, {"$unset": {"account_operation_ref": ""}})
    await db.orders.update_one(target_filter, {"$unset": {"account_operation": ""}})


@router.post("/{order_id}/merge")
async def merge_order(order_id: str, data: OrderMerge, user: dict = Depends(require_roles(["admin", "mozo"]))):
    """Merge an unpaid account with a fixed, resumable operation."""
    target_filter = await _order_lookup_scope(order_id, user)
    target = await db.orders.find_one(target_filter, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if target.get("account_operation"):
        operation = target["account_operation"]
        if operation.get("kind") != "merge" or operation.get("source_id") != data.source_order_id:
            raise HTTPException(status_code=409, detail="La cuenta está terminando otra operación; reintentá en unos segundos")
        await _resume_merge_operation(operation, user)
        return await _current_order_response(order_id, user)
    source = await db.orders.find_one(await _order_lookup_scope(data.source_order_id, user), {"_id": 0})
    if not source:
        raise HTTPException(status_code=404, detail="Cuenta a fusionar no encontrada")
    if source["id"] == target["id"]:
        raise HTTPException(status_code=400, detail="Elegí cuentas distintas")
    if source.get("status") == "cancelado" and source.get("cancellation_reason") == f"Fusionada con #{target.get('order_number')}":
        return await _current_order_response(order_id, user)
    if target["status"] in ("pagado", "cancelado") or source["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="Solo se pueden fusionar cuentas abiertas")
    if target.get("table_id") != source.get("table_id") or target.get("attention_id") != source.get("attention_id"):
        raise HTTPException(status_code=400, detail="Las cuentas deben pertenecer a la misma mesa y visita")
    if (source.get("amount_paid") or 0) > 0.009 or (target.get("amount_paid") or 0) > 0.009:
        raise HTTPException(status_code=400, detail="Las cuentas ya tienen cobros; anulalos antes de fusionar")
    combined = (target.get("items") or []) + (source.get("items") or [])
    subtotal, total = guarded_totals(target, combined)
    new_status = _derive_kitchen_status(combined, target["status"])
    if target["status"] in ("entregado", "pendiente_pago"):
        new_status = "enviado_cocina"
    target_patch = {"items": combined, "subtotal": subtotal, "total": total, "updated_at": _now()}
    target_patch.update(ticket_fields(target, new_status, target.get("amount_paid"), total))
    operation = {"id": str(uuid.uuid4()), "kind": "merge", "restaurant_id": target["restaurant_id"],
                 "branch_id": target.get("branch_id"), "target_id": target["id"], "source_id": source["id"],
                 "source_branch_id": source.get("branch_id"), "source_updated_at": source.get("updated_at"),
                 "target_patch": target_patch, "result_status": new_status,
                 "source_patch": {"status": "cancelado", "cancellation_reason": f"Fusionada con #{target.get('order_number')}", "updated_at": _now()}}
    claim = {**target_filter, "updated_at": target.get("updated_at"), "account_operation": {"$exists": False},
             "account_operation_ref": {"$exists": False}, "payment_operation": {"$exists": False}}
    result = await db.orders.update_one(claim, {"$set": {"account_operation": operation}})
    if getattr(result, "matched_count", 0) != 1:
        raise HTTPException(status_code=409, detail="La cuenta cambió mientras la revisabas")
    await _resume_merge_operation(operation, user)
    emit_order(user["restaurant_id"], order_id, new_status, source=target.get("source"), extra="merged", branch_id=target.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/move")
async def move_order(order_id: str, data: OrderMove, user: dict = Depends(require_roles(["admin", "mozo"]))):
    """Mueve una cuenta a una mesa libre; la desprende de la visita de origen."""
    order = await db.orders.find_one(await _order_lookup_scope(order_id, user), {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if order.get("account_operation") or order.get("account_operation_ref") or order.get("account_operation_id"):
        raise HTTPException(status_code=409, detail="La cuenta está terminando otra operación; reintentá en unos segundos")
    if not order.get("table_id"):
        raise HTTPException(status_code=400, detail="La cuenta no está en una mesa")
    if order["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=409, detail="La cuenta ya está cerrada; no se puede mover")
    source_table_id = order["table_id"]
    target = await db.tables.find_one(
        {"id": data.target_table_id, "restaurant_id": user["restaurant_id"], **record_branch_filter(user)},
        {"_id": 0},
    )
    if not target:
        raise HTTPException(status_code=404, detail="Mesa destino no encontrada")
    if target["id"] == source_table_id:
        raise HTTPException(status_code=400, detail="Elegí una mesa distinta")
    if target.get("branch_id") != order.get("branch_id"):
        raise HTTPException(status_code=400, detail="Las mesas pertenecen a sucursales distintas")
    if target.get("group_id"):
        raise HTTPException(status_code=409, detail="La mesa destino está unida a un grupo")
    if target.get("active_attention_id") or target.get("opening_order_id"):
        raise HTTPException(status_code=409, detail="La mesa destino tiene una visita en curso")
    target_active = await db.orders.find_one({
        "restaurant_id": user["restaurant_id"], "table_id": target["id"],
        "status": {"$nin": ["pagado", "cancelado"]}, **record_branch_filter(user),
    })
    if target_active:
        raise HTTPException(status_code=409, detail="La mesa destino ya tiene un pedido activo")
    if target.get("status") not in ("disponible", "ocupada"):
        raise HTTPException(status_code=409, detail="La mesa destino no está disponible")

    old_attention_id = order.get("attention_id")
    now = _now()
    new_attention_id = str(uuid.uuid4())

    # 1. Nueva visita para la cuenta en la mesa destino.
    attention_doc = {
        "id": new_attention_id, "restaurant_id": order["restaurant_id"],
        "table_id": target["id"], "order_id": order["id"], "order_ids": [order["id"]],
        "status": "open", "opened_by": user.get("id"), "opened_at": now,
    }
    if "branch_id" in order:
        attention_doc["branch_id"] = order["branch_id"]
    await db.attentions.insert_one(attention_doc)

    # 2. Mueve la orden a la mesa destino con su nueva visita.
    await db.orders.update_one(
        {"id": order["id"], "restaurant_id": order["restaurant_id"]},
        {"$set": {"table_id": target["id"], "attention_id": new_attention_id, "updated_at": now}},
    )

    # 3. Reclama la mesa destino.
    await db.tables.update_one(
        {"id": target["id"], "restaurant_id": user["restaurant_id"], "status": {"$in": ("disponible", "ocupada")}, "active_attention_id": {"$exists": False}, "opening_order_id": {"$exists": False}},
        {"$set": {"status": "ocupada", "active_attention_id": new_attention_id, "updated_at": now}},
    )

    # 4. Desprende la cuenta de la visita de origen (y libera la mesa si quedó vacía).
    if old_attention_id:
        old_att = await db.attentions.find_one({"id": old_attention_id, "restaurant_id": order["restaurant_id"]}, {"_id": 0})
        if old_att:
            remaining = [i for i in (old_att.get("order_ids") or []) if i != order["id"]]
            patch = {"$set": {"order_ids": remaining}}
            if old_att.get("order_id") == order["id"] and remaining:
                patch["$set"]["order_id"] = remaining[0]
            await db.attentions.update_one({"id": old_attention_id, "restaurant_id": order["restaurant_id"]}, patch)
            if not remaining:
                await db.tables.update_one(
                    {"id": source_table_id, "restaurant_id": user["restaurant_id"], "active_attention_id": old_attention_id},
                    {"$set": {"status": "disponible", "updated_at": now}, "$unset": {"active_attention_id": ""}},
                )
                emit_notice(user["restaurant_id"], "table", table_id=source_table_id, status="disponible", branch_id=order.get("branch_id"))

    emit_order(user["restaurant_id"], order_id, order["status"], source=order.get("source"), extra="moved", branch_id=order.get("branch_id"))
    emit_notice(user["restaurant_id"], "table", table_id=target["id"], status="ocupada", branch_id=order.get("branch_id"))
    return await _current_order_response(order_id, user)


async def _resume_split_operation(order: dict, operation: dict) -> None:
    scope = {"id": order["id"], "restaurant_id": operation["restaurant_id"], "account_operation.id": operation["id"]}
    if operation.get("branch_id") is not None:
        scope["branch_id"] = operation["branch_id"]
    if operation.get("phase") != "committed":
        await db.orders.update_one(scope, {"$set": operation["original_patch"]})
        for child in operation["children"]:
            child_filter = {"id": child["id"], "restaurant_id": operation["restaurant_id"]}
            existing = await db.orders.find_one(child_filter, {"_id": 0})
            if existing:
                expected = {key: value for key, value in child.items() if key != "account_operation_id"}
                actual = {key: value for key, value in existing.items() if key not in ("_id", "account_operation_id")}
                if existing.get("account_operation_id") != operation["id"] or any(actual.get(key) != value for key, value in expected.items()):
                    raise HTTPException(status_code=409, detail="Una cuenta hija existente no coincide con la operación")
            else:
                try:
                    await db.orders.insert_one(child)
                except DuplicateKeyError:
                    existing = await db.orders.find_one(child_filter, {"_id": 0})
                    if not existing or existing.get("account_operation_id") != operation["id"]:
                        raise HTTPException(status_code=409, detail="Una cuenta hija existente no coincide con la operación")
        if operation.get("attention_id"):
            for child in operation["children"]:
                await db.attentions.update_one({"id": operation["attention_id"], "restaurant_id": operation["restaurant_id"]}, {"$addToSet": {"order_ids": child["id"]}})
        committed = {**operation, "phase": "committed"}
        result = await db.orders.update_one(scope, {"$set": {"account_operation": committed}})
        if getattr(result, "matched_count", 0) != 1:
            raise HTTPException(status_code=409, detail="No se pudo confirmar la división de cuentas")
        operation = committed
    for child in operation["children"]:
        await db.orders.update_one({"id": child["id"], "restaurant_id": operation["restaurant_id"], "account_operation_id": operation["id"]}, {"$unset": {"account_operation_id": ""}})
    await db.orders.update_one(scope, {"$set": {"last_account_operation": {
        "id": operation["id"], "kind": "split", "parts": operation["parts"],
        "child_ids": [child["id"] for child in operation["children"]],
        "updated_at": operation["original_patch"].get("updated_at"),
    }}, "$unset": {"account_operation": ""}})


@router.post("/{order_id}/split")
async def split_order(order_id: str, data: OrderSplit, user: dict = Depends(require_roles(["admin", "mozo"]))):
    """Split an unpaid account using fixed child identities and resumable intent."""
    order = await db.orders.find_one(await _order_lookup_scope(order_id, user), {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    operation = order.get("account_operation")
    last_operation = order.get("last_account_operation") or {}
    if (not operation and last_operation.get("kind") == "split" and last_operation.get("parts") == data.parts
            and order.get("updated_at") == last_operation.get("updated_at")):
        return await _current_order_response(order_id, user)
    if operation:
        if operation.get("kind") != "split" or operation.get("parts") != data.parts:
            raise HTTPException(status_code=409, detail="La cuenta está terminando otra operación; reintentá en unos segundos")
        await _resume_split_operation(order, operation)
        return await _current_order_response(order_id, user)
    if order["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="No se puede dividir una cuenta cerrada")
    if (order.get("amount_paid") or 0) > 0.009:
        raise HTTPException(status_code=400, detail="La cuenta ya tiene cobros; anulalos antes de dividir")
    items = order.get("items") or []
    parts = data.parts
    if parts > len(items):
        raise HTTPException(status_code=400, detail="No hay suficientes productos para dividir en tantas partes")
    groups = [[] for _ in range(parts)]
    for idx, item in enumerate(items):
        groups[idx % parts].append(item)
    subtotal0, total0 = split_group_totals(groups[0])
    original_patch = {"items": groups[0], "subtotal": subtotal0, "total": total0, "discount": 0.0, "tip": 0.0,
                      "updated_at": _now(), **ticket_fields(order, order.get("fulfillment_status") or order.get("status"), order.get("amount_paid"), total0)}
    operation_id = str(uuid.uuid4())
    children = []
    for group in groups[1:]:
        subtotal_g, total_g = split_group_totals(group)
        child = {"id": str(uuid.uuid4()), "order_number": await _next_order_number(user["restaurant_id"]),
                 "restaurant_id": order["restaurant_id"], "table_id": order.get("table_id"),
                 "created_by": user["id"], "created_by_name": user.get("full_name"), "status": order["status"],
                 "order_type": order.get("order_type") or "mesa", "items": group, "subtotal": subtotal_g,
                 "discount": 0.0, "tip": 0.0, "total": total_g, "notes": None, "cancellation_reason": None,
                 "sent_to_kitchen_at": None, "ready_at": None, "paid_at": None, "created_at": _now(), "updated_at": _now(),
                 "attention_id": order.get("attention_id"), "attention_state": order.get("attention_state") or "open",
                 "attention_open": True, "account_operation_id": operation_id}
        if order.get("branch_id") is not None:
            child["branch_id"] = order["branch_id"]
        children.append(child)
    operation = {"id": operation_id, "kind": "split", "parts": parts, "restaurant_id": order["restaurant_id"],
                 "branch_id": order.get("branch_id"), "attention_id": order.get("attention_id"),
                 "original_patch": original_patch, "children": children,
                 "result_status": original_patch.get("status", order["status"])}
    claim = {"id": order["id"], "restaurant_id": order["restaurant_id"], "updated_at": order.get("updated_at"),
             "account_operation": {"$exists": False}, "account_operation_ref": {"$exists": False},
             "payment_operation": {"$exists": False}}
    if order.get("branch_id") is not None:
        claim["branch_id"] = order["branch_id"]
    result = await db.orders.update_one(claim, {"$set": {"account_operation": operation}})
    if getattr(result, "matched_count", 0) != 1:
        raise HTTPException(status_code=409, detail="La cuenta cambió mientras la revisabas")
    await _resume_split_operation(order, operation)
    emit_order(user["restaurant_id"], order_id, operation["result_status"], source=order.get("source"), extra="split", branch_id=order.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.patch("/{order_id}/alias")
async def set_order_alias(order_id: str, data: OrderAlias, user: dict = Depends(require_roles(["admin", "mozo"]))):
    """Identidad de la cuenta: el alias con el que viaja a cocina, y si es la
    compartida de la mesa. El alias se guarda al enviar el pedido, no antes."""
    order = await db.orders.find_one(await _order_lookup_scope(order_id, user), {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if order["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="No se puede modificar un pedido cerrado")
    patch = {"updated_at": _now()}
    if data.alias is not None:
        patch["customer_name"] = (data.alias or "").strip() or None
    if data.shared is not None:
        patch["shared"] = bool(data.shared)
    await _save_order(order, patch)
    return await _current_order_response(order_id, user)


@router.patch("/{order_id}/notes")
async def set_order_notes(order_id: str, data: OrderNotes, user: dict = Depends(require_roles(["admin", "mozo"]))):
    """Nota general para cocina del pedido. Vacía = limpiar.

    Mismos guardas que el alias: sólo pedidos abiertos, con el alcance de
    sucursal del usuario. Cocina la lee del propio pedido (`order.notes`).
    """
    order = await db.orders.find_one(await _order_lookup_scope(order_id, user), {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if order["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="No se puede modificar un pedido cerrado")
    await _save_order(order, {"notes": (data.notes or "").strip() or None, "updated_at": _now()})
    return await _current_order_response(order_id, user)


@router.delete("/{order_id}/items/{item_id}")
async def remove_item(order_id: str, item_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user))
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if o["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="No se puede modificar un pedido cerrado")
    target = next((i for i in (o.get("items") or []) if i["id"] == item_id), None)
    if target is not None and not is_draft(target):
        # Un producto que cocina ya conoce no desaparece con "−": se anula.
        raise HTTPException(status_code=400, detail="Ese producto ya fue enviado a cocina. Usá Anular producto.")
    items = [i for i in (o.get("items") or []) if i["id"] != item_id]
    subtotal, total = guarded_totals(o, items, removed_item=target)
    await _save_order(o, {
        "items": items,
        "subtotal": subtotal,
        "total": total,
        "updated_at": _now(),
        **ticket_fields(o, o.get("fulfillment_status") or o.get("status"), o.get("amount_paid"), total),
    })
    emit_order(user["restaurant_id"], order_id, o["status"], source=o.get("source"), extra="item_removed", branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/items/{item_id}/void")
async def void_item(order_id: str, item_id: str, data: OrderItemVoid, user: dict = Depends(require_roles(["admin", "mozo"]))):
    """Anula un producto ya enviado a cocina, sin borrarlo del historial."""
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user))
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if o["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="No se puede modificar un pedido cerrado")
    items = o.get("items") or []
    target = next((i for i in items if i["id"] == item_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")
    if is_cancelled(target):
        return await _current_order_response(order_id, user)
    if int(target.get("paid_qty") or 0) > 0:
        raise HTTPException(status_code=400, detail="No podés anular un producto que ya fue cobrado")
    reason = (data.reason or "").strip()
    now = _now()
    target["status"] = "cancelado"
    target["void_reason"] = reason
    target["voided_at"] = now
    target["voided_by"] = user["id"]
    target["voided_by_name"] = user.get("full_name")
    subtotal, total = guarded_totals(o, items)
    new_status = _derive_kitchen_status(items, o["status"])
    patch = {"items": items, "subtotal": subtotal, "total": total, "updated_at": now}
    patch.update(ticket_fields(o, new_status, o.get("amount_paid"), total))
    await _save_order(o, patch)
    await _audit(user["restaurant_id"], user["id"], "void_item", "order", order_id, {"item_id": item_id, "reason": reason})
    emit_order(user["restaurant_id"], order_id, new_status, source=o.get("source"), extra="item_voided", branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/items/{item_id}/move")
async def move_item(order_id: str, item_id: str, data: OrderItemMove, user: dict = Depends(require_roles(["admin", "mozo"]))):
    """Mueve un producto de una persona a otra de la misma mesa y visita.

    Sirve para corregir "quién pidió qué" sin borrar y volver a cargar: el ítem
    conserva su estado, su hora y sus observaciones.
    """
    source = await db.orders.find_one(await _order_lookup_scope(order_id, user), {"_id": 0})
    if not source:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if source.get("account_operation") or source.get("account_operation_ref") or source.get("account_operation_id"):
        raise HTTPException(status_code=409, detail="La cuenta está terminando otra operación; reintentá en unos segundos")
    if source["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="No se puede modificar un pedido cerrado")
    target = await db.orders.find_one(await _order_lookup_scope(data.target_order_id, user), {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Cuenta destino no encontrada")
    if target.get("account_operation") or target.get("account_operation_ref") or target.get("account_operation_id"):
        raise HTTPException(status_code=409, detail="La cuenta está terminando otra operación; reintentá en unos segundos")
    if target["id"] == source["id"]:
        raise HTTPException(status_code=400, detail="Elegí otra persona")
    if target["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="La cuenta destino está cerrada")
    if target.get("attention_id") != source.get("attention_id"):
        raise HTTPException(status_code=400, detail="Las cuentas deben pertenecer a la misma visita")
    item = next((i for i in (source.get("items") or []) if i["id"] == item_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")
    if is_cancelled(item):
        raise HTTPException(status_code=400, detail="El producto está anulado")
    if int(item.get("paid_qty") or 0) > 0:
        raise HTTPException(status_code=400, detail="No podés mover un producto que ya fue cobrado")

    now = _now()
    source_items = [i for i in (source.get("items") or []) if i["id"] != item_id]
    moved = dict(item)
    moved["moved_from"] = source["id"]
    moved["moved_at"] = now
    target_items = (target.get("items") or []) + [moved]

    source_subtotal, source_total = guarded_totals(source, source_items)
    target_subtotal, target_total = guarded_totals(target, target_items)

    source_patch = {
        "items": source_items,
        "subtotal": source_subtotal,
        "total": source_total,
        "updated_at": now,
    }
    # Una cuenta que se queda sin nada y sin cobros no tiene por qué seguir
    # abierta ocupando lugar entre las personas de la mesa.
    emptied = not [i for i in source_items if not is_cancelled(i)]
    if emptied and float(source.get("amount_paid") or 0) <= 0.009:
        source_patch.update({
            "status": "cancelado",
            "cancellation_reason": "Cuenta sin productos: su último producto pasó a otra persona",
        })
    else:
        source_patch.update(ticket_fields(
            source, source.get("fulfillment_status") or source["status"],
            source.get("amount_paid"), source_total,
        ))

    target_status = _derive_kitchen_status(target_items, target["status"])
    if target["status"] in ("entregado", "pendiente_pago"):
        target_status = target["status"]
    target_patch = {
        "items": target_items,
        "subtotal": target_subtotal,
        "total": target_total,
        "updated_at": now,
    }
    target_patch.update(ticket_fields(target, target_status, target.get("amount_paid"), target_total))

    await _save_order(source, source_patch)
    await _save_order(target, target_patch)
    await _audit(user["restaurant_id"], user["id"], "move_item", "order", order_id,
                 {"item_id": item_id, "target_order_id": target["id"]})
    emit_order(user["restaurant_id"], source["id"], source_patch.get("status", source["status"]),
               source=source.get("source"), extra="item_moved_out", branch_id=source.get("branch_id"))
    emit_order(user["restaurant_id"], target["id"], target_status,
               source=target.get("source"), extra="item_moved_in", branch_id=target.get("branch_id"))
    return await _current_order_response(target["id"], user)


@router.patch("/{order_id}/items/{item_id}")
async def update_item(order_id: str, item_id: str, data: OrderItemUpdate, user: dict = Depends(require_roles(["admin", "mozo"]))):
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user))
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if o["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="No se puede modificar un pedido cerrado")
    items = o.get("items") or []
    found = False
    for it in items:
        if it["id"] == item_id:
            # Lo que cocina ya recibió no se edita en silencio: se anula y se
            # vuelve a pedir. Sólo el borrador se corrige libremente.
            if not is_draft(it):
                raise HTTPException(status_code=400, detail="Ese producto ya fue enviado a cocina. Anulalo y volvé a pedirlo.")
            if data.quantity is not None:
                it["quantity"] = data.quantity
                it["subtotal"] = line_subtotal(it["unit_price"], data.quantity)
            if data.notes is not None:
                it["notes"] = data.notes
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")
    subtotal, total = guarded_totals(o, items)
    await _save_order(o, {
        "items": items,
        "subtotal": subtotal,
        "total": total,
        "updated_at": _now(),
        **ticket_fields(o, o.get("fulfillment_status") or o.get("status"), o.get("amount_paid"), total),
    })
    emit_order(user["restaurant_id"], order_id, o["status"], source=o.get("source"), extra="item_updated", branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/send-to-kitchen")
async def send_to_kitchen(order_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user))
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    items = o.get("items") or []
    if not items:
        raise HTTPException(status_code=400, detail="El pedido no tiene productos")
    if o["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="El pedido ya está cerrado")

    first_send = o["status"] == "nuevo"
    if first_send:
        # Una orden que nunca salió manda todo lo que siga pendiente de cocina.
        to_send = [it for it in items if not is_cancelled(it) and it.get("status") != "entregado"]
    else:
        # Envío de adicionales: sólo viaja lo nuevo, no se repite la comanda.
        to_send = [it for it in items if is_draft(it) or it.get("status") in (None, "", "nuevo")]

    if not to_send:
        # Nada nuevo que mandar: sólo se reintenta numerar si quedó pendiente.
        if o.get("attention_number_pending"):
            await number_accepted_order(db, order=o)
        return await _current_order_response(order_id, user)

    now = _now()
    for it in to_send:
        it["status"] = "pendiente"
        it.setdefault("added_at", now)

    patch = {
        "status": "enviado_cocina",
        "fulfillment_status": "enviado_cocina",
        "sent_to_kitchen_at": o.get("sent_to_kitchen_at") or now,
        "items": items,
        "updated_at": now,
    }
    if first_send:
        patch["acceptance_status"] = "aceptado"
    if first_send and o.get("order_type") in ("mesa", "recojo"):
        branch_id = o.get("branch_id") if o.get("table_id") else user.get("branch_id")
        attention_id = o.get("attention_id") or str(uuid.uuid4())
        try:
            context = await capture_attention_context(
                db, tenant_id=user["restaurant_id"], branch_id=branch_id, confirmed_at=now
            )
        except AttentionAcceptanceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        patch.update({
            "branch_id": branch_id,
            "attention_id": attention_id,
            "attention_number_context": context,
            "attention_number_pending": True,
        })
    await _save_order(o, patch)
    o.update(patch)
    # Only the request that wins the acceptance CAS owns the existing side effects.
    # Number propagation is separately retryable and must not repeat these effects.
    await _audit(user["restaurant_id"], user["id"], "send_to_kitchen", "order", order_id)
    emit_order(user["restaurant_id"], order_id, "enviado_cocina", source="staff", branch_id=o.get("branch_id"))
    if o.get("attention_number_pending"):
        await number_accepted_order(db, order=o)
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/bump")
async def bump_kitchen(order_id: str, data: KitchenBump, user: dict = Depends(require_roles(["admin", "cocina"]))):
    from_status = data.from_status
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user))
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    try:
        assert_kitchen_open(o)
    except FlowError as exc:
        raise HTTPException(status_code=400, detail=exc.detail)
    to_status = "en_preparacion" if from_status == "pendiente" else "listo"
    items = o.get("items") or []
    moved = 0
    for it in items:
        st = it.get("status") or "pendiente"
        if st == from_status or (from_status == "pendiente" and st in ("pendiente", None, "nuevo")):
            it["status"] = to_status
            if to_status == "en_preparacion":
                it["started_at"] = it.get("started_at") or _now()
            if to_status == "listo":
                it["ready_at"] = _now()
            moved += 1
    if moved == 0:
        raise HTTPException(status_code=400, detail="Nada para avanzar")
    new_status = _derive_kitchen_status(items, o["status"])
    patch = {"items": items, "status": new_status, "fulfillment_status": new_status, "updated_at": _now()}
    if new_status == "listo":
        patch["ready_at"] = _now()
    await _save_order(o, patch)
    emit_order(user["restaurant_id"], order_id, new_status, source=o.get("source"), extra="bump", branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/items/{item_id}/status")
async def bump_item(order_id: str, item_id: str, data: OrderItemStatusUpdate, user: dict = Depends(require_roles(["admin", "cocina"]))):
    if data.status not in ("en_preparacion", "listo"):
        raise HTTPException(status_code=400, detail="Estado de ítem no permitido")
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user))
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    try:
        assert_kitchen_open(o)
    except FlowError as exc:
        raise HTTPException(status_code=400, detail=exc.detail)
    found = False
    items = o.get("items") or []
    for it in items:
        if it["id"] == item_id:
            try:
                assert_item_transition(it.get("status"), data.status)
            except FlowError as exc:
                raise HTTPException(status_code=400, detail=exc.detail)
            it["status"] = data.status
            if data.status == "en_preparacion":
                it["started_at"] = it.get("started_at") or _now()
            if data.status == "listo":
                it["ready_at"] = _now()
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")
    new_status = _derive_kitchen_status(items, o["status"])
    patch = {"items": items, "status": new_status, "fulfillment_status": new_status, "updated_at": _now()}
    if new_status == "listo":
        patch["ready_at"] = _now()
    await _save_order(o, patch)
    emit_order(user["restaurant_id"], order_id, new_status, source=o.get("source"), extra="item_bump", branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/serve")
async def serve_order(order_id: str, user: dict = Depends(require_roles(["admin", "mozo", "cocina"]))):
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user))
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    try:
        assert_can_serve(o)
    except FlowError as exc:
        raise HTTPException(status_code=400, detail=exc.detail)
    items = o.get("items") or []
    for it in items:
        if it.get("status") != "cancelado":
            it["status"] = "entregado"
    patch = {"items": items, "updated_at": _now()}
    patch.update(ticket_fields(o, "entregado", o.get("amount_paid"), o.get("total")))
    await _save_order(o, patch)
    await _release_paid_table(o, patch["status"])
    await _audit(user["restaurant_id"], user["id"], "serve", "order", order_id)
    emit_order(user["restaurant_id"], order_id, patch["status"], source=o.get("source"), extra="serve", branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/reassign")
async def reassign_waiter(order_id: str, data: OrderReassign, user: dict = Depends(require_roles(["admin"]))):
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user), {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    waiter = await db.users.find_one(
        {"id": data.waiter_id, "restaurant_id": user["restaurant_id"], "status": "active"},
        {"_id": 0, "password_hash": 0},
    )
    if not waiter:
        raise HTTPException(status_code=404, detail="Mozo no encontrado")
    await _save_order(o, {
        "created_by": waiter["id"],
        "created_by_name": waiter["full_name"],
        "updated_at": _now(),
    })
    await _audit(user["restaurant_id"], user["id"], "reassign_waiter", "order", order_id, {"waiter_id": waiter["id"]})
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/confirm-payment")
async def confirm_public_payment(order_id: str, user: dict = Depends(require_roles(["admin", "cajero"]))):
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user))
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if o["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="El pedido ya está cerrado")
    # Un pedido prepagado no se libera marcando el pago: hay que registrar el
    # cobro y abrir la visita, o quedaría en cocina sin dinero respaldándolo.
    if o.get("acceptance_status") == "pendiente":
        raise HTTPException(
            status_code=409,
            detail="Confirmá el prepago desde Caja para registrar el cobro y enviarlo a cocina",
        )
    await _save_order(o, {"payment_status": "confirmado", "payment_proof_status": "verificado", "updated_at": _now()})
    await _audit(user["restaurant_id"], user["id"], "confirm_public_payment", "order", order_id)
    emit_order(user["restaurant_id"], order_id, o["status"], source=o.get("source"), payment_status="confirmado", branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/status")
async def change_status(order_id: str, data: OrderStatusUpdate, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user))
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    role = user["role"]
    new_status = data.status

    # Statuses that must never be set manually through this endpoint
    if new_status in ("pagado", "nuevo", "enviado_cocina"):
        raise HTTPException(status_code=400, detail="Este estado no se puede fijar manualmente")

    # Permission rules per status
    if new_status in ("en_preparacion", "listo") and role not in ("admin", "cocina"):
        raise HTTPException(status_code=403, detail="Solo cocina puede cambiar a este estado")
    if new_status == "entregado" and role not in ("admin", "mozo"):
        raise HTTPException(status_code=403, detail="Solo el mozo puede marcar entregado")
    if new_status == "pendiente_pago" and role not in ("admin", "mozo"):
        raise HTTPException(status_code=403, detail="Solo el mozo puede solicitar la cuenta")
    if new_status == "cancelado" and role not in ("admin", "cajero"):
        raise HTTPException(status_code=403, detail="Solo admin/cajero puede cancelar")
    if new_status == "cancelado" and not data.reason:
        raise HTTPException(status_code=400, detail="Se requiere motivo de cancelación")
    if new_status == "cancelado":
        assert_can_cancel(o)
    try:
        assert_order_transition(o["status"], new_status)
    except FlowError as exc:
        raise HTTPException(status_code=400, detail=exc.detail)
    if new_status == "listo":
        try:
            assert_items_ready_to_finish(o)
        except FlowError as exc:
            raise HTTPException(status_code=400, detail=exc.detail)
    if new_status == "entregado":
        try:
            assert_can_serve(o)
        except FlowError as exc:
            raise HTTPException(status_code=400, detail=exc.detail)

    update = {"status": new_status, "updated_at": _now()}
    if new_status == "listo":
        update["ready_at"] = _now()
        items = o.get("items") or []
        for it in items:
            if it.get("status") == "en_preparacion":
                it["status"] = "listo"
                it["ready_at"] = _now()
        update["items"] = items
    if new_status == "en_preparacion":
        items = o.get("items") or []
        for it in items:
            if (it.get("status") or "pendiente") in ("pendiente", "nuevo"):
                it["status"] = "en_preparacion"
                it["started_at"] = it.get("started_at") or _now()
        update["items"] = items
    if new_status == "cancelado":
        update["cancellation_reason"] = data.reason
        items = o.get("items") or []
        for item in items:
            if item.get("status") != "entregado":
                item["status"] = "cancelado"
        update["items"] = items
        if o.get("attention_state") == "opening":
            # La apertura nunca llegó a ser visita. Sin cerrarla acá, el pedido
            # cancelado sigue contando como la cuenta viva de la mesa y el salón
            # abre su hoja en un pedido muerto —con todos los platos anulados—,
            # escondiendo las cuentas que sí están en curso.
            update["attention_state"] = "closed"
            update["attention_open"] = False
    if new_status == "entregado":
        items = o.get("items") or []
        for it in items:
            if it.get("status") == "listo":
                it["status"] = "entregado"
        update["items"] = items
    if new_status == "pendiente_pago":
        fulfillment = o.get("fulfillment_status") or o.get("status")
        update.update(ticket_fields(o, fulfillment, o.get("amount_paid"), o.get("total")))
        update["payment_requested"] = True
    else:
        update.update(ticket_fields(o, new_status, o.get("amount_paid"), o.get("total")))
    if update["status"] == "pagado":
        update["paid_at"] = o.get("paid_at") or _now()
    if new_status == "pendiente_pago" and o.get("table_id") and update.get("payment_status") != "pagado":
        table_scope = {"id": o["table_id"], "restaurant_id": user["restaurant_id"]}
        if o.get("branch_id") is not None:
            table_scope["branch_id"] = o["branch_id"]
        await db.tables.update_one(
            table_scope,
            {"$set": {"status": "esperando_pago", "updated_at": _now()}}
        )
        emit_notice(user["restaurant_id"], "table", table_id=o["table_id"], status="esperando_pago", branch_id=o.get("branch_id"))

    await _save_order(o, update)
    if new_status == "cancelado" and o.get("table_id") and not o.get("attention_id"):
        await db.tables.update_one({"id": o["table_id"], "restaurant_id": user["restaurant_id"],
                                    **({"branch_id": o["branch_id"]} if o.get("branch_id") is not None else {})},
            {"$set": {"status": "disponible", "updated_at": _now()}})
        emit_notice(user["restaurant_id"], "table", table_id=o["table_id"], status="disponible", branch_id=o.get("branch_id"))
    # Una intención de prepago que nunca se pagó reserva la mesa sin visita
    # abierta. Si el restaurante la cancela, la reserva debe soltarse: si no, la
    # mesa queda trabada y nadie puede volver a abrirla desde el QR.
    if new_status == "cancelado" and o.get("table_id") and o.get("attention_state") == "opening":
        released = await discard_table_opening(
            db, table_id=o["table_id"], restaurant_id=user["restaurant_id"], order_id=order_id
        )
        if released:
            await db.tables.update_one(
                {"id": o["table_id"], "restaurant_id": user["restaurant_id"],
                 **({"branch_id": o["branch_id"]} if o.get("branch_id") is not None else {})},
                {"$set": {"status": "disponible", "updated_at": _now()}},
            )
            emit_notice(user["restaurant_id"], "table", table_id=o["table_id"], status="disponible", branch_id=o.get("branch_id"))
    await _release_paid_table(o, update["status"])
    await _audit(user["restaurant_id"], user["id"], f"status:{new_status}", "order", order_id, {"reason": data.reason})
    emit_order(user["restaurant_id"], order_id, update["status"], source=o.get("source"), branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)
