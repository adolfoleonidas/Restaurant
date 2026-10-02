"""Table branch ownership and opening coordination regressions (in-memory only)."""
import asyncio
import copy
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "oc5_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from models import TableCreate, TableUpdate, OrderCreate, PublicOrderCreate, OrderItemInput
from attention import AttentionBlocked, reserve_table_opening, release_table_opening
import routes.tables as table_routes
import routes.orders as order_routes
import routes.public as public_routes


class _Result:
    def __init__(self, matched=0):
        self.matched_count = matched
        self.modified_count = matched
        self.deleted_count = matched


class _Collection:
    def __init__(self, rows=()):
        self.rows = copy.deepcopy(list(rows))
        self.calls = []

    def find(self, query, projection=None):
        return _Cursor([_project(r, projection) for r in self.rows if _matches(r, query)])

    async def find_one(self, query, projection=None):
        self.calls.append((copy.deepcopy(query), copy.deepcopy(projection)))
        row = next((r for r in self.rows if _matches(r, query)), None)
        return _project(row, projection) if row is not None else None

    async def insert_one(self, row):
        if row.get("_id") is not None and any(existing.get("_id") == row.get("_id") for existing in self.rows):
            raise DuplicateKeyError("duplicate Mongo _id")
        if row.get("request_id") and any(
            existing.get("restaurant_id") == row.get("restaurant_id")
            and existing.get("request_id") == row.get("request_id") for existing in self.rows
        ):
            raise DuplicateKeyError("duplicate public request")
        if row.get("table_id") and row.get("attention_state") in ("opening", "open", "mutating", "closing"):
            if any(existing.get("restaurant_id") == row.get("restaurant_id")
                   and existing.get("table_id") == row.get("table_id")
                   and (existing.get("status") not in ("pagado", "cancelado")
                        or existing.get("attention_state") in ("opening", "open", "mutating", "closing"))
                   for existing in self.rows):
                raise DuplicateKeyError("duplicate active table order")
        self.rows.append(copy.deepcopy(row))
        return _Result(1)

    async def update_one(self, query, update, **kwargs):
        self.calls.append((copy.deepcopy(query), copy.deepcopy(update)))
        row = next((r for r in self.rows if _matches(r, query)), None)
        if row is None:
            return _Result()
        for key, value in update.get("$set", {}).items():
            row[key] = copy.deepcopy(value)
        for key in update.get("$unset", {}):
            row.pop(key, None)
        return _Result(1)

    async def delete_one(self, query):
        row = next((r for r in self.rows if _matches(r, query)), None)
        if row is None:
            return _Result()
        self.rows.remove(row)
        return _Result(1)


class _Cursor:
    def __init__(self, rows):
        self.rows = rows
    def sort(self, *_): return self
    def limit(self, *_): return self
    async def to_list(self, length): return copy.deepcopy(self.rows[:length])


def _matches(row, query):
    for key, value in query.items():
        if key == "$or":
            if not any(_matches(row, item) for item in value): return False
        elif key == "$and":
            if not all(_matches(row, item) for item in value): return False
        elif isinstance(value, dict):
            if "$exists" in value and ((key in row) != value["$exists"]): return False
            if "$in" in value and row.get(key) not in value["$in"]: return False
            if "$nin" in value and row.get(key) in value["$nin"]: return False
            if "$ne" in value and row.get(key) == value["$ne"]: return False
        elif row.get(key) != value:
            return False
    return True


def _project(row, projection):
    result = copy.deepcopy(row)
    if not projection:
        return result
    included = {key for key, value in projection.items() if key != "_id" and value}
    if included:
        projected = {key: value for key, value in result.items() if key in included}
        if projection.get("_id", 1) and "_id" in result:
            projected["_id"] = result["_id"]
        return projected
    return {key: value for key, value in result.items() if projection.get(key, 1)}


class _DB:
    def __init__(self, tables=(), branches=(), orders=(), attentions=()):
        self.tables = _Collection(tables)
        self.branches = _Collection(branches)
        self.orders = _Collection(orders)
        self.attentions = _Collection(attentions)
        self.zones = _Collection()
        self.audit_logs = _Collection()


def _table(**updates):
    row = {"id": "table-1", "restaurant_id": "tenant-1", "number": 1,
           "status": "disponible", "created_at": "t0", "updated_at": "t0"}
    row.update(updates)
    return row


def _branch(**updates):
    row = {"id": "branch-1", "restaurant_id": "tenant-1", "name": "Centro",
           "timezone": "America/Lima", "business_day_cutoff": "03:30"}
    row.update(updates)
    return row


def test_table_branch_fields_are_optional_but_cannot_be_cleared_or_blank():
    assert TableCreate(number=1).branch_id is None
    assert TableCreate(number=1, branch_id=" branch-1 ").branch_id == "branch-1"
    assert TableUpdate(name="A").model_dump(exclude_unset=True) == {"name": "A"}
    with pytest.raises(ValidationError): TableUpdate(branch_id=None)
    with pytest.raises(ValidationError): TableUpdate(branch_id="   ")


def test_opening_reservation_captures_branch_and_only_owner_can_release():
    async def run():
        db = _DB([_table(branch_id="branch-1")])
        branch = await reserve_table_opening(db, table=db.tables.rows[0], order_id="order-1",
                                             restaurant_id="tenant-1", allowed_statuses=("disponible",))
        assert branch == "branch-1"
        with pytest.raises(AttentionBlocked):
            await reserve_table_opening(db, table=db.tables.rows[0], order_id="order-2",
                                        restaurant_id="tenant-1", allowed_statuses=("disponible",))
        await release_table_opening(db, table_id="table-1", restaurant_id="tenant-1", order_id="order-2")
        assert db.tables.rows[0]["opening_order_id"] == "order-1"
        await release_table_opening(db, table_id="table-1", restaurant_id="tenant-1", order_id="order-1")
        assert "opening_order_id" not in db.tables.rows[0]
        return db
    db = asyncio.run(run())
    assert any(f.get("opening_order_id") == "order-1" for f, _ in db.tables.calls if isinstance(f, dict))


def test_table_branch_patch_validates_tenant_and_refuses_opening_or_occupied_table(monkeypatch):
    async def run():
        db = _DB([_table()], [_branch(), _branch(id="foreign", restaurant_id="tenant-2")])
        monkeypatch.setattr(table_routes, "db", db)
        user = {"id": "admin", "role": "admin", "restaurant_id": "tenant-1"}
        result = await table_routes.update_table("table-1", TableUpdate(branch_id="branch-1"), user)
        assert result["branch_id"] == "branch-1"
        before = copy.deepcopy(db.tables.rows)
        with pytest.raises(HTTPException) as err:
            await table_routes.update_table("table-1", TableUpdate(branch_id="foreign"), user)
        assert err.value.status_code == 404 and db.tables.rows == before
        db.tables.rows[0]["opening_order_id"] = "opening-1"
        with pytest.raises(HTTPException) as err:
            await table_routes.update_table("table-1", TableUpdate(branch_id="branch-1"), user)
        assert err.value.status_code == 409
        assert db.tables.rows[0]["branch_id"] == "branch-1"
    asyncio.run(run())


def test_branch_assignment_racing_with_order_reservation_has_single_winner():
    async def run():
        db = _DB([_table(branch_id="branch-1")])
        async def assign():
            result = await db.tables.update_one(
                {"id": "table-1", "restaurant_id": "tenant-1", "branch_id": "branch-1",
                 "active_attention_id": {"$exists": False}, "opening_order_id": {"$exists": False}},
                {"$set": {"branch_id": "branch-2"}},
            )
            return result.matched_count == 1
        # Deterministic serialization models Mongo's single-document atomic update boundary.
        assignment_won = await assign()
        with pytest.raises(AttentionBlocked):
            await reserve_table_opening(db, table=_table(branch_id="branch-1"), order_id="order-1",
                                        restaurant_id="tenant-1", allowed_statuses=("disponible",))
        assert assignment_won and db.tables.rows[0]["branch_id"] == "branch-2"
        return db
    asyncio.run(run())


def test_concurrent_reservations_for_one_table_have_one_owner():
    async def run():
        db = _DB([_table(branch_id="branch-1")])
        outcomes = await asyncio.gather(
            reserve_table_opening(db, table=_table(branch_id="branch-1"), order_id="order-1",
                                  restaurant_id="tenant-1", allowed_statuses=("disponible",)),
            reserve_table_opening(db, table=_table(branch_id="branch-1"), order_id="order-2",
                                  restaurant_id="tenant-1", allowed_statuses=("disponible",)),
            return_exceptions=True,
        )
        assert sum(not isinstance(outcome, Exception) for outcome in outcomes) == 1
        assert db.tables.rows[0]["opening_order_id"] in {"order-1", "order-2"}
        return db
    asyncio.run(run())


def test_canonical_attention_claim_preserves_branch_snapshot_and_consumes_reservation():
    from attention import open_table_attention
    async def run():
        order = {"id": "order-1", "restaurant_id": "tenant-1", "table_id": "table-1",
                 "branch_id": "branch-1", "attention_id": "attention-1",
                 "attention_state": "opening", "updated_at": "t0", "status": "nuevo"}
        db = _DB([_table(branch_id="branch-1", opening_order_id="order-1", opening_branch_id="branch-1")],
                 orders=[order])
        opened = await open_table_attention(db, order=order, user={"id": "waiter"}, now="t1")
        assert opened["status"] == "open"
        assert opened["branch_id"] == "branch-1"
        assert db.tables.rows[0]["active_attention_id"] == "attention-1"
        assert "opening_order_id" not in db.tables.rows[0]
        assert db.orders.rows[0]["branch_id"] == "branch-1"
    asyncio.run(run())


def test_staff_order_opening_uses_branch_reservation_before_insert(monkeypatch):
    async def run():
        db = _DB([_table(branch_id="branch-1")], branches=[_branch(id="branch-2")])
        monkeypatch.setattr(order_routes, "db", db)
        monkeypatch.setattr(table_routes, "db", db)
        monkeypatch.setattr(order_routes, "_next_order_number", lambda *_: asyncio.sleep(0, result=1))
        monkeypatch.setattr(order_routes, "_audit", lambda *args, **kwargs: asyncio.sleep(0))
        monkeypatch.setattr(order_routes, "emit_order", lambda *args, **kwargs: None)
        async def response(order_id, _user): return copy.deepcopy(next(row for row in db.orders.rows if row["id"] == order_id))
        monkeypatch.setattr(order_routes, "_current_order_response", response)
        result = await order_routes.create_order(
            OrderCreate(table_id="table-1", order_type="mesa", items=[]),
            {"id": "waiter", "full_name": "Waiter", "role": "mozo", "restaurant_id": "tenant-1"},
        )
        assert result["branch_id"] == "branch-1"
        assert db.attentions.rows[0]["branch_id"] == "branch-1"
        assert db.tables.rows[0]["active_attention_id"] == result["attention_id"]
        assert "opening_order_id" not in db.tables.rows[0]
        with pytest.raises(HTTPException) as error:
            await table_routes.update_table("table-1", TableUpdate(branch_id="branch-2"), {"id": "admin", "role": "admin", "restaurant_id": "tenant-1"})
        assert error.value.status_code == 409
    asyncio.run(run())


def test_table_create_validates_branch_owner_and_keeps_legacy_unassigned(monkeypatch):
    async def run():
        db = _DB(branches=[_branch(), _branch(id="foreign", restaurant_id="tenant-2")])
        monkeypatch.setattr(table_routes, "db", db)
        user = {"id": "admin", "role": "admin", "restaurant_id": "tenant-1"}
        legacy = await table_routes.create_table(TableCreate(number=1), user)
        assert "branch_id" not in legacy
        created = await table_routes.create_table(TableCreate(number=2, branch_id="branch-1"), user)
        assert created["branch_id"] == "branch-1"
        with pytest.raises(HTTPException) as error:
            await table_routes.create_table(TableCreate(number=3, branch_id="foreign"), user)
        assert error.value.status_code == 404
        assert len(db.tables.rows) == 2
    asyncio.run(run())

def _public_request():
    from types import SimpleNamespace
    return SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))


def _public_data():
    return PublicOrderCreate(
        order_type="local", table_id="table-1", request_id="123e4567-e89b-42d3-a456-426614174000",
        items=[OrderItemInput(product_id="product-1", quantity=1)], payment_method="efectivo",
    )


def test_public_order_opening_snapshots_branch_through_canonical_attention(monkeypatch):
    async def run():
        db = _DB([_table(branch_id="branch-1")], branches=[_branch(id="branch-2")])
        monkeypatch.setattr(public_routes, "db", db)
        monkeypatch.setattr(table_routes, "db", db)
        monkeypatch.setattr(public_routes, "_get_restaurant", lambda: asyncio.sleep(0, result={"id": "tenant-1", "require_table_qr": False}))
        monkeypatch.setattr(public_routes.public_order_limiter, "allow", lambda *_: True)
        monkeypatch.setattr(public_routes, "client_host", lambda *_: "127.0.0.1")
        monkeypatch.setattr(public_routes, "_public_order_fingerprint", lambda *_: "fingerprint")
        monkeypatch.setattr(public_routes, "_enrich_items", lambda *_: asyncio.sleep(0, result=([], 0.0)))
        monkeypatch.setattr(public_routes, "_next_order_number", lambda *_: asyncio.sleep(0, result=1))
        monkeypatch.setattr(public_routes, "_gen_tracking", lambda: "ABC123")
        monkeypatch.setattr(public_routes, "emit_notice", lambda *args, **kwargs: None)
        monkeypatch.setattr(public_routes, "emit_order", lambda *args, **kwargs: None)
        result = await public_routes.public_create_order(_public_data(), _public_request())
        assert db.orders.rows[0]["branch_id"] == "branch-1"
        assert db.attentions.rows[0]["branch_id"] == "branch-1"
        assert db.tables.rows[0]["active_attention_id"] == db.orders.rows[0]["attention_id"]
        assert "opening_order_id" not in db.tables.rows[0]
        replay = await public_routes.public_create_order(_public_data(), _public_request())
        assert replay["tracking_code"] == result["tracking_code"]
        assert len(db.orders.rows) == 1
        with pytest.raises(HTTPException) as error:
            await table_routes.update_table("table-1", TableUpdate(branch_id="branch-2"), {"id": "admin", "role": "admin", "restaurant_id": "tenant-1"})
        assert error.value.status_code == 409
        assert len(db.audit_logs.rows) == 1
    asyncio.run(run())


def test_staff_stale_table_snapshot_cannot_open_after_branch_assignment(monkeypatch):
    async def run():
        db = _DB([_table(branch_id="branch-1")], branches=[_branch(id="branch-2")])
        monkeypatch.setattr(order_routes, "db", db)
        monkeypatch.setattr(table_routes, "db", db)
        reached_number = asyncio.Event()
        finish_number = asyncio.Event()
        async def next_number(*_):
            reached_number.set()
            await finish_number.wait()
            return 1
        monkeypatch.setattr(order_routes, "_next_order_number", next_number)
        create_task = asyncio.create_task(order_routes.create_order(
            OrderCreate(table_id="table-1", order_type="mesa", items=[]),
            {"id": "waiter", "full_name": "Waiter", "role": "mozo", "restaurant_id": "tenant-1"},
        ))
        await reached_number.wait()
        admin = {"id": "admin", "role": "admin", "restaurant_id": "tenant-1"}
        await table_routes.update_table("table-1", TableUpdate(branch_id="branch-2"), admin)
        finish_number.set()
        with pytest.raises(HTTPException) as error:
            await create_task
        assert error.value.status_code == 409
        assert not db.orders.rows
        assert db.tables.rows[0]["branch_id"] == "branch-2"
        assert "opening_order_id" not in db.tables.rows[0]
    asyncio.run(run())


def test_public_stale_table_snapshot_cannot_open_after_branch_assignment(monkeypatch):
    async def run():
        db = _DB([_table(branch_id="branch-1")], branches=[_branch(id="branch-2")])
        monkeypatch.setattr(public_routes, "db", db)
        monkeypatch.setattr(table_routes, "db", db)
        monkeypatch.setattr(public_routes, "_get_restaurant", lambda: asyncio.sleep(0, result={"id": "tenant-1", "require_table_qr": False}))
        monkeypatch.setattr(public_routes.public_order_limiter, "allow", lambda *_: True)
        monkeypatch.setattr(public_routes, "client_host", lambda *_: "127.0.0.1")
        monkeypatch.setattr(public_routes, "_public_order_fingerprint", lambda *_: "fingerprint")
        reached_enrich = asyncio.Event()
        finish_enrich = asyncio.Event()
        async def enrich(*_):
            reached_enrich.set()
            await finish_enrich.wait()
            return [], 0.0
        monkeypatch.setattr(public_routes, "_enrich_items", enrich)
        monkeypatch.setattr(public_routes, "_next_order_number", lambda *_: asyncio.sleep(0, result=1))
        monkeypatch.setattr(public_routes, "_gen_tracking", lambda: "ABC124")
        create_task = asyncio.create_task(public_routes.public_create_order(_public_data(), _public_request()))
        await reached_enrich.wait()
        await table_routes.update_table("table-1", TableUpdate(branch_id="branch-2"),
                                        {"id": "admin", "role": "admin", "restaurant_id": "tenant-1"})
        finish_enrich.set()
        with pytest.raises(HTTPException) as error:
            await create_task
        assert error.value.status_code == 409
        assert not db.orders.rows
        assert db.tables.rows[0]["branch_id"] == "branch-2"
        assert "opening_order_id" not in db.tables.rows[0]
    asyncio.run(run())

def test_legacy_unassigned_open_order_recovers_without_branch_assignment():
    from attention import open_table_attention
    async def run():
        order = {"id": "legacy-order", "restaurant_id": "tenant-1", "table_id": "table-1",
                 "attention_id": "legacy-attention", "attention_state": "opening", "updated_at": "t0"}
        db = _DB([_table()], orders=[order])
        result = await open_table_attention(db, order=order, user={"id": "waiter"}, now="t1")
        assert result["status"] == "open"
        assert "branch_id" not in db.orders.rows[0]
        assert "branch_id" not in db.attentions.rows[0]
        assert "branch_id" not in db.tables.rows[0]
    asyncio.run(run())


@pytest.mark.parametrize("commit_before_error", [False, True])
def test_staff_insert_uncertainty_releases_only_confirmed_absence_and_preserves_recovery(monkeypatch, commit_before_error):
    async def run():
        db = _DB([_table(branch_id="branch-1")])
        monkeypatch.setattr(order_routes, "db", db)
        monkeypatch.setattr(order_routes, "_next_order_number", lambda *_: asyncio.sleep(0, result=1))
        original = db.orders.insert_one
        async def uncertain_insert(row):
            if commit_before_error:
                await original(row)
            raise RuntimeError("injected ambiguous insert outcome")
        db.orders.insert_one = uncertain_insert
        user = {"id": "waiter", "full_name": "Waiter", "role": "mozo", "restaurant_id": "tenant-1"}
        with pytest.raises(RuntimeError, match="ambiguous"):
            await order_routes.create_order(OrderCreate(table_id="table-1", order_type="mesa", items=[]), user)
        assert db.tables.rows[0]["opening_order_id"]
        db.orders.insert_one = original
        opened = await order_routes.resume_attention_open(db.tables.rows[0]["opening_order_id"], user)
        assert opened["status"] == "open"
        assert len(db.orders.rows) == 1
        assert db.attentions.rows[0]["branch_id"] == "branch-1"
    asyncio.run(run())
@pytest.mark.parametrize("commit_before_error", [False, True])
def test_public_insert_uncertainty_cleans_only_confirmed_absence_and_replays_original(monkeypatch, commit_before_error):
    async def run():
        db = _DB([_table(branch_id="branch-1")])
        monkeypatch.setattr(public_routes, "db", db)
        monkeypatch.setattr(public_routes, "_get_restaurant", lambda: asyncio.sleep(0, result={"id": "tenant-1", "require_table_qr": False}))
        monkeypatch.setattr(public_routes.public_order_limiter, "allow", lambda *_: True)
        monkeypatch.setattr(public_routes, "client_host", lambda *_: "127.0.0.1")
        monkeypatch.setattr(public_routes, "_public_order_fingerprint", lambda *_: "fingerprint")
        monkeypatch.setattr(public_routes, "_enrich_items", lambda *_: asyncio.sleep(0, result=([], 0.0)))
        monkeypatch.setattr(public_routes, "_next_order_number", lambda *_: asyncio.sleep(0, result=1))
        monkeypatch.setattr(public_routes, "_gen_tracking", lambda: "ABC125")
        monkeypatch.setattr(public_routes, "emit_notice", lambda *args, **kwargs: None)
        monkeypatch.setattr(public_routes, "emit_order", lambda *args, **kwargs: None)
        original = db.orders.insert_one
        async def uncertain_insert(row):
            if commit_before_error:
                await original(row)
            raise RuntimeError("injected ambiguous insert outcome")
        db.orders.insert_one = uncertain_insert
        with pytest.raises(RuntimeError, match="ambiguous"):
            await public_routes.public_create_order(_public_data(), _public_request())
        db.orders.insert_one = original
        assert db.tables.rows[0]["opening_order_id"]
        replay = await public_routes.public_create_order(_public_data(), _public_request())
        assert replay["tracking_code"] == "ABC125"
        assert len(db.orders.rows) == 1
        assert db.attentions.rows[0]["branch_id"] == "branch-1"
    asyncio.run(run())
@pytest.mark.parametrize("action", ["seat", "release", "delete"])
def test_table_mutations_cannot_overwrite_or_delete_opening_reservation(monkeypatch, action):
    async def run():
        db = _DB([_table(opening_order_id="owner-order", opening_branch_id=None)])
        monkeypatch.setattr(table_routes, "db", db)
        monkeypatch.setattr(table_routes, "emit_notice", lambda *args, **kwargs: None)
        user = {"id": "waiter", "role": "mozo", "restaurant_id": "tenant-1"}
        with pytest.raises(HTTPException):
            if action == "seat":
                await table_routes.seat_table("table-1", user)
            elif action == "release":
                await table_routes.release_table("table-1", user)
            else:
                await table_routes.delete_table("table-1", {**user, "role": "admin"})
        assert len(db.tables.rows) == 1
        assert db.tables.rows[0]["opening_order_id"] == "owner-order"
    asyncio.run(run())

def test_staff_reservation_persists_private_intent_before_order_insert(monkeypatch):
    async def run():
        db = _DB([_table(branch_id="branch-1")])
        monkeypatch.setattr(order_routes, "db", db)
        monkeypatch.setattr(order_routes, "_next_order_number", lambda *_: asyncio.sleep(0, result=17))
        monkeypatch.setattr(order_routes, "_compute_total", lambda items, *_: asyncio.sleep(0, result=(items, 12.5)))
        user = {"id": "waiter", "full_name": "Waiter", "role": "mozo", "restaurant_id": "tenant-1"}
        async def stop_before_insert(_):
            raise SystemExit("simulated process stop before insert")
        original = db.orders.insert_one
        db.orders.insert_one = stop_before_insert
        with pytest.raises(SystemExit):
            await order_routes.create_order(OrderCreate(table_id="table-1", order_type="mesa", items=[]), user)
        reserved = db.tables.rows[0]
        intent = reserved.get("opening_intent")
        assert intent, "the atomic table claim must retain the exact order needed for restart recovery"
        assert intent["id"] == reserved["opening_order_id"]
        assert intent["_id"] == intent["id"], "same-intent retries must use Mongo's built-in unique _id"
        assert intent["restaurant_id"] == "tenant-1"
        assert intent["table_id"] == "table-1"
        assert intent["branch_id"] == "branch-1"
        assert intent["order_number"] == 17
        assert intent["total"] == 0.0
        db.orders.insert_one = original
        resumed = await asyncio.gather(
            order_routes.resume_attention_open(intent["id"], user),
            order_routes.resume_attention_open(intent["id"], user),
        )
        assert all(item["status"] == "open" for item in resumed)
        assert len(db.orders.rows) == 1
        assert db.attentions.rows[0]["order_id"] == intent["id"]
    asyncio.run(run())


def test_attention_claim_fallback_rejects_active_marker_with_wrong_branch_or_status():
    from attention import open_table_attention
    async def run():
        order = {"id": "order-1", "restaurant_id": "tenant-1", "table_id": "table-1",
                 "branch_id": "branch-1", "attention_id": "attention-1",
                 "attention_state": "opening", "updated_at": "t0", "status": "nuevo"}
        for updates in ({"branch_id": "branch-2"}, {"status": "pagada"}):
            row = _table(branch_id="branch-1", active_attention_id="attention-1")
            row.update(updates)
            db = _DB([row], orders=[order])
            with pytest.raises(AttentionBlocked):
                await open_table_attention(db, order=order, user={"id": "waiter"}, now="t1")
    asyncio.run(run())


def test_legacy_opening_marker_without_intent_stays_fail_closed(monkeypatch):
    async def run():
        db = _DB([_table(opening_order_id="legacy-order", opening_branch_id="branch-1")])
        monkeypatch.setattr(order_routes, "db", db)
        with pytest.raises(HTTPException) as error:
            await order_routes.resume_attention_open(
                "legacy-order", {"id": "waiter", "role": "mozo", "restaurant_id": "tenant-1"}
            )
        assert error.value.status_code == 409
        assert not db.orders.rows
        assert db.tables.rows[0]["opening_order_id"] == "legacy-order"
        assert "opening_intent" not in db.tables.rows[0]
    asyncio.run(run())


@pytest.mark.parametrize("already_inserted", [False, True])
def test_opening_intent_recovery_keeps_mongo_id_for_identity_readback(already_inserted):
    from attention import recover_opening_intent
    async def run():
        intent = {
            "_id": "order-1", "id": "order-1", "order_number": 5,
            "restaurant_id": "tenant-1", "table_id": "table-1",
            "attention_id": "attention-1", "branch_id": "branch-1",
            "attention_state": "opening", "request_id": None, "request_fingerprint": None,
        }
        table = _table(branch_id="branch-1", opening_order_id="order-1",
                       opening_branch_id="branch-1", opening_intent=intent)
        db = _DB([table], orders=[intent] if already_inserted else [])
        recovered = await recover_opening_intent(
            db, table=table, order_id="order-1", restaurant_id="tenant-1"
        )
        assert recovered is not None
        assert recovered["_id"] == intent["_id"]
        assert len(db.orders.rows) == 1
    asyncio.run(run())


def test_staff_can_resume_preinsert_crash_using_only_owned_table_id(monkeypatch):
    async def run():
        db = _DB([_table(branch_id="branch-1")])
        monkeypatch.setattr(order_routes, "db", db)
        monkeypatch.setattr(table_routes, "db", db)
        numbers = []
        async def next_number(*_):
            numbers.append(1)
            return 19
        monkeypatch.setattr(order_routes, "_next_order_number", next_number)
        user = {"id": "waiter", "full_name": "Waiter", "role": "mozo", "restaurant_id": "tenant-1"}
        original_insert = db.orders.insert_one
        async def stop_before_insert(_):
            raise SystemExit("simulated process restart")
        db.orders.insert_one = stop_before_insert
        with pytest.raises(SystemExit):
            await order_routes.create_order(OrderCreate(table_id="table-1", order_type="mesa", items=[]), user)
        db.orders.insert_one = original_insert
        order_id = db.tables.rows[0]["opening_order_id"]
        resumed = await table_routes.resume_table_opening("table-1", user)
        assert resumed["id"] == order_id
        assert resumed["order_number"] == 19
        assert resumed["attention_state"] == "open"
        assert "_id" not in resumed
        assert "opening_intent" not in resumed
        assert "opening_order_id" not in resumed
        assert len(numbers) == 1
        assert len(db.orders.rows) == len(db.attentions.rows) == 1
        assert db.tables.rows[0]["active_attention_id"] == resumed["attention_id"]

        route = next(r for r in table_routes.router.routes if r.path == "/{table_id}/resume-opening")
        checker = route.dependant.dependencies[0].call
        allowed = await checker(user=user)
        assert allowed["role"] == "mozo"
        with pytest.raises(HTTPException) as denied:
            await checker(user={"role": "cocina", "restaurant_id": "tenant-1"})
        assert denied.value.status_code == 403
    asyncio.run(run())


@pytest.mark.parametrize("kind, expected", [("foreign", 404), ("missing", 404), ("legacy", 409), ("closed", 409)])
def test_staff_table_id_recovery_rejects_unowned_or_unrecoverable_markers_without_mutation(monkeypatch, kind, expected):
    async def run():
        intent = {
            "_id": "order-1", "id": "order-1", "order_number": 7,
            "restaurant_id": "tenant-1", "table_id": "table-1",
            "attention_id": "attention-1", "branch_id": "branch-1",
            "attention_state": "opening", "request_id": None, "request_fingerprint": None,
        }
        if kind == "foreign":
            row = _table(restaurant_id="tenant-2", branch_id="branch-1",
                         opening_order_id="order-1", opening_branch_id="branch-1", opening_intent=intent)
        elif kind == "missing":
            row = _table(branch_id="branch-1")
        elif kind == "legacy":
            row = _table(branch_id="branch-1", opening_order_id="order-1", opening_branch_id="branch-1")
        else:
            row = _table(branch_id="branch-1", status="pagada", opening_order_id="order-1",
                         opening_branch_id="branch-1", opening_intent=intent)
        db = _DB([row])
        monkeypatch.setattr(table_routes, "db", db)
        before = copy.deepcopy(db.tables.rows)
        with pytest.raises(HTTPException) as error:
            await table_routes.resume_table_opening("table-1", {"id": "waiter", "role": "mozo", "restaurant_id": "tenant-1"})
        assert error.value.status_code == expected
        assert db.tables.rows == before
        assert db.orders.rows == []
        assert db.attentions.rows == []
    asyncio.run(run())


def test_public_crash_recovers_only_exact_request_intent_and_keeps_it_private(monkeypatch):
    async def run():
        db = _DB([_table(branch_id="branch-1", qr_nonce="nonce-1")])
        monkeypatch.setattr(public_routes, "db", db)
        monkeypatch.setattr(table_routes, "db", db)
        monkeypatch.setattr(public_routes, "_get_restaurant", lambda: asyncio.sleep(0, result={"id": "tenant-1", "require_table_qr": False}))
        monkeypatch.setattr(public_routes.public_order_limiter, "allow", lambda *_: True)
        monkeypatch.setattr(public_routes, "client_host", lambda *_: "127.0.0.1")
        monkeypatch.setattr(public_routes, "_public_order_fingerprint", lambda data, *_: "changed" if data.notes == "changed" else "fingerprint")
        monkeypatch.setattr(public_routes, "_enrich_items", lambda *_: asyncio.sleep(0, result=([], 0.0)))
        monkeypatch.setattr(public_routes, "_next_order_number", lambda *_: asyncio.sleep(0, result=4))
        monkeypatch.setattr(public_routes, "_gen_tracking", lambda: "PUB123")
        original = db.orders.insert_one
        async def stop_before_insert(_): raise SystemExit("simulated restart")
        db.orders.insert_one = stop_before_insert
        with pytest.raises(SystemExit):
            await public_routes.public_create_order(_public_data(), _public_request())
        db.orders.insert_one = original
        intent = db.tables.rows[0]["opening_intent"]
        assert intent["request_id"] == _public_data().request_id
        assert intent["request_fingerprint"] == "fingerprint"
        recovered = await asyncio.gather(
            public_routes.public_create_order(_public_data(), _public_request()),
            public_routes.public_create_order(_public_data(), _public_request()),
        )
        assert all(item["tracking_code"] == "PUB123" for item in recovered)
        assert len(db.orders.rows) == len(db.attentions.rows) == 1
        assert "opening_intent" not in recovered
        assert "opening_order_id" not in recovered
        changed = _public_data().model_copy(update={"notes": "changed"})
        with pytest.raises(HTTPException) as error:
            await public_routes.public_create_order(changed, _public_request())
        assert error.value.status_code == 409
        listed = await table_routes.list_tables({"role": "admin", "restaurant_id": "tenant-1"})
        assert "opening_intent" not in listed[0]
        assert "opening_order_id" not in listed[0]
        link = await table_routes.guest_link("table-1", {"role": "mozo", "restaurant_id": "tenant-1"})
        assert set(link) == {"token", "path", "table_number"}
        assert "opening_intent" not in link["token"]
    asyncio.run(run())
