from fastapi import APIRouter, Depends, Query
from datetime import datetime, timezone, timedelta
from typing import Optional
from database import db
from auth import require_roles, get_current_user

router = APIRouter()


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
