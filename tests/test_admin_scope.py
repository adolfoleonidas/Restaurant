"""The `administracion` function opens every panel except staff management."""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "in_memory_only")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-for-the-hermetic-suite")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi import HTTPException  # noqa: E402

from auth import require_role_exact, require_roles  # noqa: E402


def test_an_encargado_runs_the_venue_but_cannot_manage_staff():
    async def run():
        encargado = {"id": "u1", "role": "mozo", "functions": ["administracion"], "restaurant_id": "r1"}
        admin = {"id": "u2", "role": "admin", "restaurant_id": "r1"}
        blocked = None
        try:
            await require_role_exact("admin")(encargado)
        except HTTPException as exc:
            blocked = exc
        # Every other admin panel keeps working for the encargado.
        allowed_panel = await require_roles(["admin"])(encargado)
        allowed_admin = await require_role_exact("admin")(admin)
        return blocked, allowed_panel, allowed_admin

    blocked, allowed_panel, allowed_admin = asyncio.run(run())
    assert blocked is not None and blocked.status_code == 403
    assert allowed_panel["id"] == "u1"
    assert allowed_admin["id"] == "u2"
