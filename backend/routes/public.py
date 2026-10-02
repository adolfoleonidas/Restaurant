from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone
import asyncio
import hashlib
import json
import uuid
import secrets
import string
from pymongo.errors import DuplicateKeyError
from database import db
from models import PublicOrderCreate, PublicProofUpload, PublicItemsAdd, PublicItemUpdate
from billing import BillError, guarded_totals
from order_flow import VersionError, claim_order, version_conflict
from attention import AttentionBlocked, open_table_attention, reserve_table_opening, recover_opening_intent
from attention_acceptance import AttentionAcceptanceError, capture_attention_context, number_accepted_order
from guest_access import client_host, public_order_limiter, read_table_token
from routes.products import combo_components_for
from notify import emit_order, emit_notice, subscribe, unsubscribe, public_allowed

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _gen_tracking() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(8))


_ACTIVE_ORDER_STATUSES = [
    "nuevo",
    "enviado_cocina",
    "en_preparacion",
    "listo",
    "entregado",
    "pendiente_pago",
]


def _derive_kitchen_status(items: list, current: str) -> str:
    if current in ("pagado", "cancelado", "pendiente_pago"):
        return current
    work = [i for i in items if i.get("status") not in ("entregado", "cancelado")]
    if not work:
        return current
    if all(i.get("status") == "listo" for i in work):
        return "listo"
    if any(i.get("status") == "en_preparacion" for i in work):
        return "en_preparacion"
    return "enviado_cocina"


async def _enrich_items(items, r):
    enriched = []
    subtotal = 0.0
    for it in items:
        prod = await db.products.find_one(
            {"id": it.product_id, "restaurant_id": r["id"]},
            {"_id": 0}
        )
        if not prod or not prod.get("is_available", True):
            raise HTTPException(status_code=400, detail=f"Producto no disponible: {it.product_id}")
        line = prod["price"] * it.quantity
        combo_components = await combo_components_for(prod, r["id"])
        if prod.get("is_combo") and (not combo_components or any(not c.get("is_available", True) for c in combo_components)):
            raise HTTPException(status_code=400, detail=f"El combo {prod['name']} no está disponible: un componente está agotado")
        enriched.append({
            "id": str(uuid.uuid4()),
            "product_id": prod["id"],
            "product_name": prod["name"],
            "quantity": it.quantity,
            "unit_price": prod["price"],
            "subtotal": line,
            "notes": it.notes,
            "status": "pendiente",
            "added_at": _now(),
            "is_combo": bool(prod.get("is_combo")),
            "combo_components": combo_components,
        })
        subtotal += line
    return enriched, subtotal


def _public_order_view(o: dict) -> dict:
    return {
        "id": o["id"],
        "order_number": o["order_number"],
        "tracking_code": o["tracking_code"],
        "status": o["status"],
        "order_type": o["order_type"],
        "items": o.get("items", []),
        "subtotal": o.get("subtotal", 0),
        "delivery_fee": o.get("delivery_fee", 0),
        "total": o.get("total", 0),
        "customer_name": o.get("customer_name"),
        "customer_phone": o.get("customer_phone"),
        "customer_address": o.get("customer_address"),
        "payment_method_choice": o.get("payment_method_choice"),
        "payment_status": o.get("payment_status"),
        "notes": o.get("notes"),
        "created_at": o.get("created_at"),
        "updated_at": o.get("updated_at"),
        "has_proof": bool(o.get("payment_proof_url")),
    }


def _public_order_fingerprint(data: PublicOrderCreate, restaurant_id: str, table_id: str | None) -> str:
    request_payload = data.model_dump(exclude={"request_id", "branch_id"})
    if data.order_type == "recojo" and data.branch_id is not None:
        request_payload["branch_id"] = data.branch_id
    payload = {
        "restaurant_id": restaurant_id,
        "table_id": table_id,
        "request": request_payload,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _public_order_response(order: dict) -> dict:
    return {
        "id": order["id"],
        "order_number": order["order_number"],
        "tracking_code": order["tracking_code"],
        "status": order["status"],
        "total": order["total"],
        "payment_method": order["payment_method_choice"],
    }


async def _finish_public_order(order: dict, data: PublicOrderCreate) -> dict:
    if order.get("attention_id") and order.get("attention_state") in ("opening", "open"):
        try:
            await open_table_attention(db, order=order, user={"id": None}, now=_now())
        except AttentionBlocked as exc:
            raise HTTPException(status_code=409, detail=f"La apertura quedó pendiente; reintentá el mismo pedido. {exc.detail}")
    if order.get("attention_number_pending"):
        try:
            await number_accepted_order(db, order=order)
        except AttentionAcceptanceError as exc:
            raise HTTPException(status_code=409, detail="El pedido quedó guardado y requiere conciliación") from exc
    event_id = None
    if order.get("request_id"):
        event_id = f"public-order-create:{order['restaurant_id']}:{order['request_id']}"
    existing_audit = await db.audit_logs.find_one({"event_id": event_id}) if event_id else None
    if existing_audit and (
        existing_audit.get("restaurant_id") != order["restaurant_id"]
        or existing_audit.get("entity_id") != order["id"]
        or existing_audit.get("action") != "public_order_create"
    ):
        raise HTTPException(status_code=409, detail="La solicitud requiere conciliación")
    if not existing_audit:
        if order.get("table_id"):
            emit_notice(order["restaurant_id"], "table", table_id=order["table_id"], status="ocupada")
        emit_order(order["restaurant_id"], order["id"], order["status"], source="public", order_number=order["order_number"])
        audit = {
            "id": str(uuid.uuid4()),
            "restaurant_id": order["restaurant_id"],
            "user_id": None,
            "action": "public_order_create",
            "entity": "order",
            "entity_id": order["id"],
            "details": {"order_number": order["order_number"], "tracking_code": order["tracking_code"], "customer": data.customer_name},
            "created_at": _now(),
        }
        if event_id:
            audit["event_id"] = event_id
        try:
            await db.audit_logs.insert_one(audit)
        except Exception:
            persisted = await db.audit_logs.find_one({"event_id": event_id}) if event_id else None
            if not persisted or persisted.get("entity_id") != order["id"] or persisted.get("restaurant_id") != order["restaurant_id"]:
                raise HTTPException(status_code=503, detail="El pedido quedó guardado; reintentá la misma solicitud")
    return _public_order_response(order)


def _public_mutate_guard(o: dict):
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if o["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="El pedido ya está cerrado")
    if o["status"] == "pendiente_pago":
        raise HTTPException(status_code=400, detail="La cuenta ya fue solicitada. Acercate a caja para pagar o consultá al mozo.")


async def _save_public_order(order: dict, fields: dict):
    try:
        await claim_order(db.orders, order, fields)
    except VersionError:
        raise HTTPException(status_code=409, detail=version_conflict(order))


def _money_totals(order: dict, items: list, removed_item: dict = None):
    try:
        return guarded_totals(order, items, removed_item=removed_item)
    except BillError as exc:
        raise HTTPException(status_code=400, detail=exc.detail)


async def _get_restaurant():
    r = await db.restaurants.find_one({}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=503, detail="Restaurante no configurado")
    return r


async def _next_order_number(restaurant_id: str) -> int:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    res = await db.counters.find_one_and_update(
        {"restaurant_id": restaurant_id, "key": f"order_{today}"},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    if not res or "value" not in (res or {}):
        res = await db.counters.find_one({"restaurant_id": restaurant_id, "key": f"order_{today}"})
    return res.get("value", 1) if res else 1


@router.get("/restaurant")
async def public_restaurant():
    r = await _get_restaurant()
    return {
        "id": r["id"],
        "name": r.get("name"),
        "address": r.get("address"),
        "phone": r.get("phone"),
        "logo_url": r.get("logo_url"),
        "cover_url": r.get("cover_url"),
        "opening_hours": r.get("opening_hours"),
        "currency": r.get("currency", "PEN"),
        "currency_symbol": r.get("currency_symbol", "S/"),
        "delivery_fee": r.get("delivery_fee", 0.0),
        "require_table_qr": bool(r.get("require_table_qr")),
        "public_description": r.get("public_description"),
        "social_facebook": r.get("social_facebook"),
        "social_instagram": r.get("social_instagram"),
        "social_whatsapp": r.get("social_whatsapp"),
    }


@router.get("/pickup-branches")
async def public_pickup_branches():
    restaurant = await _get_restaurant()
    branches = await db.branches.find(
        {"restaurant_id": restaurant["id"], "pickup_enabled": True},
        {"_id": 0, "id": 1, "name": 1},
    ).sort("name", 1).to_list(500)
    return [{"id": branch["id"], "name": branch["name"]} for branch in branches]


@router.get("/categories")
async def public_categories():
    r = await _get_restaurant()
    items = await db.categories.find(
        {"restaurant_id": r["id"], "status": "active"},
        {"_id": 0}
    ).sort("sort_order", 1).to_list(200)
    return items


@router.get("/products")
async def public_products():
    r = await _get_restaurant()
    items = await db.products.find(
        {"restaurant_id": r["id"]},
        {"_id": 0}
    ).sort("name", 1).to_list(500)
    for item in items:
        if item.get("is_combo"):
            comps = await combo_components_for(item, r["id"])
            item["combo_components"] = comps
            item["components_available"] = len(comps) > 0 and all(c.get("is_available", True) for c in comps)
    return items


@router.get("/tables")
async def public_tables():
    restaurant = await _get_restaurant()
    active_orders = await db.orders.find(
        {
            "restaurant_id": restaurant["id"],
            "table_id": {"$type": "string"},
            "status": {"$in": _ACTIVE_ORDER_STATUSES},
        },
        {"_id": 0, "id": 1, "table_id": 1, "order_number": 1, "status": 1, "items": 1},
    ).to_list(300)
    by_table = {order["table_id"]: order for order in active_orders if order.get("table_id")}
    active_ids = list(by_table.keys())
    query = {"restaurant_id": restaurant["id"]}
    if active_ids:
        query["$or"] = [
            {"status": {"$in": ["disponible", "ocupada"]}},
            {"id": {"$in": active_ids}},
        ]
    else:
        query["status"] = {"$in": ["disponible", "ocupada"]}
    items = await db.tables.find(
        query,
        {"_id": 0, "id": 1, "number": 1, "name": 1, "area": 1, "capacity": 1, "status": 1},
    ).sort("number", 1).to_list(200)
    for table in items:
        order = by_table.get(table["id"])
        table["active_order"] = {
            "order_number": order["order_number"],
            "status": order["status"],
            "item_count": sum(int(item.get("quantity") or 0) for item in (order.get("items") or [])),
        } if order else None
    return items


@router.get("/tables/resolve")
async def resolve_public_table(token: str):
    try:
        table_id, nonce = read_table_token(token)
    except ValueError:
        raise HTTPException(status_code=400, detail="El QR de la mesa no es válido")
    restaurant = await _get_restaurant()
    table = await db.tables.find_one(
        {"id": table_id, "restaurant_id": restaurant["id"]},
        {"_id": 0, "id": 1, "number": 1, "name": 1, "area": 1, "qr_nonce": 1, "qr_revoked": 1},
    )
    if not table:
        raise HTTPException(status_code=404, detail="Esa mesa no existe")
    if table.get("qr_revoked") or table.get("qr_nonce") != nonce:
        raise HTTPException(status_code=400, detail="El QR de la mesa no es válido")
    table.pop("qr_nonce", None)
    table.pop("qr_revoked", None)
    return table


@router.get("/payment-config")
async def public_payment_config():
    """Public view of payment methods enabled and QR/account info."""
    r = await _get_restaurant()
    cfg = await db.payment_configs.find_one({"restaurant_id": r["id"]}, {"_id": 0}) or {}
    return {
        "enable_efectivo": cfg.get("enable_efectivo", True),
        "enable_yape": cfg.get("enable_yape", True),
        "enable_plin": cfg.get("enable_plin", True),
        "enable_transferencia": cfg.get("enable_transferencia", True),
        "enable_tarjeta": cfg.get("enable_tarjeta", False),
        "yape_number": cfg.get("yape_number"),
        "yape_holder": cfg.get("yape_holder"),
        "yape_qr": cfg.get("yape_qr"),
        "plin_number": cfg.get("plin_number"),
        "plin_holder": cfg.get("plin_holder"),
        "plin_qr": cfg.get("plin_qr"),
        "bank_name": cfg.get("bank_name"),
        "bank_account": cfg.get("bank_account"),
        "bank_cci": cfg.get("bank_cci"),
        "bank_holder": cfg.get("bank_holder"),
        "transfer_instructions": cfg.get("transfer_instructions"),
    }


@router.post("/orders")
async def public_create_order(data: PublicOrderCreate, request: Request):
    request_id = getattr(data, "request_id", None)
    if data.order_type == "local" and (data.table_token or data.table_id) and not request_id:
        raise HTTPException(status_code=400, detail="Actualiza el menú para enviar tu pedido en mesa de forma segura")
    if not public_order_limiter.allow(client_host(request)):
        raise HTTPException(status_code=429, detail="Demasiados pedidos desde esta conexión. Esperá un momento.")
    r = await _get_restaurant()
    if not data.items:
        raise HTTPException(status_code=400, detail="Agrega al menos un producto")
    if data.order_type != "local":
        if not (data.customer_name or "").strip() or not (data.customer_phone or "").strip():
            raise HTTPException(status_code=400, detail="Nombre y celular son requeridos")
    if data.order_type == "delivery" and not (data.customer_address or '').strip():
        raise HTTPException(status_code=400, detail="La dirección es requerida para delivery")
    table = None
    table_id = None
    if data.order_type == "local":
        if data.table_token:
            try:
                table_id, table_nonce = read_table_token(data.table_token)
            except ValueError:
                raise HTTPException(status_code=400, detail="El QR de la mesa no es válido")
        elif r.get("require_table_qr"):
            raise HTTPException(status_code=400, detail="Escaneá el QR de tu mesa")
        elif data.table_id:
            table_id = data.table_id
            table_nonce = None
        else:
            raise HTTPException(status_code=400, detail="Elegí una mesa")
        table = await db.tables.find_one({"id": table_id, "restaurant_id": r["id"]}, {"_id": 0})
        if not table:
            raise HTTPException(status_code=400, detail="Esa mesa no existe")
        request_fingerprint = _public_order_fingerprint(data, r["id"], table_id) if request_id else None
        if request_id:
            previous = await db.orders.find_one({
                "restaurant_id": r["id"], "request_id": request_id,
            }, {"_id": 0})
            if previous:
                if previous.get("request_fingerprint") != request_fingerprint or previous.get("table_id") != table_id:
                    raise HTTPException(status_code=409, detail="La solicitud cambió; iniciá un nuevo pedido")
                return await _finish_public_order(previous, data)
            intent = table.get("opening_intent")
            if table.get("opening_order_id") and intent:
                if (intent.get("request_id") != request_id
                        or intent.get("request_fingerprint") != request_fingerprint
                        or intent.get("table_id") != table_id
                        or intent.get("restaurant_id") != r["id"]):
                    raise HTTPException(status_code=409, detail="La mesa ya tiene una solicitud en apertura")
                if data.table_token and (table.get("qr_revoked") or table.get("qr_nonce") != table_nonce):
                    raise HTTPException(status_code=400, detail="El QR de la mesa no es válido")
                recovered = await recover_opening_intent(
                    db, table=table, order_id=intent.get("id"), restaurant_id=r["id"]
                )
                if not recovered:
                    raise HTTPException(status_code=409, detail="La apertura requiere conciliación")
                return await _finish_public_order(recovered, data)
        if data.table_token and (table.get("qr_revoked") or table.get("qr_nonce") != table_nonce):
            raise HTTPException(status_code=400, detail="El QR de la mesa no es válido")
        if table.get("active_attention_id") or table.get("status") != "disponible":
            raise HTTPException(status_code=400, detail="Esa mesa ya está ocupada")
        existing = await db.orders.find_one({
            "restaurant_id": r["id"],
            "table_id": table_id,
            "status": {"$in": _ACTIVE_ORDER_STATUSES},
        })
        if existing:
            raise HTTPException(status_code=400, detail="Esa mesa ya está ocupada")
    request_fingerprint = _public_order_fingerprint(data, r["id"], table_id) if request_id else None
    if request_id and data.order_type != "local":
        previous = await db.orders.find_one({
            "restaurant_id": r["id"], "request_id": request_id,
        }, {"_id": 0})
        if previous:
            if previous.get("request_fingerprint") != request_fingerprint:
                raise HTTPException(status_code=409, detail="La solicitud cambió; iniciá un nuevo pedido")
            return await _finish_public_order(previous, data)

    pickup_branch = None
    if data.order_type == "recojo":
        if not data.branch_id:
            raise HTTPException(status_code=400, detail="Selecciona una sucursal habilitada para recojo")
        pickup_branch = await db.branches.find_one(
            {"id": data.branch_id, "restaurant_id": r["id"], "pickup_enabled": True},
            {"_id": 0},
        )
        if not pickup_branch:
            raise HTTPException(status_code=400, detail="La sucursal seleccionada no está disponible para recojo")

    enriched, subtotal = await _enrich_items(data.items, r)

    delivery_fee = r.get("delivery_fee", 0.0) if data.order_type == "delivery" else 0.0
    total = subtotal + delivery_fee
    order_id = str(uuid.uuid4())
    attention_id = str(uuid.uuid4()) if table_id or data.order_type == "recojo" else None
    branch_context = None
    accepted_at = _now()
    if attention_id:
        branch_id = table.get("branch_id") if table_id else pickup_branch.get("id")
        try:
            branch_context = await capture_attention_context(
                db, tenant_id=r["id"], branch_id=branch_id, confirmed_at=accepted_at
            )
        except AttentionAcceptanceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    tracking_code = _gen_tracking()
    # ensure uniqueness
    while await db.orders.find_one({"tracking_code": tracking_code}):
        tracking_code = _gen_tracking()
    order_no = await _next_order_number(r["id"])
    order = {
        "id": order_id,
        "order_number": order_no,
        "tracking_code": tracking_code,
        "restaurant_id": r["id"],
        "request_id": request_id,
        "request_fingerprint": request_fingerprint,
        "table_id": table_id,
        "created_by": None,
        "created_by_name": "Cliente público",
        "source": "public",
        "status": "enviado_cocina",
        "fulfillment_status": "enviado_cocina",
        "acceptance_status": "aceptado",
        "order_type": data.order_type,
        "items": enriched,
        "subtotal": round(subtotal, 2),
        "discount": 0.0,
        "tip": 0.0,
        "delivery_fee": delivery_fee,
        "total": round(total, 2),
        "notes": data.notes,
        "customer_name": (data.customer_name or "").strip() or None,
        "customer_phone": (data.customer_phone or "").strip() or None,
        "customer_address": data.customer_address,
        "customer_email": data.customer_email,
        "payment_method_choice": data.payment_method,
        "payment_status": "pendiente",
        "payment_proof_url": None,
        "cancellation_reason": None,
        "sent_to_kitchen_at": accepted_at,
        "ready_at": None,
        "paid_at": None,
        "created_at": accepted_at,
        "updated_at": accepted_at,
    }
    if pickup_branch:
        order["branch_id"] = pickup_branch["id"]
    if attention_id:
        order.update({
            "attention_id": attention_id,
            "attention_number_context": branch_context,
            "attention_number_pending": True,
        })
    if table_id:
        order.update({"attention_id": attention_id, "attention_state": "opening", "attention_open": False})
        order["_id"] = order_id
        if table.get("branch_id") is not None:
            order["branch_id"] = table["branch_id"]
        try:
            await reserve_table_opening(
                db, table=table, order_id=order_id, restaurant_id=r["id"],
                allowed_statuses=("disponible",), intent=order,
            )
        except AttentionBlocked as exc:
            if request_id:
                prior = await db.orders.find_one({"restaurant_id": r["id"], "request_id": request_id}, {"_id": 0})
                if prior and prior.get("request_fingerprint") == request_fingerprint and prior.get("table_id") == table_id:
                    return await _finish_public_order(prior, data)
            raise HTTPException(status_code=409, detail=exc.detail)
    try:
        await db.orders.insert_one(order)
    except DuplicateKeyError:
        if request_id:
            previous = await db.orders.find_one({
                "restaurant_id": r["id"], "request_id": request_id,
            }, {"_id": 0})
            if previous and previous.get("request_fingerprint") == request_fingerprint:
                return await _finish_public_order(previous, data)
            if previous:
                raise HTTPException(status_code=409, detail="La solicitud cambió; iniciá un nuevo pedido")
        raise HTTPException(status_code=400, detail="La mesa ya tiene un pedido activo")
    except Exception:
        # Keep the durable intent because an insert may have committed before raising.
        raise
    return await _finish_public_order(order, data)


@router.get("/orders/{tracking_code}")
async def public_get_order(tracking_code: str):
    o = await db.orders.find_one(
        {"tracking_code": tracking_code.upper()},
        {"_id": 0, "created_by": 0}
    )
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return _public_order_view(o)


@router.post("/orders/{tracking_code}/items")
async def public_add_items(tracking_code: str, data: PublicItemsAdd):
    r = await _get_restaurant()
    o = await db.orders.find_one({"tracking_code": tracking_code.upper()}, {"_id": 0})
    _public_mutate_guard(o)
    enriched, _ = await _enrich_items(data.items, r)
    combined = list(o.get("items") or []) + enriched
    subtotal, total = _money_totals(o, combined)
    new_status = _derive_kitchen_status(combined, o["status"])
    if o["status"] == "entregado":
        new_status = "enviado_cocina"
    await _save_public_order(o, {"items": combined, "subtotal": subtotal, "total": total, "status": new_status, "fulfillment_status": new_status, "updated_at": _now()})
    emit_order(r["id"], o["id"], new_status, source=o.get("source"), extra="items_added", order_number=o.get("order_number"))
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": r["id"],
        "user_id": None,
        "action": "public_items_added",
        "entity": "order",
        "entity_id": o["id"],
        "details": {"order_number": o.get("order_number"), "tracking_code": o["tracking_code"], "items_added": len(enriched)},
        "created_at": _now(),
    })
    updated = await db.orders.find_one({"id": o["id"]}, {"_id": 0})
    return _public_order_view(updated)


@router.patch("/orders/{tracking_code}/items/{item_id}")
async def public_update_item(tracking_code: str, item_id: str, data: PublicItemUpdate):
    r = await _get_restaurant()
    o = await db.orders.find_one({"tracking_code": tracking_code.upper()}, {"_id": 0})
    _public_mutate_guard(o)
    items = o.get("items") or []
    target = next((i for i in items if i["id"] == item_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")
    if target.get("status") not in ("pendiente", None):
        raise HTTPException(status_code=400, detail="Este plato ya está en cocina. Consultá al mozo si querés modificarlo.")
    target["quantity"] = data.quantity
    target["subtotal"] = target["unit_price"] * data.quantity
    subtotal, total = _money_totals(o, items)
    new_status = _derive_kitchen_status(items, o["status"])
    await _save_public_order(o, {"items": items, "subtotal": subtotal, "total": total, "status": new_status, "fulfillment_status": new_status, "updated_at": _now()})
    emit_order(r["id"], o["id"], new_status, source=o.get("source"), extra="item_updated", order_number=o.get("order_number"))
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": r["id"],
        "user_id": None,
        "action": "public_item_updated",
        "entity": "order",
        "entity_id": o["id"],
        "details": {"order_number": o.get("order_number"), "item_id": item_id, "quantity": data.quantity},
        "created_at": _now(),
    })
    updated = await db.orders.find_one({"id": o["id"]}, {"_id": 0})
    return _public_order_view(updated)


@router.delete("/orders/{tracking_code}/items/{item_id}")
async def public_remove_item(tracking_code: str, item_id: str):
    r = await _get_restaurant()
    o = await db.orders.find_one({"tracking_code": tracking_code.upper()}, {"_id": 0})
    _public_mutate_guard(o)
    items = o.get("items") or []
    target = next((i for i in items if i["id"] == item_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")
    if target.get("status") not in ("pendiente", None):
        raise HTTPException(status_code=400, detail="Este plato ya está en cocina. Consultá al mozo si querés quitarlo.")
    items = [i for i in items if i["id"] != item_id]
    subtotal, total = _money_totals(o, items, removed_item=target)
    new_status = _derive_kitchen_status(items, o["status"])
    await _save_public_order(o, {"items": items, "subtotal": subtotal, "total": total, "status": new_status, "fulfillment_status": new_status, "updated_at": _now()})
    emit_order(r["id"], o["id"], new_status, source=o.get("source"), extra="item_removed", order_number=o.get("order_number"))
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": r["id"],
        "user_id": None,
        "action": "public_item_removed",
        "entity": "order",
        "entity_id": o["id"],
        "details": {"order_number": o.get("order_number"), "item_id": item_id},
        "created_at": _now(),
    })
    updated = await db.orders.find_one({"id": o["id"]}, {"_id": 0})
    return _public_order_view(updated)


@router.get("/stream")
async def public_stream(restaurant_id: str = None, tracking: str = None):
    if not restaurant_id and not tracking:
        raise HTTPException(status_code=400, detail="Se requiere restaurant_id o tracking")
    rid = restaurant_id
    order_id = None
    if tracking:
        o = await db.orders.find_one(
            {"tracking_code": tracking.upper()},
            {"_id": 0, "id": 1, "restaurant_id": 1},
        )
        if not o:
            raise HTTPException(status_code=404, detail="Pedido no encontrado")
        rid = o["restaurant_id"]
        order_id = o["id"]

    queue = subscribe()

    async def gen():
        try:
            yield f"data: {json.dumps({'type': 'hello'})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if not public_allowed(event, rid, order_id):
                    continue
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            unsubscribe(queue)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/orders/{tracking_code}/proof")
async def upload_proof(tracking_code: str, data: PublicProofUpload):
    o = await db.orders.find_one({"tracking_code": tracking_code.upper()})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if not data.payment_proof or not data.payment_proof.startswith("data:image"):
        raise HTTPException(status_code=400, detail="Imagen inválida")
    if len(data.payment_proof) > 2_500_000:
        raise HTTPException(status_code=400, detail="La imagen es muy grande (max ~1.8MB)")
    await _save_public_order(o, {
        "payment_proof_url": data.payment_proof,
        "payment_status": "comprobante_subido",
        "updated_at": _now(),
    })
    emit_order(o["restaurant_id"], o["id"], o.get("status"), source="public", payment_status="comprobante_subido")
    return {"ok": True}
