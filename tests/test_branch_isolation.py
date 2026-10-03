"""Order authorization and branch-bound creation regression tests."""
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

import routes.orders as order_routes
from models import KitchenBump, OrderCreate, OrderStatusUpdate
from branch_isolation_fakes import (
    _DB, _order, _table, _user,
)


def test_branch_policy_scopes_staff_and_keeps_owner_tenantwide():
    async def run():
        from branch_access import record_branch_filter, assert_record_branch_access
        assert record_branch_filter(_user()) == {"branch_id": "branch-a"}
        assert record_branch_filter(_user("admin", None)) == {}
        assert_record_branch_access(_order("own", "branch-a"), _user())
        with pytest.raises(HTTPException) as foreign:
            assert_record_branch_access(_order("other", "branch-b"), _user())
        assert foreign.value.status_code == 404
        with pytest.raises(HTTPException) as legacy:
            assert_record_branch_access(_order("legacy", None), _user())
        assert legacy.value.status_code == 404
        assert_record_branch_access(_order("legacy", None), _user("admin", None))
    asyncio.run(run())


def test_order_lists_and_kitchen_board_filter_by_assigned_branch(monkeypatch):
    async def run():
        db = _DB(orders=[_order("a", "branch-a"), _order("b", "branch-b")])
        monkeypatch.setattr(order_routes, "db", db)
        staff_rows = await order_routes.list_orders(user=_user())
        staff_board = await order_routes.kitchen_orders(user=_user("cocina"))
        owner_rows = await order_routes.list_orders(user=_user("admin", None))
        assert [row["id"] for row in staff_rows] == ["a"]
        assert [row["id"] for row in staff_board] == ["a"]
        assert {row["id"] for row in owner_rows} == {"a", "b"}
    asyncio.run(run())


def test_order_detail_and_mutating_lookup_hide_foreign_branch(monkeypatch):
    async def run():
        db = _DB(orders=[_order("order-b", "branch-b")])
        monkeypatch.setattr(order_routes, "db", db)
        with pytest.raises(HTTPException) as caught:
            await order_routes.get_order("order-b", _user())
        assert caught.value.status_code == 404
    asyncio.run(run())


def test_staff_kitchen_mutation_hides_foreign_branch_without_write(monkeypatch):
    async def run():
        db = _DB(orders=[_order("order-b", "branch-b", status="enviado_cocina")])
        monkeypatch.setattr(order_routes, "db", db)
        with pytest.raises(HTTPException) as caught:
            await order_routes.bump_kitchen("order-b", KitchenBump(from_status="pendiente"), _user("cocina"))
        assert caught.value.status_code == 404
        assert db.orders.writes == []
    asyncio.run(run())


def test_staff_table_order_cannot_spoof_branch_from_request(monkeypatch):
    async def run():
        db = _DB(tables=[_table("table-b", "branch-b")])
        monkeypatch.setattr(order_routes, "db", db)
        request = OrderCreate(table_id="table-b", order_type="mesa")
        with pytest.raises(HTTPException) as caught:
            await order_routes.create_order(request, _user("mozo", "branch-a"))
        assert caught.value.status_code == 404
        assert db.orders.writes == []
        assert db.tables.writes == []
    asyncio.run(run())


def test_staff_with_missing_branch_assignment_fails_closed(monkeypatch):
    async def run():
        db = _DB(orders=[_order("a", "branch-a")])
        monkeypatch.setattr(order_routes, "db", db)
        with pytest.raises(HTTPException) as caught:
            await order_routes.list_orders(user=_user("mozo", None))
        assert caught.value.status_code == 403
        assert db.orders.reads == []
    asyncio.run(run())


def test_staff_assignment_to_unregistered_branch_fails_closed(monkeypatch):
    async def run():
        db = _DB(orders=[_order("a", "branch-a")])
        db.branches.rows = []
        monkeypatch.setattr(order_routes, "db", db)
        with pytest.raises(HTTPException) as caught:
            await order_routes.list_orders(user=_user())
        assert caught.value.status_code == 403
        assert db.orders.reads == []
    asyncio.run(run())


def _prepare_standalone_order(monkeypatch, db):
    async def compute_total(items, restaurant_id):
        return [], 0.0
    async def next_order_number(restaurant_id):
        return 1
    async def audit(*args, **kwargs):
        return None
    async def response(order_id, user):
        return next((row for row in db.orders.rows if row["id"] == order_id), None)
    monkeypatch.setattr(order_routes, "db", db)
    monkeypatch.setattr(order_routes, "_compute_total", compute_total)
    monkeypatch.setattr(order_routes, "_next_order_number", next_order_number)
    monkeypatch.setattr(order_routes, "_audit", audit)
    monkeypatch.setattr(order_routes, "_current_order_response", response)
    monkeypatch.setattr(order_routes, "emit_order", lambda *args, **kwargs: None)


def test_admin_standalone_order_requires_explicit_registered_branch(monkeypatch):
    async def run():
        db = _DB()
        _prepare_standalone_order(monkeypatch, db)
        user = {**_user("admin", None), "full_name": "Owner"}
        with pytest.raises(HTTPException) as caught:
            await order_routes.create_order(OrderCreate(order_type="recojo"), user)
        assert caught.value.status_code == 400
        assert db.orders.rows == []
        assert db.orders.writes == []
    asyncio.run(run())


def test_admin_standalone_order_rejects_foreign_branch_before_write(monkeypatch):
    async def run():
        db = _DB(branches=[{"id": "branch-a", "restaurant_id": "tenant-1"},
                           {"id": "foreign", "restaurant_id": "tenant-2"}])
        _prepare_standalone_order(monkeypatch, db)
        user = {**_user("admin", None), "full_name": "Owner"}
        with pytest.raises(HTTPException) as caught:
            await order_routes.create_order(OrderCreate(order_type="recojo", branch_id="foreign"), user)
        assert caught.value.status_code == 400
        assert db.orders.rows == []
        assert db.orders.writes == []
    asyncio.run(run())


def test_admin_standalone_order_persists_selected_tenant_branch(monkeypatch):
    async def run():
        db = _DB()
        _prepare_standalone_order(monkeypatch, db)
        user = {**_user("admin", None), "full_name": "Owner"}
        created = await order_routes.create_order(
            OrderCreate(order_type="recojo", branch_id="branch-b"), user
        )
        assert created["branch_id"] == "branch-b"
        assert db.orders.rows[0]["branch_id"] == "branch-b"
    asyncio.run(run())


def test_staff_standalone_order_cannot_override_assigned_branch(monkeypatch):
    async def run():
        db = _DB()
        _prepare_standalone_order(monkeypatch, db)
        user = {**_user("mozo", "branch-a"), "full_name": "Waiter"}
        with pytest.raises(HTTPException) as caught:
            await order_routes.create_order(
                OrderCreate(order_type="recojo", branch_id="branch-b"), user
            )
        assert caught.value.status_code == 403
        assert db.orders.rows == []
        assert db.orders.writes == []
    asyncio.run(run())


@pytest.mark.parametrize("table_tenant,table_branch", [("tenant-2", "branch-a"), ("tenant-1", "branch-b")])
def test_payment_request_does_not_mutate_foreign_table(monkeypatch, table_tenant, table_branch):
    async def run():
        own_order = _order("order-a", "branch-a", table_id="table-1", status="entregado",
                           fulfillment_status="entregado", total=12.0)
        foreign_table = _table("table-1", table_branch, restaurant_id=table_tenant)
        db = _DB(orders=[own_order], tables=[foreign_table])
        monkeypatch.setattr(order_routes, "db", db)
        async def save_order(order, update):
            order.update(update)
            return order
        async def audit(*args, **kwargs):
            return None
        async def response(order_id, user):
            return {"id": order_id, "status": "pendiente_pago"}
        monkeypatch.setattr(order_routes, "_save_order", save_order)
        monkeypatch.setattr(order_routes, "_audit", audit)
        monkeypatch.setattr(order_routes, "_current_order_response", response)
        monkeypatch.setattr(order_routes, "_release_paid_table", lambda *args: asyncio.sleep(0))
        monkeypatch.setattr(order_routes, "emit_notice", lambda *args, **kwargs: None)
        monkeypatch.setattr(order_routes, "emit_order", lambda *args, **kwargs: None)
        await order_routes.change_status(
            "order-a", OrderStatusUpdate(status="pendiente_pago"), _user("mozo")
        )
        assert foreign_table["status"] == "disponible"
        assert db.tables.writes[0][0] == {
            "id": "table-1", "restaurant_id": "tenant-1", "branch_id": "branch-a"
        }
    asyncio.run(run())
