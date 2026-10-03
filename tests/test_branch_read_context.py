"""Fake-only tests for explicit branch-scoped read contexts."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from test_money_integrity import RID, _Collection, _DB, _order, _open_register
import routes.cash as cash_routes
import routes.orders as order_routes
import routes.payments as payment_routes
import routes.tables as table_routes


def _owner():
    return {"id": "owner-1", "restaurant_id": RID, "role": "admin"}


def _staff(branch_id="branch-1"):
    return {"id": "cashier-1", "restaurant_id": RID, "role": "cajero", "branch_id": branch_id}


def _db(monkeypatch):
    db = _DB()
    db.branches.docs.append({"id": "branch-2", "restaurant_id": RID})
    db.payments = _Collection()
    for module in (cash_routes, order_routes, payment_routes, table_routes):
        monkeypatch.setattr(module, "db", db)
    return db


def test_owner_order_list_can_select_registered_branch_before_limit(monkeypatch):
    async def run():
        db = _db(monkeypatch)
        db.orders.docs.extend([
            {**_order(), "id": "newer-branch-2", "branch_id": "branch-2", "created_at": "z"},
            {**_order(), "id": "branch-1-order", "branch_id": "branch-1", "created_at": "a"},
        ])
        result = await order_routes.list_orders(user=_owner(), branch_id="branch-1", limit=1)
        assert [item["id"] for item in result] == ["branch-1-order"]
        assert len(db.orders.docs) == 2
    asyncio.run(run())


def test_owner_order_list_can_read_branchless_legacy_only_explicitly(monkeypatch):
    async def run():
        db = _db(monkeypatch)
        db.orders.docs.extend([
            {**_order(), "id": "branch-1-order", "branch_id": "branch-1"},
            {key: value for key, value in _order().items() if key != "branch_id"},
            {**_order(), "id": "null-branch-order", "branch_id": None},
        ])
        assert {row["id"] for row in await order_routes.list_orders(user=_owner(), legacy_only=True)} == {"order-1", "null-branch-order"}
        with pytest.raises(HTTPException) as denied:
            await order_routes.list_orders(user=_staff(), legacy_only=True)
        assert denied.value.status_code == 403
    asyncio.run(run())


def test_owner_payment_list_can_select_branch_and_staff_cannot_spoof_or_read_legacy(monkeypatch):
    async def run():
        db = _db(monkeypatch)
        db.payments.docs.extend([
            {"id": "newer-b", "restaurant_id": RID, "branch_id": "branch-2", "created_at": "z"},
            {"id": "a", "restaurant_id": RID, "branch_id": "branch-1", "created_at": "a"},
            {"id": "legacy", "restaurant_id": RID, "created_at": "0"},
            {"id": "foreign-tenant", "restaurant_id": "other", "branch_id": "branch-1"},
        ])
        assert [p["id"] for p in await payment_routes.list_payments(user=_owner(), branch_id="branch-1", period=None, limit=1)] == ["a"]
        legacy_result = await payment_routes.list_payments(user=_owner(), period=None, legacy_only=True)
        assert {p["id"] for p in legacy_result} == {"legacy"}
        assert {p["id"] for p in await payment_routes.list_payments(user=_owner(), period=None)} == {"newer-b", "a", "legacy"}
        with pytest.raises(HTTPException) as mismatch:
            await payment_routes.list_payments(user=_staff(), branch_id="branch-2")
        assert mismatch.value.status_code == 403
        with pytest.raises(HTTPException) as legacy:
            await payment_routes.list_payments(user=_staff(), legacy_only=True)
        assert legacy.value.status_code == 403
        assert len(db.payments.docs) == 4
    asyncio.run(run())


def test_owner_table_list_can_select_branch_and_scopes_active_order_join(monkeypatch):
    async def run():
        db = _db(monkeypatch)
        db.tables.docs.extend([
            {"id": "table-b", "restaurant_id": RID, "branch_id": "branch-2", "number": 1, "status": "ocupada"},
            {"id": "table-a", "restaurant_id": RID, "branch_id": "branch-1", "number": 2, "status": "ocupada"},
        ])
        db.orders.docs.extend([
            {**_order(), "id": "order-b", "table_id": "table-b", "branch_id": "branch-2"},
            {**_order(), "id": "order-a", "table_id": "table-a", "branch_id": "branch-1"},
        ])
        result = await table_routes.list_tables(user=_owner(), branch_id="branch-1")
        assert [row["id"] for row in result] == ["table-a"]
        assert result[0]["active_order"]["id"] == "order-a"
        assert len(db.tables.docs) == len(db.orders.docs) == 2
    asyncio.run(run())


def test_owner_can_read_missing_or_null_branch_cash_registers_explicitly(monkeypatch):
    async def run():
        db = _db(monkeypatch)
        db.cash_registers.docs.extend([
            {**_open_register("reg-a"), "branch_id": "branch-1"},
            {**_open_register("reg-legacy-null"), "branch_id": None, "status": "closed"},
            {key: value for key, value in {**_open_register("reg-legacy-missing"), "status": "closed"}.items() if key != "branch_id"},
        ])
        assert {r["id"] for r in await cash_routes.list_registers(user=_owner(), branch_id=None, legacy_only=True)} == {"reg-legacy-null", "reg-legacy-missing"}
        assert {r["id"] for r in await cash_routes.list_registers(user=_owner(), branch_id="branch-1")} == {"reg-a"}
        monkeypatch.setattr(cash_routes, "_period_start", lambda period, restaurant_id: asyncio.sleep(0, result="0"))
        history = await cash_routes.cash_history(user=_owner(), period="day", branch_id=None, legacy_only=True)
        assert {r["id"] for r in history["registers"]} == {"reg-legacy-null", "reg-legacy-missing"}
        db.cash_registers.docs[0]["status"] = "open"
        db.cash_registers.docs[1]["status"] = "open"
        assert (await cash_routes.current_register(user=_owner(), branch_id=None, legacy_only=True))["id"] == "reg-legacy-null"
        assert len(db.cash_registers.docs) == 3
    asyncio.run(run())


@pytest.mark.parametrize("params, status_code", [
    ({"branch_id": " "}, 400),
    ({"branch_id": "branch-1", "legacy_only": True}, 400),
    ({"branch_id": "foreign"}, 404),
])
def test_owner_invalid_branch_read_filters_fail_closed(monkeypatch, params, status_code):
    async def run():
        _db(monkeypatch)
        with pytest.raises(HTTPException) as error:
            await order_routes.list_orders(user=_owner(), **params)
        assert error.value.status_code == status_code
    asyncio.run(run())
