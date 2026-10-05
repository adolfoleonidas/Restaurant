"""The availability endpoint must not leak other branches' pending orders."""
import asyncio
import copy
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import routes.products as product_routes  # noqa: E402
from models import ProductAvailability  # noqa: E402

RID = "tenant-1"


class _Result:
    def __init__(self, count):
        self.matched_count = count
        self.modified_count = count


def _matches(row, query):
    for key, value in query.items():
        if isinstance(value, dict):
            if "$nin" in value and row.get(key) in value["$nin"]:
                return False
            continue
        if "." in key:
            head, _, tail = key.partition(".")
            items = row.get(head) or []
            if not any(isinstance(it, dict) and it.get(tail) == value for it in items):
                return False
            continue
        if row.get(key) != value:
            return False
    return True


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

    async def update_one(self, query, update):
        hits = [row for row in self.rows if _matches(row, query)]
        for row in hits:
            row.update(copy.deepcopy(update.get("$set") or {}))
        return _Result(len(hits))

    def find(self, query, projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query)])


class _DB:
    def __init__(self, orders):
        self.products = _Collection([{"id": "prod-1", "restaurant_id": RID, "name": "Lomo", "is_available": True}])
        self.orders = _Collection(orders)


def _order(order_id, branch_id):
    return {
        "id": order_id,
        "restaurant_id": RID,
        "branch_id": branch_id,
        "order_number": 7,
        "status": "en_preparacion",
        "table_id": "table-1",
        "items": [{"product_id": "prod-1", "quantity": 2, "status": "pendiente"}],
    }


def test_availability_pending_orders_are_scoped_to_the_callers_branch():
    async def run():
        db = _DB([_order("order-a", "branch-a"), _order("order-b", "branch-b")])
        product_routes.db = db
        cocina = {"id": "cocina-1", "restaurant_id": RID, "role": "cocina", "full_name": "Cocina", "branch_id": "branch-a"}
        return await product_routes.set_availability(
            "prod-1", ProductAvailability(is_available=False), cocina,
        )

    result = asyncio.run(run())
    assert [row["id"] for row in result["pending_orders"]] == ["order-a"]


def test_availability_pending_orders_cover_every_branch_for_the_owner():
    async def run():
        db = _DB([_order("order-a", "branch-a"), _order("order-b", "branch-b")])
        product_routes.db = db
        owner = {"id": "admin-1", "restaurant_id": RID, "role": "admin", "full_name": "Dueno"}
        return await product_routes.set_availability(
            "prod-1", ProductAvailability(is_available=False), owner,
        )

    result = asyncio.run(run())
    assert sorted(row["id"] for row in result["pending_orders"]) == ["order-a", "order-b"]
