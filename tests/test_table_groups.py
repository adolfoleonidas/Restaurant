"""Fake-only regressions for the salón table groups ("unir mesas").

The group is a floor marker: it blocks free member tables and never touches the
account of the table that already owns the open visit. These tests pin both
halves of that promise, including the rollback paths.
"""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import routes.orders as order_routes  # noqa: E402
import routes.table_groups as group_routes  # noqa: E402
import routes.tables as table_routes  # noqa: E402
from models import TableGroupAddTable, TableGroupCreate  # noqa: E402
from branch_isolation_fakes import _DB, _order, _table, _user  # noqa: E402


def _wire(monkeypatch, db):
    """Point every touched route module at the fake and record the floor notices."""
    monkeypatch.setattr(group_routes, "db", db)
    monkeypatch.setattr(table_routes, "db", db)
    monkeypatch.setattr(order_routes, "db", db)
    notices = []
    recorder = lambda rid, kind, **extra: notices.append({"type": kind, **extra})  # noqa: E731
    monkeypatch.setattr(group_routes, "emit_notice", recorder)
    monkeypatch.setattr(table_routes, "emit_notice", recorder)
    return notices


def _row(db, table_id):
    return next(row for row in db.tables.rows if row["id"] == table_id)


def _visit_order(order_id="order-1", table_id="table-a", attention_id="attention-1", **extra):
    return _order(order_id, "branch-a", table_id=table_id, attention_id=attention_id,
                  attention_state="open", status="en_preparacion", **extra)


def _attention(table_id="table-a", order_id="order-1", attention_id="attention-1"):
    return {"id": attention_id, "restaurant_id": "tenant-1", "order_id": order_id,
            "table_id": table_id, "status": "open", "branch_id": "branch-a"}


def _group(group_id="group-1", table_ids=("table-a", "table-b"), **extra):
    row = {"id": group_id, "restaurant_id": "tenant-1", "branch_id": "branch-a",
           "table_ids": list(table_ids), "anchor_table_id": table_ids[0],
           "name": "Mesas 1 + 2", "auto_name": True, "status": "active",
           "created_at": "t1", "updated_at": "t1"}
    row.update(extra)
    return row


def test_group_model_rejects_blank_or_repeated_tables():
    with pytest.raises(ValidationError):
        TableGroupCreate(table_ids=["table-a", "table-a"])
    with pytest.raises(ValidationError):
        TableGroupCreate(table_ids=["table-a", "  "])
    with pytest.raises(ValidationError):
        TableGroupCreate(table_ids=["table-a"])
    with pytest.raises(ValidationError):
        TableGroupCreate(table_ids=[f"table-{index}" for index in range(13)])
    assert TableGroupCreate(table_ids=["table-a", "table-b"]).table_ids == ["table-a", "table-b"]


def test_join_allows_two_running_accounts_and_keeps_both_bills(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada", active_attention_id="attention-1"),
                    _table("table-b", "branch-a", number=2, status="ocupada", active_attention_id="attention-2")],
            orders=[_visit_order("order-1", "table-a", created_at="t1"),
                    _visit_order("order-2", "table-b", attention_id="attention-2", created_at="t2")],
            attentions=[_attention("table-a"),
                        _attention("table-b", "order-2", "attention-2")],
        )
        _wire(monkeypatch, db)
        group = await group_routes.create_group(TableGroupCreate(table_ids=["table-a", "table-b"]), _user())
        assert group["table_ids"] == ["table-a", "table-b"]
        # The earliest account is the group's reference table.
        assert group["anchor_table_id"] == "table-a"
        assert db.table_groups.rows[0]["status"] == "active"
        assert db.audit_logs.rows[0]["details"]["accounts"] == 2
        for table_id, attention in (("table-a", "attention-1"), ("table-b", "attention-2")):
            row = _row(db, table_id)
            assert row["group_id"] == group["id"]
            assert row["status"] == "ocupada"
            assert row["active_attention_id"] == attention
            # Neither account was touched and neither table was re-blocked.
            assert "group_joined_status" not in row
        assert [order["table_id"] for order in db.orders.rows] == ["table-a", "table-b"]
        assert [attention["table_id"] for attention in db.attentions.rows] == ["table-a", "table-b"]
    asyncio.run(run())


def test_join_picks_the_earliest_account_and_refuses_a_free_anchor(monkeypatch):
    async def run():
        tables = [_table("table-a", "branch-a", number=1, status="ocupada", active_attention_id="attention-1"),
                  _table("table-b", "branch-a", number=2, status="ocupada", active_attention_id="attention-2"),
                  _table("table-c", "branch-a", number=3)]
        orders = [_visit_order("order-1", "table-a", created_at="t2"),
                  _visit_order("order-2", "table-b", attention_id="attention-2", created_at="t1")]

        db = _DB(tables=tables, orders=orders, attentions=[_attention("table-a"), _attention("table-b", "order-2", "attention-2")])
        _wire(monkeypatch, db)
        # table-b opened its visit first, so it becomes the reference table.
        default = await group_routes.create_group(TableGroupCreate(table_ids=["table-a", "table-b"]), _user())
        assert default["anchor_table_id"] == "table-b"

        db = _DB(tables=tables, orders=orders, attentions=[_attention("table-a"), _attention("table-b", "order-2", "attention-2")])
        _wire(monkeypatch, db)
        chosen = await group_routes.create_group(
            TableGroupCreate(table_ids=["table-a", "table-b"], anchor_table_id="table-a"), _user()
        )
        assert chosen["anchor_table_id"] == "table-a"

        db = _DB(tables=tables, orders=orders, attentions=[_attention("table-a"), _attention("table-b", "order-2", "attention-2")])
        _wire(monkeypatch, db)
        with pytest.raises(HTTPException) as caught:
            await group_routes.create_group(
                TableGroupCreate(table_ids=["table-a", "table-b", "table-c"], anchor_table_id="table-c"), _user()
            )
        assert caught.value.status_code == 409
        assert "su propia cuenta" in caught.value.detail
        assert db.table_groups.rows == []
        assert all(row.get("group_id") is None for row in db.tables.rows)
    asyncio.run(run())


def test_join_mixes_accounts_and_a_free_member(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada", active_attention_id="attention-1"),
                    _table("table-b", "branch-a", number=2, status="ocupada", active_attention_id="attention-2"),
                    _table("table-c", "branch-a", number=3, status="disponible")],
            orders=[_visit_order("order-1", "table-a", created_at="t1"),
                    _visit_order("order-2", "table-b", attention_id="attention-2", created_at="t2")],
            attentions=[_attention("table-a"), _attention("table-b", "order-2", "attention-2")],
        )
        _wire(monkeypatch, db)
        group = await group_routes.create_group(
            TableGroupCreate(table_ids=["table-a", "table-b", "table-c"]), _user()
        )
        assert group["anchor_table_id"] == "table-a"
        assert _row(db, "table-c")["group_joined_status"] == "disponible"
        assert _row(db, "table-c")["status"] == "ocupada"
        assert _row(db, "table-c").get("active_attention_id") is None

        dissolved = await group_routes.dissolve_group(group["id"], _user())
        assert dissolved["dissolved"] is True
        # Only the member the group had blocked goes back to the floor; both bills stay.
        assert _row(db, "table-a")["status"] == "ocupada"
        assert _row(db, "table-b")["status"] == "ocupada"
        assert _row(db, "table-c")["status"] == "disponible"
        assert all(row.get("group_id") is None for row in db.tables.rows)
    asyncio.run(run())


def test_removing_the_anchor_moves_the_reference_to_the_other_account(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada", group_id="group-1",
                           active_attention_id="attention-1"),
                    _table("table-b", "branch-a", number=2, status="ocupada", group_id="group-1",
                           active_attention_id="attention-2"),
                    _table("table-c", "branch-a", number=3, status="ocupada", group_id="group-1",
                           group_joined_status="disponible")],
            orders=[_visit_order("order-1", "table-a", created_at="t1"),
                    _visit_order("order-2", "table-b", attention_id="attention-2", created_at="t2")],
            attentions=[_attention("table-a"), _attention("table-b", "order-2", "attention-2")],
            table_groups=[_group("group-1", ("table-a", "table-b", "table-c"))],
        )
        _wire(monkeypatch, db)
        group = await group_routes.remove_table_from_group("group-1", "table-a", _user())
        assert group["table_ids"] == ["table-b", "table-c"]
        assert group["anchor_table_id"] == "table-b"
        # The leaving table keeps its own account and its visit.
        assert _row(db, "table-a")["status"] == "ocupada"
        assert _row(db, "table-a")["active_attention_id"] == "attention-1"
        assert "group_id" not in _row(db, "table-a")
    asyncio.run(run())


def test_join_blocks_the_free_member_and_keeps_the_anchor_account(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=4, status="ocupada", active_attention_id="attention-1"),
                    _table("table-b", "branch-a", number=5, status="disponible")],
            orders=[_visit_order("order-1", "table-a")],
            attentions=[_attention("table-a")],
        )
        notices = _wire(monkeypatch, db)
        group = await group_routes.create_group(TableGroupCreate(table_ids=["table-a", "table-b"]), _user())
        assert group["anchor_table_id"] == "table-a"
        assert group["name"] == "Mesas 4 + 5"
        assert group["table_ids"] == ["table-a", "table-b"]
        assert [row["status"] for row in db.tables.rows] == ["ocupada", "ocupada"]
        assert _row(db, "table-a")["active_attention_id"] == "attention-1"
        assert _row(db, "table-b")["group_joined_status"] == "disponible"
        assert db.table_groups.rows[0]["created_by"] == "staff-1"
        assert [entry["action"] for entry in db.audit_logs.rows] == ["join"]
        assert {notice["table_id"] for notice in notices} == {"table-a", "table-b"}
        assert [table["status"] for table in group["tables"]] == ["ocupada", "ocupada"]
    asyncio.run(run())


def test_join_keeps_a_custom_name_and_the_requested_anchor_for_free_tables(monkeypatch):
    async def run():
        db = _DB(tables=[_table("table-a", "branch-a", number=4),
                         _table("table-b", "branch-a", number=5)])
        _wire(monkeypatch, db)
        group = await group_routes.create_group(
            TableGroupCreate(table_ids=["table-a", "table-b"], name="  Cumpleaños  ", anchor_table_id="table-b"),
            _user(),
        )
        assert group["name"] == "Cumpleaños"
        assert group["anchor_table_id"] == "table-b"
        assert db.table_groups.rows[0]["auto_name"] is False
    asyncio.run(run())


def test_join_refuses_tables_from_another_branch(monkeypatch):
    async def run():
        db = _DB(tables=[_table("table-a", "branch-a", number=1),
                         _table("table-b", "branch-b", number=2)])
        _wire(monkeypatch, db)
        with pytest.raises(HTTPException) as caught:
            await group_routes.create_group(TableGroupCreate(table_ids=["table-a", "table-b"]), _user("admin", None))
        assert caught.value.status_code == 400
        assert db.tables.writes == []
    asyncio.run(run())


def test_join_cannot_reach_another_branch_table(monkeypatch):
    async def run():
        db = _DB(tables=[_table("table-a", "branch-a", number=1),
                         _table("table-b", "branch-b", number=2)])
        _wire(monkeypatch, db)
        with pytest.raises(HTTPException) as caught:
            await group_routes.create_group(TableGroupCreate(table_ids=["table-a", "table-b"]), _user())
        assert caught.value.status_code == 404
        assert db.tables.writes == []
    asyncio.run(run())


def test_join_refuses_a_table_already_in_an_active_group(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1),
                    _table("table-b", "branch-a", number=2, status="ocupada", group_id="group-x",
                           group_joined_status="disponible")],
            table_groups=[_group("group-x", ("table-b", "table-c"))],
        )
        _wire(monkeypatch, db)
        with pytest.raises(HTTPException) as caught:
            await group_routes.create_group(TableGroupCreate(table_ids=["table-a", "table-b"]), _user())
        assert caught.value.status_code == 409
        assert "ya está unida" in caught.value.detail
        assert _row(db, "table-a").get("group_id") is None
    asyncio.run(run())


def test_join_refuses_a_reserved_table_and_a_visit_in_progress(monkeypatch):
    async def run():
        reserved = _DB(tables=[_table("table-a", "branch-a", number=1),
                               _table("table-b", "branch-a", number=2, status="reservada")])
        _wire(monkeypatch, reserved)
        with pytest.raises(HTTPException) as reserved_error:
            await group_routes.create_group(TableGroupCreate(table_ids=["table-a", "table-b"]), _user())
        assert reserved_error.value.status_code == 409
        assert "no está disponible" in reserved_error.value.detail

        opening = _DB(tables=[_table("table-a", "branch-a", number=1),
                              _table("table-b", "branch-a", number=2, status="ocupada",
                                     active_attention_id="attention-9")])
        _wire(monkeypatch, opening)
        with pytest.raises(HTTPException) as opening_error:
            await group_routes.create_group(TableGroupCreate(table_ids=["table-a", "table-b"]), _user())
        assert opening_error.value.status_code == 409
        assert "visita en curso" in opening_error.value.detail
        assert opening.tables.writes == []
    asyncio.run(run())


def test_join_releases_every_claimed_table_when_the_group_insert_fails(monkeypatch):
    async def run():
        db = _DB(tables=[_table("table-a", "branch-a", number=1, status="ocupada"),
                         _table("table-b", "branch-a", number=2, status="disponible")])
        _wire(monkeypatch, db)

        async def boom(row):
            raise RuntimeError("injected group insert failure")

        monkeypatch.setattr(db.table_groups, "insert_one", boom)
        with pytest.raises(RuntimeError):
            await group_routes.create_group(TableGroupCreate(table_ids=["table-a", "table-b"]), _user())
        assert [row.get("group_id") for row in db.tables.rows] == [None, None]
        assert [row["status"] for row in db.tables.rows] == ["ocupada", "disponible"]
        assert all("group_joined_status" not in row for row in db.tables.rows)
    asyncio.run(run())


def test_add_member_moves_the_anchor_to_the_table_that_owns_the_visit(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada", group_id="group-1",
                           group_joined_status="disponible"),
                    _table("table-b", "branch-a", number=2, status="ocupada", group_id="group-1",
                           group_joined_status="disponible"),
                    _table("table-c", "branch-a", number=3, status="ocupada", active_attention_id="attention-3")],
            orders=[_visit_order("order-3", "table-c", attention_id="attention-3")],
            table_groups=[_group("group-1", ("table-a", "table-b"))],
        )
        _wire(monkeypatch, db)
        group = await group_routes.add_table_to_group("group-1", TableGroupAddTable(table_id="table-c"), _user())
        assert group["table_ids"] == ["table-a", "table-b", "table-c"]
        assert group["anchor_table_id"] == "table-c"
        assert group["name"] == "Mesas 1 + 2 + 3"
        assert _row(db, "table-c")["group_id"] == "group-1"
        assert _row(db, "table-c").get("group_joined_status") is None
    asyncio.run(run())


def test_remove_member_dissolves_the_group_below_two_tables(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada", group_id="group-1",
                           group_joined_status="disponible"),
                    _table("table-b", "branch-a", number=2, status="ocupada", group_id="group-1",
                           group_joined_status="disponible"),
                    _table("table-c", "branch-a", number=3, status="ocupada", group_id="group-1",
                           group_joined_status="disponible")],
            table_groups=[_group("group-1", ("table-a", "table-b", "table-c"))],
        )
        _wire(monkeypatch, db)
        remaining = await group_routes.remove_table_from_group("group-1", "table-c", _user())
        assert remaining["table_ids"] == ["table-a", "table-b"]
        assert _row(db, "table-c").get("group_id") is None
        assert _row(db, "table-c")["status"] == "disponible"
        assert db.table_groups.rows[0]["status"] == "active"

        dissolved = await group_routes.remove_table_from_group("group-1", "table-b", _user())
        assert dissolved == {"ok": True, "dissolved": True, "group_id": "group-1"}
        assert db.table_groups.rows[0]["status"] == "dissolved"
        assert [row["status"] for row in db.tables.rows] == ["disponible", "disponible", "disponible"]
        assert all(row.get("group_id") is None for row in db.tables.rows)
        assert [entry["action"] for entry in db.audit_logs.rows] == ["split", "dissolve"]
    asyncio.run(run())


def test_dissolve_frees_only_the_members_the_group_had_blocked(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada", group_id="group-1",
                           group_joined_status="disponible"),
                    _table("table-b", "branch-a", number=2, status="ocupada", group_id="group-1",
                           active_attention_id="attention-2")],
            orders=[_visit_order("order-2", "table-b", attention_id="attention-2")],
            attentions=[_attention("table-b", "order-2", "attention-2")],
            table_groups=[_group("group-1", ("table-a", "table-b"))],
        )
        _wire(monkeypatch, db)
        result = await group_routes.dissolve_group("group-1", _user())
        assert result["dissolved"] is True
        assert _row(db, "table-a")["status"] == "disponible"
        assert _row(db, "table-b")["status"] == "ocupada"
        assert _row(db, "table-b")["active_attention_id"] == "attention-2"
        assert all(row.get("group_id") is None for row in db.tables.rows)
    asyncio.run(run())


def test_group_operations_stay_inside_the_tenant_and_the_branch(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada", group_id="group-1",
                           group_joined_status="disponible"),
                    _table("table-b", "branch-a", number=2, status="ocupada", group_id="group-1",
                           group_joined_status="disponible")],
            table_groups=[_group("group-1", ("table-a", "table-b")),
                          _group("group-foreign", ("table-x", "table-y"), restaurant_id="tenant-2"),
                          _group("group-other-branch", ("table-x", "table-y"), branch_id="branch-b")],
        )
        _wire(monkeypatch, db)
        with pytest.raises(HTTPException) as foreign:
            await group_routes.dissolve_group("group-foreign", _user())
        assert foreign.value.status_code == 404
        with pytest.raises(HTTPException) as other_branch:
            await group_routes.dissolve_group("group-other-branch", _user())
        assert other_branch.value.status_code == 404
        assert [row["status"] for row in db.tables.rows] == ["ocupada", "ocupada"]
        assert db.tables.writes == []
    asyncio.run(run())


def test_floor_listing_attaches_the_active_group(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada", active_attention_id="attention-1",
                           group_id="group-1"),
                    _table("table-b", "branch-a", number=2, status="ocupada", group_id="group-1"),
                    _table("table-c", "branch-a", number=3)],
            orders=[_visit_order("order-1", "table-a")],
            table_groups=[_group("group-1", ("table-a", "table-b"))],
        )
        _wire(monkeypatch, db)
        tables = await table_routes.list_tables(_user())
        listed = {table["id"]: table for table in tables}
        assert listed["table-a"]["group"] == {
            "id": "group-1", "name": "Mesas 1 + 2", "anchor_table_id": "table-a",
            "table_ids": ["table-a", "table-b"],
        }
        assert listed["table-b"]["group"]["table_ids"] == ["table-a", "table-b"]
        assert listed["table-c"]["group"] is None
        assert listed["table-c"]["group_id"] is None
    asyncio.run(run())


def test_a_dissolved_group_is_not_attached_and_does_not_block_a_new_join(monkeypatch):
    async def run():
        db = _DB(
            tables=[_table("table-a", "branch-a", number=1, status="ocupada", group_id="group-old",
                           group_joined_status="disponible"),
                    _table("table-b", "branch-a", number=2)],
            table_groups=[_group("group-old", ("table-a", "table-c"), status="dissolved")],
        )
        _wire(monkeypatch, db)
        group = await group_routes.create_group(TableGroupCreate(table_ids=["table-a", "table-b"]), _user())
        assert group["table_ids"] == ["table-a", "table-b"]
        assert _row(db, "table-a")["group_id"] == group["id"]
        # The stale marker gave the floor slot back before the new claim.
        assert _row(db, "table-a")["group_joined_status"] == "disponible"
    asyncio.run(run())


def test_delete_table_refuses_a_grouped_table(monkeypatch):
    async def run():
        db = _DB(tables=[_table("table-a", "branch-a", number=1, status="ocupada", group_id="group-1")])
        _wire(monkeypatch, db)
        with pytest.raises(HTTPException) as caught:
            await table_routes.delete_table("table-a", _user("admin", None))
        assert caught.value.status_code == 409
        assert len(db.tables.rows) == 1
    asyncio.run(run())
