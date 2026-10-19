"""Fase 1 / T7: topes del stream público, reject con scope, carrito congelado y /auth/me.

Cada bloque fija un hallazgo de la auditoría del 19-10:
  1. `GET /public/stream` no tenía tope: una IP sostenía miles de streams y cada
     `publish()` los recorre todos dentro del único event loop.
  2. `prepay.reject` no aplicaba el scope de sucursal que sí usa `confirm`, y su
     actualización podía pisar un `confirm` concurrente.
  3. Tras reportar el pago el cliente seguía pudiendo cambiar el carrito, así que
     caja verificaba un monto distinto del que se terminaba cobrando.
  4. `GET /auth/me` es la fuente que el frontend usa para refrescar permisos: debe
     devolver al usuario exactamente como lo hace el login.
"""
import asyncio
import gc
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "restaurant_db_unit")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-for-the-fase1-hardening-tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import auth as auth_module  # noqa: E402
import notify  # noqa: E402
import routes.auth as auth_routes  # noqa: E402
import routes.prepay as prepay_routes  # noqa: E402
import routes.public as public_routes  # noqa: E402
from auth import hash_password  # noqa: E402
from models import LoginInput, OrderItemInput, PublicProofUpload  # noqa: E402
from test_money_integrity import _DB, _cashier  # noqa: E402
from test_table_qr_prepay_flow import _bind, _body, _create, _png_proof, _Request, _world  # noqa: E402


# ---------- 1. topes del stream público ----------

@pytest.fixture(autouse=True)
def _clean_stream_state():
    public_routes._reset_public_streams()
    yield
    public_routes._reset_public_streams()


def _stream_db():
    db = _DB()
    db.restaurants.docs.append({"id": "tenant-1", "name": "Sabor"})
    public_routes.db = db
    return db


async def _open(host, restaurant_id="tenant-1"):
    return await public_routes.public_stream(_Request(host), restaurant_id=restaurant_id)


async def _close(response):
    """Cierra un stream como lo hace Starlette: arrancándolo y cancelándolo/cerrándolo."""
    iterator = response.body_iterator
    await iterator.__anext__()
    await iterator.aclose()


def test_one_host_cannot_hold_more_than_the_per_host_cap_of_public_streams():
    async def run():
        _stream_db()
        opened = [await _open("203.0.113.9") for _ in range(public_routes._PUBLIC_STREAM_PER_HOST)]
        with pytest.raises(HTTPException) as caught:
            await _open("203.0.113.9")
        other_host = await _open("203.0.113.10")
        for response in opened + [other_host]:
            await _close(response)
        return caught.value

    error = asyncio.run(run())
    assert error.status_code == 429


def test_closing_a_stream_frees_its_slot():
    async def run():
        _stream_db()
        opened = [await _open("203.0.113.9") for _ in range(public_routes._PUBLIC_STREAM_PER_HOST)]
        await _close(opened.pop())
        reopened = await _open("203.0.113.9")
        for response in opened + [reopened]:
            await _close(response)
        return public_routes._PUBLIC_STREAMS

    state = asyncio.run(run())
    assert state["total"] == 0 and state["hosts"] == {}, "no slot may stay reserved after every stream closed"


def test_the_global_cap_refuses_new_streams_from_any_host(monkeypatch):
    monkeypatch.setattr(public_routes, "_PUBLIC_STREAM_GLOBAL", 3)

    async def run():
        _stream_db()
        opened = [await _open(f"203.0.113.{n}") for n in range(3)]
        with pytest.raises(HTTPException) as caught:
            await _open("198.51.100.1")
        for response in opened:
            await _close(response)
        return caught.value

    assert asyncio.run(run()).status_code == 429


def test_an_unknown_restaurant_gets_404_and_leaks_no_slot():
    async def run():
        _stream_db()
        errors = []
        for _ in range(public_routes._PUBLIC_STREAM_PER_HOST + 2):
            with pytest.raises(HTTPException) as caught:
                await _open("203.0.113.9", restaurant_id="no-such-restaurant")
            errors.append(caught.value.status_code)
        # Si cada intento fallido hubiera dejado su cupo, este ya estaría topado.
        ok = await _open("203.0.113.9")
        await _close(ok)
        return errors

    assert set(asyncio.run(run())) == {404}


def test_an_unknown_tracking_code_gets_404_and_leaks_no_slot():
    async def run():
        _stream_db()
        for _ in range(public_routes._PUBLIC_STREAM_PER_HOST + 2):
            with pytest.raises(HTTPException) as caught:
                await public_routes.public_stream(_Request("203.0.113.9"), tracking="NOPE")
            assert caught.value.status_code == 404
        return public_routes._PUBLIC_STREAMS["total"]

    assert asyncio.run(run()) == 0


def test_a_stream_that_never_starts_does_not_leak_its_slot_or_its_queue():
    """Starlette puede soltar la respuesta sin iterarla (cliente que se va a medias)."""
    async def run():
        _stream_db()
        before = set(notify._subs)
        response = await _open("203.0.113.9")
        assert public_routes._PUBLIC_STREAMS["total"] == 1
        del response
        gc.collect()
        return public_routes._PUBLIC_STREAMS["total"], set(notify._subs) == before

    total, subs_clean = asyncio.run(run())
    assert total == 0
    assert subs_clean


def test_a_public_stream_ends_after_its_lifetime_so_the_client_reconnects(monkeypatch):
    monkeypatch.setattr(public_routes, "_PUBLIC_STREAM_MAX_SECONDS", 0.05)

    async def run():
        _stream_db()
        response = await _open("203.0.113.9")

        async def drain():
            return [chunk async for chunk in response.body_iterator]

        chunks = await asyncio.wait_for(drain(), timeout=3)
        return chunks, public_routes._PUBLIC_STREAMS["total"]

    chunks, total = asyncio.run(run())
    assert "hello" in chunks[0]
    assert total == 0, "the slot must be released when the lifetime elapses"


def test_an_event_error_inside_the_stream_still_releases_the_slot(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("filtro roto")

    monkeypatch.setattr(public_routes, "public_allowed", boom)

    async def run():
        _stream_db()
        response = await _open("203.0.113.9")
        iterator = response.body_iterator
        await iterator.__anext__()
        notify.publish({"type": "product", "restaurant_id": "tenant-1"})
        with pytest.raises(RuntimeError):
            await iterator.__anext__()
        return public_routes._PUBLIC_STREAMS["total"]

    assert asyncio.run(run()) == 0


# ---------- 2. reject: scope de sucursal y filtro de estado ----------

def _cashier_of(branch_id):
    return {"id": "cajero-" + str(branch_id), "restaurant_id": "rest-1", "role": "cajero",
            "full_name": "Caja", "branch_id": branch_id}


def test_reject_refuses_a_cashier_of_another_branch_and_leaves_the_order_untouched():
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        db.branches.docs.append({"id": "branch-2", "restaurant_id": "rest-1", "name": "Sucursal 2"})
        created = await _create(db, _body(payment_method="yape"))
        with pytest.raises(HTTPException) as caught:
            await prepay_routes.reject_public_prepayment(created["id"], _cashier_of("branch-2"))
        stored = await db.orders.find_one({"id": created["id"]})
        return caught.value, stored

    error, stored = asyncio.run(run())
    assert error.status_code == 404
    assert stored["payment_state"] != "rechazado"


def test_reject_refuses_a_cashier_without_a_branch():
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        with pytest.raises(HTTPException) as caught:
            await prepay_routes.reject_public_prepayment(created["id"], _cashier_of(None))
        return caught.value

    assert asyncio.run(run()).status_code == 403


def test_reject_still_works_for_the_owning_branch():
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        return await prepay_routes.reject_public_prepayment(created["id"], _cashier_of("branch-1"))

    assert asyncio.run(run())["payment_state"] == "rechazado"


def test_reject_cannot_overwrite_a_confirm_that_lands_between_its_read_and_its_write():
    """El `confirm` gana la carrera: reject no puede revertir un pago ya confirmado."""
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        real_update = db.orders.update_one

        async def confirm_wins(filt, update):
            # Lo que haría un `confirm` concurrente justo antes de la escritura de reject.
            await real_update({"id": created["id"]}, {"$set": {"payment_state": "confirmado"}})
            return await real_update(filt, update)

        db.orders.update_one = confirm_wins
        with pytest.raises(HTTPException) as caught:
            await prepay_routes.reject_public_prepayment(created["id"], _cashier())
        stored = await db.orders.find_one({"id": created["id"]})
        return caught.value, stored

    error, stored = asyncio.run(run())
    assert error.status_code == 409
    assert stored["payment_state"] == "confirmado"
    assert "payment_rejected_at" not in stored


# ---------- 3. carrito congelado tras reportar el pago ----------

async def _reported_order():
    db = _world(table_prepay_mode="always")
    _bind(db)
    created = await _create(db, _body(payment_method="yape"))
    stored = await db.orders.find_one({"id": created["id"]})
    await public_routes.upload_proof(
        stored["tracking_code"], PublicProofUpload(payment_proof=_png_proof()), _Request()
    )
    reported = await db.orders.find_one({"id": created["id"]})
    assert reported["payment_state"] == "reportado"
    return db, reported


def test_add_item_is_blocked_with_409_once_the_payment_was_reported():
    async def run():
        _db, order = await _reported_order()
        with pytest.raises(HTTPException) as caught:
            await public_routes.public_add_items(
                order["tracking_code"],
                public_routes.PublicItemsAdd(items=[OrderItemInput(product_id="prod-2", quantity=1)]),
                _Request(),
            )
        return caught.value

    error = asyncio.run(run())
    assert error.status_code == 409
    assert "pago" in error.detail.lower() and "personal" in error.detail.lower()


def test_update_and_remove_item_are_blocked_with_409_once_the_payment_was_reported():
    async def run():
        db, order = await _reported_order()
        item_id = order["items"][0]["id"]
        with pytest.raises(HTTPException) as updating:
            await public_routes.public_update_item(
                order["tracking_code"], item_id, public_routes.PublicItemUpdate(quantity=3), _Request()
            )
        with pytest.raises(HTTPException) as removing:
            await public_routes.public_remove_item(order["tracking_code"], item_id, _Request())
        after = await db.orders.find_one({"id": order["id"]})
        return updating.value, removing.value, order, after

    updating, removing, before, after = asyncio.run(run())
    assert updating.status_code == 409 and removing.status_code == 409
    assert after["items"] == before["items"] and after["total"] == before["total"]


def test_the_cart_stays_editable_before_the_payment_is_reported():
    """Solo `reportado` congela: un pago aún no reportado deja armar el carrito."""
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        assert stored["payment_state"] == "pendiente"
        return await public_routes.public_add_items(
            stored["tracking_code"],
            public_routes.PublicItemsAdd(items=[OrderItemInput(product_id="prod-2", quantity=1)]),
            _Request(),
        )

    assert len(asyncio.run(run())["items"]) == 2


# ---------- 4. GET /auth/me ----------

class _Users:
    def __init__(self, rows):
        self.rows = rows

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if all(row.get(k) == v for k, v in query.items()):
                out = dict(row)
                for key, hidden in (projection or {}).items():
                    if not hidden:
                        out.pop(key, None)
                return out
        return None


class _AuthDB:
    def __init__(self, rows):
        self.users = _Users(rows)


def _mozo_row(**extra):
    return {
        "id": "u-mozo", "email": "mozo@x.pe", "password_hash": hash_password("test1234"),
        "restaurant_id": "r1", "role": "mozo", "status": "active", "branch_id": "branch-1",
        "functions": ["atencion"], "full_name": "Mozo", **extra,
    }


def test_me_returns_the_same_user_as_the_login_without_the_password_hash(monkeypatch):
    db = _AuthDB([_mozo_row()])
    monkeypatch.setattr(auth_routes, "db", db)
    monkeypatch.setattr(auth_module, "db", db)
    auth_routes._login_failures.clear()

    async def run():
        login = await auth_routes.login(_Request("10.0.0.1"), LoginInput(email="mozo@x.pe", password="test1234"))
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=login["access_token"])
        current = await auth_module.get_current_user(creds)
        return login["user"], await auth_routes.me(current)

    from_login, from_me = asyncio.run(run())
    assert from_me == from_login
    assert "password_hash" not in from_me


def test_me_reflects_functions_granted_after_the_token_was_issued(monkeypatch):
    """El caso del mozo con `cobro`: el permiso nuevo llega sin volver a iniciar sesión."""
    rows = [_mozo_row()]
    db = _AuthDB(rows)
    monkeypatch.setattr(auth_routes, "db", db)
    monkeypatch.setattr(auth_module, "db", db)
    auth_routes._login_failures.clear()

    async def run():
        login = await auth_routes.login(_Request("10.0.0.1"), LoginInput(email="mozo@x.pe", password="test1234"))
        rows[0]["functions"] = ["atencion", "cobro"]
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=login["access_token"])
        return login["user"], await auth_routes.me(await auth_module.get_current_user(creds))

    stale, fresh = asyncio.run(run())
    assert "cobro" not in stale["functions"]
    assert "cobro" in fresh["functions"]


def test_me_is_a_get_route_guarded_by_get_current_user():
    routes = [r for r in auth_routes.router.routes if getattr(r, "path", None) == "/me"]
    assert routes and "GET" in routes[0].methods
    dependencies = [d.call for d in routes[0].dependant.dependencies]
    assert auth_module.get_current_user in dependencies
