"""Clean handoff empties one restaurant and leaves no demo payment identity."""
import asyncio
import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from handoff import (  # noqa: E402
    CLEARED_COLLECTIONS,
    HandoffRefused,
    assert_handoff_admin,
    empty_payment_config,
    handoff_reset,
)

RID = "rest-1"
OTHER = "rest-2"
NOW = "2026-09-29T12:00:00+00:00"
ADMIN_ID = "admin-1"
MOZO_ID = "mozo-1"

CLEARED = (
    "orders",
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


def _match(doc, filt):
    for key, expected in (filt or {}).items():
        if isinstance(expected, dict) and "$ne" in expected:
            if doc.get(key) == expected["$ne"]:
                return False
            continue
        if doc.get(key) != expected:
            return False
    return True


class _Collection:
    def __init__(self, name, log):
        self.name = name
        self.log = log
        self.docs = []

    async def delete_many(self, filt):
        self.log.append(("delete", self.name, copy.deepcopy(filt)))
        self.docs = [doc for doc in self.docs if not _match(doc, filt)]

    async def update_one(self, filt, update):
        self.log.append(("update", self.name, copy.deepcopy(filt), copy.deepcopy(update)))
        for doc in self.docs:
            if _match(doc, filt):
                doc.update(copy.deepcopy(update.get("$set") or {}))
                return

    async def insert_one(self, doc):
        self.log.append(("insert", self.name, copy.deepcopy(doc)))
        self.docs.append(copy.deepcopy(doc))


class _DB:
    def __init__(self):
        self.log = []
        for name in list(CLEARED) + ["users", "restaurants", "payment_configs"]:
            setattr(self, name, _Collection(name, self.log))


def _loaded(db):
    for name in CLEARED:
        getattr(db, name).docs.append({
            "id": f"{name}-here",
            "restaurant_id": RID,
            "note": "999 888 777 BCP @saborperuano",
        })
        getattr(db, name).docs.append({
            "id": f"{name}-other",
            "restaurant_id": OTHER,
            "note": "otro local",
        })
    db.users.docs.extend([
        {"id": ADMIN_ID, "restaurant_id": RID, "role": "admin", "email": "admin@resto.com", "password_hash": "hash-admin"},
        {"id": MOZO_ID, "restaurant_id": RID, "role": "mozo", "email": "mozo@resto.com", "password_hash": "hash-mozo"},
        {"id": "other-admin", "restaurant_id": OTHER, "role": "admin", "email": "otro@resto.com", "password_hash": "hash-other"},
    ])
    db.restaurants.docs.append({
        "id": RID,
        "name": "Sabor Peruano",
        "ruc": "20123456789",
        "address": "Av. Larco 123",
        "phone": "+51 999 888 777",
        "logo_url": "https://cdn.example/logo.png",
        "cover_url": "https://images.pexels.com/photos/14590691/pexels-photo-14590691.jpeg",
        "public_description": "Cocina peruana de autor",
        "social_facebook": "sabor",
        "social_instagram": "@saborperuano",
        "social_whatsapp": "+51999888777",
        "opening_hours": "L-D 11:00 - 23:00",
        "delivery_fee": 5.0,
        "currency": "PEN",
        "currency_symbol": "S/",
        "timezone": "America/Lima",
        "status": "active",
        "prep_mode": "detailed",
    })
    db.restaurants.docs.append({
        "id": OTHER,
        "name": "Otro Local",
        "currency": "PEN",
        "status": "active",
    })
    db.payment_configs.docs.append({
        "id": "pay-1",
        "restaurant_id": RID,
        "yape_number": "999 888 777",
        "yape_holder": "Sabor Peruano S.A.C.",
        "yape_qr": "qr-yape",
        "plin_number": "999 888 777",
        "plin_holder": "Sabor Peruano S.A.C.",
        "plin_qr": "qr-plin",
        "bank_name": "BCP",
        "bank_account": "194-12345678-0-12",
        "bank_cci": "00219400123456780123",
        "bank_holder": "Sabor Peruano S.A.C.",
        "transfer_instructions": "Enviar a BCP",
        "enable_efectivo": True,
        "enable_yape": True,
        "enable_plin": True,
        "enable_transferencia": True,
        "enable_tarjeta": True,
        "created_at": "2020-01-01T00:00:00+00:00",
        "updated_at": "2020-01-01T00:00:00+00:00",
    })
    db.payment_configs.docs.append({
        "id": "pay-other",
        "restaurant_id": OTHER,
        "yape_number": "111",
        "bank_name": "Otro banco",
        "enable_efectivo": True,
    })


def test_wrong_confirmation_raises_and_writes_nothing():
    db = _DB()
    _loaded(db)

    async def run():
        await handoff_reset(
            db,
            restaurant_id=RID,
            admin_user_id=ADMIN_ID,
            confirmation="entregar limpio",
            now=NOW,
        )

    with pytest.raises(HandoffRefused):
        asyncio.run(run())
    assert db.log == []
    assert any(doc["id"] == "orders-here" for doc in db.orders.docs)
    assert any(doc["id"] == MOZO_ID for doc in db.users.docs)


def test_right_confirmation_clears_only_this_restaurant():
    db = _DB()
    _loaded(db)

    async def run():
        return await handoff_reset(
            db,
            restaurant_id=RID,
            admin_user_id=ADMIN_ID,
            confirmation="ENTREGAR LIMPIO",
            now=NOW,
        )

    result = asyncio.run(run())
    assert result == {"kept_user_id": ADMIN_ID}
    assert list(CLEARED_COLLECTIONS) == list(CLEARED)

    deleted = [(name, filt) for op, name, filt, *rest in db.log if op == "delete"]
    assert [name for name, _filt in deleted[:len(CLEARED)]] == list(CLEARED)
    for name, filt in deleted[:len(CLEARED)]:
        assert filt == {"restaurant_id": RID}
    user_deletes = [filt for name, filt in deleted if name == "users"]
    assert len(user_deletes) == 1
    assert user_deletes[0]["restaurant_id"] == RID
    assert all(op != "insert" for op, *_rest in db.log)

    for name in CLEARED:
        rows = getattr(db, name).docs
        assert all(doc.get("restaurant_id") != RID for doc in rows)
        assert any(doc.get("restaurant_id") == OTHER for doc in rows)

    kept_users = [doc["id"] for doc in db.users.docs if doc["restaurant_id"] == RID]
    assert kept_users == [ADMIN_ID]
    admin = next(doc for doc in db.users.docs if doc["id"] == ADMIN_ID)
    assert admin["password_hash"] == "hash-admin"
    assert any(doc["id"] == "other-admin" for doc in db.users.docs)

    rest = next(doc for doc in db.restaurants.docs if doc["id"] == RID)
    assert rest["name"] == "Restaurante"
    assert rest["ruc"] == ""
    assert rest["address"] == ""
    assert rest["phone"] == ""
    assert rest["logo_url"] is None
    assert rest["cover_url"] is None
    assert rest["public_description"] == ""
    assert rest["social_facebook"] is None
    assert rest["social_instagram"] is None
    assert rest["social_whatsapp"] is None
    assert rest["opening_hours"] == ""
    assert rest["delivery_fee"] == 0
    assert rest["updated_at"] == NOW
    assert rest["currency"] == "PEN"
    assert rest["currency_symbol"] == "S/"
    assert rest["timezone"] == "America/Lima"
    assert rest["status"] == "active"
    assert rest["prep_mode"] == "detailed"
    other = next(doc for doc in db.restaurants.docs if doc["id"] == OTHER)
    assert other["name"] == "Otro Local"

    cfg = next(doc for doc in db.payment_configs.docs if doc["restaurant_id"] == RID)
    blank = empty_payment_config(restaurant_id=RID, now=NOW, config_id="ignored")
    for key, value in blank.items():
        if key in ("id", "restaurant_id", "created_at"):
            continue
        assert cfg[key] == value
    assert cfg["id"] == "pay-1"
    assert cfg["created_at"] == "2020-01-01T00:00:00+00:00"
    other_cfg = next(doc for doc in db.payment_configs.docs if doc["restaurant_id"] == OTHER)
    assert other_cfg["yape_number"] == "111"

    owned = [rest, cfg, admin]
    owned.extend(doc for name in CLEARED for doc in getattr(db, name).docs if doc.get("restaurant_id") == RID)
    blob = repr(owned).lower()
    assert "999" not in blob
    assert "bcp" not in blob
    assert "saborperuano" not in blob


def test_assert_handoff_admin_rejects_mozo_and_accepts_admin():
    with pytest.raises(HandoffRefused):
        assert_handoff_admin({"role": "mozo", "functions": ["administracion"]})
    assert_handoff_admin({"role": "admin"}) is None


def test_empty_payment_config_has_no_demo_numbers():
    doc = empty_payment_config(restaurant_id=RID, now=NOW, config_id="cfg-1")
    blob = repr(doc).lower()
    assert "999" not in blob
    assert "bcp" not in blob
    assert "saborperuano" not in blob
    assert "194-12345678" not in blob
    assert doc["restaurant_id"] == RID
    assert doc["enable_efectivo"] is True
    assert doc["enable_yape"] is False
    assert doc["enable_plin"] is False
    assert doc["enable_transferencia"] is False
    assert doc["enable_tarjeta"] is False
    for key in (
        "yape_number",
        "yape_holder",
        "plin_number",
        "plin_holder",
        "bank_name",
        "bank_account",
        "bank_cci",
        "bank_holder",
        "transfer_instructions",
    ):
        assert doc[key] == ""
    assert doc["yape_qr"] is None
    assert doc["plin_qr"] is None
    source = (Path(__file__).resolve().parents[1] / "backend" / "seed.py").read_text(encoding="utf-8")
    assert "empty_payment_config" in source
