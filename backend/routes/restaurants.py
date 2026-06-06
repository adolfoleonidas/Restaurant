from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
from database import db
from auth import get_current_user, require_roles
from models import RestaurantUpdate

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("/current")
async def get_current_restaurant(user: dict = Depends(get_current_user)):
    r = await db.restaurants.find_one({"id": user["restaurant_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Restaurante no encontrado")
    return r


@router.patch("/current")
async def update_current_restaurant(data: RestaurantUpdate, user: dict = Depends(require_roles(["admin"]))):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    update["updated_at"] = _now()
    await db.restaurants.update_one({"id": user["restaurant_id"]}, {"$set": update})
    r = await db.restaurants.find_one({"id": user["restaurant_id"]}, {"_id": 0})
    return r
