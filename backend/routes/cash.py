from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import uuid
from database import db
from auth import get_current_user, require_roles
from models import CashOpen, CashClose, CashMovement
from billing import method_amounts, shift_payment_filter
from notify import emit_notice

LIMA = ZoneInfo("America/Lima")


def _period_start(period: str) -> str:
    now = datetime.now(LIMA)
    if period == "day":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).isoformat()

router = APIRouter()

DRAWER_METHODS = ("efectivo", "yape", "plin", "tarjeta", "transferencia")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _method_amounts(payment: dict) -> dict:
    return method_amounts(payment)


async def _shift_totals(reg: dict) -> dict:
    payments = await db.payments.find(shift_payment_filter(reg), {"_id": 0}).to_list(5000)
    by_method = {m: 0.0 for m in DRAWER_METHODS}
    total_sales = 0.0
    for payment in payments:
        if payment.get("status") not in (None, "completed"):
            continue
        total_sales = round(total_sales + float(payment.get("amount") or 0), 2)
        for method, value in _method_amounts(payment).items():
            by_method[method] = round(by_method[method] + value, 2)
    movements = await db.cash_movements.find(
        {"cash_register_id": reg["id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    income = round(sum(m["amount"] for m in movements if m["type"] == "ingreso"), 2)
    expense = round(sum(m["amount"] for m in movements if m["type"] == "egreso"), 2)
    cash_sales = by_method["efectivo"]
    expected = round(float(reg.get("opening_amount") or 0) + cash_sales + income - expense, 2)
    return {
        "total_sales": total_sales,
        "cash_sales": cash_sales,
        "by_method": by_method,
        "income": income,
        "expense": expense,
        "expected_amount": expected,
        "movements": movements,
    }


def _attach_shift(reg: dict, totals: dict) -> dict:
    for key in ("total_sales", "cash_sales", "by_method", "income", "expense", "expected_amount", "movements"):
        reg[key] = totals[key]
    return {k: v for k, v in reg.items() if k != "_id"}


@router.get("/current")
async def current_register(user: dict = Depends(require_roles(["admin", "cajero"]))):
    reg = await db.cash_registers.find_one(
        {"restaurant_id": user["restaurant_id"], "status": "open"},
        {"_id": 0}
    )
    if not reg:
        return None
    totals = await _shift_totals(reg)
    return _attach_shift(reg, totals)


@router.get("/history")
async def cash_history(
    user: dict = Depends(require_roles(["admin", "cajero"])),
    period: str = Query("day", regex="^(day|week|month)$"),
):
    start = _period_start(period)
    regs = await db.cash_registers.find(
        {"restaurant_id": user["restaurant_id"], "opened_at": {"$gte": start}},
        {"_id": 0},
    ).sort("opened_at", -1).to_list(200)
    closed = [r for r in regs if r.get("status") == "closed"]
    total_sales = sum(float(r.get("total_sales") or 0) for r in closed)
    cash_sales = sum(float(r.get("cash_sales") or 0) for r in closed)
    difference = sum(float(r.get("difference") or 0) for r in closed)
    return {
        "period": period,
        "from": start,
        "sessions": len(regs),
        "closed": len(closed),
        "total_sales": round(total_sales, 2),
        "cash_sales": round(cash_sales, 2),
        "difference": round(difference, 2),
        "registers": regs,
    }


@router.get("")
async def list_registers(user: dict = Depends(require_roles(["admin", "cajero"])), limit: int = 60):
    return await db.cash_registers.find(
        {"restaurant_id": user["restaurant_id"]},
        {"_id": 0}
    ).sort("opened_at", -1).limit(limit).to_list(limit)


@router.post("/open")
async def open_register(data: CashOpen, user: dict = Depends(require_roles(["admin", "cajero"]))):
    open_reg = await db.cash_registers.find_one({"restaurant_id": user["restaurant_id"], "status": "open"})
    if open_reg:
        raise HTTPException(status_code=400, detail="Ya existe una caja abierta")
    reg_id = str(uuid.uuid4())
    reg = {
        "id": reg_id,
        "restaurant_id": user["restaurant_id"],
        "opened_by": user["id"],
        "opened_by_name": user["full_name"],
        "opening_amount": data.opening_amount,
        "closing_amount": None,
        "expected_amount": None,
        "difference": None,
        "total_sales": 0.0,
        "status": "open",
        "opened_at": _now(),
        "closed_at": None,
        "closed_by": None,
        "notes": data.notes,
    }
    await db.cash_registers.insert_one(reg)
    emit_notice(user["restaurant_id"], "cash", status="open", register_id=reg_id)
    return {k: v for k, v in reg.items() if k != "_id"}


@router.post("/close")
async def close_register(data: CashClose, user: dict = Depends(require_roles(["admin", "cajero"]))):
    reg = await db.cash_registers.find_one({"restaurant_id": user["restaurant_id"], "status": "open"})
    if not reg:
        raise HTTPException(status_code=400, detail="No hay caja abierta")

    unresolved = await db.orders.find_one({
        "restaurant_id": user["restaurant_id"],
        "$or": [
            {"status": {"$nin": ["pagado", "cancelado"]}},
            {"payment_status": {"$in": ["comprobante_subido", "confirmado"]}},
        ],
    }, {"_id": 0, "id": 1})
    if unresolved:
        raise HTTPException(status_code=400, detail="No se puede cerrar caja: hay pedidos o pagos pendientes")

    totals = await _shift_totals(reg)
    expected = totals["expected_amount"]
    difference = round(float(data.closing_amount) - expected, 2)

    await db.cash_registers.update_one(
        {"id": reg["id"]},
        {"$set": {
            "status": "closed",
            "closing_amount": data.closing_amount,
            "expected_amount": expected,
            "difference": difference,
            "total_sales": totals["total_sales"],
            "cash_sales": totals["cash_sales"],
            "by_method": totals["by_method"],
            "income": totals["income"],
            "expense": totals["expense"],
            "closed_at": _now(),
            "closed_by": user["id"],
            "closed_by_name": user["full_name"],
            "close_notes": data.notes,
        }}
    )
    emit_notice(user["restaurant_id"], "cash", status="closed", register_id=reg["id"])
    return await db.cash_registers.find_one({"id": reg["id"]}, {"_id": 0})


@router.post("/movements")
async def add_movement(data: CashMovement, user: dict = Depends(require_roles(["admin", "cajero"]))):
    reg = await db.cash_registers.find_one({"restaurant_id": user["restaurant_id"], "status": "open"})
    if not reg:
        raise HTTPException(status_code=400, detail="No hay caja abierta")
    m = {
        "id": str(uuid.uuid4()),
        "cash_register_id": reg["id"],
        "restaurant_id": user["restaurant_id"],
        "type": data.type,
        "amount": data.amount,
        "description": data.description,
        "created_by": user["id"],
        "created_by_name": user["full_name"],
        "created_at": _now(),
    }
    await db.cash_movements.insert_one(m)
    emit_notice(user["restaurant_id"], "cash", status="movement", register_id=reg["id"])
    return {k: v for k, v in m.items() if k != "_id"}
