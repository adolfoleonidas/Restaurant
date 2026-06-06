from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from database import db
from auth import get_current_user, require_roles
from models import TableCreate, TableUpdate

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_tables(user: dict = Depends(get_current_user)):
    items = await db.tables.find(
        {"restaurant_id": user["restaurant_id"]},
        {"_id": 0}
    ).sort("number", 1).to_list(1000)
    # Attach active order id if any
    active_orders = await db.orders.find(
        {
            "restaurant_id": user["restaurant_id"],
            "status": {"$nin": ["pagado", "cancelado"]}
        },
        {"_id": 0, "id": 1, "table_id": 1, "total": 1, "created_at": 1}
    ).to_list(1000)
    by_table = {o["table_id"]: o for o in active_orders if o.get("table_id")}
    for t in items:
        active = by_table.get(t["id"])
        t["active_order"] = active
    return items


@router.post("")
async def create_table(data: TableCreate, user: dict = Depends(require_roles(["admin"]))):
    exists = await db.tables.find_one({"restaurant_id": user["restaurant_id"], "number": data.number})
    if exists:
        raise HTTPException(status_code=400, detail="Número de mesa ya existe")
    t = {
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "number": data.number,
        "name": data.name or f"Mesa {data.number}",
        "capacity": data.capacity,
        "area": data.area,
        "status": "disponible",
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.tables.insert_one(t)
    return {k: v for k, v in t.items() if k != "_id"}


@router.patch("/{table_id}")
async def update_table(table_id: str, data: TableUpdate, user: dict = Depends(require_roles(["admin"]))):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    update["updated_at"] = _now()
    res = await db.tables.update_one(
        {"id": table_id, "restaurant_id": user["restaurant_id"]},
        {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    t = await db.tables.find_one({"id": table_id}, {"_id": 0})
    return t


@router.delete("/{table_id}")
async def delete_table(table_id: str, user: dict = Depends(require_roles(["admin"]))):
    res = await db.tables.delete_one({"id": table_id, "restaurant_id": user["restaurant_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    return {"ok": True}
