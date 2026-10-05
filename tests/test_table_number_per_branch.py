"""Table numbers and zone names are unique per branch, not per restaurant."""
import asyncio
import copy
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import routes.tables as table_routes  # noqa: E402
import routes.zones as zone_routes  # noqa: E402
from models import TableCreate, ZoneCreate  # noqa: E402

RID = "tenant-1"


class _Result:
    def __init__(self, count):
        self.matched_count = count
        self.modified_count = count


def _matches(row, query):
    return all(row.get(key) == value for key, value in query.items())


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length):
        return copy.deepcopy(self.rows[:length])


class _Collection:
    def __init__(self, rows=None):
        self.rows = copy.deepcopy(rows or [])

    async def find_one(self, query, projection=None):
        return next((copy.deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query, projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, doc):
        self.rows.append(copy.deepcopy(doc))
        return _Result(1)


class _DB:
    def __init__(self):
        self.branches = _Collection([
            {"id": "branch-a", "restaurant_id": RID, "name": "A"},
            {"id": "branch-b", "restaurant_id": RID, "name": "B"},
        ])
        self.zones = _Collection([
            {"id": "z1", "restaurant_id": RID, "name": "Salon", "branch_id": "branch-a"},
        ])
        self.tables = _Collection([
            {"id": "t1", "restaurant_id": RID, "name": "Mesa 1", "number": 1, "branch_id": "branch-a"},
        ])


def _admin():
    return {"id": "admin-1", "restaurant_id": RID, "role": "admin", "full_name": "Admin"}


def test_the_same_table_number_is_allowed_in_another_branch():
    async def run():
        db = _DB()
        table_routes.db = db
        zone_routes.db = db
        # The branch needs its own zone before a table can live there.
        await zone_routes.create_zone(ZoneCreate(name="Salon", branch_id="branch-b"), _admin())
        created = await table_routes.create_table(
            TableCreate(number=1, area="Salon", branch_id="branch-b", capacity=4), _admin()
        )
        return created, db.tables.rows

    created, rows = asyncio.run(run())
    assert created["branch_id"] == "branch-b"
    assert len([row for row in rows if row["number"] == 1]) == 2


def test_the_same_table_number_in_the_same_branch_is_rejected():
    async def run():
        db = _DB()
        table_routes.db = db
        with pytest.raises(HTTPException) as caught:
            await table_routes.create_table(
                TableCreate(number=1, area="Salon", branch_id="branch-a", capacity=4), _admin()
            )
        return caught.value

    error = asyncio.run(run())
    assert error.status_code == 400


def test_the_same_zone_name_is_allowed_in_another_branch():
    async def run():
        db = _DB()
        zone_routes.db = db
        created = await zone_routes.create_zone(ZoneCreate(name="Salon", branch_id="branch-b"), _admin())
        return created, db.zones.rows

    created, rows = asyncio.run(run())
    assert created["branch_id"] == "branch-b"
    assert len([row for row in rows if row["name"] == "Salon"]) == 2


def test_the_same_zone_name_in_the_same_branch_is_rejected():
    async def run():
        db = _DB()
        zone_routes.db = db
        with pytest.raises(HTTPException) as caught:
            await zone_routes.create_zone(ZoneCreate(name="Salon", branch_id="branch-a"), _admin())
        return caught.value

    error = asyncio.run(run())
    assert error.status_code == 400
