"""Hermetic check that the demo seed gives staff a working branch (no DB needed)."""
import asyncio
import copy
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import seed  # noqa: E402
from branch_access import validate_user_branch  # noqa: E402
from models import BranchCreate  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length):
        return copy.deepcopy(self.rows[:length])


def _match(row, query):
    return all(row.get(key) == value for key, value in (query or {}).items() if not isinstance(value, dict))


class _Collection:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(copy.deepcopy(row))

    async def find_one(self, query, projection=None):
        return copy.deepcopy(next((r for r in self.rows if _match(r, query)), None))

    def find(self, query, projection=None):
        return _Cursor([r for r in self.rows if _match(r, query)])

    async def update_one(self, *_args, **_kwargs):
        return None

    async def update_many(self, *_args, **_kwargs):
        return None


class _Db:
    def __init__(self):
        self._collections = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._collections.setdefault(name, _Collection())


def _run_demo_seed(monkeypatch):
    fake = _Db()
    monkeypatch.setattr(seed, "db", fake)
    monkeypatch.setenv("SEED_DEMO", "true")
    asyncio.run(seed.run_seed())
    return fake


def test_demo_seed_creates_one_valid_default_branch(monkeypatch):
    fake = _run_demo_seed(monkeypatch)
    assert len(fake.branches.rows) == 1
    branch = fake.branches.rows[0]
    assert branch["restaurant_id"] == fake.restaurants.rows[0]["id"]
    # The same payload the branches API accepts.
    BranchCreate(name=branch["name"], timezone=branch["timezone"], business_day_cutoff=branch["business_day_cutoff"])


def test_demo_seed_assigns_tables_zones_and_staff_to_it(monkeypatch):
    fake = _run_demo_seed(monkeypatch)
    branch_id = fake.branches.rows[0]["id"]
    assert fake.tables.rows and all(t["branch_id"] == branch_id for t in fake.tables.rows)
    assert fake.zones.rows and all(z["branch_id"] == branch_id for z in fake.zones.rows)
    staff = [u for u in fake.users.rows if u["role"] != "admin"]
    assert staff and all(u["branch_id"] == branch_id for u in staff)
    admin = next(u for u in fake.users.rows if u["role"] == "admin")
    assert admin.get("branch_id") in (None, branch_id)


def test_seeded_staff_pass_the_branch_gate(monkeypatch):
    fake = _run_demo_seed(monkeypatch)
    mozo = next(u for u in fake.users.rows if u["role"] == "mozo")
    assert asyncio.run(validate_user_branch(mozo, fake.branches)) == fake.branches.rows[0]["id"]
