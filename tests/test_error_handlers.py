"""A BillError raised inside a route keeps answering 400 with the same detail."""
import asyncio
import json

from fastapi import APIRouter, FastAPI, HTTPException

from billing import BillError, assert_can_cancel
from error_handlers import bill_error_handler, register_error_handlers


def _app():
    app = FastAPI()
    register_error_handlers(app)
    router = APIRouter()

    @router.get("/bill")
    async def bill():
        assert_can_cancel({"amount_paid": 10})

    @router.get("/http")
    async def http():
        raise HTTPException(status_code=404, detail="otro")

    app.include_router(router)
    return app


def _call(app, path):
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
        "path": path, "raw_path": path.encode(), "query_string": b"", "headers": [],
        "client": ("127.0.0.1", 1), "server": ("test", 80), "scheme": "http", "root_path": "",
    }
    asyncio.run(app(scope, receive, send))
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], json.loads(body)


def test_register_installs_the_bill_error_handler():
    app = _app()
    assert app.exception_handlers[BillError] is bill_error_handler


def test_bill_error_in_a_route_answers_400_with_its_detail():
    status, body = _call(_app(), "/bill")
    assert status == 400
    assert body == {"detail": "Devuelve o anula los cobros antes de cancelar el pedido"}


def test_other_http_errors_are_untouched():
    status, body = _call(_app(), "/http")
    assert status == 404
    assert body == {"detail": "otro"}


def test_the_real_app_registers_the_handler():
    import server

    assert server.app.exception_handlers[BillError] is bill_error_handler
