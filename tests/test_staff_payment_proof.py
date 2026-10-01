"""Staff QR proof regressions; every database interaction is in-memory."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "restaurant_db_unit")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import StaffPaymentProof
from auth import require_roles
from attention import AttentionBlocked, close_table_attention
from routes import payment_config as config_routes
from routes import payments as payment_routes
from routes import orders as order_routes
from test_money_integrity import _DB, _cashier, _order, _open_register


class _ProofDB(_DB):
    def __init__(self):
        super().__init__()
        from test_money_integrity import _Collection
        self.payment_configs = _Collection()


def _png_data_url():
    # A valid one-pixel PNG header/body; no filesystem or image dependency.
    import base64
    payload = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000b49444154789c636000020000050001a5f645400000000049454e44ae426082"
    )
    return "data:image/png;base64," + base64.b64encode(payload).decode("ascii")


def _attention_world(**changes):
    db = _ProofDB()
    order = _order(**{
        "table_id": "table-1", "attention_id": "attention-1",
        "attention_state": "open", "payment_status": "pendiente",
        **changes,
    })
    db.orders.docs.append(order)
    db.attentions.docs.append({
        "id": "attention-1", "restaurant_id": "rest-1", "table_id": "table-1",
        "order_id": "order-1", "status": "open",
    })
    db.tables.docs.append({
        "id": "table-1", "restaurant_id": "rest-1", "status": "ocupada",
        "active_attention_id": "attention-1",
    })
    db.payment_configs.docs.append({
        "restaurant_id": "rest-1", "enable_yape": True, "yape_qr": "data:image/png;base64,QR",
        "enable_plin": False, "plin_qr": "private-or-disabled",
    })
    return db


def test_collection_config_is_tenant_scoped_read_only_and_minimal():
    async def run():
        db = _ProofDB()
        db.payment_configs.docs.extend([
            {"restaurant_id": "rest-1", "enable_yape": True, "yape_number": "111", "yape_qr": "qr1",
             "enable_plin": False, "plin_number": "222", "plin_qr": "qr2", "bank_account": "secret"},
            {"restaurant_id": "rest-2", "enable_yape": True, "yape_qr": "other-tenant"},
        ])
        config_routes.db = db
        result = await config_routes.collection_config(user=_cashier())
        return result, db

    result, db = asyncio.run(run())
    assert result == {
            "yape": {"enabled": True, "number": "111", "holder": None, "qr": "qr1"},
        "plin": {"enabled": False, "number": None, "holder": None, "qr": None},
    }
    assert len(db.payment_configs.docs) == 2
    assert "bank_account" not in result


def test_missing_collection_config_returns_disabled_methods_without_writing():
    async def run():
        db = _ProofDB()
        config_routes.db = db
        result = await config_routes.collection_config(user=_cashier())
        return result, db

    result, db = asyncio.run(run())
    assert result["yape"] == {"enabled": False, "number": None, "holder": None, "qr": None}
    assert result["plin"] == {"enabled": False, "number": None, "holder": None, "qr": None}
    assert db.payment_configs.docs == []


def test_staff_proof_records_pending_without_creating_payment_or_changing_balance():
    async def run():
        db = _attention_world()
        payment_routes.db = db
        result = await payment_routes.upload_staff_proof(
            "order-1", StaffPaymentProof(payment_proof=_png_data_url(), method="yape"), user=_cashier()
        )
        return result, db

    result, db = asyncio.run(run())
    saved = db.orders.docs[0]
    assert result["ok"] is True
    assert saved["payment_status"] == "comprobante_subido"
    assert saved["amount_paid"] == 0.0
    assert saved["payment_proof_url"] == _png_data_url()
    assert saved["payment_proof_method"] == "yape"
    assert saved["payment_proof_uploaded_by"] == "cashier-1"
    assert db.payments.docs == []
    assert db.cash_registers.docs == []


@pytest.mark.parametrize("method,qr_change", [
    ("plin", {"enable_plin": False}),
    ("yape", {"enable_yape": False}),
])
def test_disabled_method_is_rejected_before_order_write(method, qr_change):
    async def run():
        db = _attention_world()
        db.payment_configs.docs[0].update(qr_change)
        payment_routes.db = db
        with pytest.raises(HTTPException) as error:
            await payment_routes.upload_staff_proof(
                "order-1", StaffPaymentProof(payment_proof=_png_data_url(), method=method), user=_cashier()
            )
        return error, db

    error, db = asyncio.run(run())
    assert error.value.status_code == 400
    assert "payment_proof_url" not in db.orders.docs[0]


def test_enabled_account_without_qr_can_still_receive_photo_proof():
    async def run():
        db = _attention_world()
        db.payment_configs.docs[0]["yape_qr"] = None
        payment_routes.db = db
        result = await payment_routes.upload_staff_proof(
            "order-1", StaffPaymentProof(payment_proof=_png_data_url(), method="yape"), user=_cashier()
        )
        return result, db

    result, db = asyncio.run(run())
    assert result["ok"] is True
    assert db.orders.docs[0]["payment_status"] == "comprobante_subido"


@pytest.mark.parametrize("attention_state,attention_status,active_id", [
    ("opening", "open", "attention-1"),
    ("mutating", "open", "attention-1"),
    ("closing", "closing", "attention-1"),
    ("closed", "closed", "attention-1"),
    ("open", "open", "new-visit"),
])
def test_staff_proof_rejects_noncanonical_attention_before_write(attention_state, attention_status, active_id):
    async def run():
        db = _attention_world(attention_state=attention_state)
        db.attentions.docs[0]["status"] = attention_status
        db.tables.docs[0]["active_attention_id"] = active_id
        payment_routes.db = db
        with pytest.raises(HTTPException) as error:
            await payment_routes.upload_staff_proof(
                "order-1", StaffPaymentProof(payment_proof=_png_data_url(), method="yape"), user=_cashier()
            )
        return error, db

    error, db = asyncio.run(run())
    assert error.value.status_code == 409
    assert "payment_proof_url" not in db.orders.docs[0]


def test_staff_proof_retry_is_idempotent_and_payload_change_is_refused():
    async def run():
        db = _attention_world()
        payment_routes.db = db
        body = StaffPaymentProof(payment_proof=_png_data_url(), method="yape")
        first = await payment_routes.upload_staff_proof("order-1", body, user=_cashier())
        second = await payment_routes.upload_staff_proof("order-1", body, user=_cashier())
        with pytest.raises(HTTPException) as error:
            await payment_routes.upload_staff_proof(
                "order-1", StaffPaymentProof(payment_proof=_png_data_url()[:-4] + "AQ==", method="yape"), user=_cashier()
            )
        return first, second, error, db

    first, second, error, db = asyncio.run(run())
    assert first == second
    assert error.value.status_code == 409
    assert db.orders.docs[0]["amount_paid"] == 0.0
    assert len(db.payments.docs) == 0


def test_non_table_legacy_order_remains_collectible():
    async def run():
        db = _attention_world()
        order = db.orders.docs[0]
        order.pop("attention_id")
        order.pop("attention_state")
        order.pop("table_id")
        payment_routes.db = db
        result = await payment_routes.upload_staff_proof(
            "order-1", StaffPaymentProof(payment_proof=_png_data_url(), method="yape"), user=_cashier()
        )
        return result, db

    result, db = asyncio.run(run())
    assert result["ok"] is True
    assert db.orders.docs[0]["payment_status"] == "comprobante_subido"
    assert db.attentions.docs[0]["status"] == "open"


def test_submitted_proof_blocks_exact_visit_closure_and_keeps_table_claimed():
    async def run():
        db = _attention_world()
        payment_routes.db = db
        await payment_routes.upload_staff_proof(
            "order-1", StaffPaymentProof(payment_proof=_png_data_url(), method="yape"), user=_cashier()
        )
        with pytest.raises(AttentionBlocked, match="verificar"):
            await close_table_attention(db, order=db.orders.docs[0], user=_cashier(), now="2026-10-01T12:00:00+00:00")
        return db

    db = asyncio.run(run())
    assert db.attentions.docs[0]["status"] == "open"
    assert db.orders.docs[0]["attention_state"] == "open"
    assert db.tables.docs[0]["active_attention_id"] == "attention-1"


def test_explicit_full_payment_resolves_proof_status_without_losing_photo_evidence():
    async def run():
        db = _attention_world()
        db.orders.docs[0]["payment_status"] = "comprobante_subido"
        db.orders.docs[0]["payment_proof_url"] = _png_data_url()
        db.orders.docs[0]["payment_proof_method"] = "yape"
        db.cash_registers.docs.append(_open_register())
        payment_routes.db = db
        from models import PaymentCreate
        payment = await payment_routes.create_payment(
            PaymentCreate(order_id="order-1", method="yape", amount=20), user=_cashier()
        )
        return payment, db

    payment, db = asyncio.run(run())
    assert payment["fully_paid"] is True
    assert db.orders.docs[0]["payment_status"] == "pagado"
    assert db.orders.docs[0]["amount_paid"] == 20
    assert db.orders.docs[0]["payment_proof_url"] == _png_data_url()
    assert len(db.payments.docs) == 1


def test_other_tenant_order_is_not_found_and_not_modified():
    async def run():
        db = _attention_world()
        db.orders.docs[0]["restaurant_id"] = "rest-2"
        payment_routes.db = db
        with pytest.raises(HTTPException) as error:
            await payment_routes.upload_staff_proof(
                "order-1", StaffPaymentProof(payment_proof=_png_data_url(), method="yape"), user=_cashier()
            )
        return error, db

    error, db = asyncio.run(run())
    assert error.value.status_code == 404
    assert db.orders.docs[0]["payment_status"] == "pendiente"


def test_existing_cobro_function_is_required_for_staff_proof_route():
    async def run():
        guard = require_roles(["cajero"])
        with pytest.raises(HTTPException) as error:
            await guard(user={"id": "waiter", "restaurant_id": "rest-1", "role": "mozo"})
        return error

    error = asyncio.run(run())
    assert error.value.status_code == 403


def test_proof_image_is_not_returned_to_staff_without_cobro_function():
    saved = {
        "id": "order-1", "payment_proof_url": _png_data_url(),
        "payment_proof_method": "yape", "payment_proof_uploaded_by": "cashier-1",
        "payment_proof_uploaded_at": "timestamp", "payment_proof_sha256": "digest",
    }
    redacted = order_routes._order_for_user(saved, {"role": "mozo", "functions": ["atencion"]})
    assert "payment_proof_url" not in redacted
    assert "payment_proof_sha256" not in redacted
    assert order_routes._order_for_user(saved, _cashier())["payment_proof_url"] == _png_data_url()


@pytest.mark.parametrize("proof", ["data:image/png;base64,not-base64", "data:image/svg+xml;base64,PHN2Zz4="])
def test_invalid_or_unsupported_image_is_rejected_before_write(proof):
    async def run():
        db = _attention_world()
        payment_routes.db = db
        with pytest.raises(HTTPException) as error:
            await payment_routes.upload_staff_proof(
                "order-1", StaffPaymentProof(payment_proof=proof, method="yape"), user=_cashier()
            )
        return error, db

    error, db = asyncio.run(run())
    assert error.value.status_code == 400
    assert "payment_proof_url" not in db.orders.docs[0]
