"""The login limiter must be per account, not per venue.

Behind nginx every request shares the proxy IP, so a bucket keyed only by IP
would lock the whole restaurant out. The bucket is keyed by IP *and* email.
"""
import asyncio
import os
import sys
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
