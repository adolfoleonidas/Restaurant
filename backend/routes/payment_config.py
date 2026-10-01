from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from database import db
from auth import require_roles
from models import PaymentConfigUpdate

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _get_or_create_config(restaurant_id: str):
    cfg = await db.payment_configs.find_one({"restaurant_id": restaurant_id}, {"_id": 0})
    if cfg:
        return cfg
    cfg = {
        "id": str(uuid.uuid4()),
        "restaurant_id": restaurant_id,
        "yape_number": None,
        "yape_holder": None,
        "yape_qr": None,
        "plin_number": None,
        "plin_holder": None,
        "plin_qr": None,
        "bank_name": None,
        "bank_account": None,
        "bank_cci": None,
        "bank_holder": None,
        "transfer_instructions": None,
        "enable_efectivo": True,
        "enable_yape": True,
        "enable_plin": True,
        "enable_transferencia": True,
        "enable_tarjeta": False,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.payment_configs.insert_one(cfg)
    cfg.pop("_id", None)
    return cfg


@router.get("")
async def get_config(user: dict = Depends(require_roles(["admin"]))):
    cfg = await _get_or_create_config(user["restaurant_id"])
    return cfg


@router.get("/collection")
async def collection_config(user: dict = Depends(require_roles(["cajero"]))):
    """Read the configured mobile-wallet options without creating or exposing bank config."""
    cfg = await db.payment_configs.find_one(
        {"restaurant_id": user["restaurant_id"]}, {"_id": 0}
    ) or {}
    options = {}
    for method in ("yape", "plin"):
        enabled = bool(cfg.get(f"enable_{method}"))
        options[method] = {
            "enabled": enabled,
            "number": cfg.get(f"{method}_number") if enabled else None,
            "holder": cfg.get(f"{method}_holder") if enabled else None,
            "qr": cfg.get(f"{method}_qr") if enabled else None,
        }
    return options


@router.patch("")
async def update_config(data: PaymentConfigUpdate, user: dict = Depends(require_roles(["admin"]))):
    await _get_or_create_config(user["restaurant_id"])
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    # Allow clearing QR with empty string explicitly
    explicit = data.model_dump(exclude_unset=True)
    for f in ("yape_qr", "plin_qr", "transfer_instructions"):
        if f in explicit and explicit[f] == "":
            update[f] = None
    update["updated_at"] = _now()
    await db.payment_configs.update_one(
        {"restaurant_id": user["restaurant_id"]},
        {"$set": update}
    )
    return await db.payment_configs.find_one({"restaurant_id": user["restaurant_id"]}, {"_id": 0})
