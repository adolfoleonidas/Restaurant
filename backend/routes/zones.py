from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from database import db
from auth import get_current_user, require_roles
from models import ZoneCreate, ZoneUpdate
from notify import emit_notice
from branch_access import assert_owned_branch, validate_user_branch
from order_states import TERMINAL_ORDER_STATUSES

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_zones(user: dict = Depends(get_current_user)):
    branch_id = await validate_user_branch(user, db.branches)
    scope = {"restaurant_id": user["restaurant_id"]}
    if branch_id is not None:
        scope["branch_id"] = branch_id
    return await db.zones.find(
        scope,
        {"_id": 0}
    ).sort("sort_order", 1).sort("name", 1).to_list(1000)


@router.post("")
async def create_zone(data: ZoneCreate, user: dict = Depends(require_roles(["admin"]))):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre de la zona es obligatorio")
    exists = await db.zones.find_one({
        "restaurant_id": user["restaurant_id"], "branch_id": data.branch_id, "name": name,
    })
    if exists:
        raise HTTPException(status_code=400, detail="Ya existe una zona con ese nombre en esta sucursal")
    
    # Validate branch if provided
    await assert_owned_branch(db.branches, user["restaurant_id"], data.branch_id)
    
    z = {
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "name": name,
        "sort_order": data.sort_order,
        "created_at": _now(),
        "updated_at": _now(),
    }
    if data.branch_id:
        z["branch_id"] = data.branch_id
    await db.zones.insert_one(z)
    emit_notice(user["restaurant_id"], "zone", zone_id=z["id"], branch_id=z.get("branch_id"), change="created")
    return {k: v for k, v in z.items() if k != "_id"}


@router.patch("/{zone_id}")
async def update_zone(zone_id: str, data: ZoneUpdate, user: dict = Depends(require_roles(["admin"]))):
    z = await db.zones.find_one({"id": zone_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
    if not z:
        raise HTTPException(status_code=404, detail="Zona no encontrada")

    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "name" in update:
        new_name = update["name"].strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="El nombre de la zona es obligatorio")
        if new_name != z["name"]:
            clash = await db.zones.find_one(
                {"restaurant_id": user["restaurant_id"], "name": new_name, "id": {"$ne": zone_id}}
            )
            if clash:
                raise HTTPException(status_code=400, detail="Ya existe una zona con ese nombre")
        update["name"] = new_name
    
    # Validate branch if being updated before touching the zone or its tables.
    if "branch_id" in update:
        await assert_owned_branch(db.branches, user["restaurant_id"], update["branch_id"])

    branch_tables = []
    if "branch_id" in update and update["branch_id"] != z.get("branch_id"):
        branch_tables = await db.tables.find({
            "restaurant_id": user["restaurant_id"], "area": z["name"],
        }, {"_id": 0}).to_list(1000)
        for table in branch_tables:
            if (table.get("status") != "disponible" or table.get("active_attention_id")
                    or table.get("opening_order_id") or table.get("opening_intent")):
                raise HTTPException(status_code=409, detail="No se puede cambiar la sucursal de una mesa ocupada o en apertura")
            active_order = await db.orders.find_one({
                "restaurant_id": user["restaurant_id"], "table_id": table["id"],
                "$or": [
                    {"status": {"$nin": list(TERMINAL_ORDER_STATUSES)}},
                    {"attention_state": {"$in": ["opening", "open", "mutating", "closing"]}},
                ],
            })
            if active_order:
                raise HTTPException(status_code=409, detail="La mesa conserva un pedido o una visita")
    
    update["updated_at"] = _now()
    zone_filter = {"id": zone_id, "restaurant_id": user["restaurant_id"]}
    if "branch_id" in update:
        # "Still branchless" covers a missing field and an explicit null, so a
        # zone whose first branch is being assigned is fenced like any other.
        zone_filter["branch_id"] = z.get("branch_id")
    zone_result = await db.zones.update_one(zone_filter, {"$set": update})
    if getattr(zone_result, "matched_count", 0) != 1:
        raise HTTPException(status_code=409, detail="La zona cambió; vuelve a cargarla")
    
    # Propagate name change to tables
    if "name" in update and update["name"] != z["name"]:
        await db.tables.update_many(
            {"restaurant_id": user["restaurant_id"], "area": z["name"]},
            {"$set": {"area": update["name"], "updated_at": _now()}}
        )
    
    # Only tables inheriting the old zone branch move; individually assigned tables stay put.
    # A branchless zone is inheritable too: assigning its first branch is exactly
    # what makes its tables visible to the staff, so it cannot be skipped.
    inheriting_table_ids = [
        table["id"] for table in branch_tables if table.get("branch_id") == z.get("branch_id")
    ]
    if "branch_id" in update and inheriting_table_ids:
        expected = len(inheriting_table_ids)
        result = await db.tables.update_many(
            {"id": {"$in": inheriting_table_ids},
             "restaurant_id": user["restaurant_id"], "area": update.get("name", z["name"]),
             "branch_id": z.get("branch_id"), "status": "disponible",
             "active_attention_id": {"$exists": False}, "opening_order_id": {"$exists": False}},
            {"$set": {"branch_id": update["branch_id"], "updated_at": _now()}}
        )
        if getattr(result, "matched_count", 0) != expected:
            restore = {"$set": {"updated_at": _now()}}
            if z.get("branch_id") is None:
                restore["$unset"] = {"branch_id": ""}
            else:
                restore["$set"]["branch_id"] = z["branch_id"]
            await db.tables.update_many(
                {"id": {"$in": inheriting_table_ids},
                 "restaurant_id": user["restaurant_id"], "area": update.get("name", z["name"]),
                 "branch_id": update["branch_id"], "status": "disponible",
                 "active_attention_id": {"$exists": False}, "opening_order_id": {"$exists": False}},
                restore,
            )
            zone_restore = {"$set": {"updated_at": _now()}}
            if z.get("branch_id") is None:
                zone_restore["$unset"] = {"branch_id": ""}
            else:
                zone_restore["$set"]["branch_id"] = z["branch_id"]
            await db.zones.update_one(
                {"id": zone_id, "restaurant_id": user["restaurant_id"], "branch_id": update["branch_id"]},
                zone_restore,
            )
            raise HTTPException(status_code=409, detail="Una mesa cambió durante la reasignación de sucursal")
    
    updated = await db.zones.find_one({"id": zone_id}, {"_id": 0})
    # Renaming or re-branching a zone also changes its tables, so floor screens refresh too.
    emit_notice(user["restaurant_id"], "zone", zone_id=zone_id,
                branch_id=(updated or {}).get("branch_id"), change="updated")
    return updated


@router.delete("/{zone_id}")
async def delete_zone(zone_id: str, user: dict = Depends(require_roles(["admin"]))):
    z = await db.zones.find_one({"id": zone_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
    if not z:
        raise HTTPException(status_code=404, detail="Zona no encontrada")
    in_use = await db.tables.find_one({"restaurant_id": user["restaurant_id"], "area": z["name"]})
    if in_use:
        raise HTTPException(status_code=400, detail="La zona está en uso por mesas")
    await db.zones.delete_one({"id": zone_id})
    emit_notice(user["restaurant_id"], "zone", zone_id=zone_id, branch_id=z.get("branch_id"), change="deleted")
    return {"ok": True}
