"""Mesa → personas/subcuentas → productos.

Cubre las tres reglas nuevas del flujo manual:
  * cargar un producto no lo manda a cocina (queda en borrador);
  * "enviar adicionales" manda sólo lo nuevo, sin repetir la comanda;
  * lo que ya salió a cocina no se borra ni se edita: se anula, y deja de cobrarse.
"""
import asyncio
import copy
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import routes.orders as order_routes  # noqa: E402
from branch_isolation_fakes import _Collection  # noqa: E402
from models import OrderItemInput, OrderItemUpdate, OrderItemVoid, OrderItemMove, OrderAlias, OrderCreate  # noqa: E402

RID = "tenant-1"
STAMP = "2026-01-01T00:00:00+00:00"


class _FakeDB:
    def __init__(self, *, orders=(), products=(), tables=()):
        self.orders = _Collection(orders)
        self.products = _Collection(products)
        self.tables = _Collection(tables)
        self.branches = _Collection([{"id": "branch-1", "restaurant_id": RID}])
        self.audit_logs = _Collection()
        self.counters = _Collection()


def _user(role="mozo"):
    return {"id": "mozo-1", "restaurant_id": RID, "role": role, "full_name": "Mozo", "branch_id": "branch-1"}


def _cocina():
    return {**_user("cocina"), "id": "cocina-1", "full_name": "Cocina"}


def _product(product_id, name, price):
    return {"id": product_id, "restaurant_id": RID, "name": name, "price": price,
            "is_available": True, "is_combo": False, "preparation_time": 10}


def _item(item_id, product_id, name, price, quantity=1, status="borrador", **extra):
    row = {
        "id": item_id,
        "product_id": product_id,
        "product_name": name,
        "quantity": quantity,
        "unit_price": price,
        "subtotal": price * quantity,
        "paid_qty": 0,
        "notes": None,
        "status": status,
    }
    row.update(extra)
    return row


def _order(order_id="order-1", status="nuevo", items=(), order_type="mesa", **extra):
    row = {
        "id": order_id,
        "restaurant_id": RID,
        "branch_id": "branch-1",
        "table_id": "table-1",
        "order_number": 12,
        "status": status,
        "order_type": order_type,
        "subtotal": sum(float(i.get("subtotal") or 0) for i in items),
        "discount": 0.0,
        "tip": 0.0,
        "delivery_fee": 0.0,
        "amount_paid": 0.0,
        "updated_at": STAMP,
        "items": [copy.deepcopy(i) for i in items],
    }
    row["total"] = row["subtotal"]
    row.update(extra)
    return row


def _bind(db):
    order_routes.db = db
    order_routes.emit_order = lambda *a, **k: None
    order_routes.emit_notice = lambda *a, **k: None

    async def noop(*args, **kwargs):
        return None

    async def context(*args, **kwargs):
        return {"captured_at": STAMP}

    order_routes.capture_attention_context = context
    order_routes.number_accepted_order = noop


def _statuses(order):
    return {item["id"]: item["status"] for item in order["items"]}


# ---------- cargar productos no los manda a cocina ----------

def test_adding_a_product_leaves_it_as_a_draft():
    async def run():
        db = _FakeDB(orders=[_order()], products=[_product("prod-1", "Ceviche", 38.0)])
        _bind(db)
        return await order_routes.add_items("order-1", [OrderItemInput(product_id="prod-1", quantity=1)], _user())

    order = asyncio.run(run())
    assert order["status"] == "nuevo"
    assert [i["status"] for i in order["items"]] == ["borrador"]


def test_a_draft_does_not_show_up_in_the_kitchen():
    async def run():
        db = _FakeDB(
            orders=[_order(status="enviado_cocina", items=[
                _item("item-1", "prod-1", "Lomo", 20.0, status="pendiente"),
                _item("item-2", "prod-2", "Agua", 10.0, status="borrador"),
            ])],
            tables=[{"id": "table-1", "restaurant_id": RID, "number": 4, "branch_id": "branch-1"}],
        )
        _bind(db)
        board = await order_routes.kitchen_orders(_cocina())
        return board[0]["items"]

    assert [item["id"] for item in asyncio.run(run())] == ["item-1"]


# ---------- envío de la comanda y de los adicionales ----------

def test_first_send_promotes_the_drafts():
    async def run():
        db = _FakeDB(orders=[_order(items=[_item("item-1", "prod-1", "Lomo", 20.0)])])
        _bind(db)
        return await order_routes.send_to_kitchen("order-1", _user())

    order = asyncio.run(run())
    assert order["status"] == "enviado_cocina"
    assert _statuses(order) == {"item-1": "pendiente"}


def test_the_send_names_its_author_so_his_own_device_can_skip_the_echo():
    """El dispositivo que envía ya refresca el piso a propósito al enviar.

    Volver a pedir las listas por el eco de su propio envío le costaba otra ronda
    de peticiones —medido en el teléfono del mozo, unos 600 ms— justo cuando
    empieza el pedido siguiente. Para poder ignorarlo, el evento tiene que decir
    quién lo causó y de qué se trata.
    """
    events = []

    async def run():
        db = _FakeDB(orders=[_order(items=[_item("item-1", "prod-1", "Lomo", 20.0)])])
        _bind(db)
        order_routes.emit_order = lambda *a, **k: events.append((a, k))
        return await order_routes.send_to_kitchen("order-1", _user())

    asyncio.run(run())

    assert len(events) == 1
    args, kwargs = events[0]
    assert args[:3] == (RID, "order-1", "enviado_cocina")
    assert kwargs["extra"] == "send_to_kitchen"
    assert kwargs["actor_user_id"] == "mozo-1"


def test_sending_again_only_carries_the_new_products():
    async def run():
        db = _FakeDB(orders=[_order(
            status="listo",
            items=[
                _item("item-1", "prod-1", "Lomo", 20.0, status="listo"),
                _item("item-2", "prod-2", "Agua", 10.0, status="borrador"),
            ],
        )])
        _bind(db)
        return await order_routes.send_to_kitchen("order-1", _user())

    order = asyncio.run(run())
    # Lo que ya estaba en cocina no se toca: sólo viaja el adicional.
    assert _statuses(order) == {"item-1": "listo", "item-2": "pendiente"}
    assert order["status"] == "enviado_cocina"


def test_sending_without_new_products_changes_nothing():
    async def run():
        db = _FakeDB(orders=[_order(
            status="enviado_cocina",
            items=[_item("item-1", "prod-1", "Lomo", 20.0, status="pendiente")],
        )])
        _bind(db)
        return await order_routes.send_to_kitchen("order-1", _user())

    order = asyncio.run(run())
    assert _statuses(order) == {"item-1": "pendiente"}
    assert order["status"] == "enviado_cocina"


def test_an_additional_send_does_not_renumber_the_visit():
    async def run():
        db = _FakeDB(orders=[_order(
            status="enviado_cocina",
            acceptance_status="aceptado",
            attention_number_pending=False,
            attention_number=7,
            items=[
                _item("item-1", "prod-1", "Lomo", 20.0, status="pendiente"),
                _item("item-2", "prod-2", "Agua", 10.0, status="borrador"),
            ],
        )])
        _bind(db)
        numbered = []

        async def record_number(*args, **kwargs):
            numbered.append(kwargs.get("order", {}).get("id"))

        order_routes.number_accepted_order = record_number
        order = await order_routes.send_to_kitchen("order-1", _user())
        return order, numbered

    order, numbered = asyncio.run(run())
    assert numbered == []
    assert order["attention_number"] == 7
    assert _statuses(order) == {"item-1": "pendiente", "item-2": "pendiente"}


# ---------- anular en vez de borrar ----------

def test_voiding_a_sent_product_cancels_it_and_stops_charging_it():
    async def run():
        db = _FakeDB(orders=[_order(
            status="enviado_cocina",
            items=[
                _item("item-1", "prod-1", "Lomo", 20.0, status="pendiente"),
                _item("item-2", "prod-2", "Agua", 10.0, status="pendiente"),
            ],
        )])
        _bind(db)
        order = await order_routes.void_item("order-1", "item-2", OrderItemVoid(reason="El cliente se arrepintió"), _user())
        return order, db

    order, db = asyncio.run(run())
    voided = next(i for i in order["items"] if i["id"] == "item-2")
    assert voided["status"] == "cancelado"
    assert voided["void_reason"] == "El cliente se arrepintió"
    assert voided["voided_by"] == "mozo-1"
    assert order["subtotal"] == 20.0
    assert order["total"] == 20.0
    assert db.audit_logs.rows[0]["action"] == "void_item"


def test_an_already_charged_product_cannot_be_voided():
    async def run():
        db = _FakeDB(orders=[_order(
            status="enviado_cocina",
            amount_paid=10.0,
            items=[_item("item-1", "prod-1", "Lomo", 20.0, status="pendiente", paid_qty=1)],
        )])
        _bind(db)
        await order_routes.void_item("order-1", "item-1", OrderItemVoid(reason="prueba"), _user())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert caught.value.status_code == 400


def test_a_product_in_the_kitchen_cannot_be_deleted_only_voided():
    async def run():
        db = _FakeDB(orders=[_order(
            status="enviado_cocina",
            items=[_item("item-1", "prod-1", "Lomo", 20.0, status="pendiente")],
        )])
        _bind(db)
        await order_routes.remove_item("order-1", "item-1", _user())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert caught.value.status_code == 400
    assert "Anular producto" in caught.value.detail


def test_a_draft_can_still_be_deleted():
    async def run():
        db = _FakeDB(orders=[_order(items=[_item("item-1", "prod-1", "Lomo", 20.0)])])
        _bind(db)
        return await order_routes.remove_item("order-1", "item-1", _user())

    order = asyncio.run(run())
    assert order["items"] == []


def test_a_product_in_the_kitchen_cannot_be_edited_silently():
    async def run():
        db = _FakeDB(orders=[_order(
            status="enviado_cocina",
            items=[_item("item-1", "prod-1", "Lomo", 20.0, status="pendiente")],
        )])
        _bind(db)
        await order_routes.update_item("order-1", "item-1", OrderItemUpdate(quantity=3), _user())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert caught.value.status_code == 400


def test_a_draft_can_be_corrected_and_keeps_its_notes():
    async def run():
        db = _FakeDB(orders=[_order(items=[_item("item-1", "prod-1", "Pollo", 20.0)])])
        _bind(db)
        return await order_routes.update_item(
            "order-1", "item-1", OrderItemUpdate(quantity=2, notes="Sin ensalada"), _user()
        )

    order = asyncio.run(run())
    item = order["items"][0]
    assert item["quantity"] == 2
    assert item["notes"] == "Sin ensalada"
    assert order["total"] == 40.0


# ---------- mover un producto de una persona a otra ----------

def _two_persons(**extra):
    """Dos personas de la misma mesa y la misma visita."""
    juan = _order(
        "order-1", status="enviado_cocina", customer_name="Juan",
        items=[_item("item-1", "prod-1", "Pollo", 20.0, status="pendiente")],
    )
    maria = _order(
        "order-2", status="enviado_cocina", customer_name="María", items=[],
    )
    juan["attention_id"] = maria["attention_id"] = "att-1"
    return [juan, maria]


def test_moving_a_product_reassigns_it_without_losing_its_history():
    async def run():
        db = _FakeDB(orders=_two_persons())
        _bind(db)
        moved = await order_routes.move_item("order-1", "item-1", OrderItemMove(target_order_id="order-2"), _user())
        return moved, db

    moved, db = asyncio.run(run())
    assert [i["product_name"] for i in moved["items"]] == ["Pollo"]
    assert moved["total"] == 20.0
    # Conserva su estado y deja rastro de dónde vino.
    assert moved["items"][0]["status"] == "pendiente"
    assert moved["items"][0]["moved_from"] == "order-1"
    # La persona que se quedó sin nada no sigue abierta.
    origen = next(o for o in db.orders.rows if o["id"] == "order-1")
    assert origen["status"] == "cancelado"
    assert origen["items"] == []
    assert origen["total"] == 0.0


def test_moving_does_not_touch_the_kitchen_status_of_the_target():
    async def run():
        db = _FakeDB(orders=_two_persons())
        _bind(db)
        return await order_routes.move_item("order-1", "item-1", OrderItemMove(target_order_id="order-2"), _user())

    moved = asyncio.run(run())
    assert moved["status"] == "enviado_cocina"


def test_a_charged_product_cannot_be_moved():
    async def run():
        orders = _two_persons()
        orders[0]["items"][0]["paid_qty"] = 1
        orders[0]["amount_paid"] = 20.0
        db = _FakeDB(orders=orders)
        _bind(db)
        await order_routes.move_item("order-1", "item-1", OrderItemMove(target_order_id="order-2"), _user())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert caught.value.status_code == 400


def test_a_product_cannot_be_moved_to_another_visit():
    async def run():
        orders = _two_persons()
        orders[1]["attention_id"] = "att-otra"  # otra visita de la misma mesa
        db = _FakeDB(orders=orders)
        _bind(db)
        await order_routes.move_item("order-1", "item-1", OrderItemMove(target_order_id="order-2"), _user())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert caught.value.status_code == 400


def test_a_product_cannot_be_moved_to_itself():
    async def run():
        db = _FakeDB(orders=_two_persons())
        _bind(db)
        await order_routes.move_item("order-1", "item-1", OrderItemMove(target_order_id="order-1"), _user())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert caught.value.status_code == 400


# ---------- la cuenta compartida se marca desde su identidad ----------

def test_the_account_identity_carries_the_alias_and_the_shared_flag():
    async def run():
        db = _FakeDB(orders=[_order()])
        _bind(db)
        return await order_routes.set_order_alias(
            "order-1", OrderAlias(alias="Juan", shared=True), _user()
        )

    order = asyncio.run(run())
    assert order["customer_name"] == "Juan"
    assert order["shared"] is True


def test_changing_only_the_alias_does_not_clear_the_shared_flag():
    async def run():
        db = _FakeDB(orders=[_order(shared=True)])
        _bind(db)
        return await order_routes.set_order_alias("order-1", OrderAlias(alias="María"), _user())

    order = asyncio.run(run())
    assert order["customer_name"] == "María"
    assert order["shared"] is True


# ---------- cuenta compartida ----------

def test_a_shared_account_is_marked_in_the_request():
    assert OrderCreate(shared=True).shared is True
    assert OrderCreate().shared is False
