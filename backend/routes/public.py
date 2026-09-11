from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
import secrets
import string
from pymongo.errors import DuplicateKeyError
from database import db
from models import PublicOrderCreate, PublicProofUpload
from routes.products import combo_components_for
from notify import emit_order

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _gen_tracking() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(8))


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
        "public_description": r.get("public_description"),
        "social_facebook": r.get("social_facebook"),
        "social_instagram": r.get("social_instagram"),
        "social_whatsapp": r.get("social_whatsapp"),
    }


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
        {"restaurant_id": r["id"], "is_available": True},
        {"_id": 0}
    ).sort("name", 1).to_list(500)
    for item in items:
        if item.get("is_combo"):
            item["combo_components"] = await combo_components_for(item, r["id"])
    return items


@router.get("/tables")
async def public_tables():
    r = await _get_restaurant()
    items = await db.tables.find(
        {"restaurant_id": r["id"], "status": "disponible"},
        {"_id": 0, "id": 1, "number": 1, "name": 1, "area": 1, "capacity": 1, "status": 1},
    ).sort("number", 1).to_list(200)
    return items


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
async def public_create_order(data: PublicOrderCreate):
    r = await _get_restaurant()
    if not data.items:
        raise HTTPException(status_code=400, detail="Agrega al menos un producto")
    if data.order_type != "local":
        if not (data.customer_name or "").strip() or not (data.customer_phone or "").strip():
            raise HTTPException(status_code=400, detail="Nombre y celular son requeridos")
    if data.order_type == "delivery" and not (data.customer_address or '').strip():
        raise HTTPException(status_code=400, detail="La dirección es requerida para delivery")
    table = None
    if data.order_type == "local":
        if not data.table_id:
            raise HTTPException(status_code=400, detail="Elegí una mesa")
        table = await db.tables.find_one({"id": data.table_id, "restaurant_id": r["id"]}, {"_id": 0})
        if not table or table.get("status") != "disponible":
            raise HTTPException(status_code=400, detail="Esa mesa no está disponible")
        existing = await db.orders.find_one({
            "restaurant_id": r["id"],
            "table_id": data.table_id,
            "status": {"$nin": ["pagado", "cancelado"]},
        })
        if existing:
            raise HTTPException(status_code=400, detail="La mesa ya tiene un pedido activo")

    enriched = []
    subtotal = 0.0
    for it in data.items:
        prod = await db.products.find_one(
            {"id": it.product_id, "restaurant_id": r["id"]},
            {"_id": 0}
        )
        if not prod or not prod.get("is_available", True):
            raise HTTPException(status_code=400, detail=f"Producto no disponible: {it.product_id}")
        line = prod["price"] * it.quantity
        combo_components = await combo_components_for(prod, r["id"])
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

    delivery_fee = r.get("delivery_fee", 0.0) if data.order_type == "delivery" else 0.0
    total = subtotal + delivery_fee
    order_id = str(uuid.uuid4())
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
        "table_id": data.table_id if data.order_type == "local" else None,
        "created_by": None,
        "created_by_name": "Cliente público",
        "source": "public",
        "status": "enviado_cocina",
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
        "sent_to_kitchen_at": _now(),
        "ready_at": None,
        "paid_at": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    try:
        await db.orders.insert_one(order)
    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="La mesa ya tiene un pedido activo")
    if order.get("table_id"):
        await db.tables.update_one(
            {"id": order["table_id"]},
            {"$set": {"status": "ocupada", "updated_at": _now()}},
        )
    emit_order(r["id"], order_id, order["status"], source="public", order_number=order_no)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": r["id"],
        "user_id": None,
        "action": "public_order_create",
        "entity": "order",
        "entity_id": order_id,
        "details": {"order_number": order_no, "tracking_code": tracking_code, "customer": data.customer_name},
        "created_at": _now(),
    })
    return {
        "id": order_id,
        "order_number": order_no,
        "tracking_code": tracking_code,
        "status": order["status"],
        "total": order["total"],
        "payment_method": data.payment_method,
    }


@router.get("/orders/{tracking_code}")
async def public_get_order(tracking_code: str):
    o = await db.orders.find_one(
        {"tracking_code": tracking_code.upper()},
        {"_id": 0, "created_by": 0}
    )
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
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


@router.post("/orders/{tracking_code}/proof")
async def upload_proof(tracking_code: str, data: PublicProofUpload):
    o = await db.orders.find_one({"tracking_code": tracking_code.upper()})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if not data.payment_proof or not data.payment_proof.startswith("data:image"):
        raise HTTPException(status_code=400, detail="Imagen inválida")
    if len(data.payment_proof) > 2_500_000:
        raise HTTPException(status_code=400, detail="La imagen es muy grande (max ~1.8MB)")
    await db.orders.update_one(
        {"id": o["id"]},
        {"$set": {
            "payment_proof_url": data.payment_proof,
            "payment_status": "comprobante_subido",
            "updated_at": _now(),
        }}
    )
    emit_order(o["restaurant_id"], o["id"], o.get("status"), source="public", payment_status="comprobante_subido")
    return {"ok": True}
