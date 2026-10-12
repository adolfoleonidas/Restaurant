"""Order and payment totals, pinned before and after moving the math into billing.py.

The first block characterizes the route behavior (it passed on the code that
computed totals inline). The second block tests the billing helpers directly.
"""
import asyncio
import copy

import pytest
from fastapi import HTTPException

from models import OrderItemInput, OrderItemUpdate, OrderSplit, PaymentLine, PublicItemUpdate, PublicItemsAdd
from routes.orders import split_order, update_item
from routes.payments import create_payment
import routes.orders as order_routes
import routes.products as product_routes
import routes.public as public_routes
from tests.test_money_integrity import (
    RID,
    _DB,
    _bind,
    _cashier,
    _mozo,
    _open_register,
    _order,
    _payment_body,
    _table_item,
    _table_row,
)


def _product(pid, price, **extra):
    return {"id": pid, "restaurant_id": RID, "name": pid.title(), "price": price, "is_available": True, **extra}


def _db_with_products(*products):
    db = _DB()
    db.products.docs.extend(products)
    _bind(db)
    public_routes.db = db
    product_routes.db = db
    return db


def _line(item_id, quantity, price, status="pendiente", **extra):
    return {
        "id": item_id, "product_id": f"prod-{item_id}", "product_name": item_id.title(),
        "quantity": quantity, "unit_price": price, "subtotal": price * quantity,
        "paid_qty": 0, "status": status, **extra,
    }


# --- characterization: inline math in the routes ---------------------------------

def test_staff_pricing_sums_quantities_and_keeps_raw_floats():
    async def run():
        _db_with_products(_product("sopa", 12.5), _product("cafe", 0.1))
        items = [{"product_id": "sopa", "quantity": 3}, {"product_id": "cafe", "quantity": 3}]
        return await order_routes._compute_total(items, RID)

    enriched, subtotal = asyncio.run(run())
    assert [line["subtotal"] for line in enriched] == [37.5, 0.1 * 3]
    # The raw accumulation is stored as is; rounding only happens when billed.
    assert subtotal == 37.5 + 0.1 * 3
    assert [line["unit_price"] for line in enriched] == [12.5, 0.1]


def test_staff_pricing_prices_a_combo_as_one_line_and_rejects_unavailable():
    async def run():
        _db_with_products(
            _product("menu", 30.0, is_combo=True, combo_items=[{"product_id": "sopa", "quantity": 1}]),
            _product("sopa", 12.5),
            _product("agotado", 9.0, is_available=False),
        )
        priced = await order_routes._compute_total([{"product_id": "menu", "quantity": 2}], RID)
        with pytest.raises(HTTPException) as caught:
            await order_routes._compute_total([{"product_id": "agotado", "quantity": 1}], RID)
        return priced, caught.value

    (enriched, subtotal), error = asyncio.run(run())
    assert subtotal == 60.0
    assert enriched[0]["is_combo"] is True and enriched[0]["subtotal"] == 60.0
    assert [c["product_id"] for c in enriched[0]["combo_components"]] == ["sopa"]
    assert error.status_code == 400


def test_public_pricing_matches_staff_pricing():
    async def run():
        _db_with_products(_product("sopa", 12.5), _product("cafe", 0.1))
        items = [OrderItemInput(product_id="sopa", quantity=3), OrderItemInput(product_id="cafe", quantity=3)]
        return await public_routes._enrich_items(items, {"id": RID})

    enriched, subtotal = asyncio.run(run())
    assert [line["subtotal"] for line in enriched] == [37.5, 0.1 * 3]
    assert subtotal == 37.5 + 0.1 * 3


def test_editing_a_quantity_reprices_the_line_and_skips_cancelled_ones():
    async def run():
        db = _DB()
        order = _order(status="pendiente_pago", delivery_fee=5.0, discount=3.0, tip=2.0, subtotal=0.0, total=0.0)
        order["items"] = [_line("a", 1, 20.0, "borrador"), _line("b", 2, 5.0, "cancelado")]
        db.orders.docs.append(order)
        _bind(db)
        await update_item("order-1", "a", OrderItemUpdate(quantity=3), _mozo())
        return await db.orders.find_one({"id": "order-1"})

    stored = asyncio.run(run())
    assert stored["items"][0]["subtotal"] == 60.0
    # 60 (the cancelled line is not billed) + 5 delivery - 3 discount + 2 tip.
    assert stored["subtotal"] == 60.0
    assert stored["total"] == 64.0


def test_split_totals_are_rounded_sums_of_each_group():
    async def run():
        async def order_number(rid):
            return 99

        db = _DB()
        db.tables.docs.append(_table_row("table-1", "ocupada", "att-1"))
        db.attentions.docs.append({
            "id": "att-1", "restaurant_id": RID, "branch_id": "branch-1",
            "table_id": "table-1", "order_id": "order-1", "order_ids": ["order-1"], "status": "open",
        })
        db.orders.docs.append(_order(
            id="order-1", order_type="mesa", status="en_preparacion", table_id="table-1",
            attention_id="att-1", subtotal=0.0, total=0.0,
            items=[
                _table_item("i1", "p1", "Uno", 0.1),
                _table_item("i2", "p2", "Dos", 0.2),
                _table_item("i3", "p3", "Tres", 0.7),
                _table_item("i4", "p4", "Cuatro", 10.005),
            ],
        ))
        _bind(db)
        order_routes._next_order_number = order_number
        await split_order("order-1", OrderSplit(parts=2), _mozo())
        return db

    db = asyncio.run(run())
    original = next(o for o in db.orders.docs if o["id"] == "order-1")
    created = next(o for o in db.orders.docs if o["id"] != "order-1")
    assert (original["subtotal"], original["total"]) == (0.8, 0.8)
    assert (created["subtotal"], created["total"]) == (round(0.2 + 10.005, 2), round(0.2 + 10.005, 2))
    assert original["discount"] == 0.0 and created["tip"] == 0.0


def test_line_charge_amount_is_unit_price_times_quantity():
    async def run():
        db = _DB()
        order = _order(subtotal=45.5, total=45.5)
        order["items"] = [_line("a", 3, 10.5, "entregado"), _line("b", 2, 7.0, "entregado")]
        db.orders.docs.append(order)
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        body = _payment_body(amount=0, received_amount=100, lines=[PaymentLine(item_id="a", quantity=2)])
        paid = await create_payment(body, _cashier())
        return paid, await db.orders.find_one({"id": "order-1"})

    paid, stored = asyncio.run(run())
    assert paid["amount"] == 21.0
    assert paid["lines"] == [{"item_id": "a", "quantity": 2, "name": "A"}]
    assert paid["remaining"] == 24.5
    assert paid["fully_paid"] is False
    assert stored["amount_paid"] == 21.0
    assert stored["items"][0]["paid_qty"] == 2


def test_public_quantity_edit_reprices_and_adds_the_delivery_fee_back():
    async def run():
        db = _db_with_products()
        order = _order(
            tracking_code="TRACK123", status="enviado_cocina", subtotal=0.0, total=0.0,
            delivery_fee=4.0, source="public",
        )
        order["items"] = [_line("a", 1, 9.5), _line("b", 1, 3.0, "cancelado")]
        db.orders.docs.append(order)

        async def restaurant():
            return {"id": RID}

        public_routes._get_restaurant = restaurant
        public_routes.emit_order = lambda *args, **kwargs: None
        request = type("R", (), {"client": type("C", (), {"host": "10.0.0.5"})(), "headers": {}})()
        await public_routes.public_update_item("TRACK123", "a", PublicItemUpdate(quantity=3), request)
        return await db.orders.find_one({"id": "order-1"})

    stored = asyncio.run(run())
    assert stored["items"][0]["subtotal"] == 28.5
    assert stored["subtotal"] == 28.5
    assert stored["total"] == 32.5


# --- billing helpers, tested directly ----------------------------------------------

def test_line_subtotal_is_not_rounded():
    from billing import line_subtotal

    assert line_subtotal(0.1, 3) == 0.1 * 3
    assert line_subtotal(12.5, 4) == 50.0


def test_sum_line_subtotals_accumulates_in_order_from_zero():
    from billing import sum_line_subtotals

    values = [0.1, 0.2, 0.7, 10.005]
    expected = 0.0
    for value in values:
        expected += value
    assert sum_line_subtotals(values) == expected
    assert sum_line_subtotals([]) == 0.0


def test_line_charge_amount_reads_the_stored_unit_price():
    from billing import line_charge_amount

    assert line_charge_amount({"unit_price": 10.5}, 2) == 21.0
    assert line_charge_amount({"unit_price": None}, 2) == 0.0
    assert line_charge_amount({}, 5) == 0.0


def test_split_group_totals_rounds_the_sum_and_counts_every_line():
    from billing import split_group_totals

    items = [{"subtotal": 0.1}, {"subtotal": 0.2}, {"subtotal": 5.0, "status": "cancelado"}, {}]
    assert split_group_totals(items) == (5.3, 5.3)
    assert split_group_totals([]) == (0.0, 0.0)


def test_public_order_totals_round_subtotal_and_subtotal_plus_delivery():
    from billing import public_order_totals

    assert public_order_totals(37.800000000000004, 0.0) == (37.8, 37.8)
    assert public_order_totals(10.004, 4.0) == (10.0, 14.0)
    assert public_order_totals(0.0, 3.5) == (0.0, 3.5)


def test_paid_total_balance_and_remaining():
    from billing import balance_due, paid_total, remaining_due

    assert paid_total([{"amount": 8}, {"amount": 12.005}, {"amount": None}, {}]) == 20.01
    assert paid_total([]) == 0
    assert balance_due(20.0, 8.0) == 12.0
    assert balance_due(20.0, 25.0) == -5.0
    assert remaining_due(20.0, 25.0) == 0.0
    assert remaining_due(20.0, 8.004) == 12.0


def test_paid_after_refund_never_goes_below_zero():
    from billing import paid_after_refund

    assert paid_after_refund(40.0, 15.5) == 24.5
    assert paid_after_refund(10.0, 40.0) == 0.0
    assert paid_after_refund(None, None) == 0.0
