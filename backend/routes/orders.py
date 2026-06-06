from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timezone
from typing import Optional, List
import uuid
from database import db
from auth import get_current_user, require_roles
from models import OrderCreate, OrderItemInput, OrderItemUpdate, OrderStatusUpdate, OrderItemStatusUpdate

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


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
        enriched.append({
            "id": it.get("id") or str(uuid.uuid4()),
            "product_id": prod["id"],
            "product_name": prod["name"],
            "quantity": it["quantity"],
            "unit_price": prod["price"],
            "subtotal": line_subtotal,
            "notes": it.get("notes"),
            "status": it.get("status", "pendiente"),
        })
        subtotal += line_subtotal
    return enriched, subtotal


@router.get("")
async def list_orders(
    user: dict = Depends(get_current_user),
    status: Optional[str] = None,
    table_id: Optional[str] = None,
    active_only: bool = False,
    limit: int = 200,
):
    q = {"restaurant_id": user["restaurant_id"]}
    if status:
        q["status"] = status
    if table_id:
        q["table_id"] = table_id
    if active_only:
        q["status"] = {"$nin": ["pagado", "cancelado"]}
    items = await db.orders.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return items


@router.get("/kitchen")
async def kitchen_orders(user: dict = Depends(require_roles(["admin", "mozo", "cocina"]))):
    """Orders relevant for kitchen board (no payment info)."""
    items = await db.orders.find(
        {
            "restaurant_id": user["restaurant_id"],
            "status": {"$in": ["enviado_cocina", "en_preparacion", "listo"]}
        },
        {"_id": 0, "discount": 0, "tip": 0}
    ).sort("created_at", 1).to_list(500)
    return items


@router.get("/{order_id}")
async def get_order(order_id: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one(
        {"id": order_id, "restaurant_id": user["restaurant_id"]},
        {"_id": 0}
    )
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return o


@router.post("")
async def create_order(data: OrderCreate, user: dict = Depends(require_roles(["admin", "mozo"]))):
    # Verify table available (if mesa)
    if data.order_type == "mesa":
        if not data.table_id:
            raise HTTPException(status_code=400, detail="Se requiere mesa")
        existing = await db.orders.find_one({
            "restaurant_id": user["restaurant_id"],
            "table_id": data.table_id,
            "status": {"$nin": ["pagado", "cancelado"]}
        })
        if existing:
            raise HTTPException(status_code=400, detail="La mesa ya tiene un pedido activo")

    items = [it.model_dump() for it in data.items]
    enriched, subtotal = await _compute_total(items, user["restaurant_id"]) if items else ([], 0.0)
    order_no = await _next_order_number(user["restaurant_id"])
    order_id = str(uuid.uuid4())
    o = {
        "id": order_id,
        "order_number": order_no,
        "restaurant_id": user["restaurant_id"],
        "table_id": data.table_id,
        "created_by": user["id"],
        "created_by_name": user["full_name"],
        "status": "nuevo",
        "order_type": data.order_type,
        "items": enriched,
        "subtotal": subtotal,
        "discount": 0.0,
        "tip": 0.0,
        "total": subtotal,
        "notes": data.notes,
        "cancellation_reason": None,
        "sent_to_kitchen_at": None,
        "ready_at": None,
        "paid_at": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.orders.insert_one(o)
    if data.table_id:
        await db.tables.update_one(
            {"id": data.table_id},
            {"$set": {"status": "ocupada", "updated_at": _now()}}
        )
    await _audit(user["restaurant_id"], user["id"], "create", "order", order_id, {"order_number": order_no})
    return {k: v for k, v in o.items() if k != "_id"}


@router.post("/{order_id}/items")
async def add_items(order_id: str, items: List[OrderItemInput], user: dict = Depends(require_roles(["admin", "mozo"]))):
    o = await db.orders.find_one({"id": order_id, "restaurant_id": user["restaurant_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if o["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="No se puede modificar un pedido cerrado")
    new_items = [it.model_dump() for it in items]
    enriched_new, _ = await _compute_total(new_items, user["restaurant_id"])
    combined = (o.get("items") or []) + enriched_new
    subtotal = sum(i["subtotal"] for i in combined)
    total = subtotal - o.get("discount", 0.0) + o.get("tip", 0.0)
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"items": combined, "subtotal": subtotal, "total": total, "updated_at": _now()}}
    )
    return await db.orders.find_one({"id": order_id}, {"_id": 0})


@router.delete("/{order_id}/items/{item_id}")
async def remove_item(order_id: str, item_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    o = await db.orders.find_one({"id": order_id, "restaurant_id": user["restaurant_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if o["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="No se puede modificar un pedido cerrado")
    items = [i for i in (o.get("items") or []) if i["id"] != item_id]
    subtotal = sum(i["subtotal"] for i in items)
    total = subtotal - o.get("discount", 0.0) + o.get("tip", 0.0)
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"items": items, "subtotal": subtotal, "total": total, "updated_at": _now()}}
    )
    return await db.orders.find_one({"id": order_id}, {"_id": 0})


@router.patch("/{order_id}/items/{item_id}")
async def update_item(order_id: str, item_id: str, data: OrderItemUpdate, user: dict = Depends(require_roles(["admin", "mozo"]))):
    o = await db.orders.find_one({"id": order_id, "restaurant_id": user["restaurant_id"]})
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
    subtotal = sum(i["subtotal"] for i in items)
    total = subtotal - o.get("discount", 0.0) + o.get("tip", 0.0)
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"items": items, "subtotal": subtotal, "total": total, "updated_at": _now()}}
    )
    return await db.orders.find_one({"id": order_id}, {"_id": 0})


@router.post("/{order_id}/send-to-kitchen")
async def send_to_kitchen(order_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    o = await db.orders.find_one({"id": order_id, "restaurant_id": user["restaurant_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if not (o.get("items") or []):
        raise HTTPException(status_code=400, detail="El pedido no tiene productos")
    if o["status"] not in ("nuevo",):
        raise HTTPException(status_code=400, detail="Solo pedidos nuevos pueden enviarse a cocina")
    items = o["items"]
    for it in items:
        it["status"] = "en_preparacion"
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"status": "enviado_cocina", "sent_to_kitchen_at": _now(), "items": items, "updated_at": _now()}}
    )
    await _audit(user["restaurant_id"], user["id"], "send_to_kitchen", "order", order_id)
    return await db.orders.find_one({"id": order_id}, {"_id": 0})


@router.post("/{order_id}/status")
async def change_status(order_id: str, data: OrderStatusUpdate, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"id": order_id, "restaurant_id": user["restaurant_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    role = user["role"]
    new_status = data.status

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
    if o["status"] == "pagado":
        raise HTTPException(status_code=400, detail="El pedido ya está pagado")

    update = {"status": new_status, "updated_at": _now()}
    if new_status == "listo":
        update["ready_at"] = _now()
        # Update items status
        items = o.get("items") or []
        for it in items:
            it["status"] = "listo"
        update["items"] = items
    if new_status == "en_preparacion":
        items = o.get("items") or []
        for it in items:
            it["status"] = "en_preparacion"
        update["items"] = items
    if new_status == "cancelado":
        update["cancellation_reason"] = data.reason
        if o.get("table_id"):
            await db.tables.update_one(
                {"id": o["table_id"]},
                {"$set": {"status": "disponible", "updated_at": _now()}}
            )
    if new_status == "pendiente_pago" and o.get("table_id"):
        await db.tables.update_one(
            {"id": o["table_id"]},
            {"$set": {"status": "esperando_pago", "updated_at": _now()}}
        )

    await db.orders.update_one({"id": order_id}, {"$set": update})
    await _audit(user["restaurant_id"], user["id"], f"status:{new_status}", "order", order_id, {"reason": data.reason})
    return await db.orders.find_one({"id": order_id}, {"_id": 0})
