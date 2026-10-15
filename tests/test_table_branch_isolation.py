"""Table, zone, and staff-event branch-isolation regression tests."""
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
import routes.tables as table_routes
import routes.zones as zone_routes
import routes.notifications as notification_routes
from models import TableCreate, TableUpdate, ZoneUpdate
from branch_isolation_fakes import _DB, _Result, _matches, _order, _table, _user


def test_table_lists_and_guest_link_do_not_disclose_or_mutate_foreign_branch(monkeypatch):
    async def run():
        db = _DB(tables=[_table("table-a", "branch-a", qr_nonce="nonce-a"),
                         _table("table-b", "branch-b")],
                 zones=[{"id": "zone-a", "restaurant_id": "tenant-1", "name": "A", "branch_id": "branch-a"},
                        {"id": "zone-b", "restaurant_id": "tenant-1", "name": "B", "branch_id": "branch-b"}])
        monkeypatch.setattr(table_routes, "db", db)
        monkeypatch.setattr(zone_routes, "db", db)
        visible = await table_routes.list_tables(_user())
        assert [row["id"] for row in visible] == ["table-a"]
        visible_zones = await zone_routes.list_zones(_user())
        assert [row["id"] for row in visible_zones] == ["zone-a"]
        with pytest.raises(HTTPException) as caught:
            await table_routes.guest_link("table-b", _user())
        assert caught.value.status_code == 404
        assert db.tables.writes == []
    asyncio.run(run())


def test_admin_table_qr_revoke_keeps_tenant_predicate(monkeypatch):
    async def run():
        db = _DB(tables=[_table("foreign-table", "branch-b", restaurant_id="tenant-2")])
        monkeypatch.setattr(table_routes, "db", db)
        with pytest.raises(HTTPException) as caught:
            await table_routes.revoke_qr("foreign-table", _user("admin", None))
        assert caught.value.status_code == 404
        assert db.tables.rows[0].get("qr_revoked") is None
    asyncio.run(run())


def test_legacy_branchless_records_are_owner_only(monkeypatch):
    async def run():
        db = _DB(orders=[_order("legacy", None)], tables=[_table("table-legacy", None)])
        monkeypatch.setattr(order_routes, "db", db)
        monkeypatch.setattr(table_routes, "db", db)
        with pytest.raises(HTTPException) as order_denied:
            await order_routes.get_order("legacy", _user())
        with pytest.raises(HTTPException) as table_denied:
            await table_routes.guest_link("table-legacy", _user())
        assert order_denied.value.status_code == table_denied.value.status_code == 404
        assert (await order_routes.get_order("legacy", _user("admin", None)))["id"] == "legacy"
        assert [row["id"] for row in await table_routes.list_tables(_user("admin", None))] == ["table-legacy"]
        assert table_denied.value.status_code == 404
    asyncio.run(run())


def test_zone_branch_change_is_atomic_and_refuses_occupied_tables(monkeypatch):
    async def run():
        zone = {"id": "zone-1", "restaurant_id": "tenant-1", "name": "Patio", "branch_id": "branch-a"}
        db = _DB(zones=[zone], branches=[{"id": "branch-b", "restaurant_id": "tenant-1"}],
                 tables=[_table("busy", "branch-a", area="Patio", status="ocupada")])
        monkeypatch.setattr(zone_routes, "db", db)
        with pytest.raises(HTTPException) as caught:
            await zone_routes.update_zone("zone-1", ZoneUpdate(branch_id="branch-b"), _user("admin", None))
        assert caught.value.status_code == 409
        assert db.zones.rows[0]["branch_id"] == "branch-a"
        assert db.tables.rows[0]["branch_id"] == "branch-a"
        assert db.zones.writes == []
        assert db.tables.writes == []
    asyncio.run(run())


def test_zone_branch_propagation_moves_only_tables_inheriting_old_branch(monkeypatch):
    async def run():
        zone = {"id": "zone-1", "restaurant_id": "tenant-1", "name": "Patio", "branch_id": "branch-a"}
        inherited = _table("inherited", "branch-a", area="Patio")
        explicit = _table("explicit", "branch-b", area="Patio")
        db = _DB(zones=[zone], branches=[{"id": "branch-a", "restaurant_id": "tenant-1"},
                                         {"id": "branch-b", "restaurant_id": "tenant-1"}],
                 tables=[inherited, explicit])
        monkeypatch.setattr(zone_routes, "db", db)
        await zone_routes.update_zone("zone-1", ZoneUpdate(branch_id="branch-b"), _user("admin", None))
        assert next(row for row in db.tables.rows if row["id"] == "inherited")["branch_id"] == "branch-b"
        assert next(row for row in db.tables.rows if row["id"] == "explicit")["branch_id"] == "branch-b"
    asyncio.run(run())


def test_zone_first_branch_assignment_reaches_its_branchless_tables(monkeypatch):
    """Asignar la primera sucursal de una zona debe alcanzar a sus mesas.

    Es el camino que dejaba mesas invisibles: Local → Mesas mostraba "Hereda:
    Centro" y el mozo de Centro no veía ninguna, porque el `branch_id` guardado
    en la mesa seguía vacío y todo el filtrado por sucursal lee ese campo.
    """
    async def run():
        zone = {"id": "zone-1", "restaurant_id": "tenant-1", "name": "Salón"}
        inherited = _table("t1", None, area="Salón", number=1)
        override = _table("t2", "branch-b", area="Salón", number=2)
        db = _DB(branches=[{"id": "branch-a", "restaurant_id": "tenant-1"},
                           {"id": "branch-b", "restaurant_id": "tenant-1"}],
                 zones=[zone], tables=[inherited, override])
        monkeypatch.setattr(zone_routes, "db", db)
        monkeypatch.setattr(table_routes, "db", db)
        await zone_routes.update_zone("zone-1", ZoneUpdate(branch_id="branch-a"), _user("admin", None))
        assert next(row for row in db.tables.rows if row["id"] == "t1")["branch_id"] == "branch-a"
        # Una mesa con sucursal propia no se mueve con la zona.
        assert next(row for row in db.tables.rows if row["id"] == "t2")["branch_id"] == "branch-b"
        visible = await table_routes.list_tables(_user("mozo", "branch-a"))
        assert [row["id"] for row in visible] == ["t1"]
    asyncio.run(run())


def test_zone_first_branch_assignment_refuses_occupied_tables(monkeypatch):
    async def run():
        zone = {"id": "zone-1", "restaurant_id": "tenant-1", "name": "Salón"}
        db = _DB(branches=[{"id": "branch-a", "restaurant_id": "tenant-1"}], zones=[zone],
                 tables=[_table("busy", None, area="Salón", status="ocupada")])
        monkeypatch.setattr(zone_routes, "db", db)
        with pytest.raises(HTTPException) as caught:
            await zone_routes.update_zone("zone-1", ZoneUpdate(branch_id="branch-a"), _user("admin", None))
        assert caught.value.status_code == 409
        assert "branch_id" not in db.zones.rows[0]
        assert db.tables.writes == []
    asyncio.run(run())


def test_table_create_inherits_the_only_zone_branch_without_asking(monkeypatch):
    """La mesa nueva hereda la sucursal de su zona; antes era un 400 sin salida."""
    async def run():
        db = _DB(branches=[{"id": "branch-a", "restaurant_id": "tenant-1"}],
                 zones=[{"id": "zone-a", "restaurant_id": "tenant-1", "name": "Salón",
                         "branch_id": "branch-a"}])
        monkeypatch.setattr(table_routes, "db", db)
        created = await table_routes.create_table(TableCreate(number=1, area="Salón"), _user("admin", None))
        assert created["branch_id"] == "branch-a"
    asyncio.run(run())


def test_table_create_never_inherits_another_branch_zone_with_the_same_name(monkeypatch):
    """Dos sucursales con su propio "Salón": no se adivina, se pide la sucursal."""
    async def run():
        db = _DB(branches=[{"id": "branch-a", "restaurant_id": "tenant-1"},
                           {"id": "branch-b", "restaurant_id": "tenant-1"}],
                 zones=[{"id": "zone-a", "restaurant_id": "tenant-1", "name": "Salón",
                         "branch_id": "branch-a"},
                        {"id": "zone-b", "restaurant_id": "tenant-1", "name": "Salón",
                         "branch_id": "branch-b"}])
        monkeypatch.setattr(table_routes, "db", db)
        with pytest.raises(HTTPException) as ambiguous:
            await table_routes.create_table(TableCreate(number=1, area="Salón"), _user("admin", None))
        assert ambiguous.value.status_code == 400
        created = await table_routes.create_table(
            TableCreate(number=1, area="Salón", branch_id="branch-b"), _user("admin", None))
        assert created["branch_id"] == "branch-b"
    asyncio.run(run())


def test_table_zone_change_moves_a_branchless_table_to_the_zones_branch(monkeypatch):
    async def run():
        db = _DB(branches=[{"id": "branch-a", "restaurant_id": "tenant-1"}],
                 zones=[{"id": "zone-a", "restaurant_id": "tenant-1", "name": "Terraza",
                         "branch_id": "branch-a"}],
                 tables=[_table("t1", None, area="Salón", number=1)])
        monkeypatch.setattr(table_routes, "db", db)
        result = await table_routes.update_table("t1", TableUpdate(area="Terraza"), _user("admin", None))
        assert result["area"] == "Terraza"
        assert result["branch_id"] == "branch-a"
    asyncio.run(run())


def test_staff_notification_stream_skips_other_branch_events(monkeypatch):
    async def run():
        queue = asyncio.Queue()
        await queue.put({"type": "order", "restaurant_id": "tenant-1", "order_id": "b", "branch_id": "branch-b"})
        await queue.put({"type": "order", "restaurant_id": "tenant-1", "order_id": "a", "branch_id": "branch-a"})
        db = _DB()
        db.users.rows.append({**_user(), "status": "active"})
        monkeypatch.setattr(notification_routes, "db", db)
        monkeypatch.setattr(notification_routes, "subscribe", lambda: queue)
        monkeypatch.setattr(notification_routes, "unsubscribe", lambda current: None)
        response = await notification_routes.notification_stream(_user())
        iterator = response.body_iterator
        assert "hello" in await iterator.__anext__()
        own_event = await iterator.__anext__()
        assert '"order_id": "a"' in own_event
        await iterator.aclose()
    asyncio.run(run())


def test_notification_stream_uses_fresh_branch_after_staff_reassignment(monkeypatch):
    async def run():
        queue = asyncio.Queue()
        await queue.put({"type": "order", "restaurant_id": "tenant-1", "order_id": "old", "branch_id": "branch-a"})
        await queue.put({"type": "order", "restaurant_id": "tenant-1", "order_id": "new", "branch_id": "branch-b"})
        db = _DB()
        db.users.rows.append({**_user("mozo", "branch-b"), "status": "active"})
        monkeypatch.setattr(notification_routes, "db", db)
        monkeypatch.setattr(notification_routes, "subscribe", lambda: queue)
        monkeypatch.setattr(notification_routes, "unsubscribe", lambda current: None)
        response = await notification_routes.notification_stream(_user("mozo", "branch-a"))
        iterator = response.body_iterator
        await iterator.__anext__()
        current_event = await iterator.__anext__()
        assert '"order_id": "new"' in current_event
        await iterator.aclose()
    asyncio.run(run())



def test_notification_stream_drops_events_without_a_tenant(monkeypatch):
    """El filtro exigía el tenant solo si venía: un evento sin dueño pasaba.

    `if rid and rid != user[...]` dejaba pasar cualquier evento sin
    `restaurant_id`, así que un emisor que lo omitiera mandaría el evento a todos
    los restaurantes conectados. Hoy los 79 emisores lo ponen, así que esto es
    defensa en profundidad: se exige el tenant y lo que no lo trae se descarta.
    """
    async def run():
        queue = asyncio.Queue()
        await queue.put({"type": "order", "order_id": "sin-tenant", "branch_id": "branch-a"})
        await queue.put({"type": "order", "restaurant_id": "tenant-1", "order_id": "con-tenant", "branch_id": "branch-a"})
        db = _DB()
        db.users.rows.append({**_user(), "status": "active"})
        monkeypatch.setattr(notification_routes, "db", db)
        monkeypatch.setattr(notification_routes, "subscribe", lambda: queue)
        monkeypatch.setattr(notification_routes, "unsubscribe", lambda current: None)
        response = await notification_routes.notification_stream(_user())
        iterator = response.body_iterator
        await iterator.__anext__()          # hello
        first_payload = await iterator.__anext__()
        await iterator.aclose()
        return first_payload

    payload = asyncio.run(run())
    assert "sin-tenant" not in payload, (
        "an event with no restaurant_id must be dropped, not broadcast to every tenant"
    )
    assert "con-tenant" in payload


def test_zone_branch_rollback_preserves_unrelated_target_branch_table(monkeypatch):
    async def run():
        zone = {"id": "zone-1", "restaurant_id": "tenant-1", "name": "Patio", "branch_id": "branch-a"}
        inherited_one = _table("inherited-one", "branch-a", area="Patio")
        inherited_two = _table("inherited-two", "branch-a", area="Patio")
        explicit_target = _table("explicit-target", "branch-b", area="Patio")
        db = _DB(zones=[zone], branches=[{"id": "branch-a", "restaurant_id": "tenant-1"},
                                         {"id": "branch-b", "restaurant_id": "tenant-1"}],
                 tables=[inherited_one, inherited_two, explicit_target])
        monkeypatch.setattr(zone_routes, "db", db)
        original_update_many = db.tables.update_many
        calls = 0

        async def partial_propagation(query, update, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                row = next(row for row in db.tables.rows if _matches(row, query))
                row.update(update.get("$set", {}))
                return _Result(1)
            return await original_update_many(query, update, **kwargs)

        monkeypatch.setattr(db.tables, "update_many", partial_propagation)
        with pytest.raises(HTTPException) as caught:
            await zone_routes.update_zone("zone-1", ZoneUpdate(branch_id="branch-b"), _user("admin", None))
        assert caught.value.status_code == 409
        assert db.zones.rows[0]["branch_id"] == "branch-a"
        assert {row["id"]: row["branch_id"] for row in db.tables.rows} == {
            "inherited-one": "branch-a", "inherited-two": "branch-a", "explicit-target": "branch-b"
        }
    asyncio.run(run())


def test_invalid_staff_branch_is_rejected_before_notification_subscription(monkeypatch):
    async def run():
        db = _DB()
        monkeypatch.setattr(notification_routes, "db", db)
        subscriptions = []
        monkeypatch.setattr(notification_routes, "subscribe", lambda: subscriptions.append(asyncio.Queue()))
        monkeypatch.setattr(notification_routes, "unsubscribe", lambda current: None)
        with pytest.raises(HTTPException) as caught:
            await notification_routes.notification_stream(_user("mozo", None))
        assert caught.value.status_code == 403
        assert subscriptions == []
    asyncio.run(run())
