from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from database import db
from auth import get_current_user, require_roles
from models import ProductCreate, ProductUpdate

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_products(user: dict = Depends(get_current_user)):
    return await db.products.find(
        {"restaurant_id": user["restaurant_id"]},
        {"_id": 0}
    ).sort("name", 1).to_list(1000)


@router.post("")
async def create_product(data: ProductCreate, user: dict = Depends(require_roles(["admin"]))):
    p = {
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "category_id": data.category_id,
        "name": data.name,
        "description": data.description,
        "price": data.price,
        "image_url": data.image_url,
        "is_available": data.is_available,
        "preparation_time": data.preparation_time,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.products.insert_one(p)
    return {k: v for k, v in p.items() if k != "_id"}


@router.patch("/{product_id}")
async def update_product(product_id: str, data: ProductUpdate, user: dict = Depends(require_roles(["admin"]))):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    update["updated_at"] = _now()
    res = await db.products.update_one(
        {"id": product_id, "restaurant_id": user["restaurant_id"]},
        {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return await db.products.find_one({"id": product_id}, {"_id": 0})


@router.delete("/{product_id}")
async def delete_product(product_id: str, user: dict = Depends(require_roles(["admin"]))):
    res = await db.products.delete_one({"id": product_id, "restaurant_id": user["restaurant_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return {"ok": True}
