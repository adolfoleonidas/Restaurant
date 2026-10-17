from datetime import datetime, timezone
import os
import platform

from fastapi import APIRouter, Depends

from database import db
from auth import require_roles, verify_password_async
from security_config import known_demo_passwords

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


# digest -> does it open with a published demo password? A bcrypt hash never
# changes for the same password, so a verdict stays valid for as long as the
# digest does: changing a password changes the digest and misses the cache. The
# bcrypt sweep therefore runs once per distinct hash, not once per request.
_DEMO_VERDICTS: dict = {}
_DEMO_VERDICTS_MAX = 512


def _reset_demo_password_cache() -> None:
    _DEMO_VERDICTS.clear()


async def _opens_with_demo_password(digest: str) -> bool:
    cached = _DEMO_VERDICTS.get(digest)
    if cached is not None:
        return cached
    verdict = False
    for demo in known_demo_passwords():
        if await verify_password_async(demo, digest):
            verdict = True
            break
    if len(_DEMO_VERDICTS) >= _DEMO_VERDICTS_MAX:
        _DEMO_VERDICTS.clear()
    _DEMO_VERDICTS[digest] = verdict
    return verdict


async def _accounts_with_demo_passwords(restaurant_id: str) -> list:
    """Staff accounts that still open with a published demo password.

    bcrypt is one-way, so the only honest check is verifying the known values
    against each hash. Bounded, run off the event loop and memoized per digest.
    """
    flagged = []
    accounts = await db.users.find(
        {"restaurant_id": restaurant_id, "status": "active"},
        {"_id": 0, "email": 1, "password_hash": 1},
    ).limit(25).to_list(25)
    for account in accounts:
        digest = account.get("password_hash") or ""
        if not digest:
            continue
        if await _opens_with_demo_password(digest):
            flagged.append(account.get("email"))
    return flagged


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
    demo_accounts = await _accounts_with_demo_passwords(restaurant_id)
    return {
        "app_version": APP_VERSION,
        "environment": (os.environ.get("APP_ENV") or "production"),
        "demo_seed": _env_flag("SEED_DEMO"),
        # Actually verified against the accounts, not guessed from the env: an
        # earlier development boot can leave admin123 in production.
        "demo_passwords": bool(demo_accounts),
        "demo_password_accounts": demo_accounts,
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
