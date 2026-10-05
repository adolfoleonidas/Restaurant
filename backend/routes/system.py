from datetime import datetime, timezone
import os
import platform

from fastapi import APIRouter, Depends

from database import db
from auth import require_roles

router = APIRouter()

APP_VERSION = "1.0.0"
_STARTED_AT = datetime.now(timezone.utc)

# Tenant-scoped collections summarized for the admin settings screen.
_COUNTED = (
    ("tables", "tables"),
    ("products", "products"),
    ("categories", "categories"),
    ("users", "users"),
    ("orders", "orders"),
    ("payments", "payments"),
    ("branches", "branches"),
    ("zones", "zones"),
)


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"true", "1", "yes"}


@router.get("/info")
async def system_info(user: dict = Depends(require_roles(["admin"]))):
    """Read-only system diagnostics for the admin settings screen.

    Exposes only non-sensitive operational metadata: no connection strings,
    credentials or record contents.
    """
    restaurant_id = user["restaurant_id"]

    connected = True
    try:
        await db.command("ping")
    except Exception:
        connected = False

    counts = {}
    for key, collection in _COUNTED:
        counts[key] = await db[collection].count_documents({"restaurant_id": restaurant_id})

    restaurant = await db.restaurants.find_one(
        {"id": restaurant_id},
        {"_id": 0, "name": 1, "timezone": 1, "currency": 1, "created_at": 1},
    )

    now = datetime.now(timezone.utc)
    return {
        "app_version": APP_VERSION,
        "environment": (os.environ.get("APP_ENV") or "production"),
        "demo_seed": _env_flag("SEED_DEMO"),
        "demo_passwords": not all(os.environ.get(k) for k in (
            "SEED_ADMIN_PASSWORD", "SEED_CAJERO_PASSWORD", "SEED_MOZO_PASSWORD", "SEED_COCINA_PASSWORD",
        )),
        "database": {
            "name": os.environ.get("DB_NAME", "restaurant_db"),
            "connected": connected,
        },
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.system(),
        },
        "restaurant": restaurant,
        "counts": counts,
        "server_time": now.isoformat(),
        "uptime_seconds": int((now - _STARTED_AT).total_seconds()),
    }
