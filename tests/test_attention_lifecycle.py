"""Standalone-safe visit lifecycle tests backed by atomic in-memory collections."""
import asyncio
import copy
import os
import sys
from pathlib import Path

import pytest
from pymongo.errors import DuplicateKeyError
from models import PublicOrderCreate, OrderItemInput

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "restaurant_db_unit")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from attention import AttentionBlocked, close_table_attention, open_table_attention
from order_flow import VersionError, claim_order


def _matches(doc, filt):
    for key, expected in filt.items():
        if key == "$or":
            if not any(_matches(doc, clause) for clause in expected):
                return False
            continue
        if isinstance(expected, dict):
            if "$exists" in expected and ((key in doc) != expected["$exists"]):
                return False
            if "$nin" in expected and doc.get(key) in expected["$nin"]:
                return False
            if "$in" in expected and doc.get(key) not in expected["$in"]:
                return False
            if "$ne" in expected and doc.get(key) == expected["$ne"]:
                return False
            continue
        if doc.get(key) != expected:
            return False
    return True


class _Result:
    def __init__(self, changed):
        self.modified_count = changed
        self.matched_count = changed


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction=1):
        self.docs.sort(key=lambda doc: doc.get(key) or "", reverse=direction < 0)
        return self

    def limit(self, count):
        self.docs = self.docs[:count]
        return self

    async def to_list(self, limit):
        return copy.deepcopy(self.docs if limit is None else self.docs[:limit])


class _Collection:
    def __init__(self, db, name):
        self.db = db
        self.name = name
        self.docs = []
        self.lock = asyncio.Lock()

    async def find_one(self, filt, projection=None):
        async with self.lock:
            return next((copy.deepcopy(doc) for doc in self.docs if _matches(doc, filt)), None)

    def find(self, filt, projection=None):
        return _Cursor([doc for doc in self.docs if _matches(doc, filt)])

    async def insert_one(self, doc):
        async with self.lock:
            if self.name == "attentions" and self.db.fail_attention_insert:
                self.db.fail_attention_insert = False
                raise RuntimeError("injected attention insert failure")
            if self.name == "audit_logs" and self.db.fail_audit_insert:
                self.db.fail_audit_insert = False
                raise RuntimeError("injected audit insert failure")
            if doc.get("_id") is not None and any(row.get("_id") == doc.get("_id") for row in self.docs):
                raise DuplicateKeyError("duplicate _id")
            if doc.get("event_id") is not None and any(row.get("event_id") == doc.get("event_id") for row in self.docs):
                raise DuplicateKeyError("duplicate event_id")
            if any(row.get("id") == doc.get("id") for row in self.docs):
                raise DuplicateKeyError("duplicate id")
            self.docs.append(copy.deepcopy(doc))

    async def find_one_and_update(self, filt, update, *, upsert=False, return_document=None):
        async with self.lock:
            doc = next((row for row in self.docs if _matches(row, filt)), None)
            if doc is None:
                if not upsert:
                    return None
                doc = {key: value for key, value in filt.items() if not isinstance(value, dict)}
                doc.update(copy.deepcopy(update.get("$setOnInsert") or {}))
                self.docs.append(doc)
            for key, amount in (update.get("$inc") or {}).items():
                doc[key] = doc.get(key, 0) + amount
            return copy.deepcopy(doc)

    async def update_one(self, filt, update):
        async with self.lock:
            if self.name == "tables" and self.db.fail_table_release and "active_attention_id" in filt:
                self.db.fail_table_release = False
                raise RuntimeError("injected table projection failure")
            for doc in self.docs:
                if _matches(doc, filt):
                    doc.update(copy.deepcopy(update.get("$set") or {}))
                    for key in (update.get("$unset") or {}):
                        doc.pop(key, None)
                    return _Result(1)
        return _Result(0)


class _DB:
    def __init__(self):
        self.fail_attention_insert = False
        self.fail_table_release = False
        self.fail_audit_insert = False
        self.orders = _Collection(self, "orders")
        self.attentions = _Collection(self, "attentions")
        self.tables = _Collection(self, "tables")
        self.branches = _Collection(self, "branches")
        self.payment_configs = _Collection(self, "payment_configs")
        self.attention_number_assignments = _Collection(self, "attention_number_assignments")
        self.counters = _Collection(self, "counters")
        self.payments = _Collection(self, "payments")
        self.audit_logs = _Collection(self, "audit_logs")
        self.cash_movements = _Collection(self, "cash_movements")


def _order(**changes):
    order = {
        "id": "order-1",
        "restaurant_id": "restaurant-1",
        "table_id": "table-1",
        "attention_id": "attention-1",
        "attention_state": "open",
        "status": "pagado",
        "fulfillment_status": "entregado",
        "payment_status": "pagado",
        "amount_paid": 25.0,
        "total": 25.0,
        "updated_at": "2026-09-30T12:00:00+00:00",
        "items": [{"id": "item-1", "quantity": 1, "status": "entregado"}],
    }
    order.update(changes)
    return order


def _attention(**changes):
    row = {
        "id": "attention-1",
        "restaurant_id": "restaurant-1",
        "table_id": "table-1",
        "order_id": "order-1",
        "status": "open",
        "opened_by": "waiter-1",
        "opened_at": "2026-09-30T11:00:00+00:00",
    }
    row.update(changes)
    return row


def _user():
    return {"id": "waiter-1", "restaurant_id": "restaurant-1", "role": "mozo"}


def _ready_db(order=None, attention=None):
    db = _DB()
    db.orders.docs.append(order or _order())
    db.attentions.docs.append(attention or _attention())
    db.tables.docs.append({
        "id": "table-1",
        "restaurant_id": "restaurant-1",
        "status": "ocupada",
        "active_attention_id": "attention-1",
    })
    db.payments.docs.append({
        "id": "payment-1",
        "restaurant_id": "restaurant-1",
        "order_id": "order-1",
        "status": "completed",
        "amount": 25.0,
    })
    return db


def test_close_requires_delivered_food_and_reopens_attention_on_rejection():
    async def run():
        db = _ready_db(_order(status="listo", fulfillment_status="listo", items=[{"status": "listo"}]))
        with pytest.raises(AttentionBlocked, match="sin entregar"):
            await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        return db

    db = asyncio.run(run())
    assert db.attentions.docs[0]["status"] == "open"
    assert db.orders.docs[0]["attention_state"] == "open"
    assert db.tables.docs[0]["active_attention_id"] == "attention-1"


@pytest.mark.parametrize("payment_status", ["comprobante_subido", "confirmado"])
def test_close_rejects_unverified_payment_proofs(payment_status):
    async def run():
        db = _ready_db(_order(payment_status=payment_status))
        with pytest.raises(AttentionBlocked, match="verificar"):
            await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        return db

    db = asyncio.run(run())
    assert db.attentions.docs[0]["status"] == "open"


def test_close_requires_completed_ledger_to_equal_order_balance():
    async def run():
        db = _ready_db(_order(amount_paid=20.0))
        with pytest.raises(AttentionBlocked, match="cuadra"):
            await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        return db

    db = asyncio.run(run())
    assert db.tables.docs[0]["status"] == "ocupada"


def test_close_is_idempotent_and_releases_only_its_table_claim():
    async def run():
        db = _ready_db()
        first = await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        second = await close_table_attention(db, order=await db.orders.find_one({"id": "order-1"}), user=_user(), now="2026-09-30T13:05:00+00:00")
        return db, first, second

    db, first, second = asyncio.run(run())
    assert first["status"] == second["status"] == "closed"
    assert db.orders.docs[0]["attention_state"] == "closed"
    assert db.tables.docs[0]["status"] == "disponible"
    assert "active_attention_id" not in db.tables.docs[0]
    assert len(db.audit_logs.docs) == 1


def test_close_retry_finishes_table_projection_after_failure_without_duplicate_audit():
    async def run():
        db = _ready_db()
        db.fail_table_release = True
        with pytest.raises(RuntimeError, match="projection failure"):
            await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        attention = await db.attentions.find_one({"id": "attention-1"})
        assert attention["status"] == "closed"
        db.orders.docs[0] = await db.orders.find_one({"id": "order-1"})
        closed = await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:05:00+00:00")
        return db, closed

    db, closed = asyncio.run(run())
    assert closed["status"] == "closed"
    assert db.tables.docs[0]["status"] == "disponible"
    assert len(db.audit_logs.docs) == 1


def test_open_attention_retries_after_table_claim_when_record_insert_fails():
    async def run():
        db = _DB()
        db.orders.docs.append(_order(status="nuevo", attention_state="opening"))
        db.tables.docs.append({"id": "table-1", "restaurant_id": "restaurant-1", "status": "disponible"})
        db.fail_attention_insert = True
        with pytest.raises(RuntimeError, match="insert failure"):
            await open_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T12:00:00+00:00")
        opened = await open_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T12:01:00+00:00")
        return db, opened

    db, opened = asyncio.run(run())
    assert opened["status"] == "open"
    assert db.tables.docs[0]["active_attention_id"] == "attention-1"
    assert db.orders.docs[0]["attention_state"] == "open"
    assert len(db.attentions.docs) == 1


def test_order_mutation_cas_cannot_cross_the_close_claim():
    async def run():
        db = _ready_db()
        order = await db.orders.find_one({"id": "order-1"})
        claim = await db.orders.update_one(
            {"id": order["id"], "restaurant_id": order["restaurant_id"], "attention_state": "open"},
            {"$set": {"attention_state": "closing"}},
        )
        assert claim.modified_count == 1
        with pytest.raises(VersionError):
            await claim_order(db.orders, order, {"created_by": "other-waiter"})
        return db

    db = asyncio.run(run())
    assert "created_by" not in db.orders.docs[0]


def test_claim_order_rejects_mutations_after_attention_close_claim():
    async def run():
        from fastapi import HTTPException
        import routes.orders as order_routes

        db = _ready_db(_order(status="listo", fulfillment_status="listo", items=[{"id": "item-1", "status": "listo"}]))
        order_routes.db = db
        order = await db.orders.find_one({"id": "order-1"})
        await db.orders.update_one({"id": "order-1"}, {"$set": {"attention_state": "closing"}})
        with pytest.raises(HTTPException) as exc:
            await order_routes._save_order(order, {"notes": "stale mutation"})
        assert exc.value.status_code == 409
        return db

    db = asyncio.run(run())
    assert db.orders.docs[0].get("notes") is None


def test_payment_route_cannot_change_order_after_close_claim():
    async def run():
        from fastapi import HTTPException
        from types import SimpleNamespace
        import routes.payments as payment_routes

        db = _ready_db(_order(
            status="entregado", fulfillment_status="entregado", attention_state="closing",
            amount_paid=0, payment_status="pendiente", total=25, subtotal=25,
        ))
        db.cash_registers = _Collection(db, "cash_registers")
        db.cash_movements = _Collection(db, "cash_movements")
        db.cash_registers.docs.append({"id": "register-1", "restaurant_id": "restaurant-1", "status": "open"})
        payment_routes.db = db
        data = SimpleNamespace(order_id="order-1", idempotency_key=None)
        with pytest.raises(HTTPException) as exc:
            await payment_routes.create_payment(data, {"id": "cashier-1", "restaurant_id": "restaurant-1"})
        assert exc.value.status_code in (400, 409)
        return db

    db = asyncio.run(run())
    assert db.orders.docs[0]["amount_paid"] == 0
    assert db.payments.docs[0]["amount"] == 25


def test_table_cannot_be_seated_or_released_while_attention_is_active():
    async def run():
        from fastapi import HTTPException
        import routes.tables as table_routes

        db = _ready_db(_order(status="pagado"))
        table_routes.db = db
        for action in (table_routes.seat_table, table_routes.release_table):
            with pytest.raises(HTTPException) as exc:
                await action("table-1", _user())
            assert exc.value.status_code == 400
        return db

    db = asyncio.run(run())
    assert db.tables.docs[0]["active_attention_id"] == "attention-1"


def test_close_retry_never_releases_a_later_visit_for_same_table():
    async def run():
        db = _ready_db()
        await db.attentions.update_one({"id": "attention-1"}, {"$set": {"status": "closed"}})
        await db.orders.update_one({"id": "order-1"}, {"$set": {"attention_state": "closed"}})
        db.tables.docs[0]["active_attention_id"] = "attention-2"
        db.tables.docs[0]["status"] = "ocupada"
        result = await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        return db, result

    db, result = asyncio.run(run())
    assert result["status"] == "closed"
    assert db.tables.docs[0]["active_attention_id"] == "attention-2"
    assert db.tables.docs[0]["status"] == "ocupada"


def test_open_and_paid_order_cannot_admit_second_table_visit(monkeypatch):
    async def run():
        from fastapi import HTTPException
        from types import SimpleNamespace
        import routes.orders as order_routes

        db = _ready_db(_order(status="pagado", attention_state="open"))
        order_routes.db = db
        async def no_items(items, restaurant_id):
            return [], 0.0
        async def order_number(restaurant_id):
            return 2
        async def no_audit(*args, **kwargs):
            return None
        monkeypatch.setattr(order_routes, "_compute_total", no_items)
        order_routes._next_order_number = order_number
        order_routes._audit = no_audit
        data = SimpleNamespace(order_type="mesa", table_id="table-1", items=[], notes=None)
        with pytest.raises(HTTPException) as exc:
            await order_routes.create_order(data, {**_user(), "full_name": "Waiter"})
        assert exc.value.status_code == 400
        return db

    db = asyncio.run(run())
    assert len(db.orders.docs) == 1
    assert db.tables.docs[0]["active_attention_id"] == "attention-1"


def test_cash_close_rejects_paid_order_with_open_attention():
    async def run():
        from fastapi import HTTPException
        from types import SimpleNamespace
        import routes.cash as cash_routes

        db = _ready_db(_order(status="pagado", attention_state="open"))
        db.cash_registers = _Collection(db, "cash_registers")
        db.cash_movements = _Collection(db, "cash_movements")
        db.cash_registers.docs.append({"id": "register-1", "restaurant_id": "restaurant-1", "status": "open"})
        cash_routes.db = db
        with pytest.raises(HTTPException) as exc:
            await cash_routes.close_register(SimpleNamespace(closing_amount=25, notes=None), {
                "id": "cashier-1", "restaurant_id": "restaurant-1", "full_name": "Cashier",
            })
        assert exc.value.status_code == 400
        return db

    db = asyncio.run(run())
    assert db.cash_registers.docs[0]["status"] == "open"


def test_public_vacant_table_order_opens_only_its_own_attention():
    async def run():
        from types import SimpleNamespace
        import routes.public as public_routes

        db = _DB()
        db.branches.docs.append({"id": "branch-1", "restaurant_id": "restaurant-1",
                                 "timezone": "America/Lima", "business_day_cutoff": "04:00"})
        db.tables.docs.append({"id": "table-1", "restaurant_id": "restaurant-1", "branch_id": "branch-1",
                               "status": "disponible"})
        public_routes.db = db
        public_routes.public_order_limiter.allow = lambda host: True
        public_routes.client_host = lambda request: "test-host"
        async def restaurant():
            return {"id": "restaurant-1", "require_table_qr": False}
        async def enrich(items, r):
            return ([{"id": "item-1", "product_id": "product-1", "quantity": 1,
                      "unit_price": 25, "subtotal": 25, "status": "pendiente"}], 25.0)
        async def order_number(restaurant_id):
            return 1
        public_routes._get_restaurant = restaurant
        public_routes._enrich_items = enrich
        public_routes._next_order_number = order_number
        public_routes._gen_tracking = lambda: "OWNTRACK"
        data = PublicOrderCreate(
            request_id="d4b23f44-432a-4c9d-9474-fc764ef8cd59",
            items=[OrderItemInput(product_id="product-1")],
            order_type="local", table_id="table-1", payment_method="efectivo",
        )
        result = await public_routes.public_create_order(data, object())
        order = await db.orders.find_one({"tracking_code": "OWNTRACK"})
        return db, result, order

    db, result, order = asyncio.run(run())
    assert result["tracking_code"] == "OWNTRACK"
    assert order["attention_state"] == "open"
    assert db.attentions.docs[0]["order_id"] == order["id"]
    assert db.tables.docs[0]["active_attention_id"] == order["attention_id"]


def test_close_route_is_scoped_explicit_and_does_not_create_payment():
    async def run():
        import routes.orders as order_routes

        db = _ready_db()
        order_routes.db = db
        before = len(db.payments.docs)
        closed = await order_routes.close_attention("order-1", _user())
        return db, before, closed

    db, before, closed = asyncio.run(run())
    assert closed["status"] == "closed"
    assert len(db.payments.docs) == before
    assert len([row for row in db.audit_logs.docs if row.get("action") == "close_attention"]) == 1


def test_close_route_rejects_another_restaurants_order():
    async def run():
        from fastapi import HTTPException
        import routes.orders as order_routes

        db = _ready_db()
        order_routes.db = db
        with pytest.raises(HTTPException) as exc:
            await order_routes.close_attention("order-1", {**_user(), "restaurant_id": "restaurant-2"})
        assert exc.value.status_code == 404
        return db

    db = asyncio.run(run())
    assert db.attentions.docs[0]["status"] == "open"
    assert db.tables.docs[0]["active_attention_id"] == "attention-1"


def test_two_close_requests_have_one_atomic_winner_and_one_audit():
    async def run():
        db = _ready_db()
        async def close():
            try:
                return await close_table_attention(
                    db, order=await db.orders.find_one({"id": "order-1"}),
                    user=_user(), now="2026-09-30T13:00:00+00:00",
                )
            except AttentionBlocked as exc:
                return exc
        results = await asyncio.gather(close(), close())
        return db, results

    db, results = asyncio.run(run())
    assert all(not isinstance(result, Exception) for result in results)
    assert db.attentions.docs[0]["status"] == "closed"
    assert len([row for row in db.audit_logs.docs if row.get("event_id") == "attention-close:attention-1"]) == 1


def test_legacy_order_without_explicit_attention_cannot_release_table():
    async def run():
        legacy = _order()
        legacy.pop("attention_id")
        legacy.pop("attention_state")
        db = _ready_db(order=legacy)
        with pytest.raises(AttentionBlocked, match="visita explícita"):
            await close_table_attention(db, order=legacy, user=_user(), now="2026-09-30T13:00:00+00:00")
        return db

    db = asyncio.run(run())
    assert db.tables.docs[0]["active_attention_id"] == "attention-1"
    assert db.tables.docs[0]["status"] == "ocupada"


def test_cancelled_attention_order_keeps_table_until_explicit_close(monkeypatch):
    async def run():
        from types import SimpleNamespace
        import routes.orders as order_routes

        order = _order(status="listo", fulfillment_status="listo", amount_paid=0,
                       payment_status="pendiente", items=[{"id": "item-1", "status": "listo"}])
        db = _ready_db(order=order)
        order_routes.db = db
        monkeypatch.setattr(order_routes, "assert_can_cancel", lambda current: None)
        async def no_audit(*args, **kwargs):
            return None
        order_routes._audit = no_audit
        result = await order_routes.change_status(
            "order-1", SimpleNamespace(status="cancelado", reason="customer changed mind"),
            {**_user(), "role": "admin"},
        )
        db.payments.docs.clear()
        order_routes.emit_notice = lambda *args, **kwargs: None
        await order_routes.close_attention("order-1", {**_user(), "role": "admin"})
        return db, result

    db, result = asyncio.run(run())
    assert result["items"][0]["status"] == "cancelado"
    assert db.orders.docs[0]["items"][0]["status"] == "cancelado"
    assert db.orders.docs[0]["attention_state"] == "closed"
    assert db.attentions.docs[0]["status"] == "closed"
    assert db.tables.docs[0]["status"] == "disponible"
    assert "active_attention_id" not in db.tables.docs[0]


@pytest.mark.parametrize("status", ["unknown", "pending"])
def test_close_rejects_nonfinal_payment_ledger_entries(status):
    async def run():
        db = _ready_db()
        db.payments.docs.append({
            "id": "payment-pending", "restaurant_id": "restaurant-1",
            "order_id": "order-1", "status": status, "amount": 0,
        })
        with pytest.raises(AttentionBlocked, match="estado final"):
            await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        return db

    db = asyncio.run(run())
    assert db.attentions.docs[0]["status"] == "open"
    assert db.tables.docs[0]["active_attention_id"] == "attention-1"


def test_close_rejects_unknown_payment_status_even_when_ledger_matches():
    async def run():
        db = _ready_db(_order(payment_status="mystery"))
        with pytest.raises(AttentionBlocked, match="no confirma"):
            await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        return db

    db = asyncio.run(run())
    assert db.attentions.docs[0]["status"] == "open"


def test_close_recovers_after_audit_write_failure_without_false_success():
    async def run():
        db = _ready_db()
        db.fail_audit_insert = True
        with pytest.raises(RuntimeError, match="audit insert failure"):
            await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        assert db.attentions.docs[0]["status"] == "closing"
        assert db.orders.docs[0]["attention_state"] == "closing"
        retry_user = {**_user(), "id": "cashier-2", "full_name": "Retry Clerk"}
        retry = await close_table_attention(db, order=await db.orders.find_one({"id": "order-1"}), user=retry_user, now="2026-09-30T13:05:00+00:00")
        return db, retry

    db, retry = asyncio.run(run())
    assert retry["status"] == "closed"
    assert db.tables.docs[0]["status"] == "disponible"
    audits = [row for row in db.audit_logs.docs if row.get("event_id") == "attention-close:attention-1"]
    assert len(audits) == 1
    assert audits[0]["user_id"] == "waiter-1"

def test_void_claims_order_before_ledger_change_and_close_waits():
    async def run():
        from fastapi import HTTPException
        import routes.payments as payment_routes

        db = _ready_db()
        db.cash_registers = _Collection(db, "cash_registers")
        db.cash_registers.docs.append({"id": "register-1", "restaurant_id": "restaurant-1", "status": "open"})
        db.payments.docs[0].update({
            "cash_register_id": "register-1", "method": "tarjeta",
            "lines": [{"item_id": "item-1", "quantity": 1}],
        })
        payment_routes.db = db
        entered = asyncio.Event()
        release = asyncio.Event()
        original_update = db.payments.update_one
        async def delayed_update(filt, patch):
            if filt.get("status") == "completed":
                entered.set()
                await release.wait()
            return await original_update(filt, patch)
        db.payments.update_one = delayed_update
        void = asyncio.create_task(payment_routes.apply_void_payment(
            "payment-1", {"id": "cashier-1", "restaurant_id": "restaurant-1"},
            "duplicate charge", "void",
        ))
        await entered.wait()
        assert db.orders.docs[0]["attention_state"] == "mutating"
        with pytest.raises(AttentionBlocked):
            await close_table_attention(
                db, order=await db.orders.find_one({"id": "order-1"}),
                user=_user(), now="2026-09-30T13:00:00+00:00",
            )
        assert db.payments.docs[0]["status"] == "completed"
        release.set()
        result = await void
        return db, result

    db, result = asyncio.run(run())
    assert result["status"] == "voided"
    assert db.orders.docs[0]["attention_state"] == "open"
    assert db.orders.docs[0]["amount_paid"] == 0
    assert db.tables.docs[0]["active_attention_id"] == "attention-1"


def test_void_is_rejected_after_close_claim_without_changing_payment():
    async def run():
        from fastapi import HTTPException
        import routes.payments as payment_routes

        db = _ready_db(_order(attention_state="closing"))
        payment_routes.db = db
        with pytest.raises(HTTPException) as exc:
            await payment_routes.apply_void_payment(
                "payment-1", {"id": "cashier-1", "restaurant_id": "restaurant-1"},
                "duplicate charge", "void",
            )
        assert exc.value.status_code == 409
        return db

    db = asyncio.run(run())
    assert db.payments.docs[0]["status"] == "completed"
    assert db.orders.docs[0]["amount_paid"] == 25


def test_staff_table_order_creation_opens_visit_before_returning():
    async def run():
        from types import SimpleNamespace
        import routes.orders as order_routes

        db = _DB()
        db.branches.docs.append({"id": "branch-1", "restaurant_id": "restaurant-1",
                                 "timezone": "America/Lima", "business_day_cutoff": "04:00"})
        db.tables.docs.append({"id": "table-1", "restaurant_id": "restaurant-1", "branch_id": "branch-1",
                               "status": "disponible"})
        order_routes.db = db
        async def order_number(restaurant_id):
            return 9
        async def no_audit(*args, **kwargs):
            return None
        order_routes._next_order_number = order_number
        order_routes._audit = no_audit
        order_routes.emit_order = lambda *args, **kwargs: None
        created = await order_routes.create_order(
            SimpleNamespace(order_type="mesa", table_id="table-1", items=[], notes=None),
            {**_user(), "full_name": "Waiter"},
        )
        return db, created

    db, created = asyncio.run(run())
    assert created["attention_state"] == "open"
    assert db.tables.docs[0]["active_attention_id"] == created["attention_id"]
    assert db.attentions.docs[0]["order_id"] == created["id"]


def test_reopen_endpoint_cannot_reclaim_table_after_visit_closed():
    async def run():
        db = _ready_db()
        await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        closed_order = await db.orders.find_one({"id": "order-1"})
        with pytest.raises(AttentionBlocked):
            await open_table_attention(db, order=closed_order, user=_user(), now="2026-09-30T14:00:00+00:00")
        return db

    db = asyncio.run(run())
    assert db.tables.docs[0]["status"] == "disponible"
    assert "active_attention_id" not in db.tables.docs[0]
from types import SimpleNamespace
from fastapi import HTTPException
import routes.tables as table_routes

def test_table_status_cannot_override_an_active_attention():
    async def run():
        db = _ready_db()
        table_routes.db = db
        data = SimpleNamespace(model_dump=lambda exclude_unset=True: {"status": "disponible"})
        with pytest.raises(HTTPException) as exc:
            await table_routes.update_table("table-1", data, _user())
        assert exc.value.status_code == 409
        return db

    db = asyncio.run(run())
    assert db.tables.docs[0]["status"] == "ocupada"


@pytest.mark.parametrize("tail_status", ["pending", "unknown"])
def test_close_checks_payment_rows_after_the_five_thousandth_entry(tail_status):
    async def run():
        db = _ready_db()
        db.payments.docs.clear()
        db.payments.docs.append({
            "id": "payment-complete", "restaurant_id": "restaurant-1",
            "order_id": "order-1", "status": "completed", "amount": 25,
        })
        db.payments.docs.extend({
            "id": f"payment-void-{index}", "restaurant_id": "restaurant-1",
            "order_id": "order-1", "status": "voided", "amount": 0,
        } for index in range(5008))
        db.payments.docs.append({
            "id": "payment-tail", "restaurant_id": "restaurant-1",
            "order_id": "order-1", "status": tail_status, "amount": 0,
        })
        assert len(db.payments.docs) == 5010
        with pytest.raises(AttentionBlocked, match="estado final"):
            await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        return db

    db = asyncio.run(run())
    assert db.attentions.docs[0]["status"] == "open"
    assert db.tables.docs[0]["active_attention_id"] == "attention-1"


@pytest.mark.parametrize("failure_point", [
    "payment_before", "payment_after", "order_before", "order_after",
    "movement_before", "movement_after", "audit_before", "audit_after",
    "release_before", "release_after",
])
def test_refund_intent_recovers_every_projection_failure_exactly_once(failure_point):
    async def run():
        from fastapi import HTTPException
        import routes.payments as payment_routes

        db = _ready_db()
        db.cash_registers = _Collection(db, "cash_registers")
        db.cash_registers.docs.extend([
            {"id": "old-register", "restaurant_id": "restaurant-1", "status": "closed"},
            {"id": "new-register", "restaurant_id": "restaurant-1", "status": "open"},
        ])
        db.payments.docs[0].update({
            "cash_register_id": "old-register", "method": "efectivo",
            "lines": [{"item_id": "item-1", "quantity": 1}],
        })
        payment_routes.db = db
        collection, method = {
            "payment_before": (db.payments, "update_one"),
            "payment_after": (db.payments, "update_one"),
            "order_before": (db.orders, "update_one"),
            "order_after": (db.orders, "update_one"),
            "movement_before": (db.cash_movements, "insert_one"),
            "movement_after": (db.cash_movements, "insert_one"),
            "audit_before": (db.audit_logs, "insert_one"),
            "audit_after": (db.audit_logs, "insert_one"),
            "release_before": (db.orders, "update_one"),
            "release_after": (db.orders, "update_one"),
        }[failure_point]
        original = getattr(collection, method)
        failed = False

        def should_fail(args, kwargs):
            nonlocal failure_point
            if method == "insert_one":
                doc = args[0]
                return (failure_point.startswith("movement") and doc.get("source_payment_id") == "payment-1") or (
                    failure_point.startswith("audit") and doc.get("event_id") == "payment-void:payment-1"
                )
            filt, update = args[:2]
            fields = update.get("$set", {})
            if failure_point.startswith("payment_"):
                return filt.get("status") == "completed" and fields.get("status") == "voiding"
            if failure_point.startswith("order_"):
                if failure_point.startswith("order_"):
                    return "amount_paid" in fields and fields.get("amount_paid") == 0
            if failure_point.startswith("release_"):
                return fields.get("attention_state") == "open" and "attention_mutation" in update.get("$unset", {})
            return False

        async def injected(*args, **kwargs):
            nonlocal failed
            if not failed and should_fail(args, kwargs):
                failed = True
                if failure_point.endswith("_after"):
                    result = await original(*args, **kwargs)
                    raise RuntimeError(f"injected after-commit failure: {failure_point}")
                raise RuntimeError(f"injected before-commit failure: {failure_point}")
            return await original(*args, **kwargs)

        setattr(collection, method, injected)
        original_user = {"id": "cashier-1", "full_name": "Original Clerk", "restaurant_id": "restaurant-1"}
        retry_user = {"id": "cashier-2", "full_name": "Retry Clerk", "restaurant_id": "restaurant-1"}
        with pytest.raises(RuntimeError, match="injected"):
            await payment_routes.apply_void_payment("payment-1", original_user, "duplicate charge", "refund")
        assert failed
        retry = await payment_routes.apply_void_payment("payment-1", retry_user, "different reason", "void")
        final = await payment_routes.apply_void_payment("payment-1", retry_user, "different reason", "void")
        return db, retry, final

    db, retry, final = asyncio.run(run())
    assert retry["status"] == final["status"] == "refunded"
    assert db.orders.docs[0]["amount_paid"] == 0
    assert db.orders.docs[0]["items"][0]["paid_qty"] == 0
    assert db.orders.docs[0]["attention_state"] == "open"
    movements = [row for row in db.cash_movements.docs if row.get("source_payment_id") == "payment-1"]
    assert len(movements) == 1
    assert movements[0]["cash_register_id"] == "new-register"
    assert movements[0]["created_by"] == "cashier-1"
    assert movements[0]["_id"] == "payment-refund:payment-1"
    audits = [row for row in db.audit_logs.docs if row.get("event_id") == "payment-void:payment-1"]
    assert len(audits) == 1
    assert audits[0]["user_id"] == "cashier-1"
    assert audits[0]["details"]["reason"] == "duplicate charge"


def test_simultaneous_refund_retries_write_one_movement_and_audit():
    async def run():
        import routes.payments as payment_routes

        db = _ready_db()
        db.cash_registers = _Collection(db, "cash_registers")
        db.cash_registers.docs.extend([
            {"id": "old-register", "restaurant_id": "restaurant-1", "status": "closed"},
            {"id": "new-register", "restaurant_id": "restaurant-1", "status": "open"},
        ])
        db.payments.docs[0].update({
            "cash_register_id": "old-register", "method": "efectivo",
            "lines": [{"item_id": "item-1", "quantity": 1}],
        })
        payment_routes.db = db
        operator = {"id": "cashier-1", "full_name": "Original Clerk", "restaurant_id": "restaurant-1"}
        results = await asyncio.gather(*[
            payment_routes.apply_void_payment("payment-1", operator, "duplicate charge", "refund")
            for _ in range(2)
        ])
        return db, results

    db, results = asyncio.run(run())
    assert all(result["status"] == "refunded" for result in results)
    assert db.orders.docs[0]["amount_paid"] == 0
    assert db.orders.docs[0]["items"][0]["paid_qty"] == 0
    assert len([row for row in db.cash_movements.docs if row.get("source_payment_id") == "payment-1"]) == 1
    assert len([row for row in db.audit_logs.docs if row.get("event_id") == "payment-void:payment-1"]) == 1


def test_close_accepts_all_5010_final_ledger_rows():
    async def run():
        db = _ready_db()
        db.payments.docs.clear()
        db.payments.docs.append({
            "id": "payment-complete", "restaurant_id": "restaurant-1",
            "order_id": "order-1", "status": "completed", "amount": 25,
        })
        db.payments.docs.extend({
            "id": f"payment-void-{index}", "restaurant_id": "restaurant-1",
            "order_id": "order-1", "status": "voided", "amount": 0,
        } for index in range(5009))
        assert len(db.payments.docs) == 5010
        result = await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        return db, result

    db, result = asyncio.run(run())
    assert result["status"] == "closed"
    assert db.tables.docs[0]["status"] == "disponible"


def test_old_attention_void_without_recovery_intent_is_not_reported_as_success():
    async def run():
        from fastapi import HTTPException
        import routes.payments as payment_routes

        db = _ready_db(_order(attention_state="open", status="entregado"))
        db.payments.docs[0].update({"status": "refunded", "void_kind": "refund"})
        payment_routes.db = db
        with pytest.raises(HTTPException) as exc:
            await payment_routes.apply_void_payment(
                "payment-1", {"id": "cashier-1", "restaurant_id": "restaurant-1"},
                "duplicate charge", "refund",
            )
        assert exc.value.status_code == 409
        return db

    db = asyncio.run(run())
    assert not db.cash_movements.docs
    assert not db.audit_logs.docs


def test_close_retry_after_attention_projection_failure_keeps_original_operator():
    async def run():
        db = _ready_db()
        original_update = db.attentions.update_one
        failed = False

        async def fail_closing_projection(filt, update):
            nonlocal failed
            if not failed and (update.get("$set") or {}).get("status") == "closing":
                failed = True
                raise RuntimeError("injected attention projection failure")
            return await original_update(filt, update)

        db.attentions.update_one = fail_closing_projection
        with pytest.raises(RuntimeError, match="projection failure"):
            await close_table_attention(db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00")
        retry_user = {**_user(), "id": "cashier-2", "full_name": "Retry Clerk"}
        result = await close_table_attention(
            db, order=await db.orders.find_one({"id": "order-1"}),
            user=retry_user, now="2026-09-30T13:05:00+00:00",
        )
        return db, result

    db, result = asyncio.run(run())
    assert result["status"] == "closed"
    assert db.attentions.docs[0]["closed_by"] == "waiter-1"
    audit = next(row for row in db.audit_logs.docs if row.get("event_id") == "attention-close:attention-1")
    assert audit["user_id"] == "waiter-1"


@pytest.mark.parametrize("projection", ["movement", "audit"])
def test_terminal_refund_retry_rejects_a_mismatched_existing_projection(projection):
    async def run():
        from fastapi import HTTPException
        import routes.payments as payment_routes

        db = _ready_db()
        db.cash_registers = _Collection(db, "cash_registers")
        db.cash_registers.docs.extend([
            {"id": "old-register", "restaurant_id": "restaurant-1", "status": "closed"},
            {"id": "new-register", "restaurant_id": "restaurant-1", "status": "open"},
        ])
        db.payments.docs[0].update({
            "cash_register_id": "old-register", "method": "efectivo",
            "lines": [{"item_id": "item-1", "quantity": 1}],
        })
        payment_routes.db = db
        operator = {"id": "cashier-1", "full_name": "Original Clerk", "restaurant_id": "restaurant-1"}
        await payment_routes.apply_void_payment("payment-1", operator, "duplicate charge", "refund")
        if projection == "movement":
            db.cash_movements.docs[0]["cash_register_id"] = "wrong-register"
        else:
            db.audit_logs.docs[0]["user_id"] = "wrong-operator"
        with pytest.raises(HTTPException) as exc:
            await payment_routes.apply_void_payment("payment-1", operator, "duplicate charge", "refund")
        assert exc.value.status_code == 409

    asyncio.run(run())


def test_active_order_list_includes_terminal_orders_with_open_attentions():
    async def run():
        import routes.orders as order_routes
        db = _ready_db(_order(status="pagado", attention_state="open", attention_open=True))
        order_routes.db = db
        rows = await order_routes.list_orders({"restaurant_id": "restaurant-1", "role": "admin"}, active_only=True)
        return rows

    rows = asyncio.run(run())
    assert [row["id"] for row in rows] == ["order-1"]


def test_table_list_projects_paid_order_while_its_exact_attention_is_open():
    async def run():
        import routes.tables as table_routes
        db = _ready_db(_order(status="pagado", attention_state="open", attention_open=True))
        table_routes.db = db
        return await table_routes.list_tables({"restaurant_id": "restaurant-1", "role": "admin"})

    tables = asyncio.run(run())
    assert tables[0]["active_attention_id"] == "attention-1"
    assert tables[0]["active_order"]["id"] == "order-1"
    assert tables[0]["active_order"]["attention_id"] == "attention-1"
    assert tables[0]["active_order"]["status"] == "pagado"
