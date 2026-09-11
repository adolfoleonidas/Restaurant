from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import uuid
from database import db
from auth import get_current_user, require_roles
from models import CashOpen, CashClose, CashMovement

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


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("/current")
async def current_register(user: dict = Depends(require_roles(["admin", "cajero"]))):
    reg = await db.cash_registers.find_one(
        {"restaurant_id": user["restaurant_id"], "status": "open"},
        {"_id": 0}
    )
    if not reg:
        return None
    movs = await db.cash_movements.find(
        {"cash_register_id": reg["id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    reg["movements"] = movs
    return reg


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
    return {k: v for k, v in reg.items() if k != "_id"}


@router.post("/close")
async def close_register(data: CashClose, user: dict = Depends(require_roles(["admin", "cajero"]))):
    reg = await db.cash_registers.find_one({"restaurant_id": user["restaurant_id"], "status": "open"})
    if not reg:
        raise HTTPException(status_code=400, detail="No hay caja abierta")

    # Compute totals from payments since opened
    payments = await db.payments.find(
        {
            "restaurant_id": user["restaurant_id"],
            "created_at": {"$gte": reg["opened_at"]}
        },
        {"_id": 0}
    ).to_list(5000)
    total_sales = sum(p["total"] for p in payments)
    cash_payments_total = 0.0
    for p in payments:
        if p["method"] == "efectivo":
            cash_payments_total += p["total"]
        elif p["method"] == "mixto":
            for s in p.get("splits", []):
                if s.get("method") == "efectivo":
                    cash_payments_total += s.get("amount", 0.0)

    movements = await db.cash_movements.find(
        {"cash_register_id": reg["id"]}, {"_id": 0}
    ).to_list(1000)
    income = sum(m["amount"] for m in movements if m["type"] == "ingreso")
    expense = sum(m["amount"] for m in movements if m["type"] == "egreso")

    expected = reg["opening_amount"] + cash_payments_total + income - expense
    difference = data.closing_amount - expected

    await db.cash_registers.update_one(
        {"id": reg["id"]},
        {"$set": {
            "status": "closed",
            "closing_amount": data.closing_amount,
            "expected_amount": round(expected, 2),
            "difference": round(difference, 2),
            "total_sales": round(total_sales, 2),
            "cash_sales": round(cash_payments_total, 2),
            "income": round(income, 2),
            "expense": round(expense, 2),
            "closed_at": _now(),
            "closed_by": user["id"],
            "closed_by_name": user["full_name"],
            "close_notes": data.notes,
        }}
    )
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
    return {k: v for k, v in m.items() if k != "_id"}
