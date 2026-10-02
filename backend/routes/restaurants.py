from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
from pydantic import BaseModel
from database import db, strip_id
from auth import get_current_user, require_roles
from models import RestaurantUpdate
from handoff import HandoffRefused, assert_handoff_admin, handoff_reset

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


class HandoffBody(BaseModel):
    confirmation: str


@router.post("/current/handoff")
async def handoff_current_restaurant(body: HandoffBody, user: dict = Depends(get_current_user)):
    try:
        assert_handoff_admin(user)
        await handoff_reset(
            db,
            restaurant_id=user["restaurant_id"],
            admin_user_id=user["id"],
            confirmation=body.confirmation,
            now=_now(),
        )
    except HandoffRefused as refused:
        if refused.reason == "role":
            raise HTTPException(status_code=403, detail="Solo el administrador puede dejar el sistema limpio") from refused
        raise HTTPException(status_code=400, detail="Confirmación incorrecta") from refused
    return strip_id(await db.restaurants.find_one({"id": user["restaurant_id"]}, {"_id": 0}))
