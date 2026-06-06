from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from database import db
from auth import get_current_user, require_roles
from models import CategoryCreate, CategoryUpdate

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_categories(user: dict = Depends(get_current_user)):
    return await db.categories.find(
        {"restaurant_id": user["restaurant_id"]},
        {"_id": 0}
    ).sort("sort_order", 1).to_list(1000)


@router.post("")
async def create_category(data: CategoryCreate, user: dict = Depends(require_roles(["admin"]))):
    c = {
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "name": data.name,
        "description": data.description,
        "sort_order": data.sort_order,
        "status": "active",
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.categories.insert_one(c)
    return {k: v for k, v in c.items() if k != "_id"}


@router.patch("/{cat_id}")
async def update_category(cat_id: str, data: CategoryUpdate, user: dict = Depends(require_roles(["admin"]))):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    update["updated_at"] = _now()
    res = await db.categories.update_one(
        {"id": cat_id, "restaurant_id": user["restaurant_id"]},
        {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    return await db.categories.find_one({"id": cat_id}, {"_id": 0})


@router.delete("/{cat_id}")
async def delete_category(cat_id: str, user: dict = Depends(require_roles(["admin"]))):
    in_use = await db.products.find_one({"category_id": cat_id})
    if in_use:
        raise HTTPException(status_code=400, detail="Categoría en uso por productos")
    res = await db.categories.delete_one({"id": cat_id, "restaurant_id": user["restaurant_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    return {"ok": True}
