from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from database import db
from auth import require_role_exact, hash_password, get_current_user, apply_permissions
from models import UserCreate, UserUpdate

router = APIRouter()


async def _assert_owned_branch(branch_id: str, restaurant_id: str):
    if not isinstance(branch_id, str) or not branch_id.strip():
        raise HTTPException(status_code=400, detail="Debe indicar una sucursal válida")
    branch = await db.branches.find_one(
        {"id": branch_id, "restaurant_id": restaurant_id},
        {"_id": 0},
    )
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_users(user: dict = Depends(require_role_exact("admin"))):
    items = await db.users.find(
        {"restaurant_id": user["restaurant_id"]},
        {"_id": 0, "password_hash": 0}
    ).to_list(1000)
    return [apply_permissions(u) for u in items]


@router.post("")
async def create_user(data: UserCreate, user: dict = Depends(require_role_exact("admin"))):
    if data.branch_id is not None:
        await _assert_owned_branch(data.branch_id, user["restaurant_id"])
    existing = await db.users.find_one({"email": data.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email ya registrado")
    new = {
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "email": data.email.lower(),
        "password_hash": hash_password(data.password),
        "full_name": data.full_name,
        "role": data.role,
        "phone": data.phone,
        "status": "active",
        "can_discount": True if data.role == "admin" else bool(data.can_discount),
        "can_void": True if data.role == "admin" else bool(data.can_void),
        "functions": data.functions or (["atencion", "preparacion", "cobro", "administracion"] if data.role == "admin" else None),
        "created_at": _now(),
        "updated_at": _now(),
    }
    if data.branch_id is not None:
        new["branch_id"] = data.branch_id
    await db.users.insert_one(new)
    return {k: v for k, v in new.items() if k not in ("_id", "password_hash")}


@router.patch("/{user_id}")
async def update_user(user_id: str, data: UserUpdate, user: dict = Depends(require_role_exact("admin"))):
    user_filter = {"id": user_id, "restaurant_id": user["restaurant_id"]}
    target = await db.users.find_one(user_filter)
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "branch_id" in update:
        await _assert_owned_branch(update["branch_id"], user["restaurant_id"])
    if "password" in update:
        update["password_hash"] = hash_password(update.pop("password"))
    update["updated_at"] = _now()
    result = await db.users.update_one(user_filter, {"$set": update})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    updated = await db.users.find_one(user_filter, {"_id": 0, "password_hash": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return updated


@router.delete("/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_role_exact("admin"))):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="No puedes eliminarte a ti mismo")
    res = await db.users.delete_one({"id": user_id, "restaurant_id": user["restaurant_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"ok": True}
