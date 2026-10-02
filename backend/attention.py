"""One open En mesa atención owns the table. Closing it frees the table."""
import uuid
from datetime import datetime, timezone


class AttentionBlocked(Exception):
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


def assert_close_role(user: dict) -> None:
    if user.get("role") in ("admin", "mozo", "cajero"):
        return
    if "administracion" in (user.get("functions") or []):
        return
    raise AttentionBlocked("Solo el mozo, caja o el administrador puede cerrar la atención")


def _item_status(item: dict) -> str:
    status = item.get("status")
    if status in (None, "", "nuevo"):
        return "pendiente"
    return status


def food_is_delivered(order: dict) -> bool:
    if order.get("status") == "cancelado":
        return True
    items = order.get("items") or []
    return all(_item_status(item) in ("entregado", "cancelado") for item in items)


def _money(value) -> float:
    return round(float(value or 0), 2)


def close_block_reason(order: dict, payments: list, attention: dict) -> str | None:
    if not attention or attention.get("status") == "cerrada":
        return "La atención ya está cerrada"
    if order.get("status") != "cancelado" and not food_is_delivered(order):
        return "Todavía hay productos sin entregar"
    total = _money(order.get("total"))
    paid = _money(order.get("amount_paid"))
    confirmed = _money(sum(
        payment.get("amount") or 0
        for payment in payments
        if payment.get("status") == "completed"
    ))
    if order.get("payment_status") in ("comprobante_subido", "confirmado") and confirmed + 0.009 < total:
        return "Hay un pago por verificar"
    if confirmed + 0.009 < total or paid + 0.009 < total:
        return "La cuenta no está cubierta"
    if abs(paid - confirmed) > 0.009:
        return "La cuenta no cuadra"
    return None


async def _completed_payments(db, order: dict) -> list:
    cursor = db.payments.find({
        "restaurant_id": order["restaurant_id"],
        "order_id": order["id"],
        "status": "completed",
    })
    return await cursor.to_list(50)


async def load_attention(db, order: dict):
    if order.get("attention_id"):
        found = await db.attentions.find_one({
            "id": order["attention_id"],
            "restaurant_id": order["restaurant_id"],
        })
        if found:
            return found
    if not order.get("table_id"):
        return None
    return await db.attentions.find_one({
        "restaurant_id": order["restaurant_id"],
        "table_id": order["table_id"],
        "order_id": order["id"],
    })


async def _next_number(db, restaurant_id: str, now: str) -> int:
    day = (now or "")[:10] or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    key = f"attention_{day}"
    res = await db.counters.find_one_and_update(
        {"restaurant_id": restaurant_id, "key": key},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    if not res or "value" not in (res or {}):
        res = await db.counters.find_one({"restaurant_id": restaurant_id, "key": key})
    return int(res.get("value", 1)) if res else 1


async def open_table_attention(db, *, restaurant_id: str, table_id: str, order_id: str, user_id, now: str) -> dict:
    existing = await db.attentions.find_one({
        "restaurant_id": restaurant_id,
        "table_id": table_id,
        "status": "abierta",
    })
    if existing:
        raise AttentionBlocked("La mesa ya tiene una atención abierta")
    opened = {
        "id": str(uuid.uuid4()),
        "number": await _next_number(db, restaurant_id, now),
        "restaurant_id": restaurant_id,
        "kind": "en_mesa",
        "status": "abierta",
        "table_id": table_id,
        "order_id": order_id,
        "opened_by": user_id,
        "opened_at": now,
    }
    await db.attentions.insert_one(opened)
    await db.orders.update_one(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {"attention_id": opened["id"], "attention_open": True, "updated_at": now}},
    )
    return opened


async def _audit(db, restaurant_id: str, user_id, attention_id: str, now: str) -> None:
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": restaurant_id,
        "user_id": user_id,
        "action": "close_attention",
        "entity": "attention",
        "entity_id": attention_id,
        "details": {},
        "created_at": now,
    })


async def _mark_closed(db, order: dict, attention: dict, user: dict, now: str) -> dict:
    claimed = await db.attentions.update_one(
        {"id": attention["id"], "restaurant_id": order["restaurant_id"], "status": "abierta"},
        {"$set": {"status": "cerrada", "closed_by": user.get("id"), "closed_at": now}},
    )
    if getattr(claimed, "modified_count", 0) != 1:
        raise AttentionBlocked("La atención ya está cerrada")
    await db.orders.update_one(
        {"id": order["id"], "restaurant_id": order["restaurant_id"]},
        {"$set": {"attention_open": False}},
    )
    if order.get("table_id"):
        await db.tables.update_one(
            {"id": order["table_id"], "restaurant_id": order["restaurant_id"]},
            {"$set": {"status": "disponible", "updated_at": now}},
        )
    await _audit(db, order["restaurant_id"], user.get("id"), attention["id"], now)
    closed = await db.attentions.find_one({"id": attention["id"], "restaurant_id": order["restaurant_id"]})
    return closed or {**attention, "status": "cerrada", "closed_by": user.get("id"), "closed_at": now}


async def close_table_attention(db, *, order: dict, user: dict, now: str) -> dict:
    attention = await load_attention(db, order)
    payments = await _completed_payments(db, order)
    reason = close_block_reason(order, payments, attention)
    if reason:
        raise AttentionBlocked(reason)
    return await _mark_closed(db, order, attention, user, now)


async def abandon_table_attention(db, order: dict, user: dict, now: str) -> None:
    """Cancel path: free the table even when the food was not delivered."""
    attention = await load_attention(db, order)
    if attention and attention.get("status") == "abierta":
        await _mark_closed(db, order, attention, user, now)
        return
    if order.get("table_id"):
        await db.tables.update_one(
            {"id": order["table_id"], "restaurant_id": order.get("restaurant_id")},
            {"$set": {"status": "disponible", "updated_at": now}},
        )


async def close_settled_attention(db, order: dict, user: dict, now: str):
    """After a completed payment, close only when the food is already out."""
    if not order.get("table_id"):
        return None
    if not order.get("attention_id") and not order.get("attention_open"):
        return None
    if not food_is_delivered(order):
        return None
    try:
        return await close_table_attention(db, order=order, user=user, now=now)
    except AttentionBlocked:
        return None
