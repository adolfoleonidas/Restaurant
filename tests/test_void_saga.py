"""Non-visit payment void: crash-safe through an intent embedded in the order.

The visit path already survives a crash between its writes (write-ahead intent,
deterministic ids, idempotent resume). The path for orders without an open visit
used to flip the payment, then the order, then insert the refund with a random id,
then the audit row: a crash in the middle left a voided payment with the old
`amount_paid`, or no cash egress, and the retry answered "no vigente".
These tests crash the process after each write and retry the same void.
"""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "restaurant_db_unit")
_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest
from fastapi import HTTPException

from models import PaymentCreate
from routes.payments import apply_void_payment, create_payment
from test_money_integrity import _DB, _bind, _cashier, _open_register, _order, RID, STAMP


class SimulatedProcessCrash(BaseException):
    pass


def _world(*, same_shift=False):
    """A paid cash order whose payment belongs to a closed shift (so the refund
    must leave a cash egress in today's register)."""
    db = _DB()
    if same_shift:
        db.cash_registers.docs.append(_open_register("reg-open"))
        owner = "reg-open"
    else:
        db.cash_registers.docs.extend([
            {
                "id": "reg-old", "restaurant_id": RID, "branch_id": "branch-1", "status": "closed",
                "opened_at": "2026-09-10T08:00:00+00:00", "closed_at": "2026-09-10T23:00:00+00:00",
                "total_sales": 40.0, "cash_sales": 40.0, "opening_amount": 100.0,
            },
            _open_register("reg-today"),
        ])
        owner = "reg-old"
    order = _order(amount_paid=40.0, subtotal=40.0, total=40.0, status="pagado",
                   fulfillment_status="entregado")
    order["items"][0].update({"unit_price": 40.0, "subtotal": 40.0, "paid_qty": 1})
    db.orders.docs.append(order)
    db.payments.docs.append({
        "id": "pay-1", "restaurant_id": RID, "order_id": "order-1", "order_number": 12,
        "branch_id": "branch-1", "cash_register_id": owner, "status": "completed",
        "method": "efectivo", "amount": 40.0, "created_at": "2026-09-10T13:00:00+00:00",
    })
    _bind(db)
    return db


def _crash_after(collection, method, predicate):
    """Run the real write, then die before the caller can continue."""
    real = getattr(collection, method)

    async def wrapper(*args, **kwargs):
        result = await real(*args, **kwargs)
        if predicate(*args):
            raise SimulatedProcessCrash()
        return result

    setattr(collection, method, wrapper)
    return lambda: setattr(collection, method, real)


def _sets(update, key):
    return key in (update.get("$set") or {})


def _unsets(update, key):
    return key in (update.get("$unset") or {})


CRASH_POINTS = {
    "after_intent_claim": lambda db: _crash_after(
        db.orders, "update_one", lambda f, u: _sets(u, "payment_operation")),
    "after_payment_flip": lambda db: _crash_after(
        db.payments, "update_one", lambda f, u: _sets(u, "status")),
    "after_cash_movement": lambda db: _crash_after(
        db.cash_movements, "insert_one", lambda doc: True),
    "after_audit": lambda db: _crash_after(
        db.audit_logs, "insert_one", lambda doc: True),
    "after_intent_cleared": lambda db: _crash_after(
        db.orders, "update_one", lambda f, u: _unsets(u, "payment_operation")),
}


@pytest.mark.parametrize("point", sorted(CRASH_POINTS))
def test_crash_at_any_step_then_retry_completes_the_refund_exactly_once(point):
    async def run():
        db = _world()
        restore = CRASH_POINTS[point](db)
        with pytest.raises(SimulatedProcessCrash):
            await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")
        restore()
        if point == "after_intent_cleared":
            # Everything was already written; only the HTTP answer was lost. The
            # retry is a stale void, exactly like any other already-resolved one.
            with pytest.raises(HTTPException):
                await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")
            retried = await db.payments.find_one({"id": "pay-1"}, {"_id": 0})
        else:
            retried = await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")
        with pytest.raises(HTTPException) as late:
            await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")
        return db, retried, late.value

    db, retried, late = asyncio.run(run())
    assert retried["status"] == "refunded"
    assert [p["status"] for p in db.payments.docs] == ["refunded"]
    assert [m["_id"] for m in db.cash_movements.docs] == ["payment-refund:pay-1"]
    assert db.cash_movements.docs[0]["amount"] == 40.0
    assert db.cash_movements.docs[0]["cash_register_id"] == "reg-today"
    audits = [a for a in db.audit_logs.docs if a.get("entity_id") == "pay-1"]
    assert [a["event_id"] for a in audits] == ["payment-void:pay-1"]
    order = db.orders.docs[0]
    assert order["amount_paid"] == 0
    assert order["items"][0]["paid_qty"] == 0
    assert "payment_operation" not in order
    # once finished, the same void is a genuinely stale one
    assert late.status_code == 400


def test_happy_path_keeps_response_shape_and_leaves_no_intent_behind():
    async def run():
        db = _world()
        result = await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")
        return db, result

    db, result = asyncio.run(run())
    assert "_id" not in result
    assert result["id"] == "pay-1"
    assert result["status"] == "refunded"
    assert result["void_kind"] == "refund"
    assert result["void_reason"] == "cliente devolvió el plato"
    assert result["voided_by"] == "cashier-1"
    assert result["voided_by_name"] == "Ada"
    assert result["voided_at"]
    order = db.orders.docs[0]
    assert order["amount_paid"] == 0
    assert order["payment_status"] == "pendiente"
    assert order["status"] != "pagado"
    assert order["paid_at"] is None
    assert "payment_operation" not in order
    movement = db.cash_movements.docs[0]
    assert movement["type"] == "egreso"
    assert movement["source_payment_id"] == "pay-1"
    assert movement["created_by"] == "cashier-1"
    assert movement["description"] == "Devolución pedido 12"
    audit = db.audit_logs.docs[0]
    assert audit["action"] == "payment_refund"
    assert audit["details"] == {
        "order_id": "order-1", "kind": "refund",
        "reason": "cliente devolvió el plato", "amount": 40.0,
    }


def test_void_inside_the_open_shift_still_adds_no_cash_movement():
    async def run():
        db = _world(same_shift=True)
        result = await apply_void_payment("pay-1", _cashier(), "cobré de más sin querer", "void")
        return db, result

    db, result = asyncio.run(run())
    assert result["status"] == "voided"
    assert db.cash_movements.docs == []
    assert db.orders.docs[0]["amount_paid"] == 0
    assert "payment_operation" not in db.orders.docs[0]
    assert [a["action"] for a in db.audit_logs.docs] == ["payment_void"]


def test_no_vigente_is_for_an_already_resolved_payment_not_a_half_done_one():
    async def run():
        # genuinely finished -> 400
        done = _world()
        await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")
        with pytest.raises(HTTPException) as finished:
            await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")

        # half done (payment already flipped, order/movement/audit pending) -> resumed
        half = _world()
        restore = CRASH_POINTS["after_payment_flip"](half)
        with pytest.raises(SimulatedProcessCrash):
            await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")
        restore()
        stored = await half.payments.find_one({"id": "pay-1"})
        resumed = await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")
        return finished.value, stored, resumed

    finished, stored_mid_crash, resumed = asyncio.run(run())
    assert finished.status_code == 400
    assert "vigente" in finished.detail
    assert stored_mid_crash["status"] == "refunded"
    assert resumed["status"] == "refunded"


def test_retry_with_a_different_reason_keeps_the_original_intent():
    async def run():
        db = _world()
        restore = CRASH_POINTS["after_intent_claim"](db)
        with pytest.raises(SimulatedProcessCrash):
            await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")
        restore()
        retried = await apply_void_payment("pay-1", _cashier(), "motivo distinto aquí", "void")
        return db, retried

    db, retried = asyncio.run(run())
    assert retried["status"] == "refunded"
    assert retried["void_reason"] == "cliente devolvió el plato"
    assert db.audit_logs.docs[0]["details"]["reason"] == "cliente devolvió el plato"
    assert len(db.cash_movements.docs) == 1


def test_a_pending_void_is_finished_before_a_new_charge_is_attempted():
    async def run():
        db = _world()
        restore = CRASH_POINTS["after_payment_flip"](db)
        with pytest.raises(SimulatedProcessCrash):
            await apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund")
        restore()
        body = PaymentCreate(
            order_id="order-1", method="efectivo", amount=40, received_amount=40,
            idempotency_key="after-void", expected_updated_at=STAMP,
        )
        with pytest.raises(HTTPException) as caught:
            await create_payment(body, _cashier())
        return db, caught.value

    db, caught = asyncio.run(run())
    # the charge is refused (the bill moved), but the half-done void was completed
    assert caught.status_code == 409
    assert "payment_operation" not in db.orders.docs[0]
    assert db.orders.docs[0]["amount_paid"] == 0
    assert len(db.cash_movements.docs) == 1
    assert len([a for a in db.audit_logs.docs if a.get("entity_id") == "pay-1"]) == 1


def test_concurrent_identical_voids_still_resolve_to_one_success_and_one_conflict():
    async def run():
        db = _world()
        results = await asyncio.gather(
            apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund"),
            apply_void_payment("pay-1", _cashier(), "cliente devolvió el plato", "refund"),
            return_exceptions=True,
        )
        return db, results

    db, results = asyncio.run(run())
    assert len([r for r in results if not isinstance(r, Exception)]) == 1
    conflicts = [r for r in results if isinstance(r, HTTPException)]
    assert [c.status_code for c in conflicts] == [400]
    assert len(db.cash_movements.docs) == 1
    assert db.orders.docs[0]["amount_paid"] == 0
