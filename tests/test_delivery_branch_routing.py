"""Public delivery orders must keep an explicit tenant-owned branch."""
import asyncio
import copy
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "t1_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from models import PublicOrderCreate
import routes.public as public_routes


class Collection:
    def __init__(self, rows=()):
        self.rows = copy.deepcopy(list(rows))
        self.inserts = []

    async def find_one(self, query, projection=None):
        return next((copy.deepcopy(row) for row in self.rows
                     if all(row.get(key) == value for key, value in query.items())), None)

    def find(self, query, projection=None):
        rows = [copy.deepcopy(row) for row in self.rows
                if all(row.get(key) == value for key, value in query.items())]
        if projection:
            rows = [{key: row[key] for key, include in projection.items()
                     if include and key != "_id" and key in row} for row in rows]
        return Cursor(rows)

    async def insert_one(self, row):
        self.inserts.append(copy.deepcopy(row))
        self.rows.append(copy.deepcopy(row))


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, key, direction=1):
        self.rows.sort(key=lambda row: row.get(key) or "", reverse=direction < 0)
        return self

    async def to_list(self, limit):
        return self.rows[:limit]


class Database:
    def __init__(self, branches=()):
        self.branches = Collection(branches)
        self.orders = Collection()
        self.payment_configs = Collection()


def _request():
    from starlette.requests import Request
    return Request({"type": "http", "method": "POST", "path": "/api/public/orders",
                    "headers": [], "client": ("127.0.0.1", 1), "query_string": b""})


def _order(branch_id, request_id="12345678-1234-4234-8234-123456789abc"):
    return PublicOrderCreate(
        order_type="delivery", branch_id=branch_id, request_id=request_id,
        customer_name="Ana", customer_phone="999", customer_address="Main Street 10",
        items=[{"product_id": "dish", "quantity": 1}], payment_method="efectivo",
    )


def _configure(monkeypatch, db):
    monkeypatch.setattr(public_routes, "db", db)
    monkeypatch.setattr(public_routes, "_get_restaurant",
                        lambda: asyncio.sleep(0, result={"id": "tenant-a", "delivery_fee": 5}))
    monkeypatch.setattr(public_routes.public_order_limiter, "allow", lambda *_: True)
    monkeypatch.setattr(public_routes, "client_host", lambda *_: "test-host")
    monkeypatch.setattr(public_routes, "_ensure_public_payment_method_enabled", lambda *_: None)
    monkeypatch.setattr(public_routes, "_enrich_items",
                        lambda *_: asyncio.sleep(0, result=([{"product_id": "dish", "quantity": 1}], 12)))
    monkeypatch.setattr(public_routes, "_next_order_number", lambda *_: asyncio.sleep(0, result=8))
    monkeypatch.setattr(public_routes, "_gen_tracking", lambda: "DELIVERY123")
    monkeypatch.setattr(public_routes, "_finish_public_order", lambda row, _data: asyncio.sleep(0, result=row))


def test_public_delivery_branch_list_is_tenant_scoped_and_minimal(monkeypatch):
    db = Database([{"id": "branch-a", "restaurant_id": "tenant-a", "name": "Centro", "timezone": "private", "pickup_enabled": False},
                   {"id": "branch-foreign", "restaurant_id": "tenant-b", "name": "Other"}])
    monkeypatch.setattr(public_routes, "db", db)
    monkeypatch.setattr(public_routes, "_get_restaurant",
                        lambda: asyncio.sleep(0, result={"id": "tenant-a"}))

    branches = asyncio.run(public_routes.public_delivery_branches())

    assert branches == [{"id": "branch-a", "name": "Centro"}]


@pytest.mark.parametrize("branch_id", [None, "branch-foreign"])
def test_new_delivery_requires_tenant_branch_before_order_or_counter_writes(monkeypatch, branch_id):
    db = Database([{"id": "branch-a", "restaurant_id": "tenant-a", "name": "Centro"},
                   {"id": "branch-foreign", "restaurant_id": "tenant-b", "name": "Other"}])
    _configure(monkeypatch, db)
    monkeypatch.setattr(public_routes, "_enrich_items", lambda *_: pytest.fail("item enrichment must not start"))
    monkeypatch.setattr(public_routes, "_next_order_number", lambda *_: pytest.fail("counter must not advance"))

    with pytest.raises(HTTPException) as error:
        asyncio.run(public_routes.public_create_order(_order(branch_id), _request()))

    assert error.value.status_code in (400, 404)
    assert not db.orders.inserts


def test_delivery_binds_tenant_branch_and_exact_request_replay(monkeypatch):
    db = Database([{"id": "branch-a", "restaurant_id": "tenant-a", "name": "Centro"},
                   {"id": "branch-b", "restaurant_id": "tenant-a", "name": "Sur", "pickup_enabled": False}])
    _configure(monkeypatch, db)
    payload = _order("branch-b")

    created = asyncio.run(public_routes.public_create_order(payload, _request()))
    replay = asyncio.run(public_routes.public_create_order(payload, _request()))

    assert created["branch_id"] == "branch-b"
    assert db.orders.rows[0]["branch_id"] == "branch-b"
    assert replay["id"] == created["id"]
    assert len(db.orders.inserts) == 1
    assert db.orders.rows[0]["request_fingerprint"] == public_routes._public_order_fingerprint(payload, "tenant-a", None)

    with pytest.raises(HTTPException) as error:
        asyncio.run(public_routes.public_create_order(_order("branch-a"), _request()))
    assert error.value.status_code == 409
    assert len(db.orders.inserts) == 1


def test_delivery_fingerprint_includes_selected_branch():
    assert public_routes._public_order_fingerprint(_order("branch-a"), "tenant-a", None) != \
        public_routes._public_order_fingerprint(_order("branch-b"), "tenant-a", None)
