"""Regularizar una cuenta que el piso cerró sin cobro.

El modo «solo pedidos» archiva la cuenta como `cerrado_sin_cobro` sin inventar
dinero. Cuando el local quiera pasarla a venta, el cajero registra el cobro
manual sobre esa cuenta: el pago entra al turno y al reporte, la cuenta queda
`pagado` si se cubre el total, y la visita sigue cerrada (la mesa ya es libre).
"""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from routes.payments import apply_void_payment, create_payment  # noqa: E402
from test_money_integrity import (  # noqa: E402
    RID,
    STAMP,
    _bind,
    _cashier,
    _DB,
    _open_register,
    _order,
    _payment_body,
)


def _closed_order(**extra):
    doc = _order(
        status="cerrado_sin_cobro",
        fulfillment_status="entregado",
        payment_status="pendiente",
        closed_without_payment=True,
        closed_without_payment_at=STAMP,
        closed_without_payment_by="mozo-1",
        attention_id="attention-1",
        attention_state="closed",
        table_id="table-1",
        **extra,
    )
    return doc


def _world(order=None):
    db = _DB()
    db.orders.docs.append(order or _closed_order())
    db.cash_registers.docs.append(_open_register())
    db.tables.docs.append({
        "id": "table-1", "restaurant_id": RID, "branch_id": "branch-1",
        "number": 4, "status": "disponible",
    })
    _bind(db)
    return db


def test_a_full_manual_payment_turns_the_closed_account_into_a_sale():
    async def run():
        db = _world()
        paid = await create_payment(_payment_body(), _cashier())
        return paid, await db.orders.find_one({"id": "order-1"}), await db.tables.find_one({"id": "table-1"})

    paid, stored, table = asyncio.run(run())
    assert paid["regularized"] is True
    assert paid["amount"] == 20
    assert stored["status"] == "pagado"
    assert stored["payment_status"] == "pagado"
    assert stored["amount_paid"] == 20
    assert stored["paid_at"]
    assert stored["regularized_at"]
    assert stored["regularization_payment_id"] == paid["id"]
    # La bandera histórica no se borra: dice cómo nació la cuenta.
    assert stored["closed_without_payment"] is True
    # La visita sigue cerrada y la mesa ya era libre: no se toca.
    assert stored["attention_state"] == "closed"
    assert table["status"] == "disponible"
    # Cocina no cambia: los platos y su estado quedan como estaban.
    assert stored["items"][0]["status"] == "entregado"
    assert stored["fulfillment_status"] == "entregado"


def test_a_partial_payment_keeps_the_account_closed_until_it_is_covered():
    async def run():
        db = _world()
        first = await create_payment(
            _payment_body(amount=8, received_amount=8, idempotency_key="part-1"), _cashier()
        )
        after_first = await db.orders.find_one({"id": "order-1"})
        second = await create_payment(
            _payment_body(amount=12, received_amount=12, idempotency_key="part-2"), _cashier()
        )
        after_second = await db.orders.find_one({"id": "order-1"})
        return first, after_first, second, after_second

    first, after_first, second, after_second = asyncio.run(run())
    assert first["regularized"] is True
    assert after_first["status"] == "cerrado_sin_cobro"
    assert after_first["payment_status"] == "parcial"
    assert after_first["amount_paid"] == 8
    assert after_first.get("paid_at") is None
    assert after_second["status"] == "pagado"
    assert after_second["amount_paid"] == 20
    assert second["regularized"] is True


def test_a_regularization_payment_can_be_voided_and_regularized_again():
    async def run():
        db = _world()
        paid = await create_payment(_payment_body(), _cashier())
        voided = await apply_void_payment(paid["id"], _cashier(), "cobro registrado por error")
        after_void = await db.orders.find_one({"id": "order-1"})
        again = await create_payment(
            _payment_body(amount=20, received_amount=20, idempotency_key="key-b"), _cashier()
        )
        after_again = await db.orders.find_one({"id": "order-1"})
        return voided, after_void, again, after_again

    voided, after_void, again, after_again = asyncio.run(run())
    assert voided["status"] == "voided"
    assert after_void["status"] == "cerrado_sin_cobro"
    assert after_void["payment_status"] == "pendiente"
    assert after_void["amount_paid"] == 0
    assert after_void.get("paid_at") is None
    assert after_void["regularization_voided_at"]
    assert again["regularized"] is True
    assert after_again["status"] == "pagado"
    assert after_again["amount_paid"] == 20


def test_a_normal_closed_order_cannot_be_regularized():
    async def run():
        db = _world(_order(status="cancelado", closed_without_payment=False))
        with pytest.raises(HTTPException) as exc:
            await create_payment(_payment_body(), _cashier())
        return exc.value

    assert asyncio.run(run()).status_code == 400
