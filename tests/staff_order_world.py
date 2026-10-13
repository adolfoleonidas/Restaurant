"""An in-memory restaurant for the staff order create.

It reuses the visit fakes of `test_attention_lifecycle` (tables, visits, audit entries with a unique
`event_id`) and adds what a request id relies on: the unique index on `(restaurant_id, request_id)`
(`uniq_public_order_request`) that MongoDB enforces on orders. Counting helpers expose the side effects
a create has (numbers taken, events published) so a replay can be shown to repeat none of them.
"""
import asyncio
import copy
import os
import sys
from pathlib import Path

from pymongo.errors import DuplicateKeyError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import routes.orders as order_routes  # noqa: E402
from test_attention_lifecycle import _DB, _Collection  # noqa: E402

TENANT = "restaurant-1"
OTHER_TENANT = "restaurant-2"
REUSED = "Esa solicitud ya se usó para otro pedido. Vuelve a intentarlo."
STATE = ("orders", "tables", "attentions", "audit_logs", "counters")


def staff(role="mozo", branch="branch-1", tenant=TENANT):
    row = {"id": f"{role}-{branch}-{tenant}", "restaurant_id": tenant, "role": role, "full_name": f"{role} {branch}"}
    if branch is not None:
        row["branch_id"] = branch
    return row


class World:
    """Two branches of one restaurant (a table in each, plus a second one in the first) and one product."""

    def __init__(self, monkeypatch, *, yield_on_number=False):
        db = self.db = _DB()
        db.products = _Collection(db, "products")
        for branch, tenant in (("branch-1", TENANT), ("branch-2", TENANT), ("branch-9", OTHER_TENANT)):
            db.branches.docs.append(
                {"id": branch, "restaurant_id": tenant, "timezone": "America/Lima", "business_day_cutoff": "04:00"}
            )
        tables = (("table-1", "branch-1"), ("table-2", "branch-2"), ("table-3", "branch-1"))
        for number, (table, branch) in enumerate(tables, 1):
            db.tables.docs.append(
                {"id": table, "restaurant_id": TENANT, "branch_id": branch, "number": number, "status": "disponible"}
            )
        db.products.docs.append({
            "id": "p-sopa", "restaurant_id": TENANT, "name": "Sopa", "price": 10.0,
            "is_available": True, "is_combo": False, "preparation_time": 10,
        })
        self.numbers = []
        self.events = []
        self.duplicate_inserts = 0
        self.yield_on_number = yield_on_number
        self._enforce_request_index(db.orders)
        monkeypatch.setattr(order_routes, "db", db)
        monkeypatch.setattr(order_routes, "_next_order_number", self._next_number)
        monkeypatch.setattr(order_routes, "emit_order", lambda *args, **kwargs: self.events.append((args, kwargs)))

    async def _next_number(self, restaurant_id):
        self.numbers.append(restaurant_id)
        if self.yield_on_number:
            # Lets a second request run while this one is between "no order yet" and "order stored".
            await asyncio.sleep(0)
        return len(self.numbers)

    def _enforce_request_index(self, orders):
        insert = orders.insert_one

        async def guarded(doc):
            request_id = doc.get("request_id")
            if isinstance(request_id, str) and any(
                row.get("restaurant_id") == doc.get("restaurant_id") and row.get("request_id") == request_id
                for row in orders.docs
            ):
                self.duplicate_inserts += 1
                raise DuplicateKeyError("E11000 duplicate key error collection: orders index: uniq_public_order_request")
            return await insert(doc)

        orders.insert_one = guarded

    def state(self):
        """Everything a create can write or announce, to compare before and after a replay."""
        return {
            "collections": {name: copy.deepcopy(getattr(self.db, name).docs) for name in STATE},
            "numbers": list(self.numbers),
            "events": len(self.events),
        }

    def table(self, table_id):
        return next(row for row in self.db.tables.docs if row["id"] == table_id)


async def create(data, user):
    return await order_routes.create_order(data, user)
