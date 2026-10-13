"""POST /api/orders with a request id, over HTTP through the real app.

`test_staff_order_replay.py` calls the route function; this file checks what the composer relies on:
the verb and path, the JSON body it sends (`request_id` next to the table), the answer it reads (the
whole order, `200` on a replay exactly like on the first create), the `422` details for a malformed
id, the Spanish `409` for an id that belongs to another order, and that a request without an id is
untouched.
"""
import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server  # noqa: E402
from auth import get_current_user  # noqa: E402
from staff_order_world import REUSED, World, staff  # noqa: E402

URL = "/api/orders"
R1 = "6b0f4f0e-0f6a-4f0e-9a52-0d1f3a6e0001"
# What lib/clientId.js hands out when the browser has no crypto.
FALLBACK_ID = "c-lk3j2h1g-abcdefghij-xyz123"


def _request(method, path, body=None):
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
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())],
        "client": ("127.0.0.1", 1), "server": ("test", 80), "scheme": "http", "root_path": "",
    }
    asyncio.run(server.app(scope, receive, send))
    start = next(m for m in sent if m["type"] == "http.response.start")
    raw = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], (json.loads(raw) if raw else None)


@pytest.fixture
def http(monkeypatch):
    world = World(monkeypatch)

    def act_as(user):
        server.app.dependency_overrides[get_current_user] = lambda: user

    act_as(staff())
    yield world, act_as
    server.app.dependency_overrides.clear()


def test_the_same_post_twice_answers_200_with_the_same_order_and_makes_one(http):
    world, _ = http
    body = {"table_id": "table-1", "order_type": "mesa", "request_id": R1}

    first_status, first = _request("POST", URL, body)
    second_status, second = _request("POST", URL, body)

    assert (first_status, second_status) == (200, 200)
    assert first["id"] == second["id"] and second == first
    assert first["request_id"] == R1 and first["table_id"] == "table-1" and first["attention_state"] == "open"
    assert len(world.db.orders.docs) == 1 and len(world.events) == 1 and len(world.db.audit_logs.docs) == 1


def test_a_new_account_replay_over_http(http):
    world, _ = http
    _request("POST", URL, {"table_id": "table-1", "order_type": "mesa", "request_id": R1})
    extra = {"table_id": "table-1", "order_type": "mesa", "new_account": True, "request_id": FALLBACK_ID}

    _, first = _request("POST", URL, extra)
    status, second = _request("POST", URL, extra)

    assert status == 200 and second == first
    assert len(world.db.orders.docs) == 2


def test_a_post_without_a_request_id_still_makes_a_new_order_each_time(http):
    world, _ = http

    _, one = _request("POST", URL, {"order_type": "recojo"})
    _, two = _request("POST", URL, {"order_type": "recojo"})

    assert one["id"] != two["id"] and "request_id" not in one
    assert len(world.db.orders.docs) == 2


@pytest.mark.parametrize("bad", ["", "short", "x" * 65, "has a space in it", "semi;colon-id", "ñandú-ñandú"])
def test_a_malformed_request_id_answers_422_and_creates_nothing(http, bad):
    world, _ = http

    status, body = _request("POST", URL, {"order_type": "recojo", "request_id": bad})

    assert status == 422
    assert isinstance(body["detail"], list) and any("request_id" in entry["loc"] for entry in body["detail"])
    assert world.db.orders.docs == []


def test_an_id_that_belongs_to_another_branchs_order_answers_409_in_spanish(http):
    world, act_as = http
    _request("POST", URL, {"order_type": "recojo", "request_id": R1})
    act_as(staff(branch="branch-2"))

    status, body = _request("POST", URL, {"order_type": "recojo", "request_id": R1})

    assert (status, body["detail"]) == (409, REUSED)
    assert len(world.db.orders.docs) == 1


def test_an_id_reused_for_another_table_answers_409(http):
    world, _ = http
    _request("POST", URL, {"table_id": "table-1", "order_type": "mesa", "request_id": R1})

    status, body = _request("POST", URL, {"table_id": "table-3", "order_type": "mesa", "request_id": R1})

    assert (status, body["detail"]) == (409, REUSED)
    assert len(world.db.orders.docs) == 1 and world.table("table-3")["status"] == "disponible"


@pytest.mark.parametrize("role", ["cocina", "cajero"])
def test_kitchen_and_cashier_are_refused_with_or_without_an_id(http, role):
    world, act_as = http
    act_as(staff(role))

    status, body = _request("POST", URL, {"order_type": "recojo", "request_id": R1})

    assert status == 403 and "Requiere rol" in body["detail"]
    assert world.db.orders.docs == []
