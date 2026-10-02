"""Acceptance-context and route-boundary regressions for attention numbering."""
import asyncio
import copy
from datetime import datetime, timezone
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from attention_acceptance import capture_attention_context, number_accepted_order


class MemoryCollection:
    def __init__(self, rows=()):
        self.rows = copy.deepcopy(list(rows))
        self.inserts = []
        self.updates = []
        self.fail_next_insert = False

    async def find_one(self, query, projection=None):
        row = next((r for r in self.rows if _matches(r, query)), None)
        if row is None:
            return None
        result = copy.deepcopy(row)
        if projection:
            included = {key for key, value in projection.items() if value and key != "_id"}
            if included:
                result = {key: value for key, value in result.items() if key in included or key == "_id"}
            for key, value in projection.items():
                if value == 0:
                    result.pop(key, None)
        return result

    async def insert_one(self, row):
        if self.fail_next_insert:
            self.fail_next_insert = False
            raise RuntimeError("simulated assignment insert failure")
        if any(r.get("_id") == row.get("_id") for r in self.rows):
            from pymongo.errors import DuplicateKeyError
            raise DuplicateKeyError("duplicate _id")
        self.inserts.append(copy.deepcopy(row))
        self.rows.append(copy.deepcopy(row))

    async def find_one_and_update(self, query, update, **kwargs):
        row = next((r for r in self.rows if _matches(r, query)), None)
        if row is None:
            if not kwargs.get("upsert"):
                return None
            row = {k: v for k, v in query.items() if not isinstance(v, dict)}
            row.update(copy.deepcopy(update.get("$setOnInsert", {})))
            self.rows.append(row)
        for key, amount in update.get("$inc", {}).items():
            row[key] = row.get(key, 0) + amount
        return copy.deepcopy(row)

    async def update_one(self, query, update):
        self.updates.append((copy.deepcopy(query), copy.deepcopy(update)))
        row = next((r for r in self.rows if _matches(r, query)), None)
        if not row:
            return type("Result", (), {"matched_count": 0, "modified_count": 0})()
        before = copy.deepcopy(row)
        for key, value in update.get("$set", {}).items():
            row[key] = copy.deepcopy(value)
        for key in update.get("$unset", {}):
            row.pop(key, None)
        changed = int(row != before)
        return type("Result", (), {"matched_count": 1, "modified_count": changed})()


def _matches(row, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(row, option) for option in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$exists" in expected and ((key in row) != expected["$exists"]):
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class Database:
    def __init__(self, branches=(), orders=()):
        self.branches = MemoryCollection(branches)
        self.orders = MemoryCollection(orders)
        self.attention_number_assignments = MemoryCollection()
        self.counters = MemoryCollection()


def test_capture_requires_owned_branch_with_explicit_valid_configuration_before_acceptance():
    db = Database([
        {"id": "branch-a", "restaurant_id": "tenant-a", "timezone": "America/Lima", "business_day_cutoff": "04:00"},
        {"id": "branch-b", "restaurant_id": "tenant-b", "timezone": "America/Lima", "business_day_cutoff": "04:00"},
        {"id": "branch-no-config", "restaurant_id": "tenant-a"},
    ])
    at = datetime(2026, 10, 2, 8, tzinfo=timezone.utc)
    context = asyncio.run(capture_attention_context(db, tenant_id="tenant-a", branch_id="branch-a", confirmed_at=at))
    assert context == {
        "branch_id": "branch-a", "timezone_name": "America/Lima",
        "cutoff": "04:00:00", "confirmed_at": at.isoformat(),
    }
    for branch_id in (None, "branch-b", "branch-no-config"):
        with pytest.raises(ValueError):
            asyncio.run(capture_attention_context(db, tenant_id="tenant-a", branch_id=branch_id, confirmed_at=at))
    assert not db.attention_number_assignments.inserts
    assert not db.counters.rows


def test_numbering_uses_frozen_confirmation_context_and_persists_without_touching_order_number():
    order = {
        "id": "order-a", "restaurant_id": "tenant-a", "branch_id": "branch-a",
        "attention_id": "attention-a", "order_number": 53,
        "status": "enviado_cocina", "acceptance_status": "aceptado", "attention_number_pending": True,
        "attention_number_context": {
            "branch_id": "branch-a", "timezone_name": "America/Lima",
            "cutoff": "04:00:00", "confirmed_at": "2026-10-02T11:00:00+00:00",
        },
    }
    db = Database(orders=[order])
    db.branches.rows.clear()  # replay must use the persisted acceptance snapshot, not live settings
    result = asyncio.run(number_accepted_order(db, order=order))
    assert result["number"] == 1
    persisted = db.orders.rows[0]
    assert persisted["order_number"] == 53
    assert persisted["attention_number"] == 1
    assert persisted["attention_business_date"] == "2026-10-02"
    assert "attention_number_pending" not in persisted


def test_existing_assignment_is_recovered_after_order_number_propagation_failure():
    order = {
        "id": "order-a", "restaurant_id": "tenant-a", "branch_id": "branch-a",
        "attention_id": "attention-a", "order_number": 9,
        "status": "enviado_cocina", "acceptance_status": "aceptado", "attention_number_pending": True,
        "attention_number_context": {
            "branch_id": "branch-a", "timezone_name": "America/Lima",
            "cutoff": "04:00:00", "confirmed_at": "2026-10-02T11:00:00+00:00",
        },
    }
    db = Database(orders=[order])
    assignment = {"_id": "attention-a", "tenant_id": "tenant-a", "branch_id": "branch-a",
                  "number": 7, "business_date": "2026-10-02", "confirmed_order_id": "order-a",
                  "confirmed_at": "2026-10-02T11:00:00+00:00", "timezone_name": "America/Lima", "cutoff": "04:00:00"}
    db.attention_number_assignments.rows.append(assignment)
    result = asyncio.run(number_accepted_order(db, order=order))
    assert result["number"] == 7
    assert db.counters.rows == []
    assert db.orders.rows[0]["attention_number"] == 7


def test_provisional_or_legacy_order_does_not_consume_a_human_number():
    provisional = {"id": "draft", "restaurant_id": "tenant-a", "status": "nuevo"}
    legacy = {"id": "legacy", "restaurant_id": "tenant-a", "status": "enviado_cocina",
              "attention_id": "old-attention", "branch_id": None}
    db = Database(orders=[provisional, legacy])
    assert asyncio.run(number_accepted_order(db, order=provisional)) is None
    assert asyncio.run(number_accepted_order(db, order=legacy)) is None
    assert not db.attention_number_assignments.inserts
    assert not db.counters.rows




def test_staff_confirmation_freezes_branch_context_and_assigns_number_once(monkeypatch):
    import routes.orders as staff
    branch = {"id": "branch-a", "restaurant_id": "tenant-a", "timezone": "America/Lima", "business_day_cutoff": "04:00"}
    draft = {"id": "order-a", "_id": "order-a", "restaurant_id": "tenant-a", "created_by": "staff-a",
             "status": "nuevo", "order_type": "mesa", "table_id": "table-a", "branch_id": "branch-a",
             "attention_id": "attention-a", "attention_state": "open", "order_number": 41,
             "items": [{"id": "item-a", "status": "nuevo"}], "updated_at": "old"}
    db = Database(branches=[branch], orders=[draft])
    db.attention_number_assignments = MemoryCollection()
    db.counters = MemoryCollection()
    saves, events, audits = [], [], []

    async def save_order(order, fields):
        saves.append(copy.deepcopy(fields))
        await db.orders.update_one({"id": order["id"]}, {"$set": fields})

    async def current_response(order_id, _user):
        return await db.orders.find_one({"id": order_id})

    monkeypatch.setattr(staff, "db", db)
    monkeypatch.setattr(staff, "_save_order", save_order)
    monkeypatch.setattr(staff, "_current_order_response", current_response)
    monkeypatch.setattr(staff, "_audit", lambda *args, **kwargs: asyncio.sleep(0, result=audits.append(args)))
    monkeypatch.setattr(staff, "emit_order", lambda *args, **kwargs: events.append(args))
    user = {"id": "staff-a", "restaurant_id": "tenant-a", "branch_id": "branch-a", "role": "mozo"}

    accepted = asyncio.run(staff.send_to_kitchen("order-a", user=user))
    assert accepted["attention_number"] == 1
    assert accepted["attention_business_date"] == "2026-10-02"
    assert accepted["attention_number_context"]["branch_id"] == "branch-a"
    assert accepted["order_number"] == 41
    assert len(saves) == 1 and len(events) == 1 and len(audits) == 1


def test_concurrent_pending_staff_retries_do_not_repeat_acceptance_events_and_completed_retry_is_idempotent(monkeypatch):
    import routes.orders as staff
    from fastapi import HTTPException

    class RacingOrders(MemoryCollection):
        def __init__(self, rows):
            super().__init__(rows)
            self.readers = 0
            self.both_read = asyncio.Event()

        async def find_one(self, query, projection=None):
            result = await super().find_one(query, projection)
            if query.get("id") == "order-retry" and self.readers < 2:
                self.readers += 1
                if self.readers == 2:
                    self.both_read.set()
                await self.both_read.wait()
            return result

    pending = {
        "id": "order-retry", "restaurant_id": "tenant-a", "branch_id": "branch-a",
        "attention_id": "attention-retry", "order_number": 22, "status": "enviado_cocina",
        "acceptance_status": "aceptado", "attention_number_pending": True,
        "attention_state": "open", "updated_at": "accepted-at",
        "items": [{"id": "item-a", "status": "pendiente"}],
        "attention_number_context": {"branch_id": "branch-a", "timezone_name": "America/Lima",
                                     "cutoff": "04:00:00", "confirmed_at": "2026-10-02T11:00:00+00:00"},
    }
    db = Database(branches=[{"id": "branch-a", "restaurant_id": "tenant-a",
                             "timezone": "America/Lima", "business_day_cutoff": "04:00"}], orders=[pending])
    db.orders = RacingOrders([pending])
    events, audits = [], []
    monkeypatch.setattr(staff, "db", db)
    monkeypatch.setattr(staff, "emit_order", lambda *args, **kwargs: events.append(args))
    monkeypatch.setattr(staff, "_audit", lambda *args, **kwargs: asyncio.sleep(0, result=audits.append(args)))
    user = {"id": "staff-a", "restaurant_id": "tenant-a", "branch_id": "branch-a", "role": "mozo"}

    async def scenario():
        responses = await asyncio.gather(
            staff.send_to_kitchen("order-retry", user=user),
            staff.send_to_kitchen("order-retry", user=user),
            return_exceptions=True,
        )
        return responses

    responses = asyncio.run(scenario())
    assert all(not isinstance(response, Exception) for response in responses), responses
    assert [response["attention_number"] for response in responses] == [1, 1]
    assert events == [] and audits == []

    # A lost successful response can be retried without repeating the transition.
    replay = asyncio.run(staff.send_to_kitchen("order-retry", user=user))
    assert replay["id"] == "order-retry" and replay["attention_number"] == 1
    assert events == [] and audits == []


def test_assignment_reconciliation_rejects_same_number_with_different_origin_context():
    order = {
        "id": "order-a", "restaurant_id": "tenant-a", "branch_id": "branch-a",
        "attention_id": "attention-a", "status": "enviado_cocina", "acceptance_status": "aceptado",
        "attention_number_pending": True,
        "attention_number_context": {"branch_id": "branch-a", "timezone_name": "America/Lima",
                                     "cutoff": "04:00:00", "confirmed_at": "2026-10-02T11:00:00+00:00"},
    }
    db = Database(orders=[order])
    db.attention_number_assignments.rows.append({
        "_id": "attention-a", "tenant_id": "tenant-a", "branch_id": "branch-a", "number": 7,
        "business_date": "2026-10-01", "confirmed_order_id": "other-order",
        "confirmed_at": "2026-10-01T11:00:00+00:00", "timezone_name": "America/Lima", "cutoff": "04:00:00",
    })
    with pytest.raises(Exception):
        asyncio.run(number_accepted_order(db, order=order))
    assert "attention_number" not in db.orders.rows[0]


def test_staff_pickup_uses_fresh_user_branch_and_real_order_cas(monkeypatch):
    import routes.orders as staff

    branch = {"id": "branch-a", "restaurant_id": "tenant-a", "timezone": "America/Lima",
              "business_day_cutoff": "04:00"}
    draft = {"id": "pickup-order", "restaurant_id": "tenant-a", "order_type": "recojo",
             "status": "nuevo", "updated_at": "draft-v1", "items": [{"id": "item-a", "status": "nuevo"}],
             "order_number": 53, "attention_state": "open"}
    db = Database(branches=[branch], orders=[draft])
    db.audit_logs = MemoryCollection()
    events = []
    monkeypatch.setattr(staff, "db", db)
    monkeypatch.setattr(staff, "emit_order", lambda *args, **kwargs: events.append((args, kwargs)))
    user = {"id": "staff-a", "restaurant_id": "tenant-a", "branch_id": "branch-a", "role": "mozo"}

    result = asyncio.run(staff.send_to_kitchen("pickup-order", user=user))
    stored = asyncio.run(db.orders.find_one({"id": "pickup-order", "restaurant_id": "tenant-a"}, {"_id": 0}))
    assert stored["branch_id"] == "branch-a"
    assert stored["attention_id"] and result["attention_id"] == stored["attention_id"]
    assert stored["attention_number"] == result["attention_number"] == 1
    assert stored["order_number"] == 53
    assert len(db.audit_logs.rows) == 1 and len(events) == 1


def test_competing_initial_staff_confirmations_have_one_cas_and_one_operational_event(monkeypatch):
    import routes.orders as staff

    class RacingOrders(MemoryCollection):
        def __init__(self, rows):
            super().__init__(rows)
            self.readers = 0
            self.both_read = asyncio.Event()

        async def find_one(self, query, projection=None):
            result = await super().find_one(query, projection)
            if query.get("id") == "draft-order" and self.readers < 2:
                self.readers += 1
                if self.readers == 2:
                    self.both_read.set()
                await self.both_read.wait()
            return result

    branch = {"id": "branch-a", "restaurant_id": "tenant-a", "timezone": "America/Lima",
              "business_day_cutoff": "04:00"}
    draft = {"id": "draft-order", "restaurant_id": "tenant-a", "order_type": "mesa", "table_id": "table-a",
             "branch_id": "branch-a", "attention_id": "attention-a", "status": "nuevo", "updated_at": "v1",
             "attention_state": "open", "items": [{"id": "item-a", "status": "nuevo"}], "order_number": 61}
    db = Database(branches=[branch], orders=[draft])
    db.orders = RacingOrders([draft])
    db.audit_logs = MemoryCollection()
    events = []
    monkeypatch.setattr(staff, "db", db)
    monkeypatch.setattr(staff, "emit_order", lambda *args, **kwargs: events.append((args, kwargs)))
    user = {"id": "staff-a", "restaurant_id": "tenant-a", "branch_id": "branch-a", "role": "mozo"}

    async def scenario():
        return await asyncio.gather(
            staff.send_to_kitchen("draft-order", user=user),
            staff.send_to_kitchen("draft-order", user=user),
            return_exceptions=True,
        )

    outcomes = asyncio.run(scenario())
    successes = [item for item in outcomes if not isinstance(item, Exception)]
    failures = [item for item in outcomes if isinstance(item, Exception)]
    assert len(successes) == len(failures) == 1
    assert getattr(failures[0], "status_code", None) == 409
    assert len(db.attention_number_assignments.rows) == 1
    assert len(db.audit_logs.rows) == len(events) == 1


def test_ambiguous_order_propagation_does_not_accept_partial_or_wrong_date_readback():
    order = {
        "id": "order-a", "restaurant_id": "tenant-a", "branch_id": "branch-a",
        "attention_id": "attention-a", "status": "enviado_cocina", "acceptance_status": "aceptado",
        "attention_number_pending": True,
        "attention_number_context": {"branch_id": "branch-a", "timezone_name": "America/Lima",
                                     "cutoff": "04:00:00", "confirmed_at": "2026-10-02T11:00:00+00:00"},
    }
    db = Database(orders=[order])

    async def commit_partial_then_raise(query, update):
        persisted = db.orders.rows[0]
        persisted.update(copy.deepcopy(update["$set"]))
        persisted["attention_business_date"] = "2026-10-01"
        persisted.pop("attention_number_pending", None)
        # Simulate an ambiguous write whose number matches but whose full projection is wrong.
        raise RuntimeError("ambiguous propagation outcome")

    db.orders.update_one = commit_partial_then_raise
    with pytest.raises(RuntimeError, match="ambiguous propagation outcome"):
        asyncio.run(number_accepted_order(db, order=order))
    assert db.orders.rows[0]["attention_number"] == 1
    assert db.orders.rows[0]["attention_business_date"] == "2026-10-01"


def test_public_attention_serializers_expose_only_valid_safe_reference_fields():
    import routes.public as public_routes
    order = {
        "id": "public-order", "order_number": 81, "tracking_code": "TRACK81",
        "status": "enviado_cocina", "order_type": "recojo", "total": 12,
        "payment_method_choice": "efectivo", "acceptance_status": "aceptado",
        "attention_number": 4, "attention_business_date": "2026-10-02",
        "attention_number_assigned_at": "private-time", "attention_number_context": {"private": True},
        "attention_number_pending": False, "attention_id": "private-attention", "branch_id": "private-branch",
    }

    response = public_routes._public_order_response(order)
    view = public_routes._public_order_view(order)
    for serialized in (response, view):
        assert serialized["attention_number"] == 4
        assert serialized["attention_business_date"] == "2026-10-02"
        assert serialized["acceptance_status"] == "aceptado"
        for private in ("attention_number_assigned_at", "attention_number_context", "attention_number_pending",
                        "attention_id", "branch_id"):
            assert private not in serialized


@pytest.mark.parametrize("changes", [
    {"order_type": "delivery"}, {"order_type": "recojo", "attention_number": True},
    {"order_type": "recojo", "attention_number": 0}, {"order_type": "recojo", "attention_number": 3.5},
    {"order_type": "recojo", "attention_number": 9007199254740992}, {"order_type": "other"},
    {"order_type": "recojo", "attention_business_date": "2026-02-30"},
    {"order_type": "recojo", "acceptance_status": "pendiente"},
])
def test_public_serializers_omit_invalid_or_inapplicable_attention_reference(changes):
    import routes.public as public_routes
    order = {"id": "public-order", "order_number": 81, "tracking_code": "TRACK81", "status": "nuevo",
             "order_type": "recojo", "total": 12, "payment_method_choice": "efectivo",
             "acceptance_status": "aceptado", "attention_number": 4,
             "attention_business_date": "2026-10-02", **changes}
    for serialized in (public_routes._public_order_response(order), public_routes._public_order_view(order)):
        assert "attention_number" not in serialized
        assert "attention_business_date" not in serialized
        assert "acceptance_status" not in serialized


def test_public_retry_finishes_numbering_from_persisted_snapshot_without_leaking_context(monkeypatch):
    import routes.public as public_routes
    from models import PublicOrderCreate
    accepted = {
        "id": "public-order", "_id": "public-order", "restaurant_id": "tenant-a",
        "request_id": "12345678-1234-4234-8234-123456789abc", "request_fingerprint": "frozen",
        "order_number": 18, "tracking_code": "TRACK123", "status": "enviado_cocina",
        "order_type": "recojo", "payment_method_choice": "efectivo", "total": 12,
        "acceptance_status": "aceptado", "branch_id": "branch-a", "attention_id": "attention-a",
        "attention_number_pending": True,
        "attention_number_context": {"branch_id": "branch-a", "timezone_name": "America/Lima",
                                     "cutoff": "04:00:00", "confirmed_at": "2026-10-02T11:00:00+00:00"},
    }
    db = Database(orders=[accepted])
    db.audit_logs = MemoryCollection()
    monkeypatch.setattr(public_routes, "db", db)
    monkeypatch.setattr(public_routes, "emit_order", lambda *args, **kwargs: None)
    payload = PublicOrderCreate(order_type="recojo", request_id=accepted["request_id"], customer_name="Ana",
                                customer_phone="999", items=[{"product_id": "dish", "quantity": 1}],
                                payment_method="efectivo", branch_id="branch-a")
    response = asyncio.run(public_routes._finish_public_order(accepted, payload))
    stored = asyncio.run(db.orders.find_one({"id": "public-order"}))
    assert stored["attention_number"] == 1
    assert stored["order_number"] == 18
    assert response == {"id": "public-order", "order_number": 18, "tracking_code": "TRACK123",
                        "status": "enviado_cocina", "total": 12, "payment_method": "efectivo"}
    assert "attention_number_context" not in response
    assert "attention_id" not in response



def test_public_pickup_acceptance_snapshots_branch_and_creates_attention_identity(monkeypatch):
    import routes.public as public_routes
    from models import PublicOrderCreate
    from starlette.requests import Request
    branch = {"id": "branch-a", "restaurant_id": "tenant-a", "name": "Centro",
              "pickup_enabled": True, "timezone": "America/Lima", "business_day_cutoff": "04:00"}
    db = Database(branches=[branch])
    monkeypatch.setattr(public_routes, "db", db)
    monkeypatch.setattr(public_routes, "_get_restaurant", lambda: asyncio.sleep(0, result={"id": "tenant-a"}))
    monkeypatch.setattr(public_routes.public_order_limiter, "allow", lambda _host: True)
    monkeypatch.setattr(public_routes, "_enrich_items", lambda *_: asyncio.sleep(0, result=([{"product_id": "dish", "quantity": 1}], 12)))
    monkeypatch.setattr(public_routes, "_next_order_number", lambda *_: asyncio.sleep(0, result=18))
    monkeypatch.setattr(public_routes, "_gen_tracking", lambda: "TRACK123")

    async def finish(order, _data):
        await number_accepted_order(db, order=order)
        return public_routes._public_order_response(order)

    monkeypatch.setattr(public_routes, "_finish_public_order", finish)
    request = Request({"type": "http", "method": "POST", "path": "/api/public/orders",
                       "headers": [], "client": ("127.0.0.1", 1), "query_string": b""})
    payload = PublicOrderCreate(order_type="recojo", request_id="12345678-1234-4234-8234-123456789abc",
                                branch_id="branch-a", customer_name="Ana", customer_phone="999",
                                items=[{"product_id": "dish", "quantity": 1}], payment_method="efectivo")
    response = asyncio.run(public_routes.public_create_order(payload, request))
    stored = db.orders.rows[0]
    assert stored["attention_id"]
    assert stored["branch_id"] == "branch-a"
    assert stored["attention_number"] == 1
    assert stored["attention_number_context"]["timezone_name"] == "America/Lima"
    assert stored["attention_number_context"]["cutoff"] == "04:00:00"
    assert response == {"id": stored["id"], "order_number": 18, "tracking_code": "TRACK123",
                        "status": "enviado_cocina", "total": 12, "payment_method": "efectivo"}


def test_public_pickup_invalid_branch_time_configuration_writes_no_order_or_order_counter(monkeypatch):
    import routes.public as public_routes
    from models import PublicOrderCreate
    from starlette.requests import Request
    db = Database(branches=[{"id": "branch-a", "restaurant_id": "tenant-a", "pickup_enabled": True,
                             "timezone": "not-a-zone", "business_day_cutoff": "04:00"}])
    monkeypatch.setattr(public_routes, "db", db)
    monkeypatch.setattr(public_routes, "_get_restaurant", lambda: asyncio.sleep(0, result={"id": "tenant-a"}))
    monkeypatch.setattr(public_routes.public_order_limiter, "allow", lambda _host: True)
    monkeypatch.setattr(public_routes, "_enrich_items", lambda *_: asyncio.sleep(0, result=([{"product_id": "dish", "quantity": 1}], 12)))
    monkeypatch.setattr(public_routes, "_next_order_number", lambda *_: pytest.fail("order counter must not advance"))
    request = Request({"type": "http", "method": "POST", "path": "/api/public/orders",
                       "headers": [], "client": ("127.0.0.1", 1), "query_string": b""})
    payload = PublicOrderCreate(order_type="recojo", branch_id="branch-a", customer_name="Ana", customer_phone="999",
                                items=[{"product_id": "dish", "quantity": 1}], payment_method="efectivo")
    with pytest.raises(Exception):
        asyncio.run(public_routes.public_create_order(payload, request))
    assert not db.orders.inserts
    assert not db.counters.rows
