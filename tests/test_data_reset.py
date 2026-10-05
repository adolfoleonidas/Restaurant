"""Fake-only regressions for the operational data reset endpoint (POST /data/reset)."""
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

from auth import hash_password  # noqa: E402
import routes.data as data_routes  # noqa: E402
from routes.data import DataResetRequest  # noqa: E402

RID = "tenant-1"
ADMIN_ID = "admin-1"
ADMIN_PASSWORD = "admin123"


class _Result:
    def __init__(self, n=0):
        self.matched_count = n
        self.modified_count = n
        self.deleted_count = n


def _match(doc, filt):
    for key, expected in (filt or {}).items():
        if key == "$or":
            if not any(_match(doc, part) for part in expected):
                return False
        elif key == "$and":
            if not all(_match(doc, part) for part in expected):
                return False
        elif isinstance(expected, dict):
            if "$exists" in expected and ((key in doc) != expected["$exists"]):
                return False
            if "$in" in expected and doc.get(key) not in expected["$in"]:
                return False
            if "$ne" in expected and doc.get(key) == expected["$ne"]:
                return False
        elif doc.get(key) != expected:
            return False
    return True


class _Collection:
    def __init__(self, docs=()):
        self.docs = copy.deepcopy(list(docs))

    async def find_one(self, filt, proj=None):
        for doc in self.docs:
            if _match(doc, filt):
                return copy.deepcopy(doc)
        return None

    async def delete_many(self, filt):
        keep = [d for d in self.docs if not _match(d, filt)]
        deleted = len(self.docs) - len(keep)
        self.docs = keep
        return _Result(deleted)

    async def update_many(self, filt, update):
        n = 0
        for doc in self.docs:
            if _match(doc, filt):
                for key, value in (update.get("$set") or {}).items():
                    doc[key] = copy.deepcopy(value)
                for key in (update.get("$unset") or {}):
                    doc.pop(key, None)
                n += 1
        return _Result(n)

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return _Result(1)


class _DB:
    def __init__(self):
        self.users = _Collection()
        self.orders = _Collection()
        self.payments = _Collection()
        self.cash_registers = _Collection()
        self.cash_movements = _Collection()
        self.attentions = _Collection()
        self.approvals = _Collection()
        self.audit_logs = _Collection()
        self.counters = _Collection()
        self.tables = _Collection()
        self.products = _Collection()
        self.categories = _Collection()
        self.branches = _Collection()

    def __getitem__(self, name):
        return getattr(self, name)


def _admin(db, password=ADMIN_PASSWORD):
    db.users.docs.append({
        "id": ADMIN_ID, "restaurant_id": RID, "role": "admin",
        "full_name": "Admin", "password_hash": hash_password(password),
    })
    return {"id": ADMIN_ID, "restaurant_id": RID, "role": "admin", "full_name": "Admin"}


def _seed(db):
    # Operational rows for the tenant that must be cleared.
    db.orders.docs.append({"id": "o1", "restaurant_id": RID, "status": "pagado"})
    db.payments.docs.append({"id": "p1", "restaurant_id": RID})
    db.cash_registers.docs.append({"id": "r1", "restaurant_id": RID, "branch_id": None, "status": "open"})
    db.cash_movements.docs.append({"id": "m1", "restaurant_id": RID})
    db.attentions.docs.append({"id": "a1", "restaurant_id": RID})
    db.approvals.docs.append({"id": "ap1", "restaurant_id": RID})
    db.audit_logs.docs.append({"id": "al1", "restaurant_id": RID})
    db.counters.docs.append({"restaurant_id": RID, "key": "order_x", "value": 5})
    # Configuration rows for the tenant that must survive.
    db.products.docs.append({"id": "prod1", "restaurant_id": RID})
    db.categories.docs.append({"id": "cat1", "restaurant_id": RID})
    db.branches.docs.append({"id": "branch-1", "restaurant_id": RID})
    db.tables.docs.append({
        "id": "t1", "restaurant_id": RID, "status": "esperando_pago",
        "active_order": "o1", "active_attention_id": "a1",
    })
    # Another tenant's data must be untouched.
    db.orders.docs.append({"id": "o2", "restaurant_id": "tenant-2", "status": "nuevo"})
    db.tables.docs.append({"id": "t2", "restaurant_id": "tenant-2", "status": "ocupada"})


def test_reset_clears_operational_and_keeps_catalog(monkeypatch):
    async def run():
        db = _DB()
        admin = _admin(db)
        _seed(db)
        data_routes.db = db
        result = await data_routes.reset_operational_data(
            DataResetRequest(confirm="ELIMINAR", password=ADMIN_PASSWORD), admin
        )
        assert result["status"] == "ok"
        # Operational collections cleared only for the tenant.
        assert len(db.orders.docs) == 1 and db.orders.docs[0]["restaurant_id"] == "tenant-2"
        assert db.payments.docs == []
        assert db.cash_registers.docs == []
        assert db.cash_movements.docs == []
        assert db.attentions.docs == []
        assert db.approvals.docs == []
        assert db.counters.docs == []
        # Catalog preserved.
        assert len(db.products.docs) == 1
        assert len(db.categories.docs) == 1
        assert len(db.branches.docs) == 1
        # Tenant table reset to disponible; other tenant untouched.
        t1 = next(t for t in db.tables.docs if t["restaurant_id"] == RID)
        assert t1["status"] == "disponible"
        assert "active_order" not in t1 and "active_attention_id" not in t1
        t2 = next(t for t in db.tables.docs if t["restaurant_id"] == "tenant-2")
        assert t2["status"] == "ocupada"
        # A fresh audit entry documents the reset.
        assert any(d.get("action") == "data_reset" for d in db.audit_logs.docs)
    asyncio.run(run())


def test_reset_requires_exact_confirmation(monkeypatch):
    async def run():
        db = _DB()
        admin = _admin(db)
        data_routes.db = db
        with pytest.raises(HTTPException) as caught:
            await data_routes.reset_operational_data(
                DataResetRequest(confirm="eliminar", password=ADMIN_PASSWORD), admin
            )
        assert caught.value.status_code == 400
        assert db.orders.docs == []
    asyncio.run(run())


def test_reset_rejects_wrong_password(monkeypatch):
    async def run():
        db = _DB()
        admin = _admin(db, password=ADMIN_PASSWORD)
        _seed(db)
        data_routes.db = db
        with pytest.raises(HTTPException) as caught:
            await data_routes.reset_operational_data(
                DataResetRequest(confirm="ELIMINAR", password="wrong-password"), admin
            )
        assert caught.value.status_code == 400
        # Nothing was cleared on the failed attempt.
        assert len(db.orders.docs) == 2
    asyncio.run(run())
