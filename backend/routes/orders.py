from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import uuid
from pymongo.errors import DuplicateKeyError
from database import db
from auth import get_current_user, require_roles, user_functions
from models import OrderCreate, OrderItemInput, OrderItemUpdate, OrderStatusUpdate, OrderItemStatusUpdate, KitchenBump, OrderReassign, OrderMerge
from billing import BillError, assert_can_cancel, guarded_totals
from order_flow import (
    FlowError,
    assert_can_serve,
    assert_item_transition,
    assert_items_ready_to_finish,
    assert_kitchen_open,
    assert_order_transition,
    ticket_fields,
    VersionError,
    claim_order,
    version_conflict,
)
from routes.products import combo_components_for
from notify import emit_order, emit_notice
from attention import AttentionBlocked, open_table_attention, close_table_attention, reserve_table_opening, recover_opening_intent
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
    proj = {"_id": 0}
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
    if not order or {"cobro", "administracion"}.intersection(user_functions(user)):
        return order
    safe = dict(order)
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


async def _next_order_number(restaurant_id: str) -> int:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    res = await db.counters.find_one_and_update(
        {"restaurant_id": restaurant_id, "key": f"order_{today}"},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    # Some Motor versions need different return_document handling; fetch as fallback
    if not res or "value" not in (res or {}):
        res = await db.counters.find_one({"restaurant_id": restaurant_id, "key": f"order_{today}"})
    return res.get("value", 1) if res else 1


async def _compute_total(items: list, restaurant_id: str):
    subtotal = 0.0
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
        line_subtotal = prod["price"] * it["quantity"]
        combo_components = await combo_components_for(prod, restaurant_id)
        if prod.get("is_combo") and (not combo_components or any(not c.get("is_available", True) for c in combo_components)):
            raise HTTPException(status_code=400, detail=f"El combo {prod['name']} no está disponible: un componente está agotado")
        enriched.append({
            "id": it.get("id") or str(uuid.uuid4()),
            "product_id": prod["id"],
            "product_name": prod["name"],
            "quantity": it["quantity"],
            "unit_price": prod["price"],
            "subtotal": line_subtotal,
            "notes": it.get("notes"),
            "status": it.get("status", "pendiente"),
            "added_at": it.get("added_at") or _now(),
            "prep_minutes": int(prod.get("preparation_time") or 15),
            "is_combo": bool(prod.get("is_combo")),
            "combo_components": combo_components,
        })
        subtotal += line_subtotal
    return enriched, subtotal


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


def _apply_bill(order: dict, items: list, removed_item: dict = None):
    try:
        return guarded_totals(order, items, removed_item=removed_item)
    except BillError as exc:
        raise HTTPException(status_code=400, detail=exc.detail)


def _derive_kitchen_status(items: list, current: str) -> str:
    if current in ("pagado", "cancelado"):
        return current
    work = [i for i in items if i.get("status") not in ("entregado", "cancelado")]
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
    projection = {"_id": 0, "discount": 0, "tip": 0, "total": 0, "paid_at": 0, "payment_proof_url": 0,
                  "payment_proof_method": 0, "payment_proof_sha256": 0, "payment_proof_uploaded_by": 0,
                  "payment_proof_uploaded_at": 0}
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
        if o.get("status") == "entregado" or o.get("acceptance_status") == "pendiente":
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
        it["status"] = "pendiente"
        it["added_at"] = _now()
    combined = (o.get("items") or []) + enriched_new
    subtotal, total = _apply_bill(o, combined)
    new_status = _derive_kitchen_status(combined, o["status"])
    if o["status"] in ("entregado", "pendiente_pago"):
        new_status = "enviado_cocina"
    patch = {"items": combined, "subtotal": subtotal, "total": total, "updated_at": _now()}
    patch.update(ticket_fields(o, new_status, o.get("amount_paid"), total))
    await _save_order(o, patch)
    emit_order(user["restaurant_id"], order_id, new_status, source=o.get("source"), extra="items_added", branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.post("/{order_id}/merge")
async def merge_order(order_id: str, data: OrderMerge, user: dict = Depends(require_roles(["admin", "mozo"]))):
    """Fusiona la cuenta `source_order_id` dentro de `order_id` (misma mesa y visita)."""
    target = await db.orders.find_one(await _order_lookup_scope(order_id, user), {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    source = await db.orders.find_one(await _order_lookup_scope(data.source_order_id, user), {"_id": 0})
    if not source:
        raise HTTPException(status_code=404, detail="Cuenta a fusionar no encontrada")
    if source["id"] == target["id"]:
        raise HTTPException(status_code=400, detail="Elegí cuentas distintas")
    if target["status"] in ("pagado", "cancelado") or source["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="Solo se pueden fusionar cuentas abiertas")
    if target.get("table_id") != source.get("table_id"):
        raise HTTPException(status_code=400, detail="Las cuentas deben estar en la misma mesa")
    if target.get("attention_id") != source.get("attention_id"):
        raise HTTPException(status_code=400, detail="Las cuentas deben pertenecer a la misma visita")
    if (source.get("amount_paid") or 0) > 0.009:
        raise HTTPException(status_code=400, detail="La cuenta a fusionar ya tiene cobros; anulalos antes de fusionar")
    combined = (target.get("items") or []) + (source.get("items") or [])
    subtotal, total = _apply_bill(target, combined)
    new_status = _derive_kitchen_status(combined, target["status"])
    if target["status"] in ("entregado", "pendiente_pago"):
        new_status = "enviado_cocina"
    patch = {"items": combined, "subtotal": subtotal, "total": total, "updated_at": _now()}
    patch.update(ticket_fields(target, new_status, target.get("amount_paid"), total))
    await _save_order(target, patch)
    await _save_order(source, {
        "status": "cancelado",
        "cancellation_reason": f"Fusionada con #{target.get('order_number')}",
        "updated_at": _now(),
    })
    emit_order(user["restaurant_id"], order_id, new_status, source=target.get("source"), extra="merged", branch_id=target.get("branch_id"))
    return await _current_order_response(order_id, user)


@router.delete("/{order_id}/items/{item_id}")
async def remove_item(order_id: str, item_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    o = await db.orders.find_one(await _order_lookup_scope(order_id, user))
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if o["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="No se puede modificar un pedido cerrado")
    target = next((i for i in (o.get("items") or []) if i["id"] == item_id), None)
    items = [i for i in (o.get("items") or []) if i["id"] != item_id]
    subtotal, total = _apply_bill(o, items, removed_item=target)
    await _save_order(o, {
        "items": items,
        "subtotal": subtotal,
        "total": total,
        "updated_at": _now(),
        **ticket_fields(o, o.get("fulfillment_status") or o.get("status"), o.get("amount_paid"), total),
    })
    emit_order(user["restaurant_id"], order_id, o["status"], source=o.get("source"), extra="item_removed", branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)


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
            if data.quantity is not None:
                it["quantity"] = data.quantity
                it["subtotal"] = it["unit_price"] * data.quantity
            if data.notes is not None:
                it["notes"] = data.notes
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")
    subtotal, total = _apply_bill(o, items)
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
    if not (o.get("items") or []):
        raise HTTPException(status_code=400, detail="El pedido no tiene productos")
    if o["status"] == "enviado_cocina" and o.get("acceptance_status") == "aceptado":
        if o.get("attention_number_pending"):
            await number_accepted_order(db, order=o)
            return await _current_order_response(order_id, user)
        if o.get("attention_number_context") and o.get("attention_number") is not None:
            return await _current_order_response(order_id, user)
    if o["status"] == "enviado_cocina" and o.get("attention_number_pending"):
        await number_accepted_order(db, order=o)
        return await _current_order_response(order_id, user)
    if o["status"] not in ("nuevo",):
        raise HTTPException(status_code=400, detail="Solo pedidos nuevos pueden enviarse a cocina")
    items = o["items"]
    for it in items:
        it["status"] = "pendiente"
        it.setdefault("added_at", _now())
    now = _now()
    patch = {
        "status": "enviado_cocina",
        "fulfillment_status": "enviado_cocina",
        "acceptance_status": "aceptado",
        "sent_to_kitchen_at": now,
        "items": items,
        "updated_at": now,
    }
    if o.get("order_type") in ("mesa", "recojo"):
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
        try:
            assert_can_cancel(o)
        except BillError as exc:
            raise HTTPException(status_code=400, detail=exc.detail)
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
    await _release_paid_table(o, update["status"])
    await _audit(user["restaurant_id"], user["id"], f"status:{new_status}", "order", order_id, {"reason": data.reason})
    emit_order(user["restaurant_id"], order_id, update["status"], source=o.get("source"), branch_id=o.get("branch_id"))
    return await _current_order_response(order_id, user)
