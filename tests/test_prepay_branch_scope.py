"""La cola de prepagos y su confirmación respetan la sucursal, y fallan cerrado.

`prepay.py` cerraba el scope con `if user.get("branch_id")`. Un cajero sin sucursal
asignada —o con una que ya no existe— no entraba por esa rama, así que la consulta
salía sin filtro: veía los pedidos de todas las sucursales del restaurante, y podía
confirmar el cobro de cualquiera. El resto del backend usa los helpers de
`branch_access`, que fallan cerrado a propósito; estas pruebas fijan esa conducta
en los dos puntos que tenían el `if` flojo.
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

from test_table_qr_prepay_flow import _bind, _body, _create, _world  # noqa: E402
import routes.prepay as prepay_routes  # noqa: E402


def _cashier_without_branch():
    """Cajero real: rol operativo y sin sucursal asignada."""
    return {"id": "cajero-sin-sucursal", "restaurant_id": "rest-1", "role": "cajero",
            "full_name": "Caja", "branch_id": None}


def _cashier_of(branch_id):
    return {"id": "cajero-" + str(branch_id), "restaurant_id": "rest-1", "role": "cajero",
            "full_name": "Caja", "branch_id": branch_id}


def _admin():
    """El admin conserva la vista de todo el restaurante, como en el resto del API."""
    return {"id": "admin-1", "restaurant_id": "rest-1", "role": "admin",
            "full_name": "Dueño", "branch_id": None}


def test_the_prepay_queue_refuses_a_cashier_without_a_branch():
    """Antes salía sin filtro: mostraba la cola de todas las sucursales."""
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        with pytest.raises(HTTPException) as caught:
            await prepay_routes.list_pending_prepayments(_cashier_without_branch())
        return caught.value

    error = asyncio.run(run())
    assert error.status_code == 403, (
        "a branch-bound cashier with no branch must be refused, not shown every branch"
    )


def test_confirming_refuses_a_cashier_without_a_branch():
    """El otro punto: confirmar el cobro de un pedido de otra sucursal."""
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        with pytest.raises(HTTPException) as caught:
            await prepay_routes.confirm_public_prepayment(stored["id"], _cashier_without_branch())
        return caught.value

    error = asyncio.run(run())
    assert error.status_code == 403


def test_a_cashier_of_another_branch_cannot_confirm_a_foreign_order():
    """El caso de fondo: pedido de branch-1, cajero de branch-2."""
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        db.branches.docs.append({"id": "branch-2", "restaurant_id": "rest-1", "name": "Sucursal 2"})
        created = await _create(db, _body(payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        with pytest.raises(HTTPException) as caught:
            await prepay_routes.confirm_public_prepayment(stored["id"], _cashier_of("branch-2"))
        return caught.value

    error = asyncio.run(run())
    assert error.status_code == 404, "a foreign order must not be visible, let alone chargeable"


def test_a_cashier_with_a_dangling_branch_is_refused():
    """Sucursal borrada: la consulta salía sin filtro en vez de fallar."""
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        with pytest.raises(HTTPException) as caught:
            await prepay_routes.list_pending_prepayments(_cashier_of("branch-borrada"))
        return caught.value

    error = asyncio.run(run())
    assert error.status_code == 403


def test_the_admin_keeps_the_whole_restaurant_visible():
    """El cambio no puede encerrar al dueño en una sucursal."""
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        queue = await prepay_routes.list_pending_prepayments(_admin())
        confirmed = await prepay_routes.confirm_public_prepayment(stored["id"], _admin())
        return queue, confirmed, db

    queue, confirmed, db = asyncio.run(run())
    assert len(queue) == 1, "the owner must still see the branchless-wide queue"
    assert confirmed["ok"] is True
    assert len(db.payments.docs) == 1


def test_the_queue_of_the_owning_branch_still_lists_its_order():
    """Y el camino normal sigue funcionando: cajero de la sucursal correcta."""
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        await _create(db, _body(payment_method="yape"))
        return await prepay_routes.list_pending_prepayments(_cashier_of("branch-1"))

    queue = asyncio.run(run())
    assert len(queue) == 1
