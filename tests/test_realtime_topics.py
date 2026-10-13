"""Every realtime event carries the topic(s) a client uses to refetch only what changed.

The legacy fields (`type`, `order_id`, `status`, ...) stay untouched so older
clients keep working; `topic` is the primary topic and `topics` the full list.
"""
import asyncio
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import notify  # noqa: E402
import routes.orders as order_routes  # noqa: E402
import routes.tables as table_routes  # noqa: E402
import routes.table_groups as group_routes  # noqa: E402
from branch_isolation_fakes import _Collection, _DB, _order, _table, _user  # noqa: E402
from models import OrderItemVoid, TableTransfer  # noqa: E402
from notify import emit_notice, emit_order, subscribe, unsubscribe  # noqa: E402


def _capture(emit):
    """Run `emit()` and return the single event it published on the real hub."""
    async def run():
        q = subscribe()
        try:
            emit()
            events = []
            while not q.empty():
                events.append(q.get_nowait())
            return events
        finally:
            unsubscribe(q)
    return asyncio.run(run())


def _one(emit):
    events = _capture(emit)
    assert len(events) == 1
    return events[0]


# --- emit_order ---------------------------------------------------------------

def test_an_order_event_carries_the_orders_and_kitchen_topics():
    event = _one(lambda: emit_order("r1", "o1", "enviado_cocina", source="staff", branch_id="b1"))
    assert event["topic"] == "orders"
    assert event["topics"] == ["orders", "kitchen"]
    # Legacy fields are untouched.
    assert (event["type"], event["order_id"], event["status"], event["branch_id"]) == (
        "order", "o1", "enviado_cocina", "b1")


def test_a_draft_only_order_edit_does_not_touch_the_kitchen_topic():
    event = _one(lambda: emit_order("r1", "o1", "nuevo", extra="items_added", kitchen=False))
    assert event["topics"] == ["orders"]
    assert "kitchen" not in event


def test_a_payment_event_adds_the_payments_topic():
    event = _one(lambda: emit_order("r1", "o1", "pagado", payment_status="pagado"))
    assert event["topic"] == "orders"
    assert "payments" in event["topics"] and "orders" in event["topics"]


def test_an_order_that_becomes_paid_adds_the_payments_topic_even_without_payment_status():
    event = _one(lambda: emit_order("r1", "o1", "pagado"))
    assert "payments" in event["topics"]


def test_a_payment_proof_upload_adds_payments_and_prepay():
    event = _one(lambda: emit_order("r1", "o1", "nuevo", payment_status="comprobante_subido"))
    assert {"orders", "payments", "prepay"} <= set(event["topics"])


def test_extra_topics_are_appended_without_duplicates():
    event = _one(lambda: emit_order("r1", "o1", "nuevo", payment_status="pagado", topics=("prepay", "payments")))
    assert event["topics"].count("payments") == 1
    assert "prepay" in event["topics"]


def test_related_orders_travel_with_the_event():
    event = _one(lambda: emit_order("r1", "o1", "nuevo", extra="merged", related_order_ids=["o2"]))
    assert event["related_order_ids"] == ["o2"]


# --- emit_notice --------------------------------------------------------------

@pytest.mark.parametrize("kind,topics", [
    ("table", ["tables"]),
    ("zone", ["tables"]),
    ("product", ["catalog"]),
    ("category", ["catalog"]),
    ("cash", ["cash"]),
    ("approval", ["approvals"]),
])
def test_a_notice_carries_the_topic_of_its_kind(kind, topics):
    event = _one(lambda: emit_notice("r1", kind, branch_id="b1"))
    assert event["topic"] == topics[0]
    assert event["topics"] == topics
    assert event["type"] == kind and event["restaurant_id"] == "r1"


def test_a_notice_of_an_unknown_kind_has_no_topic_so_clients_refresh_everything():
    event = _one(lambda: emit_notice("r1", "something_new"))
    assert "topic" not in event and "topics" not in event


def test_category_events_reach_the_public_menu_stream():
    assert notify.public_allowed({"type": "category", "restaurant_id": "r1"}, "r1") is True
    assert notify.public_allowed({"type": "zone", "restaurant_id": "r1"}, "r1") is False


# The exact call shapes the routes use, one per representative action.
@pytest.mark.parametrize("action,emit,expected", [
    ("order create", lambda: emit_order("r1", "o1", "nuevo", source="staff", order_number=7, branch_id="b1"),
     ["orders", "kitchen"]),
    ("send to kitchen", lambda: emit_order("r1", "o1", "enviado_cocina", source="staff", branch_id="b1"),
     ["orders", "kitchen"]),
    ("bump", lambda: emit_order("r1", "o1", "listo", source="staff", extra="bump", branch_id="b1"),
     ["orders", "kitchen"]),
    ("cash payment", lambda: emit_order("r1", "o1", "pagado", source="staff", payment_status="pagado", branch_id="b1"),
     ["orders", "kitchen", "payments"]),
    ("payment void", lambda: emit_order("r1", "o1", "nuevo", source="staff", payment_status="voided", branch_id="b1"),
     ["orders", "kitchen", "payments"]),
    ("prepay", lambda: emit_order("r1", "o1", "nuevo", source="public", payment_status="pagado", branch_id="b1",
                                  topics=("prepay",)),
     ["orders", "kitchen", "payments", "prepay"]),
    ("seat table", lambda: emit_notice("r1", "table", table_id="t1", status="ocupada", branch_id="b1"), ["tables"]),
    ("release table", lambda: emit_notice("r1", "table", table_id="t1", status="disponible", branch_id="b1"),
     ["tables"]),
    ("cash open", lambda: emit_notice("r1", "cash", status="open", register_id="c1", branch_id="b1"), ["cash"]),
    ("cash close", lambda: emit_notice("r1", "cash", status="closed", register_id="c1", branch_id="b1"), ["cash"]),
    ("approval request", lambda: emit_notice("r1", "approval", approval_id="a1", status="pending"), ["approvals"]),
])
def test_representative_actions_publish_their_topics(action, emit, expected):
    event = _one(emit)
    assert event["topics"] == expected, action
    assert event["topic"] == expected[0]


# --- representative routes ----------------------------------------------------

RID = "tenant-1"


class _OrdersDB:
    def __init__(self, orders):
        self.orders = _Collection(orders)
        self.branches = _Collection([{"id": "branch-1", "restaurant_id": RID}])
        self.audit_logs = _Collection()
        self.counters = _Collection()


def _staff():
    return {"id": "mozo-1", "restaurant_id": RID, "role": "mozo", "full_name": "Mozo", "branch_id": "branch-1"}


def _open_order(items):
    return {
        "id": "order-1", "restaurant_id": RID, "branch_id": "branch-1", "table_id": "table-1",
        "order_number": 12, "status": "enviado_cocina", "order_type": "mesa", "subtotal": 0.0,
        "discount": 0.0, "tip": 0.0, "delivery_fee": 0.0, "amount_paid": 0.0, "total": 0.0,
        "updated_at": "2026-01-01T00:00:00+00:00", "items": items,
    }


def _line(item_id, status):
    return {"id": item_id, "product_id": "p1", "product_name": "Lomo", "quantity": 1,
            "unit_price": 10.0, "subtotal": 10.0, "status": status}


def test_removing_a_draft_line_notifies_orders_but_not_the_kitchen(monkeypatch):
    async def run():
        monkeypatch.setattr(order_routes, "db", _OrdersDB([_open_order([_line("i1", "borrador")])]))
        q = subscribe()
        try:
            await order_routes.remove_item("order-1", "i1", _staff())
            return q.get_nowait()
        finally:
            unsubscribe(q)

    event = asyncio.run(run())
    assert event["type"] == "order" and event["order_id"] == "order-1"
    assert event["topics"] == ["orders"]


def test_voiding_a_sent_line_notifies_orders_and_the_kitchen(monkeypatch):
    async def run():
        monkeypatch.setattr(order_routes, "db", _OrdersDB([_open_order([_line("i1", "pendiente")])]))
        q = subscribe()
        try:
            await order_routes.void_item("order-1", "i1", OrderItemVoid(reason="error"), _staff())
            return q.get_nowait()
        finally:
            unsubscribe(q)

    event = asyncio.run(run())
    assert event["extra"] == "item_voided"
    assert event["topics"] == ["orders", "kitchen"]


def test_moving_a_visit_notifies_the_tables_topic(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada", active_attention_id="attention-1"),
                    _table("table-b", "branch-a", number=2, status="disponible")],
            orders=[_order("order-1", "branch-a", table_id="table-a", attention_id="attention-1",
                           attention_state="open", status="en_preparacion", updated_at="t1")],
            attentions=[{"id": "attention-1", "restaurant_id": "tenant-1", "order_id": "order-1",
                         "table_id": "table-a", "status": "open", "branch_id": "branch-a"}],
        )
        for module in (table_routes, group_routes, order_routes):
            monkeypatch.setattr(module, "db", db)
        q = subscribe()
        try:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-b"), _user())
            events = []
            while not q.empty():
                events.append(q.get_nowait())
            return events
        finally:
            unsubscribe(q)

    events = asyncio.run(run())
    assert events and all(e["type"] == "table" and e["topics"] == ["tables"] for e in events)
