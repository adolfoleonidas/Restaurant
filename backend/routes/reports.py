from fastapi import APIRouter, Depends, Query
from datetime import datetime, timezone, timedelta
from typing import Optional
from zoneinfo import ZoneInfo
from database import db
from auth import require_roles, get_current_user
from billing import rank_products, summarize_payments
from branch_access import read_branch_filter

_OPEN_END = "9999-12-31T23:59:59+00:00"
BUSINESS_TIMEZONE = ZoneInfo("America/Lima")

router = APIRouter()


async def _resolve_timezone(restaurant_id: str) -> ZoneInfo:
    """Use the fixed Peru business timezone for report periods."""
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


async def _today_range(restaurant_id: str):
    tz = await _resolve_timezone(restaurant_id)
    now = datetime.now(tz)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).isoformat(), now.astimezone(timezone.utc).isoformat()


async def _report_branch_filter(user: dict, branch_id: Optional[str], legacy_only: bool) -> dict:
    return await read_branch_filter(
        user,
        db.branches,
        branch_id,
        legacy_only=legacy_only,
    )


def _scoped_report_query(restaurant_id: str, branch_filter: dict, time_filter: dict) -> dict:
    query = {"restaurant_id": restaurant_id}
    if "$or" in branch_filter:
        query["$and"] = [branch_filter, time_filter]
    else:
        query.update(branch_filter)
        query.update(time_filter)
    return query


@router.get("/dashboard")
async def dashboard(
    user: dict = Depends(get_current_user),
    branch_id: Optional[str] = None,
    legacy_only: bool = False,
):
    """KPIs visible to current user role. Some fields restricted by role."""
    rid = user["restaurant_id"]
    branch_filter = await _report_branch_filter(user, branch_id, legacy_only)
    start, end = await _today_range(rid)

    active_orders = await db.orders.count_documents(_scoped_report_query(
        rid,
        branch_filter,
        {"status": {"$nin": ["pagado", "cancelado"]}},
    ))
    occupied_tables = await db.tables.count_documents(_scoped_report_query(
        rid,
        branch_filter,
        {"status": {"$in": ["ocupada", "esperando_pago"]}},
    ))
    total_tables = await db.tables.count_documents(
        _scoped_report_query(rid, branch_filter, {})
    )

    result = {
        "active_orders": active_orders,
        "occupied_tables": occupied_tables,
        "total_tables": total_tables,
    }

    # Financial KPIs only for admin/cajero
    if user["role"] in ("admin", "cajero"):
        payment_query = _scoped_report_query(rid, branch_filter, {"$or": [
            {"created_at": {"$gte": start}},
            {"voided_at": {"$gte": start}},
        ]})
        payments = await db.payments.find(
            payment_query,
            {"_id": 0}
        ).to_list(10000)
        summary = summarize_payments(payments, start, _OPEN_END)
        total_sales = summary["total_sales"]
        orders_paid = summary["orders_count"]
        avg_ticket = (total_sales / orders_paid) if orders_paid else 0
        result.update({
            "daily_sales": round(total_sales, 2),
            "orders_paid": orders_paid,
            "avg_ticket": round(avg_ticket, 2),
        })

    if user["role"] == "admin":
        ranked = await db.payments.find(
            payment_query,
            {"_id": 0, "sold_lines": 1, "status": 1, "created_at": 1, "voided_at": 1},
        ).to_list(10000)
        result["top_products"] = rank_products(ranked, start, _OPEN_END, limit=5)

    return result


@router.get("/sales")
async def sales_report(
    user: dict = Depends(require_roles(["admin", "cajero"])),
    period: str = Query("day", regex="^(day|week|month)$"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    branch_id: Optional[str] = None,
    legacy_only: bool = False,
):
    rid = user["restaurant_id"]
    if date_from and date_to:
        start = date_from
        end = date_to
    else:
        now = datetime.now(BUSINESS_TIMEZONE)
        if period == "day":
            s = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif period == "week":
            s = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            s = (now - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0)
        start = s.astimezone(timezone.utc).isoformat()
        end = now.astimezone(timezone.utc).isoformat()
    branch_filter = await _report_branch_filter(user, branch_id, legacy_only)
    date_filter = {"$or": [
        {"created_at": {"$gte": start, "$lte": end}},
        {"voided_at": {"$gte": start, "$lte": end}},
    ]}
    payments = await db.payments.find(
        _scoped_report_query(rid, branch_filter, date_filter),
        {"_id": 0}
    ).to_list(20000)
    summary = summarize_payments(payments, start, end)
    total_sales = summary["total_sales"]
    by_method = summary["by_method"]

    top_products = rank_products(payments, start, end, limit=10)

    # Sales by hour (group by date+hour string)
    sales_by_day = summary["sales_by_day"]

    # Cancelled orders count
    cancelled = await db.orders.count_documents(_scoped_report_query(
        rid,
        branch_filter,
        {
            "status": "cancelado",
            "created_at": {"$gte": start, "$lte": end},
        },
    ))

    return {
        "period": period,
        "date_from": start,
        "date_to": end,
        "total_sales": round(total_sales, 2),
        "orders_count": summary["orders_count"],
        "avg_ticket": round(total_sales / summary["orders_count"], 2) if summary["orders_count"] else 0,
        "by_method": [{"method": k, "amount": round(v, 2)} for k, v in by_method.items()],
        "top_products": top_products,
        "sales_by_day": [{"date": k, "amount": round(v, 2)} for k, v in sorted(sales_by_day.items())],
        "cancelled_orders": cancelled,
    }


@router.get("/products")
async def product_sales(
    user: dict = Depends(require_roles(["admin", "cajero"])),
    period: str = Query("day", regex="^(day|week|month)$"),
    branch_id: Optional[str] = None,
    legacy_only: bool = False,
):
    rid = user["restaurant_id"]
    start = await _period_start(period, rid)
    branch_filter = await _report_branch_filter(user, branch_id, legacy_only)
    date_filter = {"$or": [
        {"created_at": {"$gte": start}},
        {"voided_at": {"$gte": start}},
    ]}
    payments = await db.payments.find(
        _scoped_report_query(rid, branch_filter, date_filter),
        {"_id": 0, "sold_lines": 1, "status": 1, "created_at": 1, "voided_at": 1},
    ).to_list(20000)
    products = rank_products(payments, start, _OPEN_END)
    return {
        "period": period,
        "from": start,
        "products": products,
        "total_units": sum(p["quantity"] for p in products),
        "total_revenue": round(sum(p["revenue"] for p in products), 2),
    }


def _elapsed_minutes(iso: str) -> float:
    if not iso:
        return 0.0
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds() / 60.0
    except Exception:
        return 0.0


@router.get("/today")
async def today_board(user: dict = Depends(require_roles(["admin"]))):
    rid = user["restaurant_id"]
    tables = await db.tables.find({"restaurant_id": rid}, {"_id": 0}).to_list(200)
    occupied = sum(1 for t in tables if t.get("status") in ("ocupada", "esperando_pago", "pagada"))
    cash = await db.cash_registers.find_one({"restaurant_id": rid, "status": "open"}, {"_id": 0})
    active = await db.orders.find(
        {"restaurant_id": rid, "status": {"$nin": ["pagado", "cancelado"]}},
        {"_id": 0},
    ).to_list(500)
    kitchen_orders = sum(1 for o in active if o.get("status") in ("enviado_cocina", "en_preparacion"))
    bill_requests = sum(1 for o in active if o.get("status") == "pendiente_pago")
    products = await db.products.find({"restaurant_id": rid}, {"_id": 0, "id": 1, "name": 1, "preparation_time": 1, "is_available": 1}).to_list(1000)
    by_prod = {p["id"]: p for p in products}
    table_by_id = {t["id"]: t for t in tables}

    attention = []
    delayed_by_order = {}
    for order in active:
        for item in order.get("items") or []:
            if item.get("status") != "en_preparacion":
                continue
            prod = by_prod.get(item.get("product_id")) or {}
            prep = int(prod.get("preparation_time") if prod.get("preparation_time") is not None else item.get("prep_minutes") or 15)
            started = item.get("started_at") or item.get("added_at") or order.get("sent_to_kitchen_at") or order.get("created_at")
            elapsed = _elapsed_minutes(started)
            if elapsed < prep:
                continue
            bucket = delayed_by_order.setdefault(order["id"], {
                "kind": "delay",
                "order_id": order["id"],
                "href": f"/pedidos/{order['id']}",
                "table_number": (table_by_id.get(order.get("table_id") or "") or {}).get("number"),
                "waiter_name": order.get("created_by_name"),
                "items": [],
                "elapsed_minutes": 0,
                "prep_minutes": prep,
            })
            bucket["items"].append({
                "name": item.get("product_name"),
                "quantity": item.get("quantity"),
                "elapsed_minutes": int(elapsed),
                "prep_minutes": prep,
                "status": item.get("status"),
            })
            bucket["elapsed_minutes"] = max(bucket["elapsed_minutes"], int(elapsed))
            bucket["prep_minutes"] = prep
    for card in delayed_by_order.values():
        mesa = f"Mesa {card['table_number']}" if card.get("table_number") else f"Pedido #{card['order_id'][:6]}"
        n = len(card["items"])
        card["title"] = f"{mesa} — Preparación demorada"
        names = ", ".join(f"{it['quantity']}× {it['name']}" for it in card["items"][:3])
        card["body"] = f"{names} llevan {card['elapsed_minutes']} min. Referencia: {card['prep_minutes']} min. Mozo: {card.get('waiter_name') or '—'}"
        attention.append(card)

    pending_approvals = await db.approvals.find(
        {"restaurant_id": rid, "status": "pending"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    for ap in pending_approvals:
        attention.append({
            "kind": "approval",
            "approval_id": ap["id"],
            "href": f"/dashboard?approval={ap['id']}",
            "title": f"Caja: una {('devolución' if ap.get('kind') == 'refund' else 'anulación')} requiere autorización",
            "body": f"{ap.get('requested_by_name')}: {ap.get('reason')}",
            "payload": ap,
        })

    for prod in products:
        if prod.get("is_available", True):
            continue
        attention.append({
            "kind": "sold_out",
            "product_id": prod["id"],
            "href": "/disponibilidad",
            "title": f"{prod['name']}: agotado",
            "body": "Carta de salón actualizada. Revisá pedidos pendientes de ese plato.",
        })

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "attention": attention,
        "summary": {
            "occupied_tables": occupied,
            "total_tables": len(tables),
            "kitchen_orders": kitchen_orders,
            "bill_requests": bill_requests,
            "cash_open": bool(cash),
            "cash_opened_by": (cash or {}).get("opened_by_name"),
            "active_orders": len(active),
        },
    }
