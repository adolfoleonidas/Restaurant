"""Modo «solo pedidos»: liberar la mesa sin validar pago ni comida.

El ajuste `require_payment_to_close` es del local y arranca encendido: todo lo
que ya existía sigue igual. Apagado, el cierre archiva las cuentas abiertas como
`cerrado_sin_cobro` —sin inventar dinero— y libera la mesa.
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

from attention import close_table_attention  # noqa: E402
from models import RestaurantUpdate  # noqa: E402
from service_policy import require_payment_to_close  # noqa: E402
from test_attention_lifecycle import _DB, _attention, _order, _ready_db, _user  # noqa: E402


def _unpaid_order(**changes):
    row = _order(
        status="entregado",
        fulfillment_status="entregado",
        payment_status="pendiente",
        amount_paid=0.0,
        total=25.0,
        items=[{"id": "item-1", "quantity": 1, "status": "entregado"}],
    )
    row.update(changes)
    return row


def _unpaid_db(order=None):
    db = _ready_db(order or _unpaid_order())
    # Sin cobros: la cuenta no está liquidada.
    db.payments.docs.clear()
    return db


def test_payment_control_defaults_on_and_only_an_explicit_false_turns_it_off():
    assert require_payment_to_close(None) is True
    assert require_payment_to_close({}) is True
    assert require_payment_to_close({"require_payment_to_close": True}) is True
    assert require_payment_to_close({"require_payment_to_close": None}) is True
    assert require_payment_to_close({"require_payment_to_close": False}) is False


def test_restaurant_update_accepts_the_setting():
    # `PATCH /restaurants/current` filtra los None; un false explícito viaja.
    data = RestaurantUpdate(require_payment_to_close=False)
    assert data.model_dump(exclude_unset=True) == {"require_payment_to_close": False}
    assert RestaurantUpdate().model_dump(exclude_unset=True) == {}


def test_sales_only_close_archives_unpaid_account_without_inventing_money():
    async def run():
        db = _unpaid_db()
        await close_table_attention(
            db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00",
            enforce_settlement=False,
        )
        return db

    db = asyncio.run(run())
    order = db.orders.docs[0]
    assert order["status"] == "cerrado_sin_cobro"
    assert order["payment_status"] == "pendiente"
    assert order["amount_paid"] == 0.0
    assert order["attention_state"] == "closed"
    # La comanda no se toca: cocina y mozo siguen trabajando con los mismos
    # estados de plato. El modo solo cambia cómo se libera la mesa.
    assert order["fulfillment_status"] == "entregado"
    assert order["items"][0]["status"] == "entregado"
    assert order["closed_without_payment"] is True
    assert db.attentions.docs[0]["status"] == "closed"
    assert db.attentions.docs[0]["closed_without_payment"] is True
    assert db.tables.docs[0]["status"] == "disponible"
    assert "active_attention_id" not in db.tables.docs[0]
    assert db.audit_logs.docs[0]["details"]["closed_without_payment"] is True


def test_sales_only_close_keeps_a_paid_sibling_paid_and_is_idempotent():
    async def run():
        db = _unpaid_db()
        db.orders.docs.append(_order(
            id="order-2", attention_id="attention-1", status="pagado",
            payment_status="pagado", amount_paid=10.0, total=10.0,
        ))
        db.attentions.docs[0]["order_ids"] = ["order-1", "order-2"]
        await close_table_attention(
            db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00",
            enforce_settlement=False,
        )
        # Reintento del mismo cierre: no vuelve a escribir el estado ni el audit.
        await close_table_attention(
            db, order=await db.orders.find_one({"id": "order-1"}), user=_user(),
            now="2026-09-30T13:05:00+00:00", enforce_settlement=False,
        )
        return db

    db = asyncio.run(run())
    by_id = {order["id"]: order for order in db.orders.docs}
    assert by_id["order-1"]["status"] == "cerrado_sin_cobro"
    assert by_id["order-2"]["status"] == "pagado"
    assert "closed_without_payment" not in by_id["order-2"]
    assert len(db.audit_logs.docs) == 1


def test_payment_control_on_still_blocks_an_unpaid_close():
    async def run():
        db = _unpaid_db()
        with pytest.raises(Exception, match="liquidación completa"):
            await close_table_attention(
                db, order=db.orders.docs[0], user=_user(), now="2026-09-30T13:00:00+00:00",
            )
        return db

    db = asyncio.run(run())
    assert db.orders.docs[0]["status"] == "entregado"
    assert db.tables.docs[0]["status"] == "ocupada"


def test_release_endpoint_in_sales_only_mode_closes_the_visit_and_frees_the_table(monkeypatch):
    import routes.tables as table_routes

    async def run():
        db = _unpaid_db()
        db.restaurants.docs.append({"id": "restaurant-1", "require_payment_to_close": False})
        monkeypatch.setattr(table_routes, "db", db)
        monkeypatch.setattr(table_routes, "emit_notice", lambda *args, **kwargs: None)

        async def no_audit(*args, **kwargs):
            return None

        monkeypatch.setattr(table_routes, "record_audit", no_audit)
        return await table_routes.release_table("table-1", user=_user()), db

    result, db = asyncio.run(run())
    assert result["status"] == "disponible"
    assert result["active_order"] is None
    assert db.orders.docs[0]["status"] == "cerrado_sin_cobro"
    assert db.orders.docs[0]["payment_status"] == "pendiente"
    assert db.attentions.docs[0]["closed_without_payment"] is True


def test_close_route_reads_the_venue_setting(monkeypatch):
    import routes.orders as order_routes

    async def run():
        db = _unpaid_db()
        db.restaurants.docs.append({"id": "restaurant-1", "require_payment_to_close": False})
        monkeypatch.setattr(order_routes, "db", db)
        monkeypatch.setattr(order_routes, "emit_notice", lambda *args, **kwargs: None)
        attention = await order_routes.close_attention("order-1", user=_user())
        return attention, db

    attention, db = asyncio.run(run())
    assert attention["status"] == "closed"
    assert attention["closed_without_payment"] is True
    assert db.orders.docs[0]["status"] == "cerrado_sin_cobro"


def test_release_without_a_visit_archives_the_loose_account(monkeypatch):
    import routes.tables as table_routes

    async def run():
        db = _DB()
        db.branches.docs.append({"id": "branch-1", "restaurant_id": "restaurant-1"})
        db.tables.docs.append({
            "id": "table-1", "restaurant_id": "restaurant-1", "branch_id": "branch-1",
            "number": 1, "status": "ocupada",
        })
        db.orders.docs.append(_unpaid_order(attention_id=None))
        db.restaurants.docs.append({"id": "restaurant-1", "require_payment_to_close": False})
        monkeypatch.setattr(table_routes, "db", db)
        monkeypatch.setattr(table_routes, "emit_notice", lambda *args, **kwargs: None)

        async def no_audit(*args, **kwargs):
            return None

        monkeypatch.setattr(table_routes, "record_audit", no_audit)
        return await table_routes.release_table("table-1", user=_user()), db

    result, db = asyncio.run(run())
    assert result["status"] == "disponible"
    assert db.orders.docs[0]["status"] == "cerrado_sin_cobro"
    assert db.orders.docs[0]["closed_without_payment"] is True
    assert db.orders.docs[0]["total"] == 25.0


def test_release_endpoint_keeps_the_old_refusal_when_payment_is_required(monkeypatch):
    import routes.tables as table_routes

    async def run():
        db = _unpaid_db()
        # Un local sin el ajuste (o con true) conserva el comportamiento actual.
        db.restaurants.docs.append({"id": "restaurant-1"})
        monkeypatch.setattr(table_routes, "db", db)
        monkeypatch.setattr(table_routes, "emit_notice", lambda *args, **kwargs: None)

        async def no_audit(*args, **kwargs):
            return None

        monkeypatch.setattr(table_routes, "record_audit", no_audit)
        with pytest.raises(HTTPException) as exc:
            await table_routes.release_table("table-1", user=_user())
        return exc.value, db

    exc, db = asyncio.run(run())
    assert exc.status_code == 400
    assert db.tables.docs[0]["status"] == "ocupada"
    assert db.orders.docs[0]["status"] == "entregado"
