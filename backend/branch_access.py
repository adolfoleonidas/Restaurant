"""Branch scoping helpers for authenticated operational routes."""
from fastapi import HTTPException
from auth import user_functions


def has_tenantwide_branch_access(user: dict) -> bool:
    """Administrative capability keeps its existing tenant-wide visibility."""
    return user.get("role") == "admin" or "administracion" in user_functions(user)


def record_branch_filter(user: dict) -> dict:
    """Return a query fragment for branch-bound records, failing closed if unassigned."""
    if has_tenantwide_branch_access(user):
        return {}
    branch_id = user.get("branch_id")
    if not branch_id:
        raise HTTPException(status_code=403, detail="El usuario no tiene una sucursal asignada")
    return {"branch_id": branch_id}


def assert_record_branch_access(record: dict | None, user: dict, not_found: str = "Registro no encontrado") -> None:
    """Hide foreign and branchless legacy records from non-administrative staff."""
    if not record:
        raise HTTPException(status_code=404, detail=not_found)
    if has_tenantwide_branch_access(user):
        return
    scope = record_branch_filter(user)
    if record.get("branch_id") != scope["branch_id"]:
        raise HTTPException(status_code=404, detail=not_found)


async def validate_user_branch(user: dict, branches) -> str | None:
    """Ensure a non-admin's fresh assignment still names a registered tenant branch."""
    scope = record_branch_filter(user)
    branch_id = scope.get("branch_id")
    if branch_id and not await branches.find_one(
        {"id": branch_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0, "id": 1}
    ):
        raise HTTPException(status_code=403, detail="La sucursal asignada ya no está disponible")
    return branch_id


async def read_branch_filter(
    user: dict,
    branches,
    requested: str | None = None,
    *,
    legacy_only: bool = False,
) -> dict:
    """Build a read-only branch filter without changing owner default visibility."""
    tenantwide = has_tenantwide_branch_access(user)
    if legacy_only and requested is not None:
        raise HTTPException(status_code=400, detail="Seleccione sucursal o registros históricos, no ambos")
    if legacy_only:
        if not tenantwide:
            raise HTTPException(status_code=403, detail="No tiene acceso a registros históricos sin sucursal")
        return {"$or": [{"branch_id": None}, {"branch_id": {"$exists": False}}]}
    if requested is not None:
        if not requested.strip():
            raise HTTPException(status_code=400, detail="La sucursal no es válida")
        if tenantwide:
            owned = await branches.find_one(
                {"id": requested, "restaurant_id": user["restaurant_id"]},
                {"_id": 0, "id": 1},
            )
            if not owned:
                raise HTTPException(status_code=404, detail="Sucursal no encontrada")
            return {"branch_id": requested}
        branch_id = await validate_user_branch(user, branches)
        if requested != branch_id:
            raise HTTPException(status_code=403, detail="No tiene acceso a esa sucursal")
        return {"branch_id": branch_id}
    branch_id = await validate_user_branch(user, branches)
    return {"branch_id": branch_id} if branch_id is not None else {}
