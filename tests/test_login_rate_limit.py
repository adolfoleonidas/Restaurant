"""The login limiter must be per account, not per venue.

Behind nginx every request shares the proxy IP, so a bucket keyed only by IP
would lock the whole restaurant out. The bucket is keyed by IP *and* email.
"""
import asyncio
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "in_memory_only")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-for-the-login-limiter-tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi import HTTPException  # noqa: E402

import routes.auth as auth_routes  # noqa: E402
from auth import hash_password  # noqa: E402
from models import LoginInput  # noqa: E402

PASSWORD = "test1234"


class _Users:
    def __init__(self, emails):
        self.rows = [
            {
                "id": email, "email": email, "password_hash": hash_password(PASSWORD),
                "restaurant_id": "r1", "role": "mozo", "status": "active",
                "functions": ["atencion"], "full_name": "Mozo",
            }
            for email in emails
        ]

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if row.get("email") == query.get("email"):
                return dict(row)
        return None


class _DB:
    def __init__(self, emails):
        self.users = _Users(emails)


class _Request:
    def __init__(self, host="10.0.0.1"):
        self.client = type("Client", (), {"host": host})()


def _reset_failures(monkeypatch=None, max_keys=None):
    auth_routes._login_failures.clear()
    if monkeypatch is not None and max_keys is not None:
        monkeypatch.setattr(auth_routes, "_LOGIN_MAX_KEYS", max_keys)


def test_the_failure_table_never_grows_past_its_cap(monkeypatch):
    _reset_failures(monkeypatch, max_keys=50)
    for i in range(500):
        auth_routes._record_failure(f"10.0.0.{i % 250}|user{i}@x.com")
    assert len(auth_routes._login_failures) <= 50


def test_expired_entries_are_dropped_before_live_ones(monkeypatch):
    _reset_failures(monkeypatch, max_keys=3)
    stale = time.time() - auth_routes._LOGIN_WINDOW - 10
    for name in ("a", "b"):
        auth_routes._login_failures[name] = [stale]
    auth_routes._login_failures["live"] = [time.time()]
    auth_routes._record_failure("new")
    assert "live" in auth_routes._login_failures
    assert "new" in auth_routes._login_failures
    assert "a" not in auth_routes._login_failures
    assert "b" not in auth_routes._login_failures


def test_when_all_entries_are_live_the_least_recent_is_evicted(monkeypatch):
    _reset_failures(monkeypatch, max_keys=3)
    now = time.time()
    auth_routes._login_failures["oldest"] = [now - 30]
    auth_routes._login_failures["middle"] = [now - 20]
    auth_routes._login_failures["newest"] = [now - 10]
    auth_routes._record_failure("incoming")
    assert "oldest" not in auth_routes._login_failures
    assert {"middle", "newest", "incoming"} <= set(auth_routes._login_failures)


def test_a_key_that_keeps_failing_is_not_evicted_as_old(monkeypatch):
    _reset_failures(monkeypatch, max_keys=3)
    auth_routes._record_failure("attacker")
    auth_routes._record_failure("b")
    auth_routes._record_failure("c")
    auth_routes._record_failure("attacker")  # most recent activity now
    auth_routes._record_failure("d")  # table full: evicts the least recent ("b")
    assert "attacker" in auth_routes._login_failures
    assert "b" not in auth_routes._login_failures


def test_checking_an_unknown_key_does_not_allocate_an_entry():
    _reset_failures()
    assert auth_routes._is_rate_limited("never|seen@x.com") is False
    assert "never|seen@x.com" not in auth_routes._login_failures


def test_the_lockout_threshold_is_unchanged():
    _reset_failures()
    key = "10.0.0.1|mozo@x.com"
    for _ in range(auth_routes._LOGIN_MAX - 1):
        auth_routes._record_failure(key)
    assert auth_routes._is_rate_limited(key) is False
    auth_routes._record_failure(key)
    assert auth_routes._is_rate_limited(key) is True


def test_failures_age_out_of_the_window():
    _reset_failures()
    key = "10.0.0.1|mozo@x.com"
    stale = time.time() - auth_routes._LOGIN_WINDOW - 1
    auth_routes._login_failures[key] = [stale] * auth_routes._LOGIN_MAX
    assert auth_routes._is_rate_limited(key) is False
    assert key not in auth_routes._login_failures


def test_a_locked_account_does_not_block_the_rest_of_the_staff():
    async def run():
        auth_routes.db = _DB(["mozo@x.com", "cajero@x.com"])
        auth_routes._login_failures.clear()
        request = _Request()
        for _ in range(auth_routes._LOGIN_MAX):
            try:
                await auth_routes.login(request, LoginInput(email="mozo@x.com", password="mala"))
            except HTTPException:
                pass
        locked = None
        try:
            await auth_routes.login(request, LoginInput(email="mozo@x.com", password=PASSWORD))
        except HTTPException as exc:
            locked = exc
        other = await auth_routes.login(request, LoginInput(email="cajero@x.com", password=PASSWORD))
        return locked, other

    locked, other = asyncio.run(run())
    assert locked is not None and locked.status_code == 429
    assert other["access_token"]
