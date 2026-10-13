"""Branch ownership regressions for cash and payment operations."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import CashClose, CashOpen, CashMovement, PaymentCreate, StaffPaymentProof
from test_money_integrity import RID, _Collection, _DB, _cashier, _match, _open_register, _order
import routes.cash as cash_routes
import routes.payments as payment_routes
import routes.notifications as notification_routes


def _staff(branch_id="branch-1"):
    return {"id": "cashier-staff", "restaurant_id": RID, "role": "cajero",
            "full_name": "Cashier", "branch_id": branch_id}


def _branch(db, branch_id, tenant=RID):
    db.branches.docs.append({"id": branch_id, "restaurant_id": tenant})


def test_new_owner_register_requires_index_readiness_before_write(monkeypatch):
    async def run():
        db = _DB()
        _branch(db, "branch-1")
        _branch(db, "branch-2")
        cash_routes.db = db
        request = CashOpen.model_construct(opening_amount=25, notes=None, branch_id="branch-2")
        with pytest.raises(HTTPException) as caught:
            await cash_routes.open_register(request, _cashier())
        assert caught.value.status_code == 503
        assert db.cash_registers.docs == []
    asyncio.run(run())


def test_legacy_tenant_unique_index_blocks_new_branch_register_writes():
    class IndexCursor:
        async def to_list(self, length):
            return [{"key": {"restaurant_id": 1}, "unique": True,
                     "partialFilterExpression": {"status": "open"}}]

    async def run():
        db = _DB()
        _branch(db, "branch-1")
        db.cash_registers.list_indexes = lambda: IndexCursor()
        cash_routes.db = db
        with pytest.raises(HTTPException) as caught:
            await cash_routes.open_register(
                CashOpen.model_construct(opening_amount=25, notes=None, branch_id="branch-1"), _cashier()
            )
        assert caught.value.status_code == 503
        assert db.cash_registers.docs == []
    asyncio.run(run())


def test_verified_branch_indexes_allow_separate_branch_registers(monkeypatch):
    class IndexCursor:
        async def to_list(self, length):
            return [
                {"key": {"restaurant_id": 1, "branch_id": 1}, "unique": True,
                 "partialFilterExpression": {"status": "open", "branch_id": {"$type": "string"}}},
                {"key": {"restaurant_id": 1}, "unique": True,
                 "partialFilterExpression": {"status": "open", "branch_id": None}},
            ]

    async def run():
        db = _DB()
        _branch(db, "branch-1")
        _branch(db, "branch-2")
        db.cash_registers.list_indexes = lambda: IndexCursor()
        cash_routes.db = db
        first = await cash_routes.open_register(
            CashOpen.model_construct(opening_amount=10, notes=None, branch_id="branch-1"), _cashier()
        )
        second = await cash_routes.open_register(
            CashOpen.model_construct(opening_amount=20, notes=None, branch_id="branch-2"), _cashier()
        )
        assert first["branch_id"] == "branch-1"
        assert second["branch_id"] == "branch-2"
        assert len(db.cash_registers.docs) == 2
        with pytest.raises(HTTPException) as caught:
            await cash_routes.open_register(
                CashOpen.model_construct(opening_amount=30, notes=None, branch_id="branch-2"), _cashier()
            )
        assert caught.value.status_code == 400
        assert len(db.cash_registers.docs) == 2
    asyncio.run(run())


def test_cash_indexes_use_supported_null_filter_for_legacy_branchless_registers(monkeypatch):
    import database as database_module

    supported_legacy_filter = {"status": "open", "branch_id": None}
    unsupported_legacy_filter = {"status": "open", "branch_id": {"$exists": False}}

    class IndexCollection:
        def __init__(self):
            self.created = []

        async def create_index(self, keys, **options):
            self.created.append((keys, options))

        def list_indexes(self):
            class Cursor:
                async def to_list(self, length):
                    return []
            return Cursor()

    class Database:
        def __init__(self):
            self.cash_registers = IndexCollection()

        def __getattr__(self, name):
            return IndexCollection()

    async def run():
        fake_db = Database()
        monkeypatch.setattr(database_module, "db", fake_db)
        await database_module.ensure_indexes()

        legacy_index = next(
            options for keys, options in fake_db.cash_registers.created
            if options.get("name") == "uniq_open_legacy_cash_register"
        )
        assert legacy_index["partialFilterExpression"] == supported_legacy_filter

        def indexes_for(filter_expression):
            class Cursor:
                async def to_list(self, length):
                    return [
                        {"key": {"restaurant_id": 1, "branch_id": 1}, "unique": True,
                         "partialFilterExpression": {"status": "open", "branch_id": {"$type": "string"}}},
                        {"key": {"restaurant_id": 1}, "unique": True,
                         "partialFilterExpression": filter_expression},
                    ]
            return Cursor()

        cash_routes.db = fake_db
        fake_db.cash_registers.list_indexes = lambda: indexes_for(supported_legacy_filter)
        assert await cash_routes._cash_register_index_state() == "branch_ready"
        fake_db.cash_registers.list_indexes = lambda: indexes_for(unsupported_legacy_filter)
        assert await cash_routes._cash_register_index_state() == "unready"

    asyncio.run(run())


@pytest.mark.parametrize("legacy_branch", ["missing", None])
def test_legacy_open_register_blocks_new_branch_when_branch_register_is_also_open(legacy_branch):
    class IndexCursor:
        async def to_list(self, length):
            return [
                {"key": {"restaurant_id": 1, "branch_id": 1}, "unique": True,
                 "partialFilterExpression": {"status": "open", "branch_id": {"$type": "string"}}},
                {"key": {"restaurant_id": 1}, "unique": True,
                 "partialFilterExpression": {"status": "open", "branch_id": None}},
            ]

    async def run():
        db = _DB()
        _branch(db, "branch-1")
        _branch(db, "branch-2")
        db.cash_registers.list_indexes = lambda: IndexCursor()
        db.cash_registers.docs.append({**_open_register("reg-a"), "branch_id": "branch-1"})
        legacy = {**_open_register("reg-legacy")}
        if legacy_branch is None:
            legacy["branch_id"] = None
        else:
            legacy.pop("branch_id")
        db.cash_registers.docs.append(legacy)
        before = [row.copy() for row in db.cash_registers.docs]
        cash_routes.db = db

        with pytest.raises(HTTPException) as caught:
            await cash_routes.open_register(
                CashOpen.model_construct(opening_amount=30, notes=None, branch_id="branch-2"), _cashier()
            )

        assert caught.value.status_code == 409
        assert db.cash_registers.docs == before

    asyncio.run(run())


def test_same_branch_concurrent_register_open_has_one_index_guarded_winner():
    from pymongo.errors import DuplicateKeyError

    class IndexCursor:
        async def to_list(self, length):
            return [
                {"key": {"restaurant_id": 1, "branch_id": 1}, "unique": True,
                 "partialFilterExpression": {"status": "open", "branch_id": {"$type": "string"}}},
                {"key": {"restaurant_id": 1}, "unique": True,
                 "partialFilterExpression": {"status": "open", "branch_id": None}},
            ]

    async def run():
        db = _DB()
        _branch(db, "branch-1")
        db.cash_registers.list_indexes = lambda: IndexCursor()
        lock = asyncio.Lock()
        original_insert = db.cash_registers.insert_one
        async def unique_insert(document):
            async with lock:
                if any(row.get("restaurant_id") == RID and row.get("branch_id") == "branch-1"
                       and row.get("status") == "open" for row in db.cash_registers.docs):
                    raise DuplicateKeyError("modeled branch unique index")
                return await original_insert(document)
        db.cash_registers.insert_one = unique_insert
        cash_routes.db = db
        results = await asyncio.gather(*[
            cash_routes.open_register(
                CashOpen.model_construct(opening_amount=10, notes=None, branch_id="branch-1"), _cashier()
            ) for _ in range(2)
        ], return_exceptions=True)
        assert sum(isinstance(result, dict) for result in results) == 1
        conflicts = [result for result in results if isinstance(result, HTTPException)]
        assert len(conflicts) == 1, [repr(result) for result in results]
        assert conflicts[0].status_code == 409
        assert len(db.cash_registers.docs) == 1
    asyncio.run(run())


def test_staff_current_register_is_limited_to_assigned_branch(monkeypatch):
    async def run():
        db = _DB()
        _branch(db, "branch-2")
        db.cash_registers.docs.extend([
            {**_open_register("reg-b"), "branch_id": "branch-2"},
            {**_open_register("reg-a"), "branch_id": "branch-1"},
        ])
        cash_routes.db = db
        result = await cash_routes.current_register(_staff(), None)
        assert result["id"] == "reg-a"
    asyncio.run(run())


def test_staff_payment_rejects_order_from_another_branch_before_write(monkeypatch):
    async def run():
        db = _DB()
        _branch(db, "branch-1")
        db.orders.docs.append(_order(branch_id="branch-2"))
        db.cash_registers.docs.append({**_open_register(), "branch_id": "branch-1"})
        payment_routes.db = db
        with pytest.raises(HTTPException) as caught:
            await payment_routes.create_payment(PaymentCreate(order_id="order-1", method="efectivo", amount=20), _staff())
        assert caught.value.status_code == 404
        assert db.orders.docs[0]["amount_paid"] == 0.0
        assert db.payments.docs == []
    asyncio.run(run())


def test_staff_payment_uses_register_bound_to_order_branch(monkeypatch):
    async def run():
        db = _DB()
        _branch(db, "branch-1")
        _branch(db, "branch-2")
        db.orders.docs.append(_order(branch_id="branch-1"))
        db.cash_registers.docs.extend([
            {**_open_register("reg-b"), "branch_id": "branch-2"},
            {**_open_register("reg-a"), "branch_id": "branch-1"},
        ])
        payment_routes.db = db
        result = await payment_routes.create_payment(PaymentCreate(order_id="order-1", method="efectivo", amount=20), _staff())
        assert result["cash_register_id"] == "reg-a"
        assert result["branch_id"] == "branch-1"
    asyncio.run(run())


def test_cash_notification_stream_hides_other_branch_events(monkeypatch):
    async def run():
        queue = asyncio.Queue()
        await queue.put({"type": "cash", "restaurant_id": RID, "register_id": "reg-b", "branch_id": "branch-2"})
        await queue.put({"type": "cash", "restaurant_id": RID, "register_id": "reg-a", "branch_id": "branch-1"})
        db = _DB()
        _branch(db, "branch-1")
        db.users = _Collection()
        db.users.docs.append({**_staff(), "status": "active"})
        notification_routes.db = db
        monkeypatch.setattr(notification_routes, "subscribe", lambda: queue)
        monkeypatch.setattr(notification_routes, "unsubscribe", lambda current: None)
        response = await notification_routes.notification_stream(_staff())
        iterator = response.body_iterator
        await iterator.__anext__()
        event = await iterator.__anext__()
        assert '"register_id": "reg-a"' in event
        await iterator.aclose()
    asyncio.run(run())


def test_staff_cannot_list_or_attach_proof_to_foreign_branch_order():
    async def run():
        db = _DB()
        _branch(db, "branch-1")
        db.orders.docs.append(_order(branch_id="branch-2"))
        payment_routes.db = db
        with pytest.raises(HTTPException) as listed:
            await payment_routes.payments_for_order("order-1", _staff())
        assert listed.value.status_code == 404
        with pytest.raises(HTTPException) as proof:
            await payment_routes.upload_staff_proof(
                "order-1", StaffPaymentProof(
                    payment_proof="data:image/png;base64,iVBORw0KGgo=", method="yape"
                ), _staff()
            )
        assert proof.value.status_code == 404
        assert db.orders.docs[0].get("payment_status") != "comprobante_subido"
        assert db.payments.docs == []
    asyncio.run(run())


def test_payment_by_order_hides_foreign_and_branchless_rows_from_staff_but_keeps_admin_legacy_view():
    async def run():
        db = _DB()
        _branch(db, "branch-1")
        _branch(db, "branch-2")
        db.orders.docs.append(_order(branch_id="branch-1"))
        db.payments.docs.extend([
            {"id": "payment-a", "restaurant_id": RID, "order_id": "order-1", "branch_id": "branch-1"},
            {"id": "payment-b", "restaurant_id": RID, "order_id": "order-1", "branch_id": "branch-2"},
            {"id": "payment-legacy-missing", "restaurant_id": RID, "order_id": "order-1"},
            {"id": "payment-legacy-null", "restaurant_id": RID, "order_id": "order-1", "branch_id": None},
            {"id": "payment-other-tenant", "restaurant_id": "tenant-foreign", "order_id": "order-1", "branch_id": "branch-1"},
        ])
        original_payments = [row.copy() for row in db.payments.docs]
        payment_routes.db = db

        staff_rows = await payment_routes.payments_for_order("order-1", _staff())
        owner_rows = await payment_routes.payments_for_order("order-1", _cashier())

        assert [row["id"] for row in staff_rows] == ["payment-a"]
        assert {row["id"] for row in owner_rows} == {
            "payment-a", "payment-b", "payment-legacy-missing", "payment-legacy-null"
        }
        assert db.payments.docs == original_payments

    asyncio.run(run())


def test_payment_retry_keeps_original_branch_and_register_after_other_branch_opens():
    async def run():
        db = _DB()
        _branch(db, "branch-1")
        _branch(db, "branch-2")
        db.orders.docs.append(_order(branch_id="branch-1"))
        db.cash_registers.docs.extend([
            {**_open_register("reg-a"), "branch_id": "branch-1"},
            {**_open_register("reg-b"), "branch_id": "branch-2"},
        ])
        original = {"id": "payment-original", "restaurant_id": RID, "order_id": "order-1",
                    "idempotency_key": "retry-key", "branch_id": "branch-1", "cash_register_id": "reg-a"}
        db.payments.docs.append(original)
        payment_routes.db = db
        replay = await payment_routes.create_payment(
            PaymentCreate(order_id="order-1", method="efectivo", amount=20,
                          idempotency_key="retry-key"), _staff()
        )
        return replay
    replay = asyncio.run(run())
    assert replay["id"] == "payment-original"
    assert replay["branch_id"] == "branch-1"
    assert replay["cash_register_id"] == "reg-a"


def test_owner_can_view_consolidated_registers_or_select_one_branch():
    async def run():
        db = _DB()
        _branch(db, "branch-1")
        _branch(db, "branch-2")
        db.cash_registers.docs.extend([
            {**_open_register("reg-a"), "branch_id": "branch-1"},
            {**_open_register("reg-b"), "branch_id": "branch-2"},
        ])
        cash_routes.db = db
        all_registers = await cash_routes.list_registers(_cashier(), 60, None)
        branch_registers = await cash_routes.list_registers(_cashier(), 60, "branch-2")
        return all_registers, branch_registers
    all_registers, branch_registers = asyncio.run(run())
    assert {row["id"] for row in all_registers} == {"reg-a", "reg-b"}
    assert [row["id"] for row in branch_registers] == ["reg-b"]


def test_owner_movement_rejects_foreign_branch_before_write():
    async def run():
        db = _DB()
        _branch(db, "branch-1")
        cash_routes.db = db
        data = CashMovement.model_construct(type="ingreso", amount=5, description="Correction", branch_id="branch-foreign")
        with pytest.raises(HTTPException) as caught:
            await cash_routes.add_movement(data, _cashier())
        assert caught.value.status_code == 404
        assert db.cash_movements.docs == []
    asyncio.run(run())


def test_branch_two_unresolved_order_does_not_block_branch_one_close():
    async def run():
        db = _DB()
        _branch(db, "branch-1")
        _branch(db, "branch-2")
        db.cash_registers.docs.append({**_open_register("reg-a"), "branch_id": "branch-1"})
        db.orders.docs.append(_order(id="branch-b-order", branch_id="branch-2", status="en_preparacion"))
        cash_routes.db = db
        closed = await cash_routes.close_register(
            CashClose.model_construct(closing_amount=100, notes=None, branch_id="branch-1"), _cashier()
        )
        return db, closed
    db, closed = asyncio.run(run())
    assert closed["status"] == "closed"
    assert db.orders.docs[0]["status"] == "en_preparacion"


def test_owner_can_close_branchless_legacy_register_without_assigning_branch():
    async def run():
        db = _DB()
        db.cash_registers.docs.append({"id": "legacy-register", "restaurant_id": RID,
                                       "status": "open", "opening_amount": 5})
        cash_routes.db = db
        closed = await cash_routes.close_register(
            CashClose.model_construct(closing_amount=5, notes=None, branch_id=None), _cashier()
        )
        return db, closed
    db, closed = asyncio.run(run())
    assert closed["status"] == "closed"
    assert "branch_id" not in db.cash_registers.docs[0]


def test_payment_race_fallback_rejects_competing_payment_with_other_branch(monkeypatch):
    async def run():
        from types import SimpleNamespace

        db = _DB()
        _branch(db, "branch-1")
        db.orders.docs.append(_order(branch_id="branch-1"))
        db.cash_registers.docs.append({**_open_register("reg-a"), "branch_id": "branch-1"})
        competitor = {"id": "payment-other", "restaurant_id": RID, "order_id": "order-1",
                      "idempotency_key": "race-key", "branch_id": "branch-2", "cash_register_id": "reg-b"}
        calls = 0
        async def competing_lookup(query, projection=None):
            nonlocal calls
            calls += 1
            return None if calls == 1 else competitor
        async def lose_order_claim(query, update):
            return SimpleNamespace(modified_count=0, matched_count=0)
        db.payments.find_one = competing_lookup
        db.orders.update_one = lose_order_claim
        payment_routes.db = db
        with pytest.raises(HTTPException) as caught:
            await payment_routes.create_payment(
                PaymentCreate(order_id="order-1", method="efectivo", amount=20,
                              idempotency_key="race-key"), _staff()
            )
        assert caught.value.status_code == 409
        assert db.payments.docs == []
    asyncio.run(run())


def test_staff_cannot_reconcile_branchless_payment_by_inference():
    async def run():
        db = _DB()
        _branch(db, "branch-1")
        db.orders.docs.append(_order(branch_id="branch-1", amount_paid=20, total=20))
        db.cash_registers.docs.append({**_open_register("reg-a"), "branch_id": "branch-1"})
        db.payments.docs.append({"id": "legacy-payment", "restaurant_id": RID, "order_id": "order-1",
                                 "cash_register_id": "reg-a", "status": "completed", "amount": 20,
                                 "method": "efectivo"})
        payment_routes.db = db
        with pytest.raises(HTTPException) as caught:
            await payment_routes.apply_void_payment("legacy-payment", _staff(), "duplicate charge", "void")
        assert caught.value.status_code == 404
        assert db.payments.docs[0]["status"] == "completed"
        assert db.orders.docs[0]["amount_paid"] == 20
        assert db.cash_movements.docs == []
    asyncio.run(run())


def test_new_database_installs_branch_and_legacy_uniqueness_without_tenant_unique(monkeypatch):
    import database

    class Cursor:
        async def to_list(self, length=None):
            return []

    class IndexCollection:
        def __init__(self):
            self.created = []
            self.dropped = []

        def list_indexes(self):
            return Cursor()

        async def create_index(self, keys, **options):
            self.created.append((keys, options))

        async def drop_index(self, name):
            self.dropped.append(name)

    class FakeDatabase:
        def __init__(self):
            for name in ("users", "tables", "orders", "payment_configs", "products", "payments",
                         "cash_registers", "attentions", "audit_logs", "zones", "branches",
                         "table_groups", "approvals", "categories", "restaurants"):
                setattr(self, name, IndexCollection())

    fake = FakeDatabase()
    monkeypatch.setattr(database, "db", fake)
    asyncio.run(database.ensure_indexes())
    assert fake.cash_registers.dropped == []
    assert any(options.get("name") == "uniq_open_cash_register_by_branch" for _, options in fake.cash_registers.created)
    assert any(options.get("name") == "uniq_open_legacy_cash_register" for _, options in fake.cash_registers.created)
    assert not any(options.get("name") == "uniq_open_cash_register" for _, options in fake.cash_registers.created)


def test_existing_tenant_unique_cash_index_is_preserved_without_startup_replacement(monkeypatch):
    import database

    class Cursor:
        async def to_list(self, length=None):
            return [{"name": "uniq_open_cash_register", "key": {"restaurant_id": 1},
                     "unique": True, "partialFilterExpression": {"status": "open"}}]

    class IndexCollection:
        def __init__(self, existing=()):
            self.created = []
            self.dropped = []
            self.existing = existing

        def list_indexes(self):
            return Cursor() if self.existing else EmptyCursor()

        async def create_index(self, keys, **options):
            self.created.append((keys, options))

        async def drop_index(self, name):
            self.dropped.append(name)

    class EmptyCursor:
        async def to_list(self, length=None):
            return []

    class FakeDatabase:
        def __init__(self):
            for name in ("users", "tables", "orders", "payment_configs", "products", "payments",
                         "attentions", "audit_logs", "zones", "branches", "table_groups",
                         "approvals", "categories", "restaurants"):
                setattr(self, name, IndexCollection())
            self.cash_registers = IndexCollection(existing=(True,))

    fake = FakeDatabase()
    monkeypatch.setattr(database, "db", fake)
    asyncio.run(database.ensure_indexes())
    assert fake.cash_registers.dropped == []
    # Only the register's own id gets a unique index; no open-register rule is installed over the old one.
    assert not any(options.get("unique") for keys, options in fake.cash_registers.created if keys != "id")


def test_refund_reconciliation_rejects_movement_with_different_branch():
    async def run():
        db = _DB()
        db.cash_movements.docs.append({
            "_id": "refund-id", "cash_register_id": "register-a", "restaurant_id": RID,
            "branch_id": "branch-2", "type": "egreso", "amount": 10,
            "source_payment_id": "payment-1", "created_by": "cashier-1",
            "created_by_name": "Cashier", "description": "Refund",
        })
        payment_routes.db = db
        intent = {"movement": {
            "_id": "refund-id", "cash_register_id": "register-a", "restaurant_id": RID,
            "branch_id": "branch-1", "type": "egreso", "amount": 10,
            "source_payment_id": "payment-1", "created_by": "cashier-1",
            "created_by_name": "Cashier", "description": "Refund",
        }}
        with pytest.raises(HTTPException) as caught:
            await payment_routes._ensure_refund_movement(intent)
        assert caught.value.status_code == 409
    asyncio.run(run())


def test_legacy_registerless_payment_is_not_counted_in_another_branch_shift():
    from billing import shift_payment_filter

    shift_a = {"id": "reg-a", "restaurant_id": RID, "branch_id": "branch-1",
               "opened_at": "2026-10-01T00:00:00+00:00"}
    legacy_payment = {"restaurant_id": RID, "branch_id": "branch-2",
                      "created_at": "2026-10-01T10:00:00+00:00", "amount": 12}
    assert not _match(legacy_payment, shift_payment_filter(shift_a))
