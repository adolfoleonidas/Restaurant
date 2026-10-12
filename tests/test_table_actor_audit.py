"""Seat, release and transfer stay open to any waiter of the branch but name who acted."""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import routes.orders as order_routes  # noqa: E402
import routes.table_groups as group_routes  # noqa: E402
import routes.tables as table_routes  # noqa: E402
from models import TableTransfer  # noqa: E402
from branch_isolation_fakes import _DB, _order, _table, _user  # noqa: E402


def _wire(monkeypatch, db):
    for module in (table_routes, group_routes, order_routes):
        monkeypatch.setattr(module, "db", db)
    for module in (table_routes, group_routes):
        monkeypatch.setattr(module, "emit_notice", lambda *a, **k: None)


def _waiter():
    return _user(role="mozo", branch_id="branch-a", id="waiter-9", full_name="Ana Mozo")


def _assert_actor(entry, action, table_id):
    assert entry["action"] == action
    assert entry["entity"] in ("table", "order")
    assert entry["user_id"] == "waiter-9"
    assert entry["user_name"] == "Ana Mozo"
    assert entry["user_role"] == "mozo"
    assert entry["branch_id"] == "branch-a"
    assert entry["restaurant_id"] == "tenant-1"
    assert entry["created_at"]
    assert table_id in (entry["entity_id"], entry["details"].get("from_table_id"))


def test_any_waiter_seat_is_recorded_with_the_actor(monkeypatch):
    async def run():
        db = _DB(tables=[_table("table-a", "branch-a", number=4)])
        _wire(monkeypatch, db)
        await table_routes.seat_table("table-a", _waiter())
        assert len(db.audit_logs.rows) == 1
        entry = db.audit_logs.rows[0]
        _assert_actor(entry, "seat", "table-a")
        assert entry["details"]["table_number"] == 4
    asyncio.run(run())


def test_any_waiter_release_is_recorded_with_the_actor(monkeypatch):
    async def run():
        db = _DB(tables=[_table("table-a", "branch-a", number=4, status="ocupada")])
        _wire(monkeypatch, db)
        await table_routes.release_table("table-a", _waiter())
        assert len(db.audit_logs.rows) == 1
        entry = db.audit_logs.rows[0]
        _assert_actor(entry, "release", "table-a")
        assert entry["details"]["table_number"] == 4
    asyncio.run(run())


def test_transfer_is_recorded_with_the_actor(monkeypatch):
    async def run():
        order = _order("order-1", "branch-a", table_id="table-a", attention_id="attention-1",
                       attention_state="open", status="en_preparacion", updated_at="t1")
        attention = {"id": "attention-1", "restaurant_id": "tenant-1", "order_id": "order-1",
                     "table_id": "table-a", "status": "open", "branch_id": "branch-a"}
        db = _DB(tables=[_table("table-a", "branch-a", number=1, status="ocupada",
                                active_attention_id="attention-1"),
                         _table("table-b", "branch-a", number=2)],
                 orders=[order], attentions=[attention])
        _wire(monkeypatch, db)
        await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-b"), _waiter())
        assert len(db.audit_logs.rows) == 1
        _assert_actor(db.audit_logs.rows[0], "transfer", "table-a")
    asyncio.run(run())
