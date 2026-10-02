"""Tenant-scoped branch catalog tests using in-memory collections only."""
import asyncio
import copy
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "oc5_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from models import BranchCreate, BranchUpdate
import routes.branches as branch_routes


class _Result:
    def __init__(self, count):
        self.matched_count = count
        self.modified_count = count


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, key, direction=1):
        self.rows.sort(key=lambda row: row.get(key, ""), reverse=direction < 0)
        return self

    async def to_list(self, length):
        return copy.deepcopy(self.rows[:length])


class _Branches:
    def __init__(self, rows=None):
        self.rows = copy.deepcopy(rows or [])
        self.queries = []

    async def find_one(self, query, projection=None):
        self.queries.append(copy.deepcopy(query))
        return next((copy.deepcopy(row) for row in self.rows if all(row.get(k) == v for k, v in query.items())), None)

    def find(self, query, projection=None):
        self.queries.append(copy.deepcopy(query))
        return _Cursor([row for row in self.rows if all(row.get(k) == v for k, v in query.items())])

    async def insert_one(self, row):
        self.rows.append(copy.deepcopy(row))

    async def update_one(self, query, patch):
        self.queries.append(copy.deepcopy(query))
        for row in self.rows:
            if all(row.get(k) == v for k, v in query.items()):
                row.update(copy.deepcopy(patch.get("$set", {})))
                return _Result(1)
        return _Result(0)


class _DB:
    def __init__(self, rows=None):
        self.branches = _Branches(rows)


def _admin(restaurant_id="tenant-a"):
    return {"id": "admin-1", "restaurant_id": restaurant_id, "role": "admin"}


def _branch(**overrides):
    row = {
        "id": "branch-1",
        "restaurant_id": "tenant-a",
        "name": "Centro",
        "timezone": "America/Lima",
        "business_day_cutoff": "03:30",
        "created_at": "2026-10-01T10:00:00+00:00",
        "updated_at": "2026-10-01T10:00:00+00:00",
    }
    row.update(overrides)
    return row


def test_branch_create_requires_name_timezone_and_local_cutoff():
    data = BranchCreate(name=" Sur ", timezone="America/Lima", business_day_cutoff="03:30")
    assert data.model_dump() == {"name": "Sur", "timezone": "America/Lima", "business_day_cutoff": "03:30", "pickup_enabled": False}
    with pytest.raises(ValidationError):
        BranchCreate(name="Sur", timezone="America/Lima")
    with pytest.raises(ValidationError):
        BranchCreate(name="Sur", timezone="UTC", business_day_cutoff="+03:00")
    with pytest.raises(ValidationError):
        BranchCreate(name="Sur", timezone="+03:00", business_day_cutoff="03:30")
    with pytest.raises(ValidationError):
        BranchCreate(name="  ", timezone="America/Lima", business_day_cutoff="03:30")
    with pytest.raises(ValidationError):
        BranchCreate(name="Sur", timezone="Mars/Olympus", business_day_cutoff="03:30")
    with pytest.raises(ValidationError):
        BranchCreate(name="Sur", timezone="America/Lima", business_day_cutoff="24:00")
    with pytest.raises(ValidationError):
        BranchCreate(name="Sur", timezone="America/Lima", business_day_cutoff="03:30", restaurant_id="tenant-b")
    with pytest.raises(ValidationError):
        BranchCreate(name="Sur", timezone="America/Lima", business_day_cutoff="03:30", id="branch-client")
    with pytest.raises(ValidationError):
        BranchCreate(name="Sur", timezone="America/Lima", business_day_cutoff="03:30", unexpected=True)


def test_branch_partial_update_preserves_omitted_settings_and_rejects_null():
    update = BranchUpdate(name=" Norte ")
    assert update.model_dump(exclude_unset=True) == {"name": "Norte"}
    with pytest.raises(ValidationError):
        BranchUpdate(timezone=None)
    with pytest.raises(ValidationError):
        BranchUpdate(name="   ")
    with pytest.raises(ValidationError):
        BranchUpdate(restaurant_id="tenant-b")
    with pytest.raises(ValidationError):
        BranchUpdate(id="branch-client")


def test_list_returns_only_authenticated_tenant_branches(monkeypatch):
    db = _DB([_branch(), _branch(id="branch-2", name="Norte", restaurant_id="tenant-a"), _branch(id="other", restaurant_id="tenant-b")])
    monkeypatch.setattr(branch_routes, "db", db)
    result = asyncio.run(branch_routes.list_branches(_admin()))
    assert {row["id"] for row in result} == {"branch-1", "branch-2"}
    assert all(row["restaurant_id"] == "tenant-a" for row in result)
    assert db.branches.queries[-1] == {"restaurant_id": "tenant-a"}


def test_create_generates_immutable_identity_and_tenant_from_authenticated_user(monkeypatch):
    db = _DB()
    monkeypatch.setattr(branch_routes, "db", db)
    result = asyncio.run(branch_routes.create_branch(
        BranchCreate(name="Sur", timezone="America/Lima", business_day_cutoff="04:15"), _admin("tenant-a")
    ))
    assert result["restaurant_id"] == "tenant-a"
    assert result["id"] and result["id"] != "tenant-a"
    assert result["name"] == "Sur"
    assert result["timezone"] == "America/Lima"
    assert result["business_day_cutoff"] == "04:15"
    assert "_id" not in result
    assert db.branches.rows == [result]


def test_update_is_partial_tenant_scoped_and_keeps_identity_owner(monkeypatch):
    db = _DB([_branch(), _branch(id="foreign", restaurant_id="tenant-b")])
    monkeypatch.setattr(branch_routes, "db", db)
    result = asyncio.run(branch_routes.update_branch("branch-1", BranchUpdate(timezone="America/Bogota"), _admin()))
    assert result["timezone"] == "America/Bogota"
    assert result["business_day_cutoff"] == "03:30"
    assert result["id"] == "branch-1" and result["restaurant_id"] == "tenant-a"
    assert db.branches.queries[-2] == {"id": "branch-1", "restaurant_id": "tenant-a"}
    assert db.branches.queries[-1] == {"id": "branch-1", "restaurant_id": "tenant-a"}


def test_cross_tenant_update_is_not_found_and_does_not_mutate(monkeypatch):
    foreign = _branch(id="foreign", restaurant_id="tenant-b")
    db = _DB([foreign])
    monkeypatch.setattr(branch_routes, "db", db)
    with pytest.raises(HTTPException) as error:
        asyncio.run(branch_routes.update_branch("foreign", BranchUpdate(name="Hijacked"), _admin("tenant-a")))
    assert error.value.status_code == 404
    assert db.branches.rows == [foreign]
    assert db.branches.queries == [{"id": "foreign", "restaurant_id": "tenant-a"}]


def test_catalog_mutations_use_existing_admin_function_authorization():
    from inspect import signature
    create_dep = signature(branch_routes.create_branch).parameters["user"].default.dependency
    update_dep = signature(branch_routes.update_branch).parameters["user"].default.dependency
    assert create_dep.__name__ == update_dep.__name__ == "_checker"

    async def checks():
        assert await create_dep(user=_admin()) == _admin()
        function_admin = {"id": "function-admin", "restaurant_id": "tenant-a", "role": "mozo", "functions": ["administracion"]}
        assert await update_dep(user=function_admin) == function_admin
        with pytest.raises(HTTPException) as error:
            await create_dep(user={"id": "waiter", "restaurant_id": "tenant-a", "role": "mozo", "functions": ["atencion"]})
        assert error.value.status_code == 403

    asyncio.run(checks())


def test_distinct_branches_in_one_tenant_keep_independent_timezone_and_cutoff(monkeypatch):
    db = _DB()
    monkeypatch.setattr(branch_routes, "db", db)
    first = asyncio.run(branch_routes.create_branch(BranchCreate(name="Centro", timezone="America/Lima", business_day_cutoff="03:00"), _admin()))
    second = asyncio.run(branch_routes.create_branch(BranchCreate(name="Centro", timezone="America/Bogota", business_day_cutoff="04:30"), _admin()))
    assert first["id"] != second["id"]
    assert first["restaurant_id"] == second["restaurant_id"] == "tenant-a"
    assert (first["timezone"], first["business_day_cutoff"]) == ("America/Lima", "03:00")
    assert (second["timezone"], second["business_day_cutoff"]) == ("America/Bogota", "04:30")
    assert len(db.branches.rows) == 2


def test_empty_update_is_rejected_without_mutation(monkeypatch):
    row = _branch()
    db = _DB([row])
    monkeypatch.setattr(branch_routes, "db", db)
    with pytest.raises(HTTPException) as error:
        asyncio.run(branch_routes.update_branch("branch-1", BranchUpdate(), _admin()))
    assert error.value.status_code == 400
    assert db.branches.rows == [row]


def test_pickup_publication_is_disabled_by_default_and_updates_partially(monkeypatch):
    db = _DB()
    monkeypatch.setattr(branch_routes, "db", db)
    created = asyncio.run(branch_routes.create_branch(
        BranchCreate(name="Norte", timezone="America/Lima", business_day_cutoff="03:30"), _admin()
    ))
    assert created["pickup_enabled"] is False
    enabled = asyncio.run(branch_routes.update_branch(created["id"], BranchUpdate(pickup_enabled=True), _admin()))
    assert enabled["pickup_enabled"] is True
    assert enabled["timezone"] == "America/Lima" and enabled["business_day_cutoff"] == "03:30"
    with pytest.raises(ValidationError):
        BranchUpdate(pickup_enabled=None)
    with pytest.raises(ValidationError):
        BranchUpdate(pickup_enabled="true")
    with pytest.raises(ValidationError):
        BranchCreate(name="South", timezone="America/Lima", business_day_cutoff="03:00", pickup_enabled="true")
