"""Money integrity: invalid amounts, delivery fee, paid orders, concurrent charges, shift refunds."""
import asyncio
import copy
import os
import sys
from pathlib import Path

import pytest
from pymongo.errors import DuplicateKeyError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "restaurant_db_unit")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi import HTTPException
from pydantic import ValidationError

from models import CashClose, CashMovement, CashOpen, OrderItemUpdate, PaymentCreate, PaymentLine, PaymentSplit, ProductCreate
from billing import method_amounts
from routes.cash import _shift_totals, add_movement, close_register
from routes.orders import add_items, change_status, kitchen_orders, merge_order, move_order, remove_item, serve_order, set_order_alias, split_order, update_item
from routes.payments import apply_void_payment, create_payment, proof_is_pending
from order_flow import ticket_fields
from routes.reports import sales_report
import routes.cash as cash_routes
import routes.orders as order_routes
import routes.payments as payment_routes
import routes.reports as report_routes


RID = "rest-1"
STAMP = "2026-09-11T12:00:00+00:00"


class _Result:
    def __init__(self, n):
        self.modified_count = n
        self.matched_count = n


def _match(doc, filt):
    for key, expected in (filt or {}).items():
        if key == "$or":
            if not any(_match(doc, clause) for clause in expected):
                return False
            continue
        if key == "$and":
            if not all(_match(doc, clause) for clause in expected):
                return False
            continue
        if isinstance(expected, dict):
            if "$nin" in expected:
                if doc.get(key) in expected["$nin"]:
                    return False
                continue
            if "$exists" in expected:
                if (key in doc) != bool(expected["$exists"]):
                    return False
                continue
            if "$in" in expected:
                if doc.get(key) not in expected["$in"]:
                    return False
                continue
            bounds = ("$gte", "$gt", "$lte", "$lt")
            if any(op in expected for op in bounds):
                value = doc.get(key)
                if value is None:
                    return False
                if "$gte" in expected and value < expected["$gte"]:
                    return False
                if "$gt" in expected and value <= expected["$gt"]:
                    return False
                if "$lte" in expected and value > expected["$lte"]:
                    return False
                if "$lt" in expected and value >= expected["$lt"]:
                    return False
                continue
        if doc.get(key) != expected:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *args, **kwargs):
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    async def to_list(self, n):
        await asyncio.sleep(0)
        return [copy.deepcopy(d) for d in self.docs[:n]]


class _Collection:
    def __init__(self):
        self.docs = []
        self._lock = asyncio.Lock()

    async def find_one(self, filt, proj=None):
        await asyncio.sleep(0)
        async with self._lock:
            for doc in self.docs:
                if _match(doc, filt):
                    return copy.deepcopy(doc)
        return None

    def find(self, filt, proj=None):
        return _Cursor([copy.deepcopy(d) for d in self.docs if _match(d, filt)])

    async def insert_one(self, doc):
        await asyncio.sleep(0)
        async with self._lock:
            if doc.get("event_id") and any(d.get("event_id") == doc.get("event_id") for d in self.docs):
                raise DuplicateKeyError("duplicate audit event id")
            if doc.get("request_id") and any(
                d.get("restaurant_id") == doc.get("restaurant_id")
                and d.get("request_id") == doc.get("request_id")
                for d in self.docs
            ):
                raise DuplicateKeyError("duplicate public request id")
            key = doc.get("idempotency_key")
            if key and any(d.get("idempotency_key") == key for d in self.docs):
                raise DuplicateKeyError("duplicate idempotency key")
            self.docs.append(copy.deepcopy(doc))

    async def update_one(self, filt, update):
        await asyncio.sleep(0)
        async with self._lock:
            for doc in self.docs:
                if _match(doc, filt):
                    for key, value in (update.get("$set") or {}).items():
                        doc[key] = copy.deepcopy(value)
                    for key, value in (update.get("$addToSet") or {}).items():
                        current = doc.setdefault(key, [])
                        if value not in current:
                            current.append(copy.deepcopy(value))
                    for key in (update.get("$unset") or {}):
                        doc.pop(key, None)
                    return _Result(1)
        return _Result(0)

    async def count_documents(self, filt):
        await asyncio.sleep(0)
        return sum(1 for doc in self.docs if _match(doc, filt))

    def aggregate(self, pipeline):
        class _Agg:
            async def to_list(self, n):
                return []

        return _Agg()


class _DB:
    def __init__(self):
        self.orders = _Collection()
        self.payments = _Collection()
        self.cash_registers = _Collection()
        self.cash_movements = _Collection()
        self.audit_logs = _Collection()
        self.restaurants = _Collection()
        self.tables = _Collection()
        self.attentions = _Collection()
        self.products = _Collection()
        self.branches = _Collection()
        self.payment_configs = _Collection()
        self.branches.docs.append({"id": "branch-1", "restaurant_id": RID})


def _bind(db):
    payment_routes.db = db
    order_routes.db = db
    cash_routes.db = db
    report_routes.db = db


def _cashier():
    return {
        "id": "cashier-1",
        "restaurant_id": RID,
        "role": "admin",
        "full_name": "Ada",
        "can_discount": True,
        "can_void": True,
    }


def _mozo():
    return {**_cashier(), "id": "mozo-1", "role": "mozo", "full_name": "Mozo", "branch_id": "branch-1"}


def _cocina():
    return {**_cashier(), "id": "cocina-1", "role": "cocina", "full_name": "Cocina", "branch_id": "branch-1"}


def _flow(name):
    return type("S", (), {"status": name, "reason": None})()


def _order(**extra):
    doc = {
        "id": "order-1",
        "restaurant_id": RID,
        "branch_id": "branch-1",
        "order_number": 12,
        "status": "entregado",
        "order_type": "delivery",
        "subtotal": 20.0,
        "discount": 0.0,
        "tip": 0.0,
        "delivery_fee": 0.0,
        "total": 20.0,
        "amount_paid": 0.0,
        "updated_at": STAMP,
        "items": [{
            "id": "item-1",
            "product_id": "prod-1",
            "product_name": "Lomo",
            "quantity": 1,
            "unit_price": 20.0,
            "subtotal": 20.0,
            "paid_qty": 0,
            "status": "entregado",
        }],
    }
    doc.update(extra)
    return doc


def _open_register(reg_id="reg-open"):
    return {
        "id": reg_id,
        "restaurant_id": RID,
        "branch_id": "branch-1",
        "status": "open",
        "opening_amount": 100.0,
        "opened_at": "2026-09-11T08:00:00+00:00",
        "total_sales": 0.0,
    }


def _payment_body(**extra):
    body = {
        "order_id": "order-1",
        "method": "efectivo",
        "amount": 20,
        "received_amount": 20,
        "idempotency_key": "key-a",
    }
    body.update(extra)
    return PaymentCreate(**body)


def test_models_reject_negative_money_and_quantities():
    with pytest.raises(ValidationError):
        ProductCreate(category_id="c", name="Sopa", price=-1)
    with pytest.raises(ValidationError):
        PaymentCreate(order_id="o", method="efectivo", amount=-5)
    with pytest.raises(ValidationError):
        PaymentCreate(order_id="o", method="efectivo", amount=10, tip=-1)
    with pytest.raises(ValidationError):
        PaymentSplit(method="efectivo", amount=-3)
    with pytest.raises(ValidationError):
        CashOpen(opening_amount=-10)
    with pytest.raises(ValidationError):
        CashMovement(type="egreso", amount=-4, description="salida")
    with pytest.raises(ValidationError):
        OrderItemUpdate(quantity=-2)


def test_charge_keeps_delivery_fee_in_the_bill():
    async def run():
        db = _DB()
        db.orders.docs.append(_order(delivery_fee=5.0, total=25.0))
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        paid = await create_payment(_payment_body(amount=25, received_amount=25), _cashier())
        stored = await db.orders.find_one({"id": "order-1"})
        return paid, stored

    paid, stored = asyncio.run(run())
    assert paid["amount"] == 25
    assert paid["fully_paid"] is True
    assert stored["total"] == 25
    assert stored["amount_paid"] == 25


def test_payment_is_tied_to_the_open_register():
    async def run():
        db = _DB()
        db.orders.docs.append(_order())
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        return await create_payment(_payment_body(), _cashier())

    paid = asyncio.run(run())
    assert paid["cash_register_id"] == "reg-open"


def test_same_idempotency_key_returns_the_original_payment():
    async def run():
        db = _DB()
        db.orders.docs.append(_order())
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        body = _payment_body(idempotency_key="same-key")
        first = await create_payment(body, _cashier())
        second = await create_payment(body, _cashier())
        stored = await db.orders.find_one({"id": "order-1"})
        return first, second, stored, len(db.payments.docs)

    first, second, stored, count = asyncio.run(run())
    assert first["id"] == second["id"]
    assert count == 1
    assert stored["amount_paid"] == 20
    assert stored["status"] == "pagado"


def test_two_cashiers_cannot_charge_the_same_balance():
    async def run():
        db = _DB()
        db.orders.docs.append(_order(total=20.0))
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        first = create_payment(_payment_body(idempotency_key="key-a"), _cashier())
        second = create_payment(_payment_body(idempotency_key="key-b", method="yape", amount=20), _cashier())
        results = await asyncio.gather(first, second, return_exceptions=True)
        stored = await db.orders.find_one({"id": "order-1"})
        return results, db.payments.docs, stored

    results, payments, stored = asyncio.run(run())
    successes = [r for r in results if not isinstance(r, Exception)]
    conflicts = [r for r in results if isinstance(r, HTTPException)]
    assert len(successes) == 1
    assert len(conflicts) == 1
    assert conflicts[0].status_code == 409
    assert len(payments) == 1
    assert stored["amount_paid"] == 20
    assert stored["status"] == "pagado"


def test_second_partial_payment_still_closes_the_bill():
    async def run():
        db = _DB()
        db.orders.docs.append(_order())
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        first = await create_payment(_payment_body(amount=8, received_amount=8, idempotency_key="half"), _cashier())
        second = await create_payment(_payment_body(amount=12, received_amount=12, idempotency_key="rest"), _cashier())
        stored = await db.orders.find_one({"id": "order-1"})
        return first, second, stored, len(db.payments.docs)

    first, second, stored, count = asyncio.run(run())
    assert first["fully_paid"] is False
    assert second["fully_paid"] is True
    assert stored["amount_paid"] == 20
    assert count == 2


def _partially_paid_order():
    # Los dos productos siguen en borrador: lo que estas pruebas cuidan son las
    # reglas de dinero al quitar o encoger un producto, no el envío a cocina.
    order = _order(amount_paid=40.0, total=50.0, subtotal=50.0, status="pendiente_pago")
    order["items"] = [
        {
            "id": "item-1",
            "product_id": "prod-1",
            "product_name": "Lomo",
            "quantity": 2,
            "unit_price": 20.0,
            "subtotal": 40.0,
            "paid_qty": 2,
            "status": "borrador",
        },
        {
            "id": "item-2",
            "product_id": "prod-2",
            "product_name": "Agua",
            "quantity": 1,
            "unit_price": 10.0,
            "subtotal": 10.0,
            "paid_qty": 0,
            "status": "borrador",
        },
    ]
    return order


def test_cannot_remove_an_already_paid_item():
    async def run():
        db = _DB()
        db.orders.docs.append(_partially_paid_order())
        _bind(db)
        await remove_item("order-1", "item-1", _mozo())

    with pytest.raises(HTTPException) as removed:
        asyncio.run(run())
    assert removed.value.status_code == 400


def test_cannot_shrink_an_item_below_what_was_paid():
    async def run():
        db = _DB()
        db.orders.docs.append(_partially_paid_order())
        _bind(db)
        await update_item("order-1", "item-1", OrderItemUpdate(quantity=1), _mozo())

    with pytest.raises(HTTPException) as shrunk:
        asyncio.run(run())
    assert shrunk.value.status_code == 400


def test_can_remove_an_unpaid_item_while_another_is_paid():
    async def run():
        db = _DB()
        db.orders.docs.append(_partially_paid_order())
        _bind(db)
        return await remove_item("order-1", "item-2", _mozo())

    updated = asyncio.run(run())
    assert [item["id"] for item in updated["items"]] == ["item-1"]
    assert updated["total"] == 40
    assert updated["amount_paid"] == 40


def test_cannot_cancel_while_money_was_collected():
    async def run():
        db = _DB()
        db.orders.docs.append(_order(amount_paid=8.0, status="pendiente_pago"))
        _bind(db)
        await change_status("order-1", type("S", (), {"status": "cancelado", "reason": "se fue el cliente"})(), _cashier())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert caught.value.status_code == 400


def test_editing_items_keeps_the_delivery_fee():
    async def run():
        db = _DB()
        db.products.docs.append({
            "id": "prod-2",
            "restaurant_id": RID,
            "name": "Agua",
            "price": 10.0,
            "is_available": True,
            "is_combo": False,
        })
        db.orders.docs.append(_order(delivery_fee=5.0, total=25.0))
        _bind(db)
        from models import OrderItemInput
        updated = await add_items("order-1", [OrderItemInput(product_id="prod-2", quantity=1)], _mozo())
        return updated

    updated = asyncio.run(run())
    assert updated["subtotal"] == 30
    assert updated["total"] == 35


def _table_item(item_id, product_id, name, price):
    return {
        "id": item_id, "product_id": product_id, "product_name": name,
        "quantity": 1, "unit_price": price, "subtotal": price,
        "paid_qty": 0, "status": "pendiente",
    }


def test_merge_fuses_accounts_and_cancels_source():
    async def run():
        from models import OrderMerge

        db = _DB()
        db.orders.docs.append(_order(
            id="order-1", order_number=12, order_type="mesa", status="en_preparacion",
            table_id="table-1", attention_id="att-1", subtotal=20.0, total=20.0,
            items=[_table_item("i1", "prod-1", "Lomo", 20.0)],
        ))
        db.orders.docs.append(_order(
            id="order-2", order_number=13, order_type="mesa", status="en_preparacion",
            table_id="table-1", attention_id="att-1", subtotal=10.0, total=10.0,
            items=[_table_item("i2", "prod-2", "Agua", 10.0)],
        ))
        _bind(db)
        result = await merge_order("order-1", OrderMerge(source_order_id="order-2"), _mozo())
        return db, result

    db, result = asyncio.run(run())
    assert result["id"] == "order-1"
    assert [i["id"] for i in result["items"]] == ["i1", "i2"]
    assert result["total"] == 30.0
    source = next(o for o in db.orders.docs if o["id"] == "order-2")
    assert source["status"] == "cancelado"
    assert "Fusionada" in (source.get("cancellation_reason") or "")


def test_merge_rejects_a_source_with_collected_money():
    async def run():
        from models import OrderMerge

        db = _DB()
        db.orders.docs.append(_order(
            id="order-1", order_number=12, order_type="mesa", status="en_preparacion",
            table_id="table-1", attention_id="att-1",
        ))
        db.orders.docs.append(_order(
            id="order-2", order_number=13, order_type="mesa", status="pendiente_pago",
            table_id="table-1", attention_id="att-1", amount_paid=5.0,
        ))
        _bind(db)
        with pytest.raises(HTTPException) as exc:
            await merge_order("order-1", OrderMerge(source_order_id="order-2"), _mozo())
        assert exc.value.status_code == 400

    asyncio.run(run())


def _table_row(table_id, status, attention=None):
    row = {"id": table_id, "restaurant_id": RID, "branch_id": "branch-1", "status": status}
    if attention:
        row["active_attention_id"] = attention
    return row


def test_move_account_to_free_table_detaches_from_source_visit():
    async def run():
        from models import OrderMove

        db = _DB()
        db.tables.docs.append(_table_row("table-1", "ocupada", "att-1"))
        db.tables.docs.append(_table_row("table-2", "disponible"))
        db.attentions.docs.append({
            "id": "att-1", "restaurant_id": RID, "branch_id": "branch-1",
            "table_id": "table-1", "order_id": "order-1", "order_ids": ["order-1", "order-2"], "status": "open",
        })
        db.orders.docs.append(_order(id="order-1", order_number=12, order_type="mesa", status="en_preparacion", table_id="table-1", attention_id="att-1"))
        db.orders.docs.append(_order(id="order-2", order_number=13, order_type="mesa", status="en_preparacion", table_id="table-1", attention_id="att-1"))
        _bind(db)
        result = await move_order("order-2", OrderMove(target_table_id="table-2"), _mozo())
        return db, result

    db, result = asyncio.run(run())
    assert result["table_id"] == "table-2"
    assert result["attention_id"] != "att-1"
    source_att = next(a for a in db.attentions.docs if a["id"] == "att-1")
    assert source_att["order_ids"] == ["order-1"]
    assert source_att["order_id"] == "order-1"
    target_table = next(t for t in db.tables.docs if t["id"] == "table-2")
    assert target_table["active_attention_id"] == result["attention_id"]
    assert target_table["status"] == "ocupada"
    source_table = next(t for t in db.tables.docs if t["id"] == "table-1")
    assert source_table["active_attention_id"] == "att-1"  # la otra cuenta sigue


def test_move_sole_account_releases_source_table():
    async def run():
        from models import OrderMove

        db = _DB()
        db.tables.docs.append(_table_row("table-1", "ocupada", "att-1"))
        db.tables.docs.append(_table_row("table-2", "disponible"))
        db.attentions.docs.append({
            "id": "att-1", "restaurant_id": RID, "branch_id": "branch-1",
            "table_id": "table-1", "order_id": "order-1", "order_ids": ["order-1"], "status": "open",
        })
        db.orders.docs.append(_order(id="order-1", order_number=12, order_type="mesa", status="en_preparacion", table_id="table-1", attention_id="att-1"))
        _bind(db)
        await move_order("order-1", OrderMove(target_table_id="table-2"), _mozo())
        return db

    db = asyncio.run(run())
    source_table = next(t for t in db.tables.docs if t["id"] == "table-1")
    assert "active_attention_id" not in source_table
    assert source_table["status"] == "disponible"


def test_split_distributes_items_into_accounts():
    async def run():
        from models import OrderSplit

        async def order_number(rid):
            return 99

        db = _DB()
        db.tables.docs.append(_table_row("table-1", "ocupada", "att-1"))
        db.attentions.docs.append({
            "id": "att-1", "restaurant_id": RID, "branch_id": "branch-1",
            "table_id": "table-1", "order_id": "order-1", "order_ids": ["order-1"], "status": "open",
        })
        db.orders.docs.append(_order(
            id="order-1", order_number=12, order_type="mesa", status="en_preparacion",
            table_id="table-1", attention_id="att-1", subtotal=65.0, total=65.0,
            items=[
                _table_item("i1", "prod-1", "Lomo", 20.0),
                _table_item("i2", "prod-2", "Agua", 10.0),
                _table_item("i3", "prod-3", "Ceviche", 30.0),
                _table_item("i4", "prod-4", "Chicha", 5.0),
            ],
        ))
        _bind(db)
        order_routes._next_order_number = order_number
        await split_order("order-1", OrderSplit(parts=2), _mozo())
        return db

    db = asyncio.run(run())
    original = next(o for o in db.orders.docs if o["id"] == "order-1")
    assert [i["id"] for i in original["items"]] == ["i1", "i3"]
    assert original["total"] == 50.0
    new_orders = [o for o in db.orders.docs if o["id"] != "order-1"]
    assert len(new_orders) == 1
    assert [i["id"] for i in new_orders[0]["items"]] == ["i2", "i4"]
    assert new_orders[0]["total"] == 15.0
    assert new_orders[0]["attention_id"] == "att-1"
    assert new_orders[0]["order_number"] == 99
    att = next(a for a in db.attentions.docs if a["id"] == "att-1")
    assert set(att["order_ids"]) == {"order-1", new_orders[0]["id"]}


def test_split_rejects_an_account_with_collected_money():
    async def run():
        from models import OrderSplit

        db = _DB()
        db.orders.docs.append(_order(id="order-1", amount_paid=5.0, status="pendiente_pago"))
        _bind(db)
        with pytest.raises(HTTPException) as exc:
            await split_order("order-1", OrderSplit(parts=2), _mozo())
        assert exc.value.status_code == 400

    asyncio.run(run())


def test_set_order_alias_trims_and_stores_it():
    async def run():
        from models import OrderAlias

        db = _DB()
        db.orders.docs.append(_order(
            id="order-1", order_number=12, order_type="mesa", status="en_preparacion",
            table_id="table-1", attention_id="att-1",
            items=[_table_item("i1", "prod-1", "Lomo", 20.0)],
        ))
        _bind(db)
        await set_order_alias("order-1", OrderAlias(alias="  Juan  "), _mozo())
        return db

    db = asyncio.run(run())
    order = next(o for o in db.orders.docs if o["id"] == "order-1")
    assert order["customer_name"] == "Juan"


def test_shift_totals_ignore_other_registers():
    async def run():
        db = _DB()
        reg = _open_register("reg-a")
        db.cash_registers.docs.append(reg)
        db.payments.docs.extend([
            {"id": "p1", "restaurant_id": RID, "cash_register_id": "reg-a", "status": "completed", "method": "efectivo", "amount": 10, "created_at": "2026-09-11T10:00:00+00:00"},
            {"id": "p2", "restaurant_id": RID, "cash_register_id": "reg-b", "status": "completed", "method": "efectivo", "amount": 99, "created_at": "2026-09-11T10:05:00+00:00"},
        ])
        _bind(db)
        return await _shift_totals(reg)

    totals = asyncio.run(run())
    assert totals["total_sales"] == 10
    assert totals["cash_sales"] == 10


def _shift_totals_with_ledger_sizes(payment_count, movement_count):
    async def run():
        db = _DB()
        reg = _open_register("reg-large")
        db.cash_registers.docs.append(reg)
        db.payments.docs.extend(
            {
                "id": f"payment-{index}",
                "restaurant_id": RID,
                "cash_register_id": reg["id"],
                "status": "completed",
                "method": "efectivo",
                "amount": 0.01,
                "created_at": STAMP,
            }
            for index in range(payment_count)
        )
        db.cash_movements.docs.extend(
            {
                "id": f"movement-{index}",
                "cash_register_id": reg["id"],
                "type": "ingreso",
                "amount": 0.01,
                "created_at": STAMP,
            }
            for index in range(movement_count)
        )
        _bind(db)
        return await _shift_totals(reg)

    return asyncio.run(run())


def test_shift_payment_totals_include_rows_beyond_old_limit():
    totals = _shift_totals_with_ledger_sizes(payment_count=5001, movement_count=0)
    assert totals["total_sales"] == 50.01
    assert totals["cash_sales"] == 50.01


def test_shift_movement_totals_include_rows_beyond_old_limit():
    totals = _shift_totals_with_ledger_sizes(payment_count=0, movement_count=1001)
    assert totals["income"] == 10.01
    assert len(totals["movements"]) == 1000


def test_refund_after_close_does_not_rewrite_the_closed_shift():
    async def run():
        db = _DB()
        closed = {
            "id": "reg-old",
            "restaurant_id": RID,
            "status": "closed",
            "opened_at": "2026-09-10T08:00:00+00:00",
            "closed_at": "2026-09-10T23:00:00+00:00",
            "total_sales": 40.0,
            "cash_sales": 40.0,
            "opening_amount": 100.0,
        }
        db.cash_registers.docs.extend([closed, _open_register("reg-today")])
        db.orders.docs.append(_order(amount_paid=40.0, subtotal=40.0, total=40.0, status="pagado"))
        db.orders.docs[0]["items"][0]["unit_price"] = 40.0
        db.orders.docs[0]["items"][0]["subtotal"] = 40.0
        db.orders.docs[0]["items"][0]["paid_qty"] = 1
        db.payments.docs.append({
            "id": "pay-1",
            "restaurant_id": RID,
            "order_id": "order-1",
            "cash_register_id": "reg-old",
            "status": "completed",
            "method": "efectivo",
            "amount": 40.0,
            "created_at": "2026-09-10T13:00:00+00:00",
        })
        _bind(db)
        original_now = payment_routes._now
        payment_routes._now = lambda: "2026-09-23T15:00:00+00:00"
        try:
            await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")
        finally:
            payment_routes._now = original_now
        closed_again = await db.cash_registers.find_one({"id": "reg-old"})
        yesterday = await sales_report(
            _cashier(),
            period="day",
            date_from="2026-09-10T00:00:00+00:00",
            date_to="2026-09-10T23:59:59+00:00",
        )
        today = await sales_report(
            _cashier(),
            period="day",
            date_from="2026-09-23T00:00:00+00:00",
            date_to="2026-09-23T23:59:59+00:00",
        )
        return closed_again, db.cash_movements.docs, yesterday, today

    closed_again, movements, yesterday, today = asyncio.run(run())
    assert closed_again["total_sales"] == 40
    assert closed_again["status"] == "closed"
    assert len(movements) == 1
    assert movements[0]["type"] == "egreso"
    assert movements[0]["amount"] == 40
    assert movements[0]["cash_register_id"] == "reg-today"
    assert yesterday["total_sales"] == 40
    assert today["total_sales"] == -40


def test_void_inside_the_open_shift_does_not_add_a_second_deduction():
    async def run():
        db = _DB()
        db.cash_registers.docs.append(_open_register())
        db.orders.docs.append(_order(amount_paid=20.0, status="pagado"))
        db.orders.docs[0]["items"][0]["paid_qty"] = 1
        db.payments.docs.append({
            "id": "pay-1",
            "restaurant_id": RID,
            "order_id": "order-1",
            "cash_register_id": "reg-open",
            "status": "completed",
            "method": "efectivo",
            "amount": 20.0,
            "created_at": "2026-09-11T13:00:00+00:00",
        })
        _bind(db)
        await apply_void_payment("pay-1", _cashier(), "cobré de más sin querer", "void")
        totals = await _shift_totals(db.cash_registers.docs[0])
        return db.cash_movements.docs, totals

    movements, totals = asyncio.run(run())
    assert movements == []
    assert totals["total_sales"] == 0
    assert totals["cash_sales"] == 0


def test_paying_the_bill_does_not_pull_food_out_of_the_kitchen():
    async def run():
        db = _DB()
        cooking = _order(status="enviado_cocina")
        cooking["items"][0]["status"] = "pendiente"
        cooking["table_id"] = "mesa-1"
        db.orders.docs.append(cooking)
        db.tables.docs.append({"id": "mesa-1", "restaurant_id": RID, "branch_id": "branch-1", "status": "ocupada"})
        db.restaurants.docs.append({"id": RID, "auto_release_table": False})
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        paid = await create_payment(_payment_body(), _cashier())
        stored = await db.orders.find_one({"id": "order-1"})
        board = await kitchen_orders(_cocina())
        table = await db.tables.find_one({"id": "mesa-1"})
        ready = await change_status("order-1", _flow("en_preparacion"), _cocina())
        finished = await change_status("order-1", _flow("listo"), _cocina())
        served = await serve_order("order-1", _mozo())
        closed = await db.orders.find_one({"id": "order-1"})
        table_after = await db.tables.find_one({"id": "mesa-1"})
        return paid, stored, board, table, ready, finished, served, closed, table_after

    paid, stored, board, table, ready, finished, served, closed, table_after = asyncio.run(run())
    assert paid["fully_paid"] is True
    assert stored["status"] == "enviado_cocina"
    assert stored["fulfillment_status"] == "enviado_cocina"
    assert stored["payment_status"] == "pagado"
    assert any(row["id"] == "order-1" for row in board)
    assert table["status"] == "ocupada"
    assert ready["status"] == "en_preparacion"
    assert finished["fulfillment_status"] == "listo"
    assert served["status"] == "pagado"
    assert served["fulfillment_status"] == "entregado"
    assert closed["payment_status"] == "pagado"
    assert table_after["status"] == "pagada"


def test_request_bill_then_pay_ready_order_keeps_ready_food_serviceable():
    async def run():
        db = _DB()
        ready = _order(status="listo", fulfillment_status="listo")
        ready["items"][0]["status"] = "listo"
        ready["table_id"] = "mesa-1"
        db.orders.docs.append(ready)
        db.tables.docs.append({"id": "mesa-1", "restaurant_id": RID, "branch_id": "branch-1", "status": "ocupada"})
        db.restaurants.docs.append({"id": RID, "auto_release_table": False})
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        requested = await change_status("order-1", _flow("pendiente_pago"), _mozo())
        board = await kitchen_orders(_cocina())
        paid = await create_payment(_payment_body(), _cashier())
        table = await db.tables.find_one({"id": "mesa-1"})
        stored = await db.orders.find_one({"id": "order-1"})
        served = await serve_order("order-1", _mozo())
        return requested, board, table, paid, stored, served

    requested, board, table, paid, stored, served = asyncio.run(run())
    assert requested["fulfillment_status"] == "listo"
    assert requested["payment_requested"] is True
    assert paid["fully_paid"] is True
    assert stored["fulfillment_status"] == "listo"
    assert stored["status"] == "listo"
    assert table["status"] != "disponible"
    assert any(row["id"] == "order-1" for row in board)
    assert served["status"] == "pagado"
    assert served["fulfillment_status"] == "entregado"


def test_requesting_bill_does_not_hide_ready_food_or_block_service():
    async def run():
        db = _DB()
        ready = _order(status="listo", fulfillment_status="listo")
        ready["items"][0]["status"] = "listo"
        db.orders.docs.append(ready)
        _bind(db)
        requested = await change_status("order-1", _flow("pendiente_pago"), _mozo())
        board = await kitchen_orders(_cocina())
        served = await serve_order("order-1", _mozo())
        return requested, board, served

    requested, board, served = asyncio.run(run())
    assert requested["fulfillment_status"] == "listo"
    assert requested["payment_requested"] is True
    assert any(row["id"] == "order-1" for row in board)
    assert served["status"] == "entregado"
    assert served["fulfillment_status"] == "entregado"


def test_request_bill_then_pay_delivered_order_closes_payment_without_reopening_food():
    async def run():
        db = _DB()
        delivered = _order(status="entregado", fulfillment_status="entregado")
        db.orders.docs.append(delivered)
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        requested = await change_status("order-1", _flow("pendiente_pago"), _mozo())
        paid = await create_payment(_payment_body(), _cashier())
        stored = await db.orders.find_one({"id": "order-1"})
        return requested, paid, stored

    requested, paid, stored = asyncio.run(run())
    assert requested["fulfillment_status"] == "entregado"
    assert requested["payment_requested"] is True
    assert paid["fully_paid"] is True
    assert stored["fulfillment_status"] == "entregado"
    assert stored["payment_status"] == "pagado"
    assert stored["status"] == "pagado"


def test_request_bill_does_not_allow_duplicate_service_of_delivered_items():
    async def run():
        db = _DB()
        db.orders.docs.append(_order(status="entregado", fulfillment_status="entregado"))
        _bind(db)
        await change_status("order-1", _flow("pendiente_pago"), _mozo())
        with pytest.raises(HTTPException) as caught:
            await serve_order("order-1", _mozo())
        return caught.value

    assert asyncio.run(run()).status_code == 400


@pytest.mark.parametrize(
    ("status", "payment_status"),
    [("en_preparacion", None), ("entregado", "comprobante_subido"), ("entregado", "confirmado")],
)
def test_cash_close_rejects_open_orders_and_payment_proofs(status, payment_status):
    async def run():
        db = _DB()
        db.cash_registers.docs.append(_open_register())
        doc = _order(status=status)
        if payment_status:
            doc["payment_status"] = payment_status
        db.orders.docs.append(doc)
        _bind(db)
        with pytest.raises(HTTPException) as caught:
            await close_register(CashClose(closing_amount=100, branch_id="branch-1"), _cashier())
        return caught.value, db.cash_registers.docs[0]

    caught, register = asyncio.run(run())
    assert caught.status_code == 400
    assert register["status"] == "open"


def test_cash_close_allows_settled_orders_and_ignores_other_restaurants():
    async def run():
        db = _DB()
        db.cash_registers.docs.append(_open_register())
        db.orders.docs.append(_order(status="pagado", payment_status="pagado"))
        db.orders.docs.append(_order(
            id="other-order",
            restaurant_id="rest-2",
            status="en_preparacion",
        ))
        _bind(db)
        return await close_register(CashClose(closing_amount=100, branch_id="branch-1"), _cashier())

    closed = asyncio.run(run())
    assert closed["status"] == "closed"


def test_partial_mixto_does_not_mark_selected_dishes_paid():
    async def run():
        db = _DB()
        order = _order(subtotal=40.0, total=40.0, status="entregado")
        order["items"][0]["quantity"] = 2
        order["items"][0]["unit_price"] = 20.0
        order["items"][0]["subtotal"] = 40.0
        db.orders.docs.append(order)
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        try:
            await create_payment(
                PaymentCreate(
                    order_id="order-1",
                    method="mixto",
                    amount=10,
                    splits=[
                        PaymentSplit(method="efectivo", amount=6),
                        PaymentSplit(method="yape", amount=4),
                    ],
                    lines=[PaymentLine(item_id="item-1", quantity=2)],
                    idempotency_key="mixto-short",
                ),
                _cashier(),
            )
            paid = None
        except HTTPException as exc:
            paid = exc
        stored = await db.orders.find_one({"id": "order-1"})
        return paid, stored, list(db.payments.docs)

    error, stored, payments = asyncio.run(run())
    assert isinstance(error, HTTPException)
    assert error.status_code == 400
    assert int(stored["items"][0].get("paid_qty") or 0) == 0
    assert payments == []


def test_mixto_covering_one_line_marks_only_that_line():
    async def run():
        db = _DB()
        order = _order(subtotal=40.0, total=40.0, status="entregado")
        order["items"][0]["quantity"] = 2
        order["items"][0]["unit_price"] = 20.0
        order["items"][0]["subtotal"] = 40.0
        db.orders.docs.append(order)
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        paid = await create_payment(
            PaymentCreate(
                order_id="order-1",
                method="mixto",
                amount=20,
                splits=[
                    PaymentSplit(method="efectivo", amount=10),
                    PaymentSplit(method="yape", amount=10),
                ],
                lines=[PaymentLine(item_id="item-1", quantity=1)],
                idempotency_key="mixto-one",
            ),
            _cashier(),
        )
        stored = await db.orders.find_one({"id": "order-1"})
        return paid, stored

    paid, stored = asyncio.run(run())
    assert paid["amount"] == 20
    assert paid["fully_paid"] is False
    assert stored["items"][0]["paid_qty"] == 1
    assert stored["status"] != "pagado"


def test_two_refunds_of_the_same_payment_record_one_cash_out():
    async def run():
        db = _DB()
        closed = {
            "id": "reg-old",
            "restaurant_id": RID,
            "status": "closed",
            "opened_at": "2026-09-10T08:00:00+00:00",
            "closed_at": "2026-09-10T23:00:00+00:00",
            "total_sales": 40.0,
            "opening_amount": 100.0,
        }
        db.cash_registers.docs.extend([closed, _open_register("reg-today")])
        db.orders.docs.append(_order(amount_paid=40.0, subtotal=40.0, total=40.0, status="pagado", fulfillment_status="entregado"))
        db.orders.docs[0]["items"][0]["paid_qty"] = 1
        db.payments.docs.append({
            "id": "pay-1",
            "restaurant_id": RID,
            "order_id": "order-1",
            "order_number": 12,
            "cash_register_id": "reg-old",
            "status": "completed",
            "method": "efectivo",
            "amount": 40.0,
            "created_at": "2026-09-10T13:00:00+00:00",
        })
        _bind(db)
        results = await asyncio.gather(
            apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund"),
            apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund"),
            return_exceptions=True,
        )
        stored = await db.orders.find_one({"id": "order-1"})
        return results, db.cash_movements.docs, stored

    results, movements, stored = asyncio.run(run())
    successes = [row for row in results if not isinstance(row, Exception)]
    conflicts = [row for row in results if isinstance(row, HTTPException)]
    assert len(successes) == 1
    assert len(conflicts) == 1
    assert conflicts[0].status_code == 400
    assert len(movements) == 1
    assert movements[0]["amount"] == 40
    assert stored["amount_paid"] == 0


def test_stale_kitchen_update_cannot_overwrite_a_payment():
    async def run():
        db = _DB()
        cooking = _order(status="enviado_cocina", subtotal=20.0, total=20.0)
        cooking["items"][0]["status"] = "pendiente"
        cooking["items"][0]["paid_qty"] = 0
        db.orders.docs.append(cooking)
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        reads = 0
        release = asyncio.Event()
        real_find = db.orders.find_one
        real_update = db.orders.update_one

        async def find_one(filt, proj=None):
            nonlocal reads
            doc = await real_find(filt, proj)
            if doc and doc.get("id") == "order-1":
                reads += 1
                if reads >= 2:
                    release.set()
            return doc

        async def update_one(filt, update):
            if filt.get("id") == "order-1":
                await release.wait()
            return await real_update(filt, update)

        db.orders.find_one = find_one
        db.orders.update_one = update_one
        results = await asyncio.gather(
            create_payment(_payment_body(), _cashier()),
            change_status("order-1", _flow("en_preparacion"), _cocina()),
            return_exceptions=True,
        )
        stored = await db.orders.find_one({"id": "order-1"})
        return results, stored, list(db.payments.docs)

    results, stored, payments = asyncio.run(run())
    successes = [row for row in results if not isinstance(row, Exception)]
    conflicts = [row for row in results if isinstance(row, HTTPException)]
    assert len(successes) == 1
    assert len(conflicts) == 1
    assert conflicts[0].status_code == 409
    paid_qty = int(stored["items"][0].get("paid_qty") or 0)
    if payments:
        assert stored["amount_paid"] == 20
        assert paid_qty == 1
    else:
        assert stored["status"] == "en_preparacion"
        assert paid_qty == 0
        assert stored["amount_paid"] == 0


def test_mixed_payment_with_change_nets_the_change_off_the_drawer():
    """Cash 60 + Yape 50 on a 100 bill, with 10 change: 50 cash and 50 Yape.

    The drawer hands the change back, so the cash side keeps 50 and not the 60
    that was handed over; otherwise the shift closes with a phantom surplus.
    """
    payment = {
        "method": "mixto",
        "amount": 100.0,
        "received_amount": 110.0,
        "change_amount": 10.0,
        "splits": [
            {"method": "efectivo", "amount": 60.0},
            {"method": "yape", "amount": 50.0},
        ],
    }
    assert method_amounts(payment) == {"efectivo": 50.0, "yape": 50.0}


def test_mixed_payment_without_change_keeps_each_split():
    payment = {
        "method": "mixto",
        "amount": 100.0,
        "received_amount": 100.0,
        "change_amount": 0.0,
        "splits": [
            {"method": "efectivo", "amount": 60.0},
            {"method": "yape", "amount": 40.0},
        ],
    }
    assert method_amounts(payment) == {"efectivo": 60.0, "yape": 40.0}


def test_charging_without_a_new_discount_keeps_the_accounts_discount():
    """Voiding leaves the discount on the account; re-charging must honour it."""
    async def run():
        db = _DB()
        db.orders.docs.append(_order(subtotal=100.0, discount=10.0, total=90.0, amount_paid=0.0))
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        paid = await create_payment(_payment_body(amount=90, received_amount=90), _cashier())
        stored = await db.orders.find_one({"id": "order-1"})
        return paid, stored

    paid, stored = asyncio.run(run())
    assert paid["discount"] == 10.0
    assert paid["total"] == 90.0
    assert stored["amount_paid"] == 90.0
    assert stored["status"] == "pagado"


def test_public_pickup_payment_can_be_voided_without_an_open_visit():
    """A public pickup carries an attention_id for numbering but no visit."""
    async def run():
        db = _DB()
        db.orders.docs.append(_order(
            order_type="recojo", status="pagado", total=20.0, amount_paid=20.0,
            attention_id="attention-1",
        ))
        db.orders.docs[0]["items"][0]["paid_qty"] = 1
        db.cash_registers.docs.append(_open_register())
        db.payments.docs.append({
            "id": "pay-1", "restaurant_id": RID, "order_id": "order-1", "order_number": 12,
            "cash_register_id": "reg-open", "branch_id": "branch-1", "method": "efectivo",
            "amount": 20.0, "received_amount": 20.0, "change_amount": 0.0,
            "status": "completed", "created_at": STAMP, "paid_by": "cashier-1",
        })
        _bind(db)
        voided = await apply_void_payment("pay-1", _cashier(), "el cliente cancelo", "void")
        stored = await db.orders.find_one({"id": "order-1"})
        return voided, stored

    voided, stored = asyncio.run(run())
    assert voided["status"] in ("voided", "refunded")
    assert stored["amount_paid"] == 0.0


def test_cashier_cannot_move_more_than_the_limit():
    """A big movement shifts the expected cash, so it needs an admin."""
    async def run():
        db = _DB()
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        cajero = {**_cashier(), "role": "cajero", "branch_id": "branch-1"}
        with pytest.raises(HTTPException) as caught:
            await add_movement(CashMovement(type="egreso", amount=500, description="pago a proveedor"), cajero)
        return caught.value, db.cash_movements.docs

    error, movements = asyncio.run(run())
    assert error.status_code == 403
    assert movements == []


def test_cash_movement_needs_a_description_and_is_audited():
    async def run():
        db = _DB()
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        cajero = {**_cashier(), "role": "cajero", "branch_id": "branch-1"}
        with pytest.raises(HTTPException) as short:
            await add_movement(CashMovement(type="ingreso", amount=10, description="x"), cajero)
        created = await add_movement(
            CashMovement(type="ingreso", amount=10, description="sencillo para el vuelto"), cajero
        )
        return short.value, created, db.cash_movements.docs, db.audit_logs.docs

    short, created, movements, audit = asyncio.run(run())
    assert short.status_code == 400
    assert created["amount"] == 10
    assert len(movements) == 1
    assert any(row.get("action") == "cash_movement" for row in audit)


def test_partial_payment_does_not_hide_a_pending_proof():
    """The proof has its own status, so a partial payment keeps it in review."""
    order = {
        "payment_status": "comprobante_subido",
        "payment_proof_status": "pendiente",
        "items": [],
    }
    fields = ticket_fields(order, "entregado", 10.0, 100.0)
    assert fields["payment_status"] == "parcial"
    assert order["payment_proof_status"] == "pendiente"
    assert proof_is_pending({**order, **fields}) is True


def test_proof_status_falls_back_to_payment_status_for_legacy_orders():
    assert proof_is_pending({"payment_status": "comprobante_subido"}) is True
    assert proof_is_pending({"payment_status": "parcial"}) is False
    assert proof_is_pending({"payment_status": "parcial", "payment_proof_status": "pendiente"}) is True
    assert proof_is_pending({"payment_status": "parcial", "payment_proof_status": "verificado"}) is False


def test_replaying_a_payment_returns_the_settled_shape():
    """A retry after a network cut must report the bill as covered."""
    async def run():
        db = _DB()
        db.orders.docs.append(_order())
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        body = _payment_body(idempotency_key="retry-key")
        first = await create_payment(body, _cashier())
        stored = await db.orders.find_one({"id": "order-1"})
        replay = await create_payment(body, _cashier())
        return first, stored, replay

    first, stored, replay = asyncio.run(run())
    assert replay["id"] == first["id"]
    assert stored["amount_paid"] == 20
    assert replay["fully_paid"] is True
    assert replay["remaining"] == 0.0


def test_a_disabled_payment_method_is_rejected():
    async def run():
        db = _DB()
        db.orders.docs.append(_order())
        db.cash_registers.docs.append(_open_register())
        db.payment_configs.docs.append({"restaurant_id": RID, "enable_efectivo": True, "enable_tarjeta": False})
        _bind(db)
        with pytest.raises(HTTPException) as caught:
            await create_payment(_payment_body(method="tarjeta", idempotency_key="card-key"), _cashier())
        return caught.value, db.payments.docs

    error, payments = asyncio.run(run())
    assert error.status_code == 400
    assert "tarjeta" in error.detail
    assert payments == []


def test_a_mixed_payment_with_a_disabled_method_is_rejected():
    async def run():
        db = _DB()
        db.orders.docs.append(_order(subtotal=100.0, total=100.0))
        db.cash_registers.docs.append(_open_register())
        db.payment_configs.docs.append({"restaurant_id": RID, "enable_efectivo": True, "enable_plin": False})
        _bind(db)
        body = PaymentCreate(
            order_id="order-1", method="mixto", amount=100, idempotency_key="mix-key",
            splits=[PaymentSplit(method="efectivo", amount=50), PaymentSplit(method="plin", amount=50)],
        )
        with pytest.raises(HTTPException) as caught:
            await create_payment(body, _cashier())
        return caught.value, db.payments.docs

    error, payments = asyncio.run(run())
    assert error.status_code == 400
    assert "plin" in error.detail
    assert payments == []


def test_mixed_payment_rejects_change_greater_than_cash_tender_before_writes():
    async def run():
        db = _DB()
        db.orders.docs.append(_order(subtotal=40.0, total=40.0))
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        body = PaymentCreate(
            order_id="order-1",
            method="mixto",
            amount=40,
            idempotency_key="mixed-overchange",
            splits=[
                PaymentSplit(method="yape", amount=50),
                PaymentSplit(method="efectivo", amount=10),
            ],
        )
        with pytest.raises(HTTPException) as caught:
            await create_payment(body, _cashier())
        return caught.value, db, await db.orders.find_one({"id": "order-1"})

    error, db, order = asyncio.run(run())
    assert error.status_code == 400
    assert db.payments.docs == []
    assert order["amount_paid"] == 0


def test_mixed_payment_cash_change_attributes_charge_and_replay_idempotently():
    async def run():
        db = _DB()
        db.orders.docs.append(_order(subtotal=100.0, total=100.0))
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        body = PaymentCreate(
            order_id="order-1",
            method="mixto",
            amount=100,
            idempotency_key="mixed-valid-change",
            splits=[
                PaymentSplit(method="efectivo", amount=60),
                PaymentSplit(method="yape", amount=50),
            ],
        )
        first = await create_payment(body, _cashier())
        replay = await create_payment(body, _cashier())
        return first, replay, db

    first, replay, db = asyncio.run(run())
    assert first["amount"] == 100
    assert first["change_amount"] == 10
    assert method_amounts(first) == {"efectivo": 50, "yape": 50}
    assert sum(method_amounts(first).values()) == first["amount"]
    assert replay["id"] == first["id"]
    assert len(db.payments.docs) == 1


def test_mixed_payment_rejects_subcent_splits_that_round_above_charge_before_writes():
    async def run():
        db = _DB()
        db.orders.docs.append(_order(subtotal=0.01, total=0.01))
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        body = PaymentCreate(
            order_id="order-1",
            method="mixto",
            amount=0.01,
            idempotency_key="mixed-subcent-overcharge",
            splits=[
                PaymentSplit(method="yape", amount=0.005),
                PaymentSplit(method="plin", amount=0.005),
            ],
        )
        with pytest.raises(HTTPException) as caught:
            await create_payment(body, _cashier())
        return caught.value, db, await db.orders.find_one({"id": "order-1"})

    error, db, order = asyncio.run(run())
    assert error.status_code == 400
    assert "dos decimales" in error.detail
    assert db.payments.docs == []
    assert order["amount_paid"] == 0


def test_mixed_payment_accepts_normal_cent_precision_and_attributes_exact_charge():
    async def run():
        db = _DB()
        db.orders.docs.append(_order(subtotal=0.03, total=0.03))
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        paid = await create_payment(
            PaymentCreate(
                order_id="order-1",
                method="mixto",
                amount=0.03,
                splits=[
                    PaymentSplit(method="efectivo", amount=0.01),
                    PaymentSplit(method="yape", amount=0.02),
                ],
            ),
            _cashier(),
        )
        return paid

    paid = asyncio.run(run())
    assert paid["amount"] == 0.03
    assert method_amounts(paid) == {"efectivo": 0.01, "yape": 0.02}
    assert sum(method_amounts(paid).values()) == paid["amount"]
