"""Nota general de cocina del pedido (S3-3).

`orders.notes` ya viaja en `POST /orders` y Cocina lo muestra; lo que faltaba
era un camino para actualizarlo en un pedido abierto. Cubre:
  * guardar, recortar y limpiar la nota;
  * el rechazo en pedidos cerrados, igual que el alias de la cuenta;
  * el máximo de largo del modelo.
"""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import routes.orders as order_routes  # noqa: E402
from branch_isolation_fakes import _Collection  # noqa: E402
from models import OrderNotes  # noqa: E402

RID = "tenant-1"
STAMP = "2026-01-01T00:00:00+00:00"


class _FakeDB:
    def __init__(self, *, orders=()):
        self.orders = _Collection(orders)
        self.branches = _Collection([{"id": "branch-1", "restaurant_id": RID}])
        self.audit_logs = _Collection()
        self.counters = _Collection()


def _user(role="mozo"):
    return {"id": "mozo-1", "restaurant_id": RID, "role": role, "full_name": "Mozo", "branch_id": "branch-1"}


def _order(order_id="order-1", status="nuevo", **extra):
    row = {
        "id": order_id,
        "restaurant_id": RID,
        "branch_id": "branch-1",
        "table_id": "table-1",
        "order_number": 12,
        "status": status,
        "order_type": "mesa",
        "subtotal": 0.0,
        "discount": 0.0,
        "tip": 0.0,
        "delivery_fee": 0.0,
        "amount_paid": 0.0,
        "total": 0.0,
        "notes": None,
        "updated_at": STAMP,
        "items": [],
    }
    row.update(extra)
    return row


def _bind(db):
    order_routes.db = db
    order_routes.emit_order = lambda *a, **k: None
    order_routes.emit_notice = lambda *a, **k: None

    async def noop(*args, **kwargs):
        return None

    order_routes.number_accepted_order = noop


def test_saving_the_kitchen_note_on_an_open_order():
    async def run():
        db = _FakeDB(orders=[_order()])
        _bind(db)
        return await order_routes.set_order_notes("order-1", OrderNotes(notes="Sin cebolla para la mesa 4"), _user())

    order = asyncio.run(run())
    assert order["notes"] == "Sin cebolla para la mesa 4"


def test_the_kitchen_note_is_trimmed():
    async def run():
        db = _FakeDB(orders=[_order()])
        _bind(db)
        return await order_routes.set_order_notes("order-1", OrderNotes(notes="  Sin ají  "), _user())

    order = asyncio.run(run())
    assert order["notes"] == "Sin ají"


def test_an_empty_kitchen_note_clears_it():
    async def run():
        db = _FakeDB(orders=[_order(notes="Vieja")])
        _bind(db)
        return await order_routes.set_order_notes("order-1", OrderNotes(notes="   "), _user())

    order = asyncio.run(run())
    assert order["notes"] is None


def test_a_closed_order_cannot_change_its_kitchen_note():
    async def run():
        db = _FakeDB(orders=[_order(status="pagado")])
        _bind(db)
        await order_routes.set_order_notes("order-1", OrderNotes(notes="Tarde"), _user())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert caught.value.status_code == 400


def test_a_cancelled_order_cannot_change_its_kitchen_note():
    async def run():
        db = _FakeDB(orders=[_order(status="cancelado")])
        _bind(db)
        await order_routes.set_order_notes("order-1", OrderNotes(notes="Tarde"), _user())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert caught.value.status_code == 400


def test_the_kitchen_note_has_a_bounded_length():
    assert OrderNotes(notes="x" * 500).notes == "x" * 500
    with pytest.raises(ValidationError):
        OrderNotes(notes="x" * 501)
