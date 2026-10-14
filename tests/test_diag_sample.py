"""El endpoint donde el medidor del teléfono deja sus números.

El medidor de la app (`?diag=1`) mide lo único que el servidor no puede ver:
cuánto tarda un toque en el dispositivo del mozo, partido en "el hilo estaba
ocupado" y "mi código". Este endpoint lo guarda para poder leerlo después.

Lo que se comprueba aquí: exige sesión, guarda lo que llega junto a quién lo
mandó, y rechaza una muestra desmedida (un cliente roto no debe llenar la base).
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import routes.diag as diag_routes  # noqa: E402
import server  # noqa: E402
from auth import get_current_user  # noqa: E402
from branch_isolation_fakes import _Collection  # noqa: E402

RID = "tenant-1"
URL = "/api/diag/sample"
SAMPLE = {
    "version": "de8353ed",
    "screen": "412x915 vertical",
    "viewport": {"w": 412, "h": 915, "orientation": "vertical", "dpr": 2.625, "nodes": 530, "ua": "Pixel 7"},
    "taps": {"n": 8, "p50": 160, "max": 320, "busy": 110, "code": 4},
    "longs": {"n": 12, "max": 324},
    "fps": 52,
}


class _FakeDB:
    def __init__(self):
        self.diag_samples = _Collection()


def _request(method, path, body=None, headers=None):
    payload = json.dumps(body).encode() if body is not None else b""
    messages = [{"type": "http.request", "body": payload, "more_body": False}]
    sent = []

    async def receive():
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
        "path": path, "raw_path": path.encode(), "query_string": b"",
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]
        + [(key.encode(), value.encode()) for key, value in (headers or {}).items()],
        "client": ("127.0.0.1", 1), "server": ("test", 80), "scheme": "http", "root_path": "",
    }
    asyncio.run(server.app(scope, receive, send))
    start = next(m for m in sent if m["type"] == "http.response.start")
    raw = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], (json.loads(raw) if raw else None)


@pytest.fixture
def http():
    db = _FakeDB()
    diag_routes.db = db
    user = {"id": "mozo-1", "restaurant_id": RID, "role": "mozo", "full_name": "Mozo", "branch_id": "branch-1"}
    server.app.dependency_overrides[get_current_user] = lambda: user
    yield db
    server.app.dependency_overrides.clear()


def test_saves_the_sample_with_who_sent_it(http):
    status, body = _request("POST", URL, SAMPLE)

    assert status == 200
    assert body["ok"] is True

    assert len(http.diag_samples.rows) == 1
    row = http.diag_samples.rows[0]
    assert row["restaurant_id"] == RID
    assert row["user_id"] == "mozo-1"
    assert row["role"] == "mozo"
    assert row["version"] == "de8353ed"
    assert row["screen"] == "412x915 vertical"
    assert row["taps"] == {"n": 8, "p50": 160, "max": 320, "busy": 110, "code": 4}
    assert row["longs"] == {"n": 12, "max": 324}
    assert row["fps"] == 52
    assert row["viewport"]["ua"] == "Pixel 7"
    assert row["created_at"]


def test_a_sample_with_nothing_missing_still_saves(http):
    """Es un diagnóstico: un cliente que manda menos no debe ser un error."""
    status, body = _request("POST", URL, {"version": "abc12345"})

    assert status == 200
    assert body["ok"] is True
    assert http.diag_samples.rows[0]["version"] == "abc12345"
    assert http.diag_samples.rows[0]["taps"] == {}


def test_without_a_session_it_is_refused(http):
    server.app.dependency_overrides.clear()

    status, _ = _request("POST", URL, SAMPLE)

    assert status in (401, 403)
    assert http.diag_samples.rows == []


def test_a_sample_too_big_is_refused(http):
    giant = {**SAMPLE, "viewport": {**SAMPLE["viewport"], "ua": "x" * 8000}}

    status, body = _request("POST", URL, giant)

    assert status == 413
    assert "demasiado grande" in body["detail"]
    assert http.diag_samples.rows == []
