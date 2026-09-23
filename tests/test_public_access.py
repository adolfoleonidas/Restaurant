"""Public orders need a table QR, a rate limit, and staff acceptance before the kitchen."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "restaurant_db_unit")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import PublicOrderCreate, OrderItemInput
from routes.orders import kitchen_orders
from routes.public import public_create_order, public_tables
from guest_access import read_table_token, sign_table, public_order_limiter
from test_money_integrity import _DB, _cashier
import routes.orders as order_routes
import routes.public as public_routes


class _Request:
    def __init__(self, host):
        self.client = type("Client", (), {"host": host})()
        self.headers = {}


def _bind(db):
    public_routes.db = db
    order_routes.db = db
    counter = {"n": 0}

    async def _next(_restaurant_id):
        counter["n"] += 1
        return counter["n"]

    public_routes._next_order_number = _next


def _world():
    db = _DB()
    db.restaurants.docs.append({"id": "rest-1", "name": "Sabor", "delivery_fee": 0})
    db.tables.docs.append({"id": "mesa-1", "restaurant_id": "rest-1", "number": 4, "status": "disponible", "area": "Salon"})
    db.products.docs.append({
        "id": "prod-1",
        "restaurant_id": "rest-1",
        "name": "Lomo",
        "price": 20.0,
        "is_available": True,
        "is_combo": False,
    })
    return db


def _body(**extra):
    data = {
        "order_type": "local",
        "table_id": "mesa-1",
        "customer_name": "Ana",
        "customer_phone": "999",
        "items": [OrderItemInput(product_id="prod-1", quantity=1)],
        "payment_method": "efectivo",
    }
    data.update(extra)
    return PublicOrderCreate(**data)


def test_default_menu_lists_tables_and_a_bad_token_is_rejected():
    async def run():
        _bind(_world())
        return await public_tables()

    listed = asyncio.run(run())
    assert listed[0]["number"] == 4
    with pytest.raises(ValueError):
        read_table_token("no-es-un-qr")


def test_local_order_without_qr_still_reaches_the_kitchen():
    async def run():
        db = _world()
        _bind(db)
        public_order_limiter.reset()
        created = await public_create_order(_body(), _Request("10.0.0.8"))
        stored = await db.orders.find_one({"id": created["id"]})
        board = await kitchen_orders(_cashier())
        return stored, board

    stored, board = asyncio.run(run())
    assert stored["status"] == "enviado_cocina"
    assert stored["table_id"] == "mesa-1"
    assert any(row["id"] == stored["id"] for row in board)


def test_signed_table_qr_selects_that_table_when_the_local_turns_it_on():
    async def run():
        db = _world()
        db.restaurants.docs[0]["require_table_qr"] = True
        _bind(db)
        public_order_limiter.reset()
        try:
            await public_create_order(_body(), _Request("10.0.0.7"))
            missing = None
        except HTTPException as exc:
            missing = exc
        token = sign_table("mesa-1")
        created = await public_create_order(_body(table_token=token), _Request("10.0.0.9"))
        stored = await db.orders.find_one({"id": created["id"]})
        board = await kitchen_orders(_cashier())
        return missing, stored, board

    missing, stored, board = asyncio.run(run())
    assert missing is not None and missing.status_code == 400
    assert stored["table_id"] == "mesa-1"
    assert stored["status"] == "enviado_cocina"
    assert any(row["id"] == stored["id"] for row in board)


def test_public_orders_are_rate_limited_per_client():
    async def run():
        db = _world()
        _bind(db)
        public_order_limiter.reset()
        public_order_limiter.limit = 2
        request = _Request("10.1.1.1")
        try:
            first = await public_create_order(_body(order_type="recojo", table_token=None, table_id=None), request)
            await public_create_order(_body(order_type="recojo", table_token=None, table_id=None), request)
            try:
                await public_create_order(_body(order_type="recojo", table_token=None, table_id=None), request)
                blocked = None
            except HTTPException as exc:
                blocked = exc
            return first, blocked
        finally:
            public_order_limiter.limit = 8
            public_order_limiter.reset()

    first, blocked = asyncio.run(run())
    assert first["order_number"]
    assert blocked is not None and blocked.status_code == 429
    assert read_table_token(sign_table("mesa-1")) == "mesa-1"
