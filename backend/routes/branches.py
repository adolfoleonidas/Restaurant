"""Tenant-scoped branch catalog and local business-day settings."""
from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user, require_roles
from database import db, strip_id
from models import BranchCreate, BranchUpdate

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_branches(user: dict = Depends(get_current_user)):
    return await db.branches.find(
        {"restaurant_id": user["restaurant_id"]},
        {"_id": 0},
    ).sort("name", 1).to_list(1000)


@router.post("")
async def create_branch(data: BranchCreate, user: dict = Depends(require_roles(["admin"]))):
    timestamp = _now()
    branch = {
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "name": data.name,
        "timezone": data.timezone,
        "business_day_cutoff": data.business_day_cutoff,
        "pickup_enabled": data.pickup_enabled,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    await db.branches.insert_one(branch)
    return strip_id(branch)


@router.patch("/{branch_id}")
async def update_branch(branch_id: str, data: BranchUpdate, user: dict = Depends(require_roles(["admin"]))):
    owner_filter = {"id": branch_id, "restaurant_id": user["restaurant_id"]}
    branch = await db.branches.find_one(owner_filter, {"_id": 0})
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")

    update = data.model_dump(exclude_unset=True)
    if not update:
        raise HTTPException(status_code=400, detail="Debe indicar al menos un ajuste")

    update["updated_at"] = _now()
    result = await db.branches.update_one(owner_filter, {"$set": update})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")
    updated = await db.branches.find_one(owner_filter, {"_id": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")
    return strip_id(updated)
