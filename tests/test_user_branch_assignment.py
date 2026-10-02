"""Explicit user-to-branch assignment tests using isolated in-memory fakes."""
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

from models import UserCreate, UserUpdate
import routes.users as user_routes


class _Users:
    def __init__(self, rows=None):
        self.rows = copy.deepcopy(rows or [])
        self.queries = []
        self.writes = []

    async def find_one(self, query, projection=None):
        self.queries.append(copy.deepcopy(query))
        row = next((copy.deepcopy(row) for row in self.rows if all(row.get(key) == value for key, value in query.items())), None)
        if row is not None and projection:
            for field, include in projection.items():
                if include == 0:
                    row.pop(field, None)
        return row

    async def insert_one(self, row):
        self.writes.append(("insert", copy.deepcopy(row)))
        self.rows.append(copy.deepcopy(row))

    async def update_one(self, query, patch):
        self.writes.append(("update", copy.deepcopy(query), copy.deepcopy(patch)))
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                row.update(copy.deepcopy(patch.get("$set", {})))
                return type("Result", (), {"matched_count": 1, "modified_count": 1})()
        return type("Result", (), {"matched_count": 0, "modified_count": 0})()


class _Branches:
    def __init__(self, rows=None):
        self.rows = copy.deepcopy(rows or [])
        self.queries = []

    async def find_one(self, query, projection=None):
        self.queries.append(copy.deepcopy(query))
        return next((copy.deepcopy(row) for row in self.rows if all(row.get(key) == value for key, value in query.items())), None)


class _DB:
    def __init__(self, users=None, branches=None):
        self.users = _Users(users)
        self.branches = _Branches(branches)


def _admin(tenant="tenant-a"):
    return {"id": "admin-1", "restaurant_id": tenant, "role": "admin"}


def _branch(branch_id="branch-a", tenant="tenant-a"):
    return {"id": branch_id, "restaurant_id": tenant, "name": "Centro", "timezone": "America/Lima", "business_day_cutoff": "03:30"}


def _user(**changes):
    row = {
        "id": "user-1",
        "restaurant_id": "tenant-a",
        "email": "staff@example.com",
        "password_hash": "stored-hash",
        "full_name": "Staff Member",
        "role": "mozo",
        "phone": None,
        "status": "active",
        "functions": None,
        "created_at": "2026-10-01T10:00:00+00:00",
        "updated_at": "2026-10-01T10:00:00+00:00",
    }
    row.update(changes)
    return row


def _create(**changes):
    values = {"email": "new.staff@example.com", "password": "secret", "full_name": "New Staff", "role": "mozo"}
    values.update(changes)
    return UserCreate(**values)


def test_create_without_branch_preserves_legacy_unassigned_behavior(monkeypatch):
    db = _DB()
    monkeypatch.setattr(user_routes, "db", db)
    monkeypatch.setattr(user_routes, "hash_password", lambda password: "hashed:" + password)
    result = asyncio.run(user_routes.create_user(_create(), _admin()))
    assert "branch_id" not in result
    assert result["restaurant_id"] == "tenant-a"
    assert "password_hash" not in result
    assert db.users.rows[0]["password_hash"] == "hashed:secret"
    assert len(db.users.writes) == 1
    assert db.branches.queries == []


def test_create_with_owned_branch_stores_only_server_checked_branch_metadata(monkeypatch):
    db = _DB(branches=[_branch()])
    monkeypatch.setattr(user_routes, "db", db)
    monkeypatch.setattr(user_routes, "hash_password", lambda password: "hashed:" + password)
    result = asyncio.run(user_routes.create_user(_create(branch_id="branch-a", restaurant_id="tenant-b"), _admin("tenant-a")))
    assert result["branch_id"] == "branch-a"
    assert result["restaurant_id"] == "tenant-a"
    assert "password_hash" not in result
    assert db.users.rows[0]["password_hash"] == "hashed:secret"
    assert db.branches.queries == [{"id": "branch-a", "restaurant_id": "tenant-a"}]


@pytest.mark.parametrize("branch_id", ["missing", "branch-foreign"])
def test_create_rejects_missing_or_foreign_branch_without_user_write(monkeypatch, branch_id):
    foreign = _branch("branch-foreign", "tenant-b")
    db = _DB(branches=[foreign])
    monkeypatch.setattr(user_routes, "db", db)
    hashes = []
    monkeypatch.setattr(user_routes, "hash_password", lambda password: hashes.append(password) or "hashed")
    with pytest.raises(HTTPException) as error:
        asyncio.run(user_routes.create_user(_create(branch_id=branch_id), _admin()))
    assert error.value.status_code == 404
    assert db.users.writes == []
    assert hashes == []
    assert db.branches.queries == [{"id": branch_id, "restaurant_id": "tenant-a"}]


def test_user_branch_assignment_schemas_reject_blank_null_and_client_owner_fields():
    with pytest.raises(ValidationError):
        _create(branch_id="   ")
    with pytest.raises(ValidationError):
        UserUpdate(branch_id=None)
    with pytest.raises(ValidationError):
        UserUpdate(branch_id=" ")
    with pytest.raises(ValidationError):
        UserUpdate(branch_id=7)
    untrusted = _create(branch_id="branch-a", restaurant_id="tenant-b")
    assert "restaurant_id" not in untrusted.model_dump()


def test_omitted_branch_update_preserves_assignment_and_existing_user_fields(monkeypatch):
    assigned = _user(branch_id="branch-a")
    db = _DB(users=[assigned])
    monkeypatch.setattr(user_routes, "db", db)
    monkeypatch.setattr(user_routes, "hash_password", lambda password: "hashed:" + password)
    result = asyncio.run(user_routes.update_user("user-1", UserUpdate(full_name="Updated Name", password="new-secret"), _admin()))
    assert result["full_name"] == "Updated Name"
    assert result["branch_id"] == "branch-a"
    assert result["restaurant_id"] == "tenant-a"
    assert "password_hash" not in result
    assert db.users.rows[0]["password_hash"] == "hashed:new-secret"
    assert db.users.writes[0][1] == {"id": "user-1", "restaurant_id": "tenant-a"}
    assert all(query.get("restaurant_id") == "tenant-a" for query in db.users.queries)
    assert db.branches.queries == []


def test_explicit_valid_assignment_updates_only_metadata_on_tenant_owned_user(monkeypatch):
    db = _DB(users=[_user()], branches=[_branch()])
    monkeypatch.setattr(user_routes, "db", db)
    result = asyncio.run(user_routes.update_user("user-1", UserUpdate(branch_id="branch-a"), _admin()))
    repeated = asyncio.run(user_routes.update_user("user-1", UserUpdate(branch_id="branch-a"), _admin()))
    assert result["branch_id"] == repeated["branch_id"] == "branch-a"
    assert result["restaurant_id"] == "tenant-a"
    assert db.users.rows[0]["password_hash"] == "stored-hash"
    assert db.branches.queries == [{"id": "branch-a", "restaurant_id": "tenant-a"}] * 2
    assert len(db.users.writes) == 2
    assert len(db.branches.rows) == 1


@pytest.mark.parametrize("branch_id", ["missing", "branch-foreign"])
def test_update_rejects_unowned_branch_without_modifying_user(monkeypatch, branch_id):
    existing = _user(branch_id="branch-a")
    db = _DB(users=[existing], branches=[_branch("branch-foreign", "tenant-b")])
    monkeypatch.setattr(user_routes, "db", db)
    with pytest.raises(HTTPException) as error:
        asyncio.run(user_routes.update_user("user-1", UserUpdate(branch_id=branch_id), _admin()))
    assert error.value.status_code == 404
    assert db.users.rows == [existing]
    assert db.users.writes == []
    assert db.branches.queries == [{"id": branch_id, "restaurant_id": "tenant-a"}]


def test_wrong_tenant_user_target_is_not_disclosed_or_mutated(monkeypatch):
    foreign_user = _user(restaurant_id="tenant-b", branch_id="branch-foreign")
    db = _DB(users=[foreign_user], branches=[_branch("branch-a", "tenant-a")])
    monkeypatch.setattr(user_routes, "db", db)
    with pytest.raises(HTTPException) as error:
        asyncio.run(user_routes.update_user("user-1", UserUpdate(branch_id="branch-a"), _admin("tenant-a")))
    assert error.value.status_code == 404
    assert db.users.rows == [foreign_user]
    assert db.users.writes == []
    assert db.branches.queries == []
    assert db.users.queries[0] == {"id": "user-1", "restaurant_id": "tenant-a"}


def test_user_mutations_keep_existing_admin_function_authorization():
    from inspect import signature
    create_dep = signature(user_routes.create_user).parameters["user"].default.dependency
    update_dep = signature(user_routes.update_user).parameters["user"].default.dependency
    assert create_dep.__name__ == update_dep.__name__ == "_checker"

    async def checks():
        assert await create_dep(user=_admin()) == _admin()
        function_admin = {"id": "function-admin", "restaurant_id": "tenant-a", "role": "mozo", "functions": ["administracion"]}
        assert await update_dep(user=function_admin) == function_admin
        with pytest.raises(HTTPException) as error:
            await create_dep(user={"id": "waiter", "restaurant_id": "tenant-a", "role": "mozo", "functions": ["atencion"]})
        assert error.value.status_code == 403

    asyncio.run(checks())
