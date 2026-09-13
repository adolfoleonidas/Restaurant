from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timezone, timedelta
from typing import Optional
from zoneinfo import ZoneInfo
import uuid
from pymongo.errors import DuplicateKeyError
from database import db
from auth import get_current_user, require_roles
from models import PaymentCreate, PaymentVoid
from notify import emit_order

LIMA = ZoneInfo("America/Lima")
router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _period_start(period: str) -> str:
    now = datetime.now(LIMA)
    if period == "day":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).isoformat()


@router.get("")
async def list_payments(
    user: dict = Depends(require_roles(["admin", "cajero"])),
    limit: int = 200,
    q: Optional[str] = None,
    period: Optional[str] = Query(None, regex="^(day|week|month)$"),
):
    filt = {"restaurant_id": user["restaurant_id"]}
    if period:
        filt["created_at"] = {"$gte": _period_start(period)}
    items = await db.payments.find(filt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    needle = (q or "").strip().lower()
    if needle:
        items = [
            p for p in items
            if needle in " ".join([
                str(p.get("order_number") or ""),
                str(p.get("method") or ""),
                str(p.get("paid_by_name") or ""),
                str(p.get("notes") or ""),
                str(p.get("id") or ""),
            ]).lower()
        ]
    return items


@router.get("/by-order/{order_id}")
async def payments_for_order(order_id: str, user: dict = Depends(require_roles(["admin", "cajero"]))):
    return await db.payments.find(
        {"restaurant_id": user["restaurant_id"], "order_id": order_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(50)


@router.post("")
async def create_payment(data: PaymentCreate, user: dict = Depends(require_roles(["admin", "cajero"]))):
    if data.idempotency_key:
        existing = await db.payments.find_one(
            {"restaurant_id": user["restaurant_id"], "idempotency_key": data.idempotency_key},
            {"_id": 0},
        )
        if existing:
            return existing

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

    if data.expected_updated_at and order.get("updated_at") and data.expected_updated_at != order.get("updated_at"):
        raise HTTPException(status_code=409, detail={
            "code": "account_changed",
            "message": "La cuenta cambió mientras la revisabas. Revisá el nuevo importe antes de cobrar.",
            "previous_total": data.expected_total,
            "new_total": order.get("total"),
            "updated_at": order.get("updated_at"),
        })

    subtotal = float(order.get("subtotal", 0.0))
    discount = float(data.discount or 0.0)
    if discount > 0.009:
        if not user.get("can_discount"):
            raise HTTPException(status_code=403, detail="No tenés permiso para aplicar descuentos")
        if len((data.discount_reason or "").strip()) < 5:
            raise HTTPException(status_code=400, detail="El descuento requiere un motivo")
    elif float(order.get("amount_paid") or 0) > 0:
        discount = float(order.get("discount") or 0.0)
    tip = float(data.tip or 0.0)
    if tip <= 0.009 and float(order.get("amount_paid") or 0) > 0:
        tip = float(order.get("tip") or 0.0)
    bill_total = max(0.0, subtotal - discount) + tip
    prior = await db.payments.find({"order_id": data.order_id, "status": "completed"}, {"_id": 0, "amount": 1}).to_list(50)
    paid_so_far = round(sum(float(p.get("amount") or 0) for p in prior), 2)
    remaining = round(bill_total - paid_so_far, 2)
    if remaining <= 0:
        raise HTTPException(status_code=400, detail="El pedido ya está cerrado")

    line_payload = []
    items = order.get("items") or []
    if data.lines:
        by_id = {i["id"]: i for i in items}
        line_total = 0.0
        for line in data.lines:
            it = by_id.get(line.item_id)
            if not it:
                raise HTTPException(status_code=400, detail="Ítem no está en la cuenta")
            unpaid = int(it.get("quantity") or 0) - int(it.get("paid_qty") or 0)
            if line.quantity > unpaid:
                raise HTTPException(status_code=400, detail=f"Solo quedan {unpaid} de {it.get('product_name')}")
            line_total += float(it.get("unit_price") or 0) * line.quantity
            line_payload.append({"item_id": line.item_id, "quantity": line.quantity, "name": it.get("product_name")})
        data.amount = round(line_total, 2)

    if data.method == "mixto":
        if not data.splits or len(data.splits) < 2:
            raise HTTPException(status_code=400, detail="Pago mixto requiere al menos 2 métodos")
        sum_splits = round(sum(s.amount for s in data.splits), 2)
        amount = min(sum_splits, remaining)
        received = sum_splits
        change = max(0.0, round(sum_splits - remaining, 2)) if sum_splits >= remaining else 0.0
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Monto inválido")
    elif data.method == "efectivo":
        received = data.received_amount if data.received_amount is not None else data.amount
        amount = min(float(data.amount or remaining), remaining)
        if received < amount:
            raise HTTPException(status_code=400, detail=f"Monto insuficiente. A pagar: {amount}, Recibido: {received}")
        change = round(received - amount, 2)
    else:
        amount = min(float(data.amount or remaining), remaining)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Monto inválido")
        received = amount
        change = 0.0

    amount = round(amount, 2)
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
        "total": bill_total,
        "splits": [s.model_dump() for s in (data.splits or [])],
        "lines": line_payload,
        "status": "completed",
        "paid_by": user["id"],
        "paid_by_name": user["full_name"],
        "notes": data.notes,
        "discount_reason": (data.discount_reason or "").strip() or None,
        "idempotency_key": data.idempotency_key,
        "created_at": _now(),
    }
    try:
        await db.payments.insert_one(payment)
    except DuplicateKeyError:
        existing = await db.payments.find_one(
            {"restaurant_id": user["restaurant_id"], "idempotency_key": data.idempotency_key},
            {"_id": 0},
        )
        if existing:
            return existing
        raise HTTPException(status_code=400, detail="No se pudo registrar el pago")

    if line_payload:
        by_pay = {l["item_id"]: l["quantity"] for l in line_payload}
        for it in items:
            extra = by_pay.get(it["id"], 0)
            if extra:
                it["paid_qty"] = int(it.get("paid_qty") or 0) + extra

    new_paid = round(paid_so_far + amount, 2)
    fully_paid = new_paid >= bill_total - 0.009
    order_set = {
        "discount": discount,
        "tip": tip,
        "total": bill_total,
        "amount_paid": new_paid,
        "updated_at": _now(),
        "items": items,
    }
    if fully_paid:
        for it in items:
            it["paid_qty"] = int(it.get("quantity") or 0)
        order_set["items"] = items
        order_set["status"] = "pagado"
        order_set["paid_at"] = _now()
    await db.orders.update_one({"id": data.order_id}, {"$set": order_set})

    if fully_paid:
        emit_order(user["restaurant_id"], data.order_id, "pagado", source=order.get("source"))
        if order.get("table_id"):
            r = await db.restaurants.find_one({"id": user["restaurant_id"]}, {"_id": 0})
            new_status = "disponible" if (r or {}).get("auto_release_table") else "pagada"
            await db.tables.update_one(
                {"id": order["table_id"]},
                {"$set": {"status": new_status, "updated_at": _now()}},
            )

    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "user_id": user["id"],
        "action": "payment_create",
        "entity": "payment",
        "entity_id": payment_id,
        "details": {"order_id": data.order_id, "method": data.method, "amount": amount, "remaining": round(bill_total - new_paid, 2)},
        "created_at": _now(),
    })

    payment["remaining"] = round(max(0.0, bill_total - new_paid), 2)
    payment["fully_paid"] = fully_paid
    payment["table_released"] = False
    return {k: v for k, v in payment.items() if k != "_id"}


async def apply_void_payment(payment_id: str, user: dict, reason: str, kind: str = "void"):
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="La anulación requiere un motivo")
    kind = kind if kind in ("void", "refund") else "void"
    pay = await db.payments.find_one({"id": payment_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
    if not pay:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    if pay.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Ese cobro ya no está vigente")

    order = await db.orders.find_one({"id": pay["order_id"], "restaurant_id": user["restaurant_id"]})
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if order.get("status") == "cancelado":
        raise HTTPException(status_code=400, detail="El pedido está cancelado")

    items = order.get("items") or []
    if pay.get("lines"):
        by_pay = {l.get("item_id"): int(l.get("quantity") or 0) for l in pay["lines"]}
        for it in items:
            cut = by_pay.get(it.get("id"), 0)
            if cut:
                it["paid_qty"] = max(0, int(it.get("paid_qty") or 0) - cut)
    else:
        others = await db.payments.count_documents({
            "order_id": pay["order_id"],
            "status": "completed",
            "id": {"$ne": pay["id"]},
        })
        if others == 0:
            for it in items:
                it["paid_qty"] = 0

    new_paid = round(max(0.0, float(order.get("amount_paid") or 0) - float(pay.get("amount") or 0)), 2)
    bill = float(order.get("total") or 0)
    order_set = {
        "amount_paid": new_paid,
        "items": items,
        "updated_at": _now(),
    }
    reopened = new_paid < bill - 0.009
    if reopened and order.get("status") == "pagado":
        order_set["status"] = "pendiente_pago"
        order_set["paid_at"] = None

    status_label = "refunded" if kind == "refund" else "voided"
    await db.payments.update_one({"id": payment_id}, {"$set": {
        "status": status_label,
        "void_kind": kind,
        "void_reason": reason,
        "voided_by": user["id"],
        "voided_by_name": user.get("full_name"),
        "voided_at": _now(),
    }})
    await db.orders.update_one({"id": order["id"]}, {"$set": order_set})
    if reopened and order.get("table_id"):
        table = await db.tables.find_one({"id": order["table_id"]})
        if table and table.get("status") == "pagada":
            await db.tables.update_one(
                {"id": table["id"]},
                {"$set": {"status": "ocupada", "updated_at": _now()}},
            )

    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "user_id": user["id"],
        "action": "payment_void" if kind == "void" else "payment_refund",
        "entity": "payment",
        "entity_id": payment_id,
        "details": {"order_id": pay["order_id"], "kind": kind, "reason": reason, "amount": pay.get("amount")},
        "created_at": _now(),
    })
    return await db.payments.find_one({"id": payment_id}, {"_id": 0})


@router.post("/{payment_id}/void")
async def void_payment(payment_id: str, data: PaymentVoid, user: dict = Depends(require_roles(["admin", "cajero"]))):
    if not user.get("can_void"):
        raise HTTPException(status_code=403, detail="No tenés permiso para anular o devolver un cobro")
    return await apply_void_payment(payment_id, user, data.reason, data.kind)
