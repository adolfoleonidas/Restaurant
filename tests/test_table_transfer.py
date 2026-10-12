"""Fake-only regressions for moving an open visit between tables.

The move has three durable steps — reserve the destination, relocate the order
(is is the point of no return), then relocate the visit and free the source.
These tests pin the guards, the rollback of a failed relocation and the retry
that finishes an interrupted move.
"""
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

import routes.orders as order_routes  # noqa: E402
import routes.table_groups as group_routes  # noqa: E402
import routes.tables as table_routes  # noqa: E402
from models import TableTransfer  # noqa: E402
from branch_isolation_fakes import _DB, _Result, _order, _table, _user  # noqa: E402


def _wire(monkeypatch, db):
    monkeypatch.setattr(table_routes, "db", db)
    monkeypatch.setattr(group_routes, "db", db)
    monkeypatch.setattr(order_routes, "db", db)
    notices = []
    recorder = lambda rid, kind, **extra: notices.append({"type": kind, **extra})  # noqa: E731
    monkeypatch.setattr(table_routes, "emit_notice", recorder)
    monkeypatch.setattr(group_routes, "emit_notice", recorder)
    return notices


def _row(db, table_id):
    return next(row for row in db.tables.rows if row["id"] == table_id)


def _visit_order(order_id="order-1", table_id="table-a", attention_id="attention-1", **extra):
    row = _order(order_id, "branch-a", table_id=table_id, attention_id=attention_id,
                 attention_state="open", status="en_preparacion", updated_at="t1")
    row.update(extra)
    return row


async def _stale_order_update(*args, **kwargs):
    """Simulate an order that changed under the caller's feet."""
    return _Result()


def _attention(table_id="table-a", order_id="order-1", attention_id="attention-1"):
    return {"id": attention_id, "restaurant_id": "tenant-1", "order_id": order_id,
            "table_id": table_id, "status": "open", "branch_id": "branch-a"}


def _served_tables():
    return [_table("table-a", "branch-a", number=1, status="ocupada", active_attention_id="attention-1"),
            _table("table-b", "branch-a", number=2, status="disponible")]


def test_transfer_moves_the_order_and_the_visit_to_a_free_table(monkeypatch):
    async def run():
        db = _DB(tables=_served_tables(), orders=[_visit_order()], attentions=[_attention()])
        notices = _wire(monkeypatch, db)
        result = await table_routes.transfer_table(
            "table-a", TableTransfer(target_table_id="table-b"), _user()
        )
        assert result["ok"] is True
        assert (result["from_number"], result["to_number"]) == (1, 2)
        assert result["order"]["table_id"] == "table-b"
        assert db.orders.rows[0]["table_id"] == "table-b"
        assert db.attentions.rows[0]["table_id"] == "table-b"
        assert _row(db, "table-a")["status"] == "disponible"
        assert "active_attention_id" not in _row(db, "table-a")
        assert _row(db, "table-b")["status"] == "ocupada"
        assert _row(db, "table-b")["active_attention_id"] == "attention-1"
        assert [entry["action"] for entry in db.audit_logs.rows] == ["transfer"]
        assert db.audit_logs.rows[0]["details"]["to_table"] == 2
        assert {notice["table_id"] for notice in notices} == {"table-a", "table-b"}
    asyncio.run(run())


def test_transfer_refuses_the_same_table(monkeypatch):
    async def run():
        db = _DB(tables=_served_tables(), orders=[_visit_order()], attentions=[_attention()])
        _wire(monkeypatch, db)
        with pytest.raises(HTTPException) as caught:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-a"), _user())
        assert caught.value.status_code == 400
        assert db.tables.writes == []
    asyncio.run(run())


def test_transfer_refuses_a_destination_with_its_own_account(monkeypatch):
    async def run():
        db = _DB(
            tables=_served_tables()
            + [_table("table-c", "branch-a", number=3, status="ocupada", active_attention_id="attention-2")],
            orders=[_visit_order(), _visit_order("order-2", "table-c", attention_id="attention-2")],
            attentions=[_attention(), _attention("table-c", "order-2", "attention-2")],
        )
        _wire(monkeypatch, db)
        with pytest.raises(HTTPException) as caught:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-c"), _user())
        assert caught.value.status_code == 409
        assert "ya tiene un pedido activo" in caught.value.detail
        assert db.tables.writes == []
        assert db.orders.rows[0]["table_id"] == "table-a"
    asyncio.run(run())


def test_transfer_refuses_a_destination_with_a_visit_in_progress(monkeypatch):
    async def run():
        db = _DB(
            tables=_served_tables()
            + [_table("table-c", "branch-a", number=3, status="ocupada", active_attention_id="attention-9")],
            orders=[_visit_order()],
            attentions=[_attention()],
        )
        _wire(monkeypatch, db)
        with pytest.raises(HTTPException) as caught:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-c"), _user())
        assert caught.value.status_code == 409
        assert "visita en curso" in caught.value.detail
        assert db.tables.writes == []
    asyncio.run(run())


def test_transfer_refuses_a_paid_destination_and_a_grouped_source(monkeypatch):
    async def run():
        paid = _DB(tables=_served_tables() + [_table("table-c", "branch-a", number=3, status="pagada")],
                   orders=[_visit_order()], attentions=[_attention()])
        _wire(monkeypatch, paid)
        with pytest.raises(HTTPException) as unavailable:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-c"), _user())
        assert unavailable.value.status_code == 409
        assert "no está disponible" in unavailable.value.detail
        assert paid.tables.writes == []

        grouped = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada",
                           active_attention_id="attention-1", group_id="group-1"),
                    _table("table-b", "branch-a", number=2)],
            orders=[_visit_order()], attentions=[_attention()],
        )
        _wire(monkeypatch, grouped)
        with pytest.raises(HTTPException) as joined:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-b"), _user())
        assert joined.value.status_code == 409
        assert "separa las mesas" in joined.value.detail
        assert grouped.tables.writes == []
    asyncio.run(run())


def test_transfer_stays_inside_the_branch(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada",
                           active_attention_id="attention-1"),
                    _table("table-b", "branch-b", number=2)],
            orders=[_visit_order()], attentions=[_attention()],
        )
        _wire(monkeypatch, db)
        with pytest.raises(HTTPException) as caught:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-b"), _user())
        assert caught.value.status_code == 404
        assert db.tables.writes == []
        assert db.orders.rows[0]["table_id"] == "table-a"
    asyncio.run(run())


def test_transfer_requires_an_open_account_and_a_materialized_visit(monkeypatch):
    async def run():
        idle = _DB(tables=[_table("table-a", "branch-a", number=1, status="ocupada"),
                           _table("table-b", "branch-a", number=2)])
        _wire(monkeypatch, idle)
        with pytest.raises(HTTPException) as empty:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-b"), _user())
        assert empty.value.status_code == 409
        assert "no tiene un pedido activo" in empty.value.detail

        paid = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="esperando_pago",
                           active_attention_id="attention-1"),
                    _table("table-b", "branch-a", number=2)],
            orders=[_visit_order(status="pagado")], attentions=[_attention()],
        )
        _wire(monkeypatch, paid)
        with pytest.raises(HTTPException) as settled:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-b"), _user())
        assert settled.value.status_code == 409
        assert "cuenta ya está cerrada" in settled.value.detail

        opening = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada",
                           active_attention_id="attention-1"),
                    _table("table-b", "branch-a", number=2)],
            orders=[_visit_order(attention_state="opening")], attentions=[],
        )
        _wire(monkeypatch, opening)
        with pytest.raises(HTTPException) as pending:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-b"), _user())
        assert pending.value.status_code == 409
        assert "todavía no está abierta" in pending.value.detail
        assert opening.tables.writes == []
    asyncio.run(run())


def test_transfer_gives_the_destination_back_when_the_order_changed(monkeypatch):
    async def run():
        db = _DB(tables=_served_tables(), orders=[_visit_order()], attentions=[_attention()])
        _wire(monkeypatch, db)
        monkeypatch.setattr(db.orders, "update_one", _stale_order_update)
        with pytest.raises(HTTPException) as caught:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-b"), _user())
        assert caught.value.status_code == 409
        assert "El pedido cambió" in caught.value.detail
        assert _row(db, "table-b")["status"] == "disponible"
        assert "active_attention_id" not in _row(db, "table-b")
        assert _row(db, "table-a")["active_attention_id"] == "attention-1"
        assert db.orders.rows[0]["table_id"] == "table-a"
        assert db.attentions.rows[0]["table_id"] == "table-a"
        assert db.audit_logs.rows == []
    asyncio.run(run())


def test_transfer_retry_finishes_the_visit_relocation(monkeypatch):
    async def run():
        # Interrupted between relocating the order and relocating the visit.
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada",
                           active_attention_id="attention-1"),
                    _table("table-b", "branch-a", number=2, status="ocupada",
                           active_attention_id="attention-1")],
            orders=[_visit_order(table_id="table-b")],
            attentions=[_attention(table_id="table-a")],
        )
        notices = _wire(monkeypatch, db)
        result = await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-b"), _user())
        assert result["ok"] is True
        assert db.attentions.rows[0]["table_id"] == "table-b"
        assert _row(db, "table-a")["status"] == "disponible"
        assert "active_attention_id" not in _row(db, "table-a")
        assert _row(db, "table-b")["active_attention_id"] == "attention-1"
        assert db.audit_logs.rows[0]["details"]["reconciled"] is True
        assert {notice["table_id"] for notice in notices} == {"table-a", "table-b"}
    asyncio.run(run())


def test_transfer_retry_releases_a_source_that_kept_the_visit_fence(monkeypatch):
    async def run():
        # Interrupted between relocating the visit and freeing the source table.
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada",
                           active_attention_id="attention-1"),
                    _table("table-b", "branch-a", number=2, status="ocupada",
                           active_attention_id="attention-1")],
            orders=[_visit_order(table_id="table-b")],
            attentions=[_attention(table_id="table-b")],
        )
        _wire(monkeypatch, db)
        result = await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-b"), _user())
        assert result["ok"] is True
        assert _row(db, "table-a")["status"] == "disponible"
        assert "active_attention_id" not in _row(db, "table-a")
        assert db.attentions.rows[0]["table_id"] == "table-b"
    asyncio.run(run())


def test_transfer_retry_needs_the_visit_to_belong_to_the_pair(monkeypatch):
    async def run():
        db = _DB(
            tables=_served_tables(),
            orders=[_visit_order(table_id="table-b")],
            attentions=[_attention(table_id="table-x")],
        )
        _wire(monkeypatch, db)
        with pytest.raises(HTTPException) as caught:
            await table_routes.transfer_table("table-a", TableTransfer(target_table_id="table-b"), _user())
        assert caught.value.status_code == 409
        assert db.tables.writes == []
    asyncio.run(run())
