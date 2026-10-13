"""The batch endpoint over HTTP, through the real app.

`test_draft_lines_batch.py` calls the route function; this file checks what the
composer actually relies on: the verb and path, the JSON body it sends
(`{"lines": [...]}`, not wrapped), the answer it reads (the whole order plus
`line_results`), the validation errors `apiErrorMessage` turns into a sentence,
and that lines created by a batch still work with the older per-line routes.
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

import routes.orders as order_routes  # noqa: E402
import server  # noqa: E402
from auth import get_current_user  # noqa: E402
from branch_isolation_fakes import _Collection  # noqa: E402

RID = "tenant-1"
STAMP = "2026-01-01T00:00:00+00:00"
CID = "6b0f4f0e-0f6a-4f0e-9a52-0d1f3a6e0001"
URL = "/api/orders/order-1/draft-lines"


class _FakeDB:
    def __init__(self):
        self.orders = _Collection([{
            "id": "order-1", "restaurant_id": RID, "branch_id": "branch-1", "table_id": "table-1",
            "order_number": 12, "status": "nuevo", "order_type": "mesa", "subtotal": 0.0, "discount": 0.0,
            "tip": 0.0, "delivery_fee": 0.0, "amount_paid": 0.0, "total": 0.0, "updated_at": STAMP, "items": [],
        }])
        self.products = _Collection([{
            "id": "p-sopa", "restaurant_id": RID, "name": "Sopa", "price": 10.0,
            "is_available": True, "is_combo": False, "preparation_time": 10,
        }])
        self.branches = _Collection([{"id": "branch-1", "restaurant_id": RID}])
        self.audit_logs = _Collection()
        self.counters = _Collection()


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
    db = _FakeDB()
    order_routes.db = db
    user = {"id": "mozo-1", "restaurant_id": RID, "role": "mozo", "full_name": "Mozo", "branch_id": "branch-1"}

    def act_as(role):
        server.app.dependency_overrides[get_current_user] = lambda: {**user, "role": role}

    act_as("mozo")
    yield db, act_as
    server.app.dependency_overrides.clear()


def test_a_batch_is_a_put_with_the_lines_unwrapped_and_answers_with_the_order_and_a_report(http):
    status, body = _request("PUT", URL, {"lines": [{"client_line_id": CID, "product_id": "p-sopa", "quantity": 2}]})

    assert status == 200
    assert body["id"] == "order-1" and body["total"] == 20.0
    assert [(i["client_line_id"], i["quantity"], i["status"]) for i in body["items"]] == [(CID, 2, "borrador")]
    assert body["line_results"] == [{"client_line_id": CID, "result": "applied", "line_id": body["items"][0]["id"]}]


def test_the_same_request_again_changes_nothing(http):
    request = {"lines": [{"client_line_id": CID, "product_id": "p-sopa", "quantity": 2}]}
    _, first = _request("PUT", URL, request)
    status, second = _request("PUT", URL, request)

    assert status == 200
    assert [i["id"] for i in second["items"]] == [i["id"] for i in first["items"]]
    assert second["line_results"][0]["result"] == "unchanged"


def test_a_line_the_batch_created_is_still_editable_with_the_older_routes(http):
    _, created = _request("PUT", URL, {"lines": [{"client_line_id": CID, "product_id": "p-sopa", "quantity": 1}]})
    line_id = created["items"][0]["id"]

    status, body = _request("PATCH", f"/api/orders/order-1/items/{line_id}", {"quantity": 4})
    assert status == 200 and body["items"][0]["quantity"] == 4

    # And the batch finds that same line again, by either id.
    status, body = _request("PUT", URL, {"lines": [{"client_line_id": CID, "quantity": 0}]})
    assert status == 200 and body["items"] == []


def test_an_invalid_body_answers_422_with_the_details_the_client_turns_into_a_sentence(http):
    status, body = _request("PUT", URL, {"lines": [
        {"client_line_id": CID, "quantity": 1}, {"client_line_id": CID, "quantity": 2},
    ]})
    assert status == 422
    assert isinstance(body["detail"], list) and body["detail"]

    status, body = _request("PUT", URL, {"lines": [{"client_line_id": CID, "quantity": -1}]})
    assert status == 422
    assert any("quantity" in entry["loc"] for entry in body["detail"])

    status, _ = _request("PUT", URL, {"lines": []})
    assert status == 422


def test_the_body_is_the_batch_itself_not_a_wrapper(http):
    status, _ = _request("PUT", URL, {"data": {"lines": [{"client_line_id": CID, "quantity": 1}]}})
    assert status == 422


def test_only_put_is_allowed(http):
    status, _ = _request("POST", URL, {"lines": [{"client_line_id": CID, "quantity": 1}]})
    assert status == 405


@pytest.mark.parametrize("role", ["cocina", "cajero"])
def test_kitchen_and_cashier_are_refused(http, role):
    _, act_as = http
    act_as(role)
    status, body = _request("PUT", URL, {"lines": [{"client_line_id": CID, "product_id": "p-sopa", "quantity": 1}]})

    assert status == 403
    assert "Requiere rol" in body["detail"]


def test_a_closed_order_answers_400_with_its_reason(http):
    db, _ = http
    db.orders.rows[0]["status"] = "pagado"
    status, body = _request("PUT", URL, {"lines": [{"client_line_id": CID, "product_id": "p-sopa", "quantity": 1}]})

    assert status == 400
    assert body["detail"] == "No se puede modificar un pedido cerrado"


def test_a_stale_version_answers_409_with_the_conflict_code(http):
    status, body = _request("PUT", URL, {
        "lines": [{"client_line_id": CID, "product_id": "p-sopa", "quantity": 1}],
        "version": "2025-12-31T00:00:00+00:00",
    })

    assert status == 409
    assert body["detail"]["code"] == "account_changed"
