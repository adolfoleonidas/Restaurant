"""bcrypt must never run on the event loop.

The server is a single process with in-process SSE, so one blocking bcrypt call
freezes every request and stream. Password work goes through the async wrappers
in `auth` (a worker thread), and the admin diagnostics stop re-hashing on every
request.
"""
import asyncio
import os
import sys
import time
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "in_memory_only")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-for-the-bcrypt-loop-tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import auth  # noqa: E402
import routes.auth as auth_routes  # noqa: E402
import routes.system as system_routes  # noqa: E402
from models import LoginInput  # noqa: E402

PASSWORD = "test1234"


class _Request:
    def __init__(self, host="10.0.0.1"):
        self.client = type("Client", (), {"host": host})()


def _staff(password_hash, email="mozo@x.com"):
    return {
        "id": email, "email": email, "password_hash": password_hash,
        "restaurant_id": "r1", "role": "mozo", "status": "active",
        "functions": ["atencion"], "full_name": "Mozo",
    }


class _Users:
    def __init__(self, rows):
        self.rows = rows

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if row.get("email") == query.get("email"):
                return dict(row)
        return None


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def limit(self, n):
        return self

    async def to_list(self, n):
        return [dict(r) for r in self.rows[:n]]


class _SystemUsers:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query, projection=None):
        return _Cursor(self.rows)

    async def count_documents(self, query):
        return len(self.rows)


class _Collection:
    async def count_documents(self, query):
        return 0

    async def find_one(self, query, projection=None):
        return None


class _SystemDB:
    def __init__(self, rows):
        self.users = _SystemUsers(rows)
        self._other = _Collection()

    async def command(self, name):
        return {"ok": 1}

    def __getitem__(self, name):
        return self.users if name == "users" else self._other

    @property
    def restaurants(self):
        return self._other


def _slow(seconds):
    def _inner(*args):
        time.sleep(seconds)
        return True
    return _inner


# --- the wrappers --------------------------------------------------------------

def test_the_async_wrappers_round_trip_a_password():
    async def run():
        digest = await auth.hash_password_async(PASSWORD)
        return (
            digest,
            await auth.verify_password_async(PASSWORD, digest),
            await auth.verify_password_async("otra", digest),
        )

    digest, ok, bad = asyncio.run(run())
    assert digest != PASSWORD and digest.startswith("$2")
    assert ok is True and bad is False


def test_the_async_verify_runs_off_the_event_loop_thread(monkeypatch):
    import threading
    seen = {}

    def _where(plain, hashed):
        seen["thread"] = threading.current_thread()
        return True

    monkeypatch.setattr(auth, "verify_password", _where)
    asyncio.run(auth.verify_password_async("x", "y"))
    assert seen["thread"] is not threading.main_thread()


# --- login ---------------------------------------------------------------------

def test_login_keeps_the_event_loop_responsive_while_bcrypt_runs(monkeypatch):
    monkeypatch.setattr(auth, "verify_password", _slow(0.3))
    monkeypatch.setattr(auth_routes, "db", type("DB", (), {"users": _Users([_staff("irrelevant")])})())
    auth_routes._login_failures.clear()

    async def run():
        ticks = 0
        stop = asyncio.Event()

        async def ticker():
            nonlocal ticks
            while not stop.is_set():
                await asyncio.sleep(0.01)
                ticks += 1

        task = asyncio.create_task(ticker())
        await auth_routes.login(_Request(), LoginInput(email="mozo@x.com", password=PASSWORD))
        stop.set()
        await task
        return ticks

    # A blocked loop manages ~0 ticks in 300 ms; a free one manages dozens.
    assert asyncio.run(run()) >= 10


def test_a_wrong_password_is_still_a_401():
    digest = auth.hash_password(PASSWORD)
    auth_routes.db = type("DB", (), {"users": _Users([_staff(digest)])})()
    auth_routes._login_failures.clear()

    async def run():
        with pytest.raises(HTTPException) as error:
            await auth_routes.login(_Request(), LoginInput(email="mozo@x.com", password="mala"))
        good = await auth_routes.login(_Request("10.0.0.2"), LoginInput(email="mozo@x.com", password=PASSWORD))
        return error.value, good

    error, good = asyncio.run(run())
    assert error.status_code == 401
    assert good["access_token"]


# --- /system/info --------------------------------------------------------------

def _info(db):
    system_routes.db = db
    return asyncio.run(system_routes.system_info({"restaurant_id": "r1", "role": "admin"}))


def test_system_info_reports_accounts_that_keep_a_demo_password():
    system_routes._reset_demo_password_cache()
    demo = _staff(auth.hash_password("admin123"), "admin@x.com")
    safe = _staff(auth.hash_password("una-clave-propia-larga"), "mozo@x.com")
    result = _info(_SystemDB([demo, safe]))
    assert result["demo_passwords"] is True
    assert result["demo_password_accounts"] == ["admin@x.com"]


def test_system_info_is_clean_when_no_account_keeps_a_demo_password():
    system_routes._reset_demo_password_cache()
    result = _info(_SystemDB([_staff(auth.hash_password("una-clave-propia-larga"))]))
    assert result["demo_passwords"] is False
    assert result["demo_password_accounts"] == []


def test_system_info_does_not_run_bcrypt_again_for_unchanged_accounts(monkeypatch):
    system_routes._reset_demo_password_cache()
    rows = [_staff(auth.hash_password("admin123"), "admin@x.com"), _staff(auth.hash_password("propia-123"))]
    db = _SystemDB(rows)
    first = _info(db)

    calls = []
    real = auth.verify_password
    monkeypatch.setattr(auth, "verify_password", lambda *a: calls.append(a) or real(*a))
    second = _info(db)

    assert calls == []
    assert second["demo_password_accounts"] == first["demo_password_accounts"] == ["admin@x.com"]


def test_system_info_notices_a_password_change_without_a_stale_answer():
    system_routes._reset_demo_password_cache()
    rows = [_staff(auth.hash_password("admin123"), "admin@x.com")]
    db = _SystemDB(rows)
    assert _info(db)["demo_passwords"] is True

    rows[0]["password_hash"] = auth.hash_password("ya-cambiada-por-el-dueno")
    assert _info(db)["demo_passwords"] is False


def test_system_info_keeps_the_event_loop_responsive(monkeypatch):
    system_routes._reset_demo_password_cache()
    monkeypatch.setattr(auth, "verify_password", _slow(0.1))
    db = _SystemDB([_staff("hash-%d" % i, "u%d@x.com" % i) for i in range(3)])
    system_routes.db = db

    async def run():
        ticks = 0
        stop = asyncio.Event()

        async def ticker():
            nonlocal ticks
            while not stop.is_set():
                await asyncio.sleep(0.01)
                ticks += 1

        task = asyncio.create_task(ticker())
        await system_routes.system_info({"restaurant_id": "r1", "role": "admin"})
        stop.set()
        await task
        return ticks

    assert asyncio.run(run()) >= 10
