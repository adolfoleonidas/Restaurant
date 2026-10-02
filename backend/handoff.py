"""Admin-only wipe that leaves one blank house for the next client."""

HANDOFF_CONFIRMATION = "ENTREGAR LIMPIO"

CLEARED_COLLECTIONS = (
    "orders",
    "attentions",
    "payments",
    "cash_registers",
    "cash_movements",
    "tables",
    "zones",
    "products",
    "categories",
    "approvals",
    "audit_logs",
    "counters",
)


class HandoffRefused(Exception):
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def assert_handoff_admin(user) -> None:
    if user.get("role") != "admin":
        raise HandoffRefused("role")


def empty_payment_config(*, restaurant_id: str, now: str, config_id: str) -> dict:
    return {
        "id": config_id,
        "restaurant_id": restaurant_id,
        "yape_number": "",
        "yape_holder": "",
        "yape_qr": None,
        "plin_number": "",
        "plin_holder": "",
        "plin_qr": None,
        "bank_name": "",
        "bank_account": "",
        "bank_cci": "",
        "bank_holder": "",
        "transfer_instructions": "",
        "enable_efectivo": True,
        "enable_yape": False,
        "enable_plin": False,
        "enable_transferencia": False,
        "enable_tarjeta": False,
        "created_at": now,
        "updated_at": now,
    }


def _blank_payment_update(now: str) -> dict:
    fields = empty_payment_config(restaurant_id="", now=now, config_id="")
    for key in ("id", "restaurant_id", "created_at"):
        fields.pop(key)
    return fields


async def handoff_reset(db, *, restaurant_id: str, admin_user_id: str, confirmation: str, now: str) -> dict:
    if confirmation != HANDOFF_CONFIRMATION:
        raise HandoffRefused("confirmation")
    for name in CLEARED_COLLECTIONS:
        await getattr(db, name).delete_many({"restaurant_id": restaurant_id})
    await db.users.delete_many({"restaurant_id": restaurant_id, "id": {"$ne": admin_user_id}})
    await db.restaurants.update_one(
        {"id": restaurant_id},
        {"$set": {
            "name": "Restaurante",
            "ruc": "",
            "address": "",
            "phone": "",
            "logo_url": None,
            "cover_url": None,
            "public_description": "",
            "social_facebook": None,
            "social_instagram": None,
            "social_whatsapp": None,
            "opening_hours": "",
            "delivery_fee": 0,
            "updated_at": now,
        }},
    )
    await db.payment_configs.update_one(
        {"restaurant_id": restaurant_id},
        {"$set": _blank_payment_update(now)},
    )
    return {"kept_user_id": admin_user_id}
