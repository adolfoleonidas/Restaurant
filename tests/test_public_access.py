"""Public orders need a table QR, a rate limit, and staff acceptance before the kitchen."""
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

from models import PublicOrderCreate, OrderItemInput, PublicProofUpload
from attention import AttentionBlocked
from routes.orders import kitchen_orders
from routes.public import public_create_order, public_tables, upload_proof
from guest_access import read_table_token, sign_table, public_order_limiter
from test_money_integrity import _DB, _cashier
import routes.orders as order_routes
import routes.public as public_routes


class _Request:
    def __init__(self, host):
        self.client = type("Client", (), {"host": host})()
        self.headers = {}


class _Counters:
    """Minimal atomic counter store for attention numbering in unit tests."""

    def __init__(self):
        self.docs = {}

    async def find_one_and_update(self, filt, update, upsert=False, return_document=None):
        key = filt["_id"]
        doc = self.docs.get(key)
        if doc is None:
            if not upsert:
                return None
            doc = {"_id": key}
            for k, v in (update.get("$setOnInsert") or {}).items():
                doc[k] = v
            doc["value"] = 0
            self.docs[key] = doc
        doc["value"] = doc.get("value", 0) + update.get("$inc", {}).get("value", 0)
        return dict(doc)


def _bind(db):
    public_routes.db = db
    order_routes.db = db
    counter = {"n": 0}

    async def _next(_restaurant_id):
        counter["n"] += 1
        return counter["n"]

    public_routes._next_order_number = _next


def _world():
    db = _DB()
    db.restaurants.docs.append({"id": "rest-1", "name": "Sabor", "delivery_fee": 0})
    db.tables.docs.append({
        "id": "mesa-1", "restaurant_id": "rest-1", "number": 4, "status": "disponible", "area": "Salon",
        "qr_nonce": "nonce-1", "qr_revoked": False, "branch_id": "branch-1",
    })
    db.branches = type(db.orders)()
    db.branches.docs.append({
        "id": "branch-1", "restaurant_id": "rest-1", "name": "Central", "pickup_enabled": True,
        "timezone": "America/Lima", "business_day_cutoff": "04:00",
    })
    db.attention_number_assignments = type(db.orders)()
    db.counters = _Counters()
    db.products.docs.append({
        "id": "prod-1",
        "restaurant_id": "rest-1",
        "name": "Lomo",
        "price": 20.0,
        "is_available": True,
        "is_combo": False,
    })
    db.payment_configs = type(db.orders)()
    return db


def _body(**extra):
    data = {
        "order_type": "local",
        "table_id": "mesa-1",
        "request_id": "6b44c60b-e4b0-4cfe-83ed-956242f2fc2c",
        "customer_name": "Ana",
        "customer_phone": "999",
        "items": [OrderItemInput(product_id="prod-1", quantity=1)],
        "payment_method": "efectivo",
    }
    data.update(extra)
    return PublicOrderCreate(**data)


def test_default_menu_lists_tables_and_a_bad_token_is_rejected():
    async def run():
        _bind(_world())
        return await public_tables()

    listed = asyncio.run(run())
    assert listed[0]["number"] == 4
    with pytest.raises(ValueError):
        read_table_token("no-es-un-qr")


def test_local_order_without_qr_still_reaches_the_kitchen():
    async def run():
        db = _world()
        _bind(db)
        public_order_limiter.reset()
        created = await public_create_order(_body(), _Request("10.0.0.8"))
        stored = await db.orders.find_one({"id": created["id"]})
        board = await kitchen_orders(_cashier())
        return stored, board

    stored, board = asyncio.run(run())
    assert stored["status"] == "enviado_cocina"
    assert stored["table_id"] == "mesa-1"
    assert any(row["id"] == stored["id"] for row in board)


def test_signed_table_qr_selects_that_table_when_the_local_turns_it_on():
    async def run():
        db = _world()
        db.restaurants.docs[0]["require_table_qr"] = True
        _bind(db)
        public_order_limiter.reset()
        try:
            await public_create_order(_body(), _Request("10.0.0.7"))
            missing = None
        except HTTPException as exc:
            missing = exc
        token = sign_table("mesa-1", "nonce-1")
        created = await public_create_order(_body(table_token=token, request_id="2e070dd1-69a5-42ef-afc9-e7247b8a86a9"), _Request("10.0.0.9"))
        stored = await db.orders.find_one({"id": created["id"]})
        board = await kitchen_orders(_cashier())
        return missing, stored, board

    missing, stored, board = asyncio.run(run())
    assert missing is not None and missing.status_code == 400
    assert stored["table_id"] == "mesa-1"
    assert stored["status"] == "enviado_cocina"
    assert any(row["id"] == stored["id"] for row in board)


def test_public_orders_are_rate_limited_per_client():
    async def run():
        db = _world()
        _bind(db)
        public_order_limiter.reset()
        public_order_limiter.limit = 2
        request = _Request("10.1.1.1")
        recojo = {"order_type": "recojo", "table_token": None, "table_id": None, "request_id": None, "branch_id": "branch-1"}
        try:
            first = await public_create_order(_body(**recojo), request)
            await public_create_order(_body(**recojo), request)
            try:
                await public_create_order(_body(**recojo), request)
                blocked = None
            except HTTPException as exc:
                blocked = exc
            return first, blocked
        finally:
            public_order_limiter.limit = 8
            public_order_limiter.reset()

    first, blocked = asyncio.run(run())
    assert first["order_number"]
    assert blocked is not None and blocked.status_code == 429
    assert read_table_token(sign_table("mesa-1", "nonce-1")) == ("mesa-1", "nonce-1")


def test_revoked_or_rotated_qr_is_rejected():
    async def run():
        db = _world()
        db.restaurants.docs[0]["require_table_qr"] = True
        _bind(db)
        public_order_limiter.reset()
        good = sign_table("mesa-1", "nonce-1")
        created = await public_create_order(_body(table_token=good, request_id="0c43a31c-a8d4-4bf0-9fb2-22c438344ef3"), _Request("10.0.0.11"))
        db.tables.docs[0]["qr_revoked"] = True
        public_order_limiter.reset()
        try:
            await public_create_order(_body(table_token=good, request_id="11d1749b-b186-4f4d-a8fa-05a84e97a668"), _Request("10.0.0.12"))
            revoked = None
        except HTTPException as exc:
            revoked = exc
        db.tables.docs[0]["qr_revoked"] = False
        db.tables.docs[0]["qr_nonce"] = "nonce-2"
        public_order_limiter.reset()
        try:
            await public_create_order(_body(table_token=good, request_id="4f05a9a6-5bf5-4080-90f4-644bd671b60f"), _Request("10.0.0.13"))
            rotated = None
        except HTTPException as exc:
            rotated = exc
        return created, revoked, rotated

    created, revoked, rotated = asyncio.run(run())
    assert created["id"]
    assert revoked is not None and revoked.status_code == 400
    assert rotated is not None and rotated.status_code == 400


def test_public_table_order_retry_recovers_only_its_own_opening():
    async def run():
        db = _world()
        _bind(db)
        public_order_limiter.reset()
        body = _body(request_id="3a5a8d12-0f30-4f43-a05e-b329f1d6c4a1")
        # A response/opening failure can be retried using the client-owned capability.
        opener = public_routes.open_table_attention
        failed_once = False

        async def fail_once(*args, **kwargs):
            nonlocal failed_once
            if not failed_once:
                failed_once = True
                raise AttentionBlocked("injected opening failure")
            return await opener(*args, **kwargs)

        public_routes.open_table_attention = fail_once
        try:
            await public_create_order(body, _Request("10.0.0.18"))
        except HTTPException as exc:
            first = exc
        finally:
            public_routes.open_table_attention = opener
        public_order_limiter.reset()
        recovered = await public_create_order(body, _Request("10.0.0.18"))
        own = await db.orders.find_one({"id": recovered["id"]})
        attention = await db.attentions.find_one({"id": own["attention_id"]})
        audits = [row for row in db.audit_logs.docs if row.get("action") == "public_order_create"]
        return first, recovered, own, attention, audits, db

    first, recovered, own, attention, audits, db = asyncio.run(run())
    assert first.status_code == 409
    assert recovered["id"] == own["id"]
    assert own["request_id"] == "3a5a8d12-0f30-4f43-a05e-b329f1d6c4a1"
    assert attention["status"] == "open"
    assert len(db.orders.docs) == 1
    assert len(audits) == 1


def test_public_order_nonce_rejects_changed_payload_and_other_table_owner():
    async def run():
        db = _world()
        _bind(db)
        public_order_limiter.reset()
        nonce = "6c64c1d0-17af-465e-bb4a-31e85c494914"
        own = await public_create_order(_body(request_id=nonce), _Request("10.0.0.19"))
        public_order_limiter.reset()
        try:
            await public_create_order(_body(request_id=nonce, notes="different"), _Request("10.0.0.19"))
            changed = None
        except HTTPException as exc:
            changed = exc
        public_order_limiter.reset()
        try:
            await public_create_order(_body(request_id="b3f3dd04-c3a2-4a34-ae32-0b3c7e8f8aba"), _Request("10.0.0.20"))
            stranger = None
        except HTTPException as exc:
            stranger = exc
        return own, changed, stranger, db

    own, changed, stranger, db = asyncio.run(run())
    assert changed is not None and changed.status_code == 409
    assert stranger is not None and stranger.status_code in (400, 409)
    assert own["tracking_code"] not in str(stranger.detail)
    assert len(db.orders.docs) == 1


def test_public_order_request_nonce_is_restaurant_scoped():
    async def run():
        db = _world()
        _bind(db)
        public_order_limiter.reset()
        nonce = "db0c89d6-a4d4-402c-87e6-fd0f9cd9fdf7"
        first = await public_create_order(_body(order_type="recojo", request_id=nonce, branch_id="branch-1"), _Request("10.0.0.21"))
        db.restaurants.docs[0]["id"] = "rest-2"
        db.products.docs[0]["restaurant_id"] = "rest-2"
        db.branches.docs[0]["restaurant_id"] = "rest-2"
        public_order_limiter.reset()
        second = await public_create_order(_body(order_type="recojo", request_id=nonce, branch_id="branch-1"), _Request("10.0.0.21"))
        return first, second, db

    first, second, db = asyncio.run(run())
    assert second["id"] != first["id"]
    assert len(db.orders.docs) == 2


def test_public_request_nonce_must_be_a_canonical_uuid():
    with pytest.raises(Exception):
        _body(request_id="predictable")


@pytest.mark.parametrize("use_qr", [False, True], ids=["table-selection", "qr-token"])
def test_new_dine_in_orders_without_request_id_fail_before_writes(use_qr):
    async def run():
        db = _world()
        _bind(db)
        public_order_limiter.reset()
        before_table = dict(db.tables.docs[0])
        extra = {"request_id": None}
        if use_qr:
            extra["table_token"] = sign_table("mesa-1", "nonce-1")
        try:
            await public_create_order(_body(**extra), _Request("10.0.0.24"))
            error = None
        except HTTPException as exc:
            error = exc
        return db, error, before_table

    db, error, before_table = asyncio.run(run())
    assert error is not None and error.status_code == 400
    assert "actualiza" in error.detail.lower()
    assert db.orders.docs == []
    assert db.attentions.docs == []
    assert db.tables.docs[0] == before_table


def test_concurrent_public_retries_with_same_request_id_create_one_order():
    async def run():
        db = _world()
        _bind(db)
        public_order_limiter.reset()
        body = _body(request_id="fd00f07f-7007-45dd-b22f-0d0d02ad2fff")
        return await asyncio.gather(
            public_create_order(body, _Request("10.0.0.22")),
            public_create_order(body, _Request("10.0.0.23")),
        ), db

    responses, db = asyncio.run(run())
    assert responses[0]["id"] == responses[1]["id"]
    assert len(db.orders.docs) == 1
    assert len([row for row in db.audit_logs.docs if row.get("action") == "public_order_create"]) == 1


def test_public_order_request_id_accepts_uuid_v4_but_rejects_v1():
    valid = "a8098c1a-f86e-41d8-b102-1b6f7c5f3a21"
    assert _body(request_id=valid).request_id == valid
    with pytest.raises(Exception):
        _body(request_id="a8098c1a-f86e-11d8-b102-1b6f7c5f3a21")


def test_public_proof_upload_accepts_open_order_and_rejects_closed_orders():
    async def run():
        db = _world()
        _bind(db)
        open_order = {
            "id": "order-open",
            "restaurant_id": "rest-1",
            "tracking_code": "OPEN1234",
            "status": "enviado_cocina",
            "updated_at": "2026-09-11T12:00:00+00:00",
        }
        paid_order = {**open_order, "id": "order-paid", "tracking_code": "PAID1234", "status": "pagado"}
        cancelled_order = {**open_order, "id": "order-cancelled", "tracking_code": "CANCEL12", "status": "cancelado"}
        confirmed_order = {
            **open_order,
            "id": "order-confirmed",
            "tracking_code": "CONFIR12",
            "payment_status": "confirmado",
        }
        db.orders.docs.extend([open_order, paid_order, cancelled_order, confirmed_order])
        proof = PublicProofUpload(payment_proof="data:image/png;base64,abc")

        accepted = await upload_proof("open1234", proof)
        stored_open = await db.orders.find_one({"id": "order-open"})
        blocked = {}
        for label, code in (("paid", "paid1234"), ("cancelled", "cancel12"), ("confirmed", "confir12")):
            try:
                await upload_proof(code, proof)
                blocked[label] = None
            except HTTPException as exc:
                blocked[label] = exc
        return accepted, stored_open, blocked

    accepted, stored_open, blocked = asyncio.run(run())
    assert accepted == {"ok": True}
    assert stored_open["payment_status"] == "comprobante_subido"
    assert stored_open["payment_proof_url"].startswith("data:image")
    for label in ("paid", "cancelled", "confirmed"):
        exc = blocked[label]
        assert exc is not None and exc.status_code == 400
        assert exc.detail == "El pedido ya está cerrado"


def test_public_order_rejects_disabled_payment_method_but_keeps_enabled_defaults():
    async def run():
        db = _world()
        db.payment_configs.docs.append({
            "restaurant_id": "rest-1",
            "enable_yape": False,
            "enable_plin": True,
        })
        _bind(db)
        public_order_limiter.reset()
        try:
            await public_create_order(
                _body(payment_method="yape", order_type="recojo", table_token=None, table_id=None,
                      branch_id="branch-1", request_id="3f1c2d4b-5a6e-4f70-8b91-c2d3e4f5a6b7"),
                _Request("10.0.0.21"),
            )
            disabled = None
        except HTTPException as exc:
            disabled = exc

        public_order_limiter.reset()
        default_enabled = await public_create_order(
            _body(payment_method="efectivo", order_type="recojo", table_token=None, table_id=None,
                  branch_id="branch-1", request_id="7c9e1f2a-3b4d-4e5f-9a01-b2c3d4e5f6a7"),
            _Request("10.0.0.22"),
        )
        public_order_limiter.reset()
        configured_enabled = await public_create_order(
            _body(payment_method="plin", order_type="recojo", table_token=None, table_id=None,
                  branch_id="branch-1", request_id="0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
            _Request("10.0.0.23"),
        )
        return disabled, default_enabled, configured_enabled

    disabled, default_enabled, configured_enabled = asyncio.run(run())
    assert disabled is not None and disabled.status_code == 400
    assert disabled.detail == "El método de pago seleccionado no está disponible"
    assert default_enabled["payment_method"] == "efectivo"
    assert configured_enabled["payment_method"] == "plin"


def test_public_order_rejects_card_when_default_payment_config_disables_it():
    async def run():
        db = _world()
        _bind(db)
        public_order_limiter.reset()
        try:
            await public_create_order(
                _body(payment_method="tarjeta", order_type="recojo", table_token=None, table_id=None),
                _Request("10.0.0.24"),
            )
            blocked = None
        except HTTPException as exc:
            blocked = exc
        return blocked

    blocked = asyncio.run(run())
    assert blocked is not None and blocked.status_code == 400
    assert blocked.detail == "El método de pago seleccionado no está disponible"
