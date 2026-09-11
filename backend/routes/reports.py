from fastapi import APIRouter, Depends, Query
from datetime import datetime, timezone, timedelta
from typing import Optional
from zoneinfo import ZoneInfo
from database import db
from auth import require_roles, get_current_user

LIMA = ZoneInfo("America/Lima")
router = APIRouter()


def _lima_period_start(period: str) -> str:
    now = datetime.now(LIMA)
    if period == "day":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).isoformat()


def _today_range():
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat(), now.isoformat()


@router.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    """KPIs visible to current user role. Some fields restricted by role."""
    rid = user["restaurant_id"]
    start, end = _today_range()

    active_orders = await db.orders.count_documents({
        "restaurant_id": rid,
        "status": {"$nin": ["pagado", "cancelado"]}
    })
    occupied_tables = await db.tables.count_documents({
        "restaurant_id": rid,
        "status": {"$in": ["ocupada", "esperando_pago"]}
    })
    total_tables = await db.tables.count_documents({"restaurant_id": rid})

    result = {
        "active_orders": active_orders,
        "occupied_tables": occupied_tables,
        "total_tables": total_tables,
    }

    # Financial KPIs only for admin/cajero
    if user["role"] in ("admin", "cajero"):
        payments = await db.payments.find(
            {"restaurant_id": rid, "created_at": {"$gte": start}},
            {"_id": 0}
        ).to_list(10000)
        total_sales = sum(p["total"] for p in payments)
        orders_paid = len(payments)
        avg_ticket = (total_sales / orders_paid) if orders_paid else 0
        result.update({
            "daily_sales": round(total_sales, 2),
            "orders_paid": orders_paid,
            "avg_ticket": round(avg_ticket, 2),
        })

    # Top products today (admin only)
    if user["role"] == "admin":
        pipeline = [
            {"$match": {"restaurant_id": rid, "created_at": {"$gte": start}, "status": "pagado"}},
            {"$unwind": "$items"},
            {"$group": {
                "_id": "$items.product_id",
                "name": {"$first": "$items.product_name"},
                "quantity": {"$sum": "$items.quantity"},
                "revenue": {"$sum": "$items.subtotal"},
            }},
            {"$sort": {"quantity": -1}},
            {"$limit": 5},
        ]
        top = await db.orders.aggregate(pipeline).to_list(10)
        result["top_products"] = [
            {"product_id": t["_id"], "name": t["name"], "quantity": t["quantity"], "revenue": round(t["revenue"], 2)}
            for t in top
        ]

    return result


@router.get("/sales")
async def sales_report(
    user: dict = Depends(require_roles(["admin", "cajero"])),
    period: str = Query("day", regex="^(day|week|month)$"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    rid = user["restaurant_id"]
    now = datetime.now(timezone.utc)
    if date_from and date_to:
        start = date_from
        end = date_to
    elif period == "day":
        s = now.replace(hour=0, minute=0, second=0, microsecond=0)
        start, end = s.isoformat(), now.isoformat()
    elif period == "week":
        s = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
        start, end = s.isoformat(), now.isoformat()
    else:
        s = (now - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0)
        start, end = s.isoformat(), now.isoformat()

    payments = await db.payments.find(
        {"restaurant_id": rid, "created_at": {"$gte": start, "$lte": end}},
        {"_id": 0}
    ).to_list(20000)

    total_sales = sum(p["total"] for p in payments)
    by_method = {}
    for p in payments:
        if p["method"] == "mixto":
            for s in p.get("splits", []):
                m = s.get("method")
                by_method[m] = by_method.get(m, 0) + s.get("amount", 0)
        else:
            by_method[p["method"]] = by_method.get(p["method"], 0) + p["total"]

    # Top products in period
    pipeline = [
        {"$match": {"restaurant_id": rid, "created_at": {"$gte": start, "$lte": end}, "status": "pagado"}},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.product_id",
            "name": {"$first": "$items.product_name"},
            "quantity": {"$sum": "$items.quantity"},
            "revenue": {"$sum": "$items.subtotal"},
        }},
        {"$sort": {"quantity": -1}},
        {"$limit": 10},
    ]
    top_products = await db.orders.aggregate(pipeline).to_list(20)

    # Sales by hour (group by date+hour string)
    sales_by_day = {}
    for p in payments:
        try:
            d = datetime.fromisoformat(p["created_at"].replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except Exception:
            d = p["created_at"][:10]
        sales_by_day[d] = sales_by_day.get(d, 0) + p["total"]

    # Cancelled orders count
    cancelled = await db.orders.count_documents({
        "restaurant_id": rid,
        "status": "cancelado",
        "created_at": {"$gte": start, "$lte": end}
    })

    return {
        "period": period,
        "date_from": start,
        "date_to": end,
        "total_sales": round(total_sales, 2),
        "orders_count": len(payments),
        "avg_ticket": round(total_sales / len(payments), 2) if payments else 0,
        "by_method": [{"method": k, "amount": round(v, 2)} for k, v in by_method.items()],
        "top_products": [
            {"product_id": t["_id"], "name": t["name"], "quantity": t["quantity"], "revenue": round(t["revenue"], 2)}
            for t in top_products
        ],
        "sales_by_day": [{"date": k, "amount": round(v, 2)} for k, v in sorted(sales_by_day.items())],
        "cancelled_orders": cancelled,
    }


@router.get("/products")
async def product_sales(
    user: dict = Depends(require_roles(["admin", "cajero"])),
    period: str = Query("day", regex="^(day|week|month)$"),
):
    rid = user["restaurant_id"]
    start = _lima_period_start(period)
    orders = await db.orders.find(
        {
            "restaurant_id": rid,
            "$or": [
                {"created_at": {"$gte": start}},
                {"paid_at": {"$gte": start}},
                {"updated_at": {"$gte": start}},
            ],
        },
        {"_id": 0, "items": 1, "status": 1},
    ).to_list(8000)
    grouped = {}
    for order in orders:
        for item in order.get("items") or []:
            paid_qty = int(item.get("paid_qty") or 0)
            qty = int(item.get("quantity") or 0)
            if paid_qty > 0:
                sold = paid_qty
            elif order.get("status") == "pagado":
                sold = qty
            else:
                sold = 0
            if sold <= 0:
                continue
            pid = item.get("product_id") or item.get("id")
            unit = float(item.get("unit_price") or 0)
            row = grouped.setdefault(pid, {
                "product_id": pid,
                "name": item.get("product_name") or "Ítem",
                "quantity": 0,
                "revenue": 0.0,
            })
            row["quantity"] += sold
            row["revenue"] = round(row["revenue"] + sold * unit, 2)
    products = sorted(grouped.values(), key=lambda r: (-r["quantity"], r["name"]))
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
