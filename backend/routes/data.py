from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import db
from auth import require_roles, verify_password

router = APIRouter()

# Must be typed verbatim to authorize a reset.
RESET_CONFIRMATION = "ELIMINAR"

# Operational (day-to-day) collections cleared by the reset. Configuration and
# catalog collections (restaurants, users, branches, zones, tables, categories,
# products, payment_configs) are intentionally preserved.
OPERATIONAL_COLLECTIONS = (
    "orders",
    "payments",
    "cash_registers",
    "cash_movements",
    "attentions",
    "approvals",
    "audit_logs",
    "counters",
)

# Catalogue collections wiped by the catalogue reset. The seed ships a demo menu
# that a real restaurant has to replace; combos are products flagged `is_combo`,
# so clearing products clears them too.
CATALOG_COLLECTIONS = (
    "products",
    "categories",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class DataResetRequest(BaseModel):
    confirm: str = Field(..., description="Escribe ELIMINAR para confirmar")
    password: str = Field(..., description="Contraseña actual del administrador")


@router.post("/reset")
async def reset_operational_data(data: DataResetRequest, user: dict = Depends(require_roles(["admin"]))):
    """Clear operational data, keeping the menu, tables, branches and staff.

    Requires admin role, a typed `ELIMINAR` confirmation, and the admin's
    current password. Resets tables to `disponible` and records a fresh audit
    entry after the wipe.
    """
    if data.confirm.strip() != RESET_CONFIRMATION:
        raise HTTPException(status_code=400, detail=f"Escribe {RESET_CONFIRMATION} para confirmar el restablecimiento")

    current = await db.users.find_one(
        {"id": user["id"], "restaurant_id": user["restaurant_id"]},
        {"password_hash": 1},
    )
    if not current or not current.get("password_hash") or not verify_password(data.password, current["password_hash"]):
        raise HTTPException(status_code=400, detail="Contraseña de administrador incorrecta")

    rid = user["restaurant_id"]
    cleared: dict = {}
    for name in OPERATIONAL_COLLECTIONS:
        result = await db[name].delete_many({"restaurant_id": rid})
        cleared[name] = result.deleted_count

    now = _now()
    tables = await db.tables.update_many(
        {"restaurant_id": rid},
        {
            "$set": {"status": "disponible", "updated_at": now},
            "$unset": {"active_order": "", "active_attention_id": "", "opening_order_id": ""},
        },
    )

    # The audit log is wiped above; this fresh entry documents the reset itself.
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": rid,
        "user_id": user["id"],
        "action": "data_reset",
        "entity": "system",
        "entity_id": rid,
        "details": {"cleared": cleared, "tables_reset": tables.modified_count},
        "created_at": now,
    })

    return {"status": "ok", "cleared": cleared, "tables_reset": tables.modified_count}


@router.post("/catalog")
async def reset_catalog(data: DataResetRequest, user: dict = Depends(require_roles(["admin"]))):
    """Empty the menu (products, categories and combos) so a real one can be loaded.

    Same guards as the operational reset (admin, typed `ELIMINAR`, current
    password) plus a refusal while there are active orders, so the menu is never
    wiped mid-service. Existing orders keep their own product snapshots.
    """
    if data.confirm.strip() != RESET_CONFIRMATION:
        raise HTTPException(status_code=400, detail=f"Escribe {RESET_CONFIRMATION} para confirmar")

    current = await db.users.find_one(
        {"id": user["id"], "restaurant_id": user["restaurant_id"]},
        {"password_hash": 1},
    )
    if not current or not current.get("password_hash") or not verify_password(data.password, current["password_hash"]):
        raise HTTPException(status_code=400, detail="Contraseña de administrador incorrecta")

    rid = user["restaurant_id"]
    active = await db.orders.count_documents(
        {"restaurant_id": rid, "status": {"$nin": ["pagado", "cancelado"]}}
    )
    if active:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Hay {active} pedido(s) activo(s). Cerralos o restablecé los datos "
                "operativos antes de vaciar la carta."
            ),
        )

    cleared: dict = {}
    for name in CATALOG_COLLECTIONS:
        result = await db[name].delete_many({"restaurant_id": rid})
        cleared[name] = result.deleted_count

    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": rid,
        "user_id": user["id"],
        "action": "catalog_reset",
        "entity": "system",
        "entity_id": rid,
        "details": {"cleared": cleared},
        "created_at": _now(),
    })

    return {"status": "ok", "cleared": cleared}
