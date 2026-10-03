from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import uuid
from database import db
from auth import get_current_user, require_roles
from branch_access import has_tenantwide_branch_access, read_branch_filter, validate_user_branch
from models import CashOpen, CashClose, CashMovement
from billing import method_amounts, shift_payment_filter
from pymongo.errors import DuplicateKeyError
from notify import emit_notice

BUSINESS_TIMEZONE = ZoneInfo("America/Lima")


async def _resolve_timezone(restaurant_id: str) -> ZoneInfo:
    """Use the fixed Peru business timezone for cash reporting periods."""
    return BUSINESS_TIMEZONE


async def _period_start(period: str, restaurant_id: str) -> str:
    tz = await _resolve_timezone(restaurant_id)
    now = datetime.now(tz)
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


async def _cash_branch(user: dict, requested: str | None = None, *, owner_selection: bool = False) -> str | None:
    tenantwide = has_tenantwide_branch_access(user)
    if tenantwide:
        if requested:
            owned = await db.branches.find_one(
                {"id": requested, "restaurant_id": user["restaurant_id"]}, {"_id": 0, "id": 1}
            )
            if not owned:
                raise HTTPException(status_code=404, detail="Sucursal no encontrada")
            return requested
        if owner_selection:
            raise HTTPException(status_code=400, detail="Seleccione una sucursal para esta operación")
        return None
    branch_id = await validate_user_branch(user, db.branches)
    if requested and requested != branch_id:
        raise HTTPException(status_code=403, detail="No tiene acceso a esa sucursal")
    return branch_id


def _branch_query(branch_id: str | None, *, legacy: bool = False) -> dict:
    if branch_id:
        return {"branch_id": branch_id}
    return {"branch_id": None} if legacy else {}


async def _cash_register_index_state() -> str:
    """Read index metadata only; never create, replace, or drop cash indexes here."""
    try:
        cursor = db.cash_registers.list_indexes()
        indexes = await cursor.to_list(length=100)
    except Exception:
        return "unready"
    old_tenant_unique = False
    branch_unique = False
    legacy_unique = False
    for index in indexes:
        key = list(dict(index.get("key", {})).items())
        partial = index.get("partialFilterExpression") or {}
        if (index.get("unique") and key == [("restaurant_id", 1)]
                and partial.get("status") == "open" and "branch_id" not in partial):
            old_tenant_unique = True
        if (index.get("unique") and key == [("restaurant_id", 1), ("branch_id", 1)]
                and partial.get("status") == "open"
                and partial.get("branch_id") == {"$type": "string"}):
            branch_unique = True
        if (index.get("unique") and key == [("restaurant_id", 1)]
                and partial.get("status") == "open"
                and partial.get("branch_id") == {"$exists": False}):
            legacy_unique = True
    if branch_unique and legacy_unique and not old_tenant_unique:
        return "branch_ready"
    if old_tenant_unique:
        return "single_register"
    return "unready"


async def _open_register_for_branch(restaurant_id: str, branch_id: str | None, *, legacy: bool = False):
    query = {"restaurant_id": restaurant_id, "status": "open", **_branch_query(branch_id, legacy=legacy)}
    return await db.cash_registers.find_one(query, {"_id": 0})


@router.get("/current")
async def current_register(
    user: dict = Depends(require_roles(["admin", "cajero"])),
    branch_id: str | None = Query(None),
    legacy_only: bool = False,
):
    branch_filter = await read_branch_filter(user, db.branches, branch_id, legacy_only=legacy_only)
    query = {"restaurant_id": user["restaurant_id"], "status": "open", **branch_filter}
    reg = await db.cash_registers.find_one(query, {"_id": 0})
    if not reg:
        return None
    return _attach_shift(reg, await _shift_totals(reg))


@router.get("/history")
async def cash_history(
    user: dict = Depends(require_roles(["admin", "cajero"])),
    period: str = Query("day", regex="^(day|week|month)$"),
    branch_id: str | None = Query(None),
    legacy_only: bool = False,
):
    branch_filter = await read_branch_filter(user, db.branches, branch_id, legacy_only=legacy_only)
    start = await _period_start(period, user["restaurant_id"])
    query = {"restaurant_id": user["restaurant_id"], "opened_at": {"$gte": start}, **branch_filter}
    regs = await db.cash_registers.find(query, {"_id": 0}).sort("opened_at", -1).to_list(200)
    closed = [reg for reg in regs if reg.get("status") == "closed"]
    return {
        "period": period, "from": start, "sessions": len(regs), "closed": len(closed),
        "total_sales": round(sum(float(reg.get("total_sales") or 0) for reg in closed), 2),
        "cash_sales": round(sum(float(reg.get("cash_sales") or 0) for reg in closed), 2),
        "difference": round(sum(float(reg.get("difference") or 0) for reg in closed), 2),
        "registers": regs,
    }


@router.get("")
async def list_registers(
    user: dict = Depends(require_roles(["admin", "cajero"])),
    limit: int = 60,
    branch_id: str | None = Query(None),
    legacy_only: bool = False,
):
    branch_filter = await read_branch_filter(user, db.branches, branch_id, legacy_only=legacy_only)
    query = {"restaurant_id": user["restaurant_id"], **branch_filter}
    return await db.cash_registers.find(query, {"_id": 0}).sort("opened_at", -1).limit(limit).to_list(limit)


@router.post("/open")
async def open_register(data: CashOpen, user: dict = Depends(require_roles(["admin", "cajero"]))):
    branch = await _cash_branch(user, data.branch_id, owner_selection=True)
    if not branch:
        raise HTTPException(status_code=400, detail="No se crean cajas nuevas sin sucursal")
    state = await _cash_register_index_state()
    legacy_open = await db.cash_registers.find_one(
        {"restaurant_id": user["restaurant_id"], "status": "open", "$or": [
            {"branch_id": None}, {"branch_id": {"$exists": False}},
        ]}, {"_id": 0}
    )
    same_branch = await _open_register_for_branch(user["restaurant_id"], branch)
    if state != "branch_ready":
        raise HTTPException(status_code=503, detail="La configuración de índices de caja requiere revisión antes de abrir")
    if same_branch:
        raise HTTPException(status_code=400, detail="Ya existe una caja abierta en esta sucursal")
    if legacy_open:
        raise HTTPException(status_code=409, detail="La caja heredada debe conciliarse antes de abrir una caja por sucursal")
    reg_id = str(uuid.uuid4())
    reg = {
        "id": reg_id, "restaurant_id": user["restaurant_id"], "branch_id": branch,
        "opened_by": user["id"], "opened_by_name": user["full_name"],
        "opening_amount": data.opening_amount, "closing_amount": None,
        "expected_amount": None, "difference": None, "total_sales": 0.0,
        "status": "open", "opened_at": _now(), "closed_at": None,
        "closed_by": None, "notes": data.notes,
    }
    try:
        await db.cash_registers.insert_one(reg)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Otra caja se abrió para esta sucursal; vuelva a cargarla")
    emit_notice(user["restaurant_id"], "cash", status="open", register_id=reg_id, branch_id=branch)
    return {k: v for k, v in reg.items() if k != "_id"}


@router.post("/close")
async def close_register(data: CashClose, user: dict = Depends(require_roles(["admin", "cajero"]))):
    branch = await _cash_branch(user, data.branch_id)
    legacy = branch is None and has_tenantwide_branch_access(user)
    query = {"restaurant_id": user["restaurant_id"], "status": "open", **_branch_query(branch, legacy=legacy)}
    reg = await db.cash_registers.find_one(query, {"_id": 0})
    if not reg:
        raise HTTPException(status_code=400, detail="No hay caja abierta")
    unresolved_status = [
        {"status": {"$nin": ["pagado", "cancelado"]}},
        {"payment_status": {"$in": ["comprobante_subido", "confirmado"]}},
        {"attention_state": {"$in": ["opening", "open", "mutating", "closing"]}},
    ]
    unresolved_query = {"restaurant_id": user["restaurant_id"], "$or": unresolved_status}
    if reg.get("branch_id"):
        unresolved_query["branch_id"] = reg["branch_id"]
    else:
        unresolved_query["$and"] = [{"$or": [{"branch_id": None}, {"branch_id": {"$exists": False}}]}]
    unresolved = await db.orders.find_one(unresolved_query, {"_id": 0, "id": 1})
    if unresolved:
        raise HTTPException(status_code=400, detail="No se puede cerrar caja: hay pedidos o pagos pendientes")
    totals = await _shift_totals(reg)
    expected = totals["expected_amount"]
    difference = round(float(data.closing_amount) - expected, 2)
    close_filter = {"id": reg["id"], "restaurant_id": user["restaurant_id"], "status": "open", **_branch_query(reg.get("branch_id"), legacy=reg.get("branch_id") is None)}
    result = await db.cash_registers.update_one(close_filter, {"$set": {
        "status": "closed", "closing_amount": data.closing_amount,
        "expected_amount": expected, "difference": difference,
        "total_sales": totals["total_sales"], "cash_sales": totals["cash_sales"],
        "by_method": totals["by_method"], "income": totals["income"], "expense": totals["expense"],
        "closed_at": _now(), "closed_by": user["id"], "closed_by_name": user["full_name"],
        "close_notes": data.notes,
    }})
    if getattr(result, "matched_count", 0) != 1:
        raise HTTPException(status_code=409, detail="La caja cambió; vuelva a cargarla")
    emit_notice(user["restaurant_id"], "cash", status="closed", register_id=reg["id"], branch_id=reg.get("branch_id"))
    return await db.cash_registers.find_one({"id": reg["id"], "restaurant_id": user["restaurant_id"]}, {"_id": 0})


@router.post("/movements")
async def add_movement(data: CashMovement, user: dict = Depends(require_roles(["admin", "cajero"]))):
    branch = await _cash_branch(user, data.branch_id, owner_selection=has_tenantwide_branch_access(user))
    if branch is None and not has_tenantwide_branch_access(user):
        raise HTTPException(status_code=403, detail="El usuario no tiene una sucursal asignada")
    reg = await _open_register_for_branch(user["restaurant_id"], branch, legacy=branch is None)
    if not reg:
        raise HTTPException(status_code=400, detail="No hay caja abierta para esta sucursal")
    movement = {
        "id": str(uuid.uuid4()), "cash_register_id": reg["id"],
        "restaurant_id": user["restaurant_id"], "branch_id": reg.get("branch_id"),
        "type": data.type, "amount": data.amount, "description": data.description,
        "created_by": user["id"], "created_by_name": user["full_name"], "created_at": _now(),
    }
    await db.cash_movements.insert_one(movement)
    emit_notice(user["restaurant_id"], "cash", status="movement", register_id=reg["id"], branch_id=reg.get("branch_id"))
    return {k: v for k, v in movement.items() if k != "_id"}
