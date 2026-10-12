"""Catalog and floor CRUD publish realtime events so open screens update live.

Products and categories publish `catalog` events; tables and zones publish
`tables` events. Table/zone events deliberately carry no `status`, so the voice
assistant (which announces `esperando_pago`) never mistakes a rename for a bill
request. Everything runs against in-memory fakes and the real event hub.
"""
import asyncio
import copy
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import routes.categories as category_routes  # noqa: E402
import routes.data as data_routes  # noqa: E402
import routes.products as product_routes  # noqa: E402
import routes.tables as table_routes  # noqa: E402
import routes.zones as zone_routes  # noqa: E402
from branch_isolation_fakes import _Collection, _Result, _matches  # noqa: E402
from models import (  # noqa: E402
    CategoryCreate, CategoryUpdate, ProductCreate, ProductImportRow, ProductsImport, ProductUpdate,
    TableCreate, TableUpdate, ZoneCreate, ZoneUpdate,
)
from notify import subscribe, unsubscribe  # noqa: E402

RID = "tenant-1"


class _Coll(_Collection):
    """The shared fake plus the delete/count operations the CRUD routes use."""

    async def delete_one(self, query):
        row = next((r for r in self.rows if _matches(r, query)), None)
        if row is None:
            return _Result(0, deleted=0)
        self.rows.remove(row)
        return _Result(1, deleted=1)

    async def delete_many(self, query):
        gone = [r for r in self.rows if _matches(r, query)]
        self.rows = [r for r in self.rows if r not in gone]
        return _Result(0, deleted=len(gone))

    async def update_many(self, query, update, **kwargs):
        rows = [r for r in self.rows if _matches(r, query)]
        for row in rows:
            row.update(copy.deepcopy(update.get("$set", {})))
        return _Result(len(rows))

    async def count_documents(self, query):
        return len([r for r in self.rows if _matches(r, query)])


class _DB:
    def __init__(self, **tables):
        names = ("products", "categories", "tables", "zones", "orders", "users", "audit_logs", "payments")
        for name in names:
            setattr(self, name, _Coll(tables.get(name, ())))
        self.branches = _Coll(tables.get("branches", [
            {"id": "branch-a", "restaurant_id": RID}, {"id": "branch-b", "restaurant_id": RID}]))

    def __getitem__(self, name):
        return getattr(self, name)


def _admin():
    return {"id": "admin-1", "restaurant_id": RID, "role": "admin", "full_name": "Admin"}


def _events(run):
    """Run the async scenario and return what it published on the real hub."""
    async def go():
        q = subscribe()
        try:
            await run()
            out = []
            while not q.empty():
                out.append(q.get_nowait())
            return out
        finally:
            unsubscribe(q)
    return asyncio.run(go())


def _bind(monkeypatch, db):
    for module in (product_routes, category_routes, table_routes, zone_routes, data_routes):
        monkeypatch.setattr(module, "db", db)


def _product(**extra):
    row = {"id": "p1", "restaurant_id": RID, "category_id": "c1", "name": "Lomo", "price": 10.0}
    row.update(extra)
    return row


# --- products -----------------------------------------------------------------

def test_creating_a_product_publishes_a_catalog_event(monkeypatch):
    _bind(monkeypatch, _DB())
    created = {}

    async def run():
        created.update(await product_routes.create_product(
            ProductCreate(category_id="c1", name="Lomo", price=10.0), _admin()))

    [event] = _events(run)
    assert (event["type"], event["topic"], event["topics"]) == ("product", "catalog", ["catalog"])
    assert event["restaurant_id"] == RID
    assert event["product_id"] == created["id"] and event["change"] == "created"


def test_updating_and_deleting_a_product_publish_catalog_events(monkeypatch):
    _bind(monkeypatch, _DB(products=[_product()]))

    async def run():
        await product_routes.update_product("p1", ProductUpdate(price=12.0), _admin())
        await product_routes.delete_product("p1", _admin())

    events = _events(run)
    assert [(e["type"], e["topics"], e["change"], e["product_id"]) for e in events] == [
        ("product", ["catalog"], "updated", "p1"),
        ("product", ["catalog"], "deleted", "p1"),
    ]


def test_a_missing_product_publishes_nothing(monkeypatch):
    _bind(monkeypatch, _DB())

    async def run():
        for call in (
            product_routes.update_product("nope", ProductUpdate(price=1.0), _admin()),
            product_routes.delete_product("nope", _admin()),
        ):
            with pytest.raises(HTTPException):
                await call

    assert _events(run) == []


def test_an_import_publishes_one_catalog_event_only_when_it_created_something(monkeypatch):
    _bind(monkeypatch, _DB())

    async def created():
        await product_routes.import_products(ProductsImport(items=[
            ProductImportRow(name="Ceviche", category="Entradas", price="25"),
            ProductImportRow(name="Chicha", category="Bebidas", price="8"),
        ]), _admin())

    [event] = _events(created)
    assert (event["type"], event["topics"], event["change"]) == ("product", ["catalog"], "imported")

    async def nothing():
        await product_routes.import_products(ProductsImport(items=[ProductImportRow(name="", price="1")]), _admin())

    assert _events(nothing) == []


# --- categories ---------------------------------------------------------------

def test_category_crud_publishes_catalog_events(monkeypatch):
    _bind(monkeypatch, _DB())
    made = {}

    async def run():
        made.update(await category_routes.create_category(CategoryCreate(name="Postres"), _admin()))
        await category_routes.update_category(made["id"], CategoryUpdate(name="Dulces"), _admin())
        await category_routes.delete_category(made["id"], _admin())

    events = _events(run)
    assert [(e["type"], e["topics"], e["change"]) for e in events] == [
        ("category", ["catalog"], "created"),
        ("category", ["catalog"], "updated"),
        ("category", ["catalog"], "deleted"),
    ]
    assert all(e["category_id"] == made["id"] for e in events)


def test_a_category_in_use_or_missing_publishes_nothing(monkeypatch):
    _bind(monkeypatch, _DB(products=[_product(category_id="c1")], categories=[{"id": "c1", "restaurant_id": RID}]))

    async def run():
        for call in (
            category_routes.delete_category("c1", _admin()),
            category_routes.update_category("nope", CategoryUpdate(name="x"), _admin()),
        ):
            with pytest.raises(HTTPException):
                await call

    assert _events(run) == []


# --- tables -------------------------------------------------------------------

def _floor():
    return _DB(
        zones=[{"id": "z1", "restaurant_id": RID, "name": "Salon", "branch_id": "branch-a"},
               {"id": "z2", "restaurant_id": RID, "name": "Salon", "branch_id": "branch-b"}],
        tables=[{"id": "t1", "restaurant_id": RID, "number": 1, "name": "Mesa 1", "area": "Salon",
                 "status": "disponible", "branch_id": "branch-a"}],
    )


def _assert_table_event(event, change, branch_id, table_id):
    assert (event["type"], event["topic"], event["topics"]) == ("table", "tables", ["tables"])
    assert event["change"] == change and event["table_id"] == table_id and event["branch_id"] == branch_id
    assert "status" not in event, "CRUD events must not look like a seat / bill status change"


def test_creating_a_table_publishes_a_tables_event_for_its_branch(monkeypatch):
    _bind(monkeypatch, _floor())
    created = {}

    async def run():
        created.update(await table_routes.create_table(
            TableCreate(number=2, area="Salon", branch_id="branch-a"), _admin()))

    [event] = _events(run)
    _assert_table_event(event, "created", "branch-a", created["id"])


def test_updating_a_table_publishes_a_tables_event(monkeypatch):
    _bind(monkeypatch, _floor())

    async def run():
        await table_routes.update_table("t1", TableUpdate(capacity=6), _admin())

    [event] = _events(run)
    _assert_table_event(event, "updated", "branch-a", "t1")


def test_moving_a_table_to_another_branch_notifies_both_branches(monkeypatch):
    _bind(monkeypatch, _floor())

    async def run():
        await table_routes.update_table("t1", TableUpdate(branch_id="branch-b", area="Salon"), _admin())

    events = _events(run)
    assert sorted(e["branch_id"] for e in events) == ["branch-a", "branch-b"]
    for event in events:
        _assert_table_event(event, "updated", event["branch_id"], "t1")


def test_deleting_a_table_publishes_a_tables_event_and_a_blocked_delete_publishes_nothing(monkeypatch):
    _bind(monkeypatch, _floor())

    async def run():
        await table_routes.delete_table("t1", _admin())
        with pytest.raises(HTTPException):
            await table_routes.delete_table("t1", _admin())

    [event] = _events(run)
    _assert_table_event(event, "deleted", "branch-a", "t1")


def test_rotating_and_revoking_the_qr_publish_tables_events(monkeypatch):
    _bind(monkeypatch, _floor())

    async def run():
        await table_routes.rotate_qr("t1", _admin())
        await table_routes.revoke_qr("t1", _admin())

    rotated, revoked = _events(run)
    _assert_table_event(rotated, "qr_rotated", "branch-a", "t1")
    _assert_table_event(revoked, "qr_revoked", "branch-a", "t1")


# --- zones --------------------------------------------------------------------

def test_zone_crud_publishes_tables_events(monkeypatch):
    _bind(monkeypatch, _floor())
    made = {}

    async def run():
        made.update(await zone_routes.create_zone(ZoneCreate(name="Terraza", branch_id="branch-a"), _admin()))
        await zone_routes.update_zone(made["id"], ZoneUpdate(sort_order=3), _admin())
        await zone_routes.delete_zone(made["id"], _admin())

    events = _events(run)
    assert [(e["type"], e["topic"], e["topics"], e["change"]) for e in events] == [
        ("zone", "tables", ["tables"], "created"),
        ("zone", "tables", ["tables"], "updated"),
        ("zone", "tables", ["tables"], "deleted"),
    ]
    assert all(e["zone_id"] == made["id"] and e["branch_id"] == "branch-a" for e in events)


def test_renaming_a_zone_renames_its_tables_and_announces_it(monkeypatch):
    _bind(monkeypatch, _floor())

    async def run():
        await zone_routes.update_zone("z1", ZoneUpdate(name="Patio"), _admin())

    [event] = _events(run)
    assert (event["type"], event["topics"], event["change"], event["zone_id"]) == ("zone", ["tables"], "updated", "z1")


def test_a_zone_in_use_cannot_be_deleted_and_publishes_nothing(monkeypatch):
    _bind(monkeypatch, _floor())

    async def run():
        with pytest.raises(HTTPException):
            await zone_routes.delete_zone("z1", _admin())

    assert _events(run) == []


# --- resets -------------------------------------------------------------------

def test_the_catalog_reset_publishes_catalog_events(monkeypatch):
    _bind(monkeypatch, _DB(products=[_product()], users=[{"id": "admin-1", "restaurant_id": RID, "password_hash": "x"}]))
    monkeypatch.setattr(data_routes, "verify_password", lambda *args: True)

    async def run():
        await data_routes.reset_catalog(data_routes.DataResetRequest(confirm="ELIMINAR", password="pw"), _admin())

    events = _events(run)
    assert events and all(e["topics"] == ["catalog"] and e["change"] == "reset" for e in events)
    assert {e["type"] for e in events} == {"product", "category"}


def test_the_operational_reset_makes_every_client_refresh_everything(monkeypatch):
    _bind(monkeypatch, _DB(users=[{"id": "admin-1", "restaurant_id": RID, "password_hash": "x"}]))
    monkeypatch.setattr(data_routes, "verify_password", lambda *args: True)
    for name in data_routes.OPERATIONAL_COLLECTIONS:
        setattr(data_routes.db, name, getattr(data_routes.db, name, _Coll()))

    async def run():
        await data_routes.reset_operational_data(
            data_routes.DataResetRequest(confirm="ELIMINAR", password="pw"), _admin())

    [event] = _events(run)
    assert event["type"] == "data_reset" and event["restaurant_id"] == RID
    assert "topic" not in event and "topics" not in event
