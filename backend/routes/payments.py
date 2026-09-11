from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from pymongo.errors import DuplicateKeyError
from database import db
from auth import get_current_user, require_roles
from models import PaymentCreate
from notify import emit_order

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_payments(user: dict = Depends(require_roles(["admin", "cajero"])), limit: int = 200):
    items = await db.payments.find(
        {"restaurant_id": user["restaurant_id"]},
        {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    return items


@router.post("")
async def create_payment(data: PaymentCreate, user: dict = Depends(require_roles(["admin", "cajero"]))):
    open_reg = await db.cash_registers.find_one(
        {"restaurant_id": user["restaurant_id"], "status": "open"}
    )
    if not open_reg:
        raise HTTPException(status_code=400, detail="No hay caja abierta")

    order = await db.orders.find_one({"id": data.order_id, "restaurant_id": user["restaurant_id"]})
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if order["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="El pedido ya está cerrado")

    subtotal = order.get("subtotal", 0.0)
    discount = data.discount or 0.0
    tip = data.tip or 0.0
    total = max(0.0, subtotal - discount) + tip

    if data.method == "mixto":
        if not data.splits or len(data.splits) < 2:
            raise HTTPException(status_code=400, detail="Pago mixto requiere al menos 2 métodos")
        sum_splits = sum(s.amount for s in data.splits)
        if round(sum_splits, 2) < round(total, 2):
            raise HTTPException(status_code=400, detail=f"Monto insuficiente. Total: {total}, Pagado: {sum_splits}")
        change = max(0.0, sum_splits - total)
        amount = sum_splits
        received = sum_splits
    elif data.method == "efectivo":
        received = data.received_amount if data.received_amount is not None else data.amount
        if received < total:
            raise HTTPException(status_code=400, detail=f"Monto insuficiente. Total: {total}, Recibido: {received}")
        change = received - total
        amount = total
    else:
        amount = data.amount
        if round(amount, 2) < round(total, 2):
            raise HTTPException(status_code=400, detail=f"Monto insuficiente. Total: {total}, Pagado: {amount}")
        received = amount
        change = 0.0

    payment_id = str(uuid.uuid4())
    payment = {
        "id": payment_id,
        "restaurant_id": user["restaurant_id"],
        "order_id": data.order_id,
        "order_number": order.get("order_number"),
        "method": data.method,
        "amount": amount,
        "received_amount": received,
        "change_amount": change,
        "discount": discount,
        "tip": tip,
        "total": total,
        "splits": [s.model_dump() for s in (data.splits or [])],
        "status": "completed",
        "paid_by": user["id"],
        "paid_by_name": user["full_name"],
        "notes": data.notes,
        "created_at": _now(),
    }
    try:
        await db.payments.insert_one(payment)
    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="El pedido ya está cerrado")

    # Update order
    await db.orders.update_one(
        {"id": data.order_id},
        {"$set": {
            "status": "pagado",
            "discount": discount,
            "tip": tip,
            "total": total,
            "paid_at": _now(),
            "updated_at": _now(),
        }}
    )

    emit_order(user["restaurant_id"], data.order_id, "pagado", source=order.get("source"))
    # Free table
    if order.get("table_id"):
        await db.tables.update_one(
            {"id": order["table_id"]},
            {"$set": {"status": "disponible", "updated_at": _now()}}
        )

    # Audit
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "user_id": user["id"],
        "action": "payment_create",
        "entity": "payment",
        "entity_id": payment_id,
        "details": {"order_id": data.order_id, "method": data.method, "total": total},
        "created_at": _now(),
    })

    return {k: v for k, v in payment.items() if k != "_id"}
