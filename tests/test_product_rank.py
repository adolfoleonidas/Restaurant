"""Dish ranking follows what was paid, and a later refund does not erase the sale day."""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "restaurant_db_unit")
_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import PaymentCreate, PaymentLine
from routes.payments import apply_void_payment, create_payment
from routes.reports import sales_report
import routes.payments as payment_routes
from test_money_integrity import _DB, _bind, _cashier, _open_register, _order


def _two_units():
    order = _order(subtotal=40.0, total=40.0, delivery_fee=0.0, order_type="mesa")
    order["items"][0]["quantity"] = 2
    order["items"][0]["unit_price"] = 20.0
    order["items"][0]["subtotal"] = 40.0
    order["created_at"] = "2026-09-10T12:00:00+00:00"
    return order


def test_partial_sale_stays_on_its_day_after_a_later_refund():
    async def run():
        db = _DB()
        db.orders.docs.append(_two_units())
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        original = payment_routes._now
        payment_routes._now = lambda: "2026-09-10T13:00:00+00:00"
        try:
            paid = await create_payment(
                PaymentCreate(
                    order_id="order-1",
                    method="efectivo",
                    amount=20,
                    received_amount=20,
                    lines=[PaymentLine(item_id="item-1", quantity=1)],
                    idempotency_key="rank-1",
                ),
                _cashier(),
            )
            payment_routes._now = lambda: "2026-09-23T15:00:00+00:00"
            await apply_void_payment(paid["id"], _cashier(), "cliente devolvió el plato", "refund")
        finally:
            payment_routes._now = original
        sale_day = await sales_report(
            _cashier(),
            period="day",
            date_from="2026-09-10T00:00:00+00:00",
            date_to="2026-09-10T23:59:59+00:00",
        )
        refund_day = await sales_report(
            _cashier(),
            period="day",
            date_from="2026-09-23T00:00:00+00:00",
            date_to="2026-09-23T23:59:59+00:00",
        )
        return sale_day, refund_day

    sale_day, refund_day = asyncio.run(run())
    sold = next(row for row in sale_day["top_products"] if row["product_id"] == "prod-1")
    assert sold["quantity"] == 1
    assert sold["revenue"] == 20
    refunded = next(row for row in refund_day["top_products"] if row["product_id"] == "prod-1")
    assert refunded["quantity"] == -1
