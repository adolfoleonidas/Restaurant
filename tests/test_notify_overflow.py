"""A subscriber whose queue overflows must be told, not silently abandoned."""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import notify
import routes.notifications as notification_routes
from branch_isolation_fakes import _DB, _user


def _event(n):
    return {"type": "order", "restaurant_id": "tenant-1", "order_id": f"o{n}", "branch_id": "branch-a"}


def test_overflow_leaves_a_close_marker_instead_of_a_silent_gap():
    async def run():
        slow = notify.subscribe()
        fast = notify.subscribe()
        try:
            for n in range(65):
                if n == 60:
                    # The fast client keeps up, the slow one never reads.
                    while not fast.empty():
                        fast.get_nowait()
                notify.publish(_event(n))
            assert slow not in notify._subs
            assert fast in notify._subs
            assert slow.get_nowait() is notify.CLOSED
            assert slow.empty()
        finally:
            notify.unsubscribe(slow)
            notify.unsubscribe(fast)
    asyncio.run(run())


def test_stream_ends_when_its_queue_overflows_so_the_client_reconnects(monkeypatch):
    async def run():
        db = _DB()
        db.users.rows.append({**_user(), "status": "active"})
        monkeypatch.setattr(notification_routes, "db", db)
        before = set(notify._subs)
        response = await notification_routes.notification_stream(_user())
        assert len(notify._subs - before) == 1
        for n in range(200):
            notify.publish(_event(n))
        iterator = response.body_iterator
        assert "hello" in await iterator.__anext__()

        async def drain():
            async for _chunk in iterator:
                pass

        await asyncio.wait_for(drain(), timeout=2)
        assert notify._subs == before
    asyncio.run(run())


def test_stream_keeps_delivering_while_the_queue_does_not_overflow(monkeypatch):
    async def run():
        db = _DB()
        db.users.rows.append({**_user(), "status": "active"})
        monkeypatch.setattr(notification_routes, "db", db)
        response = await notification_routes.notification_stream(_user())
        iterator = response.body_iterator
        await iterator.__anext__()
        notify.publish(_event(1))
        assert '"order_id": "o1"' in await iterator.__anext__()
        await iterator.aclose()
    asyncio.run(run())


def test_public_stream_ends_on_overflow_instead_of_crashing_on_the_marker():
    import routes.public as public_routes
    from test_money_integrity import _DB as _RestaurantDB

    class _Request:
        client = type("Client", (), {"host": "10.0.0.5"})()
        headers = {}

    async def run():
        db = _RestaurantDB()
        db.restaurants.docs.append({"id": "tenant-1"})
        public_routes.db = db
        before = set(notify._subs)
        response = await public_routes.public_stream(_Request(), restaurant_id="tenant-1")
        for n in range(200):
            notify.publish({"type": "product", "restaurant_id": "tenant-1"})
        iterator = response.body_iterator
        assert "hello" in await iterator.__anext__()

        async def drain():
            async for _chunk in iterator:
                pass

        await asyncio.wait_for(drain(), timeout=2)
        assert notify._subs == before
    asyncio.run(run())
