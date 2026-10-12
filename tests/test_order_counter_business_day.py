"""The daily order counter follows the business day (America/Lima), not UTC."""
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import routes.orders as order_routes


class _Counters:
    def __init__(self):
        self.keys = []

    async def find_one_and_update(self, query, update, **kwargs):
        self.keys.append(query["key"])
        return {"value": 1}


class _DB:
    def __init__(self):
        self.counters = _Counters()


def test_evening_in_lima_keeps_the_local_day_key():
    # 20:00 Lima on 2026-10-12 is 01:00 UTC on 2026-10-13.
    instant = datetime(2026, 10, 13, 1, 0, tzinfo=timezone.utc)
    assert order_routes._order_counter_key(instant) == "order_2026-10-12"


def test_lima_midnight_rolls_the_key_over():
    before = datetime(2026, 10, 13, 4, 59, tzinfo=timezone.utc)  # 23:59 Lima, day 12
    after = datetime(2026, 10, 13, 5, 0, tzinfo=timezone.utc)  # 00:00 Lima, day 13
    assert order_routes._order_counter_key(before) == "order_2026-10-12"
    assert order_routes._order_counter_key(after) == "order_2026-10-13"


def test_next_order_number_uses_the_business_day_key(monkeypatch):
    db = _DB()

    class _Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 13, 1, 0, tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr(order_routes, "db", db)
    monkeypatch.setattr(order_routes, "datetime", _Clock)
    assert asyncio.run(order_routes._next_order_number("tenant-1")) == 1
    assert db.counters.keys == ["order_2026-10-12"]
