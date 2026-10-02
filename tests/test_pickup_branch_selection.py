"""Public pickup branch admission and idempotency regressions using fake collections."""
import asyncio
import copy
import hashlib
import json
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "oc5_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from models import PublicOrderCreate
import routes.public as public_routes


class Collection:
    def __init__(self, rows=()):
        self.rows = copy.deepcopy(list(rows))
        self.inserts = []

    async def find_one(self, query, projection=None):
        return next((copy.deepcopy(row) for row in self.rows if all(row.get(k) == v for k, v in query.items())), None)

    def find(self, query, projection=None):
        rows = [copy.deepcopy(row) for row in self.rows if all(row.get(k) == v for k, v in query.items())]
        return Cursor(rows)

    async def insert_one(self, row):
        self.inserts.append(copy.deepcopy(row))
        self.rows.append(copy.deepcopy(row))


class Cursor:
    def __init__(self, rows): self.rows = rows
    def sort(self, *_args): return self
    async def to_list(self, length): return self.rows[:length]


class DB:
    def __init__(self, branches=(), orders=()):
        self.branches = Collection(branches)
        self.orders = Collection(orders)
        self.audit_logs = Collection()
        self.counters = Collection()


def request():
    from starlette.requests import Request
    return Request({"type": "http", "method": "POST", "path": "/api/public/orders", "headers": [], "client": ("127.0.0.1", 1), "query_string": b""})


def order(branch_id=None, request_id=None):
    payload = {"order_type": "recojo", "customer_name": "Ana", "customer_phone": "999", "items": [{"product_id": "dish", "quantity": 1}], "payment_method": "efectivo"}
    if branch_id is not None: payload["branch_id"] = branch_id
    if request_id: payload["request_id"] = request_id
    return PublicOrderCreate(**payload)


def test_public_order_branch_field_validates_nonblank_and_is_optional_for_legacy_models():
    assert order().branch_id is None
    assert order(" branch-a ").branch_id == "branch-a"
    with pytest.raises(ValidationError): order("   ")


def test_public_pickup_list_returns_only_minimal_enabled_branches(monkeypatch):
    db = DB([
        {"id": "a", "restaurant_id": "tenant-a", "name": "Centro", "pickup_enabled": True, "timezone": "private"},
        {"id": "b", "restaurant_id": "tenant-a", "name": "Legacy"},
        {"id": "c", "restaurant_id": "tenant-a", "name": "Off", "pickup_enabled": False},
        {"id": "d", "restaurant_id": "tenant-b", "name": "Foreign", "pickup_enabled": True},
    ])
    monkeypatch.setattr(public_routes, "db", db)
    monkeypatch.setattr(public_routes, "_get_restaurant", lambda: asyncio.sleep(0, result={"id": "tenant-a"}))
    result = asyncio.run(public_routes.public_pickup_branches())
    assert result == [{"id": "a", "name": "Centro"}]


def test_new_pickup_requires_enabled_owned_branch_before_order_or_counter_writes(monkeypatch):
    db = DB([{"id": "branch-a", "restaurant_id": "tenant-a", "name": "Centro", "pickup_enabled": False}])
    monkeypatch.setattr(public_routes, "db", db)
    monkeypatch.setattr(public_routes, "_get_restaurant", lambda: asyncio.sleep(0, result={"id": "tenant-a"}))
    monkeypatch.setattr(public_routes.public_order_limiter, "allow", lambda _host: True)
    monkeypatch.setattr(public_routes, "_enrich_items", lambda *_: asyncio.sleep(0, result=([{"product_id": "dish", "quantity": 1}], 12)))
    monkeypatch.setattr(public_routes, "_next_order_number", lambda *_: pytest.fail("counter must not advance"))
    for branch_id in (None, "foreign", "branch-a"):
        with pytest.raises(HTTPException) as error:
            asyncio.run(public_routes.public_create_order(order(branch_id), request()))
        assert error.value.status_code in (400, 404)
        assert not db.orders.inserts


def test_enabled_pickup_snapshots_selected_branch_without_changing_table_or_delivery(monkeypatch):
    db = DB([{"id": "branch-a", "restaurant_id": "tenant-a", "name": "Centro", "pickup_enabled": True}])
    monkeypatch.setattr(public_routes, "db", db)
    monkeypatch.setattr(public_routes, "_get_restaurant", lambda: asyncio.sleep(0, result={"id": "tenant-a"}))
    monkeypatch.setattr(public_routes.public_order_limiter, "allow", lambda _host: True)
    monkeypatch.setattr(public_routes, "_enrich_items", lambda *_: asyncio.sleep(0, result=([{"product_id": "dish", "quantity": 1}], 12)))
    monkeypatch.setattr(public_routes, "_next_order_number", lambda *_: asyncio.sleep(0, result=7))
    monkeypatch.setattr(public_routes, "_gen_tracking", lambda: "TRACK123")
    monkeypatch.setattr(public_routes, "_finish_public_order", lambda row, _data: asyncio.sleep(0, result=row))
    created = asyncio.run(public_routes.public_create_order(order("branch-a"), request()))
    assert created["branch_id"] == "branch-a"
    assert len(db.orders.inserts) == 1


def test_fingerprint_keeps_legacy_payload_and_binds_selected_branch():
    legacy = order()
    explicit_a = order("branch-a")
    explicit_b = order("branch-b")
    old_payload = {"restaurant_id": "tenant-a", "table_id": None, "request": legacy.model_dump(exclude={"request_id", "branch_id"})}
    old_bytes = json.dumps(old_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    assert public_routes._public_order_fingerprint(legacy, "tenant-a", None) == hashlib.sha256(old_bytes).hexdigest()
    assert public_routes._public_order_fingerprint(explicit_a, "tenant-a", None) != public_routes._public_order_fingerprint(explicit_b, "tenant-a", None)
    table_request = legacy.model_copy(update={"order_type": "local", "branch_id": "untrusted-client-branch"})
    table_without_override = legacy.model_copy(update={"order_type": "local", "branch_id": None})
    assert public_routes._public_order_fingerprint(table_request, "tenant-a", "table-a") == public_routes._public_order_fingerprint(table_without_override, "tenant-a", "table-a")


def test_exact_pickup_replay_survives_later_disable_but_changed_branch_conflicts(monkeypatch):
    request_id = "12345678-1234-4234-8234-123456789abc"
    original = order("branch-a", request_id)
    previous = {"id": "old-order", "restaurant_id": "tenant-a", "request_id": request_id,
                "request_fingerprint": public_routes._public_order_fingerprint(original, "tenant-a", None),
                "branch_id": "branch-a", "order_number": 5, "table_id": None}
    db = DB([{"id": "branch-a", "restaurant_id": "tenant-a", "name": "Centro", "pickup_enabled": False}], [previous])
    monkeypatch.setattr(public_routes, "db", db)
    monkeypatch.setattr(public_routes, "_get_restaurant", lambda: asyncio.sleep(0, result={"id": "tenant-a"}))
    monkeypatch.setattr(public_routes.public_order_limiter, "allow", lambda _host: True)
    monkeypatch.setattr(public_routes, "_finish_public_order", lambda row, _data: asyncio.sleep(0, result=row))
    replay = asyncio.run(public_routes.public_create_order(original, request()))
    assert replay["id"] == "old-order"
    assert not db.orders.inserts

    with pytest.raises(HTTPException) as error:
        asyncio.run(public_routes.public_create_order(order("branch-b", request_id), request()))
    assert error.value.status_code == 409
    assert not db.orders.inserts
