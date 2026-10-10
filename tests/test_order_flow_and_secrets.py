"""Order transitions stay forward, and a new production boot refuses known secrets."""
import asyncio
import copy
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "restaurant_db_unit")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi import HTTPException

from models import KitchenBump, OrderItemStatusUpdate
from routes.orders import bump_item, bump_kitchen, change_status, serve_order
import routes.orders as order_routes


RID = "rest-1"


class _Result:
    def __init__(self, n):
        self.modified_count = n


def _match(doc, filt):
    for key, expected in (filt or {}).items():
        if isinstance(expected, dict) and "$nin" in expected:
            if doc.get(key) in expected["$nin"]:
                return False
            continue
        if isinstance(expected, dict) and "$exists" in expected:
            if (key in doc) != bool(expected["$exists"]):
                return False
            continue
        if doc.get(key) != expected:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, n):
        return [copy.deepcopy(d) for d in self.docs[:n]]


class _Collection:
    def __init__(self):
        self.docs = []

    async def find_one(self, filt, proj=None):
        for doc in self.docs:
            if _match(doc, filt):
                return copy.deepcopy(doc)
        return None

    def find(self, filt, proj=None):
        return _Cursor([d for d in self.docs if _match(d, filt)])

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))

    async def update_one(self, filt, update):
        for doc in self.docs:
            if _match(doc, filt):
                doc.update(copy.deepcopy(update.get("$set") or {}))
                return _Result(1)
        return _Result(0)


class _DB:
    def __init__(self):
        self.orders = _Collection()
        self.audit_logs = _Collection()
        self.tables = _Collection()
        self.branches = _Collection()
        self.branches.docs.append({"id": "branch-1", "restaurant_id": RID})


def _bind(db):
    order_routes.db = db


def _user(role):
    return {"id": role, "restaurant_id": RID, "role": role, "full_name": role, "branch_id": "branch-1"}


def _order(status, item_status):
    return {
        "id": "order-1",
        "restaurant_id": RID,
        "branch_id": "branch-1",
        "status": status,
        "updated_at": "2026-09-23T12:00:00+00:00",
        "items": [{
            "id": "item-1",
            "product_name": "Lomo",
            "quantity": 1,
            "status": item_status,
        }],
    }


def _status(name, reason=None):
    return type("S", (), {"status": name, "reason": reason})()


def test_serve_rejects_items_still_in_preparation():
    async def run():
        db = _DB()
        db.orders.docs.append(_order("en_preparacion", "en_preparacion"))
        _bind(db)
        await serve_order("order-1", _user("mozo"))

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert caught.value.status_code == 400


def test_item_cannot_skip_preparation_or_go_backwards():
    async def jump():
        db = _DB()
        db.orders.docs.append(_order("enviado_cocina", "pendiente"))
        _bind(db)
        await bump_item("order-1", "item-1", OrderItemStatusUpdate(status="listo"), _user("cocina"))

    async def back():
        db = _DB()
        db.orders.docs.append(_order("listo", "listo"))
        _bind(db)
        await bump_item("order-1", "item-1", OrderItemStatusUpdate(status="en_preparacion"), _user("cocina"))

    with pytest.raises(HTTPException) as jumped:
        asyncio.run(jump())
    with pytest.raises(HTTPException) as backed:
        asyncio.run(back())
    assert jumped.value.status_code == 400
    assert backed.value.status_code == 400


def test_cancelled_order_cannot_be_reopened_or_cooked():
    async def reopen():
        db = _DB()
        db.orders.docs.append(_order("cancelado", "cancelado"))
        _bind(db)
        await change_status("order-1", _status("entregado"), _user("admin"))

    async def cook():
        db = _DB()
        db.orders.docs.append(_order("cancelado", "pendiente"))
        _bind(db)
        await bump_kitchen("order-1", KitchenBump(from_status="pendiente"), _user("cocina"))

    with pytest.raises(HTTPException) as reopened:
        asyncio.run(reopen())
    with pytest.raises(HTTPException) as cooked:
        asyncio.run(cook())
    assert reopened.value.status_code == 400
    assert cooked.value.status_code == 400


def test_status_cannot_move_backwards():
    async def run():
        db = _DB()
        db.orders.docs.append(_order("listo", "listo"))
        _bind(db)
        await change_status("order-1", _status("en_preparacion"), _user("cocina"))

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert caught.value.status_code == 400


def test_ready_ticket_can_still_be_served():
    async def run():
        db = _DB()
        db.orders.docs.append(_order("listo", "listo"))
        _bind(db)
        served = await serve_order("order-1", _user("mozo"))
        prepared = await change_status("order-1", _status("pendiente_pago"), _user("mozo"))
        return served, prepared

    served, prepared = asyncio.run(run())
    assert served["status"] == "entregado"
    assert served["items"][0]["status"] == "entregado"
    assert prepared["status"] == "entregado"
    assert prepared["fulfillment_status"] == "entregado"
    assert prepared["payment_requested"] is True


def test_item_advances_one_step_at_a_time():
    async def run():
        db = _DB()
        db.orders.docs.append(_order("enviado_cocina", "pendiente"))
        _bind(db)
        cooking = await bump_item("order-1", "item-1", OrderItemStatusUpdate(status="en_preparacion"), _user("cocina"))
        ready = await bump_item("order-1", "item-1", OrderItemStatusUpdate(status="listo"), _user("cocina"))
        return cooking, ready

    cooking, ready = asyncio.run(run())
    assert cooking["items"][0]["status"] == "en_preparacion"
    assert ready["items"][0]["status"] == "listo"
    assert ready["status"] == "listo"


def test_kitchen_can_still_walk_forward():
    async def run():
        db = _DB()
        db.orders.docs.append(_order("enviado_cocina", "pendiente"))
        _bind(db)
        cooking = await change_status("order-1", _status("en_preparacion"), _user("cocina"))
        ready = await change_status("order-1", _status("listo"), _user("cocina"))
        return cooking, ready

    cooking, ready = asyncio.run(run())
    assert cooking["status"] == "en_preparacion"
    assert cooking["items"][0]["status"] == "en_preparacion"
    assert ready["status"] == "listo"
    assert ready["items"][0]["status"] == "listo"


def test_production_rejects_known_jwt_and_open_cors():
    from security_config import assert_runtime_config

    with pytest.raises(RuntimeError):
        assert_runtime_config({
            "APP_ENV": "production",
            "JWT_SECRET": "change-this-secret",
            "CORS_ORIGINS": "https://resto.example",
        })
    with pytest.raises(RuntimeError):
        assert_runtime_config({
            "APP_ENV": "production",
            "JWT_SECRET": "x" * 40,
            "CORS_ORIGINS": "*",
        })
    assert_runtime_config({
        "APP_ENV": "development",
        "JWT_SECRET": "change-this-secret",
        "CORS_ORIGINS": "*",
    })


def test_production_seed_refuses_demo_passwords():
    from security_config import resolve_seed_passwords

    with pytest.raises(RuntimeError):
        resolve_seed_passwords({"APP_ENV": "production"})
    with pytest.raises(RuntimeError):
        resolve_seed_passwords({
            "APP_ENV": "production",
            "SEED_ADMIN_PASSWORD": "admin123",
            "SEED_CAJERO_PASSWORD": "otra-clave-caja",
            "SEED_MOZO_PASSWORD": "otra-clave-mozo",
            "SEED_COCINA_PASSWORD": "otra-clave-cocina",
        })
    passwords = resolve_seed_passwords({"APP_ENV": "development"})
    assert passwords["SEED_ADMIN_PASSWORD"] == "admin123"
    production = resolve_seed_passwords({
        "APP_ENV": "production",
        "SEED_ADMIN_PASSWORD": "admin-unico-de-este-local",
        "SEED_CAJERO_PASSWORD": "caja-unica-de-este-local",
        "SEED_MOZO_PASSWORD": "mozo-unico-de-este-local",
        "SEED_COCINA_PASSWORD": "cocina-unica-de-este-local",
    })
    assert production["SEED_ADMIN_PASSWORD"] == "admin-unico-de-este-local"


def test_compose_does_not_publish_known_defaults():
    text = (Path(__file__).resolve().parents[1] / "docker-compose.yml").read_text(encoding="utf-8")
    assert "change-this-secret" not in text
    assert "CORS_ORIGINS:-*" not in text
    assert ":-*" not in text
