"""Flujo del QR de mesa: contexto, prepago y regla "sin pago no hay cocina".

Cubre la mejora completa del pedido por QR:
  1. el enlace de la mesa abre el menú (no el checkout);
  2. el QR solo da contexto: la mesa queda preseleccionada, no impuesta;
  3. con prepago, el pedido no llega a cocina hasta que se confirma el cobro;
  4. sin prepago, nada cambia respecto del comportamiento anterior;
  5. una mesa con visita abierta acepta pedidos adicionales de otros celulares.
"""
import asyncio
import base64
import os
import sys
import time
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "restaurant_db_unit")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import OrderItemInput, PublicOrderCreate
from payment_policy import (
    DEFAULT_PREPAY_MODE,
    collection_policy,
    kitchen_visible,
    needs_counter_verification,
    order_acceptance,
    payment_label,
)
from guest_access import public_miss_limiter, public_order_limiter, read_table_token, sign_table
from routes.tables import _qr_payload
from test_money_integrity import _DB, _cashier
import routes.cash as cash_routes
import routes.orders as order_routes
import routes.payment_config as payment_config_routes
import routes.payments as payment_routes
import routes.prepay as prepay_routes
import routes.public as public_routes


class _Request:
    def __init__(self, host="10.0.0.5"):
        self.client = type("Client", (), {"host": host})()
        self.headers = {}


class _Counters:
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
    for module in (public_routes, order_routes, prepay_routes, payment_routes, cash_routes,
                   payment_config_routes):
        module.db = db
    counter = {"n": 0}

    async def _next(_restaurant_id):
        counter["n"] += 1
        return counter["n"]

    public_routes._next_order_number = _next
    order_routes._next_order_number = _next


def _world(**restaurant):
    db = _DB()
    db.restaurants.docs.append({"id": "rest-1", "name": "Sabor", "delivery_fee": 0, **restaurant})
    db.tables.docs.append({
        "id": "mesa-1", "restaurant_id": "rest-1", "number": 8, "status": "disponible",
        "area": "Salon", "qr_nonce": "nonce-1", "qr_revoked": False, "branch_id": "branch-1",
    })
    db.branches.docs[0].update({
        "name": "Central", "pickup_enabled": True,
        "timezone": "America/Lima", "business_day_cutoff": "04:00",
    })
    db.attention_number_assignments = type(db.orders)()
    db.counters = _Counters()
    db.products.docs.append({
        "id": "prod-1", "restaurant_id": "rest-1", "name": "Lomo saltado",
        "price": 32.0, "is_available": True, "is_combo": False,
    })
    db.products.docs.append({
        "id": "prod-2", "restaurant_id": "rest-1", "name": "Chicha morada",
        "price": 14.0, "is_available": True, "is_combo": False,
    })
    db.cash_registers.docs.append({
        "id": "reg-1", "restaurant_id": "rest-1", "branch_id": "branch-1",
        "status": "open", "opened_at": "2026-01-01T00:00:00+00:00",
    })
    db.audit_logs.docs.append({
        "id": "reg-audit", "event_id": "cash-open:reg-1", "restaurant_id": "rest-1",
        "action": "cash_open", "entity": "cash_register", "entity_id": "reg-1",
        "details": {}, "created_at": "2026-01-01T00:00:00+00:00",
    })
    return db


def _body(**extra):
    data = {
        "order_type": "local",
        "table_token": sign_table("mesa-1", "nonce-1"),
        "request_id": "6b44c60b-e4b0-4cfe-83ed-956242f2fc2c",
        "items": [OrderItemInput(product_id="prod-1", quantity=1)],
        "payment_method": "yape",
    }
    data.update(extra)
    return PublicOrderCreate(**data)


async def _create(db, body, host="10.0.0.5"):
    public_order_limiter.reset()
    return await public_routes.public_create_order(body, _Request(host))


async def _kitchen_ids(db):
    board = await order_routes.kitchen_orders(_cashier())
    return [row["id"] for row in board]


def _png_proof() -> str:
    """Una imagen minúscula con firma PNG real, que pasa la validación."""
    return "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32).decode()


# ---------- 1. el QR abre el menú, no el checkout ----------

def test_the_table_qr_opens_the_menu_with_the_table_in_context():
    payload = _qr_payload({"id": "mesa-8", "number": 8}, "nonce-abc")
    assert payload["path"].startswith("/menu?mesa=")
    assert "/checkout" not in payload["path"]
    assert payload["token"] in payload["path"]
    assert payload["table_number"] == 8


def test_scanning_the_qr_creates_nothing_and_returns_the_table_context():
    async def run():
        db = _world()
        _bind(db)
        token = sign_table("mesa-1", "nonce-1")
        context = await public_routes.public_table_session(token)
        return context, db

    context, db = asyncio.run(run())
    assert context["table"]["number"] == 8
    assert context["session"]["open"] is False
    assert context["session"]["orders"] == []
    assert db.orders.docs == []
    assert db.attentions.docs == []
    assert db.tables.docs[0]["status"] == "disponible"


def test_the_qr_only_preselects_the_table_and_the_venue_defines_the_defaults():
    """El QR no encierra al cliente: la política sigue siendo del restaurante."""
    # Sin configuración, el local cobra al final y no exige prepago.
    assert DEFAULT_PREPAY_MODE == "never"
    assert collection_policy({}, "local")["prepay_required"] is False
    # Y nada más queda encendido por defecto: recojo y delivery siguen igual.
    assert collection_policy({}, "recojo")["prepay_required"] is False
    assert collection_policy({}, "delivery")["prepay_required"] is False
    # Con prepago activo, el QR de mesa sí lo exige.
    always = {"table_prepay_mode": "always"}
    assert collection_policy(always, "local")["prepay_required"] is True
    # Y las otras modalidades siguen visibles: el cliente puede elegir recojo.
    assert collection_policy(always, "recojo")["prepay_required"] is False
    assert collection_policy({**always, "prepay_pickup": True}, "recojo")["prepay_required"] is True
    # La configuración por tipo deja el mostrador sin prepago.
    by_type = {"table_prepay_mode": "by_order_type", "prepay_delivery": False}
    assert collection_policy(by_type, "local")["prepay_required"] is True
    assert collection_policy(by_type, "delivery")["prepay_required"] is False


# ---------- QR impreso: no vence solo ----------

def test_a_long_lived_qr_stays_valid_for_years():
    """El cartel de la mesa se imprime una vez: el enlace dura, no caduca solo."""
    token = sign_table("mesa-1", "nonce-1")
    padded = token + "=" * (-len(token) % 4)
    raw = base64.urlsafe_b64decode(padded.encode()).decode()
    _, _, expires = raw.rsplit("|", 1)[0].split("|")
    years = (int(expires) - int(time.time())) / (365 * 24 * 3600)
    assert years > 9
    assert read_table_token(token) == ("mesa-1", "nonce-1")


def test_an_expired_print_still_opens_the_table_and_gets_renewed():
    """Un enlace vencido no debe dejar al cliente parado frente a la mesa."""
    async def run():
        db = _world()
        _bind(db)
        expired = sign_table("mesa-1", "nonce-1", ttl_seconds=-60)
        try:
            read_table_token(expired)
            strict_error = None
        except ValueError as exc:
            strict_error = exc
        context = await public_routes.public_table_session(expired)
        audits = [row for row in db.audit_logs.docs if row.get("action") == "table_qr_renewed"]
        return strict_error, context, audits, db

    strict_error, context, audits, db = asyncio.run(run())
    assert strict_error is not None
    assert context["table"]["number"] == 8
    # Se devuelve un enlace nuevo y queda registro para el restaurante.
    assert context["renewed_token"]
    assert read_table_token(context["renewed_token"]) == ("mesa-1", "nonce-1")
    assert len(audits) == 1
    assert audits[0]["details"]["reason"] == "expired_token_reissued"


def test_an_expired_print_can_still_place_the_order():
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        expired = sign_table("mesa-1", "nonce-1", ttl_seconds=-60)
        created = await _create(db, _body(table_token=expired, payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        return stored, db

    stored, db = asyncio.run(run())
    assert stored["table_id"] == "mesa-1"
    assert stored["acceptance_status"] == "pendiente"


def test_a_renewed_link_cannot_resurrect_a_rotated_or_revoked_qr():
    """La renovación automática no devuelve capacidades que el local dio de baja."""
    async def run():
        db = _world()
        _bind(db)
        expired = sign_table("mesa-1", "nonce-1", ttl_seconds=-60)
        db.tables.docs[0]["qr_nonce"] = "nonce-2"  # regenerado desde el panel
        try:
            await public_routes.public_table_session(expired)
            rotated = None
        except HTTPException as exc:
            rotated = exc
        db.tables.docs[0]["qr_nonce"] = "nonce-1"
        db.tables.docs[0]["qr_revoked"] = True
        try:
            await public_routes.public_table_session(expired)
            revoked = None
        except HTTPException as exc:
            revoked = exc
        return rotated, revoked, db

    rotated, revoked, db = asyncio.run(run())
    assert rotated is not None and rotated.status_code == 400
    assert revoked is not None and revoked.status_code == 400
    assert [r for r in db.audit_logs.docs if r.get("action") == "table_qr_renewed"] == []


def test_a_forged_signature_is_never_renewed():
    async def run():
        db = _world()
        _bind(db)
        forged = "bWVzYS0xfG5vbmNlLTF8OTk5OTk5OTk5OXxmaXJtYS1pbnZlbnRhZGE"
        try:
            await public_routes.public_table_session(forged)
            error = None
        except HTTPException as exc:
            error = exc
        return error, db

    error, db = asyncio.run(run())
    assert error is not None and error.status_code == 400
    assert [r for r in db.audit_logs.docs if r.get("action") == "table_qr_renewed"] == []


def test_the_follow_up_page_shows_every_order_of_the_table():
    """El resumen de la mesa se resuelve por el pedido, no por el token del QR.

    El enlace de seguimiento se comparte y se abre sin `?mesa=`: si el grupo
    dependiera del contexto guardado, el cliente vería solo su pedido.
    """
    async def run():
        db = _world()
        _bind(db)
        first = await _create(db, _body())
        second = await _create(db, _body(
            request_id="2e070dd1-69a5-42ef-afc9-e7247b8a86a9",
            items=[OrderItemInput(product_id="prod-2", quantity=1)],
        ), host="10.0.0.6")
        stored = await db.orders.find_one({"id": first["id"]})
        summary = await public_routes.public_order_table_session(stored["tracking_code"], _Request())
        return first, second, summary

    first, second, summary = asyncio.run(run())
    assert summary["table"]["number"] == 8
    numbers = [order["order_number"] for order in summary["session"]["orders"]]
    assert len(numbers) == 2
    assert first["id"] in [order["id"] for order in summary["session"]["orders"]]
    assert second["id"] in [order["id"] for order in summary["session"]["orders"]]
    assert summary["session"]["total_pending"] == 46.0
    # Cada pedido trae sus productos y sus observaciones para el resumen.
    detalle = summary["session"]["orders"][0]
    assert detalle["items"][0]["name"] == "Lomo saltado"
    assert detalle["items"][0]["quantity"] == 1


def test_a_cancelled_order_disappears_from_the_table_summary():
    async def run():
        db = _world()
        _bind(db)
        created = await _create(db, _body())
        stored = await db.orders.find_one({"id": created["id"]})
        con_pedido = await public_routes.public_order_table_session(stored["tracking_code"], _Request())
        await order_routes.change_status(
            stored["id"], _status_input("cancelado", "prueba"), _cashier(),
        )
        resumen = await public_routes.public_order_table_session(stored["tracking_code"], _Request())
        return con_pedido, resumen

    con_pedido, resumen = asyncio.run(run())
    assert len(con_pedido["session"]["orders"]) == 1
    assert resumen["session"]["orders"] == []
    assert resumen["session"]["total_pending"] == 0.0
    assert resumen["session"]["total_paid"] == 0.0
    assert resumen["table"]["number"] == 8


def test_a_table_summary_requires_a_valid_tracking_code():
    async def run():
        db = _world()
        _bind(db)
        public_miss_limiter.reset()
        try:
            await public_routes.public_order_table_session("NOEXISTE", _Request())
            error = None
        except HTTPException as exc:
            error = exc
        return error

    error = asyncio.run(run())
    assert error is not None and error.status_code == 404


def test_a_pickup_order_has_no_table_summary():
    async def run():
        db = _world()
        _bind(db)
        created = await _create(db, _body(
            order_type="recojo", table_token=None, table_id=None, branch_id="branch-1",
            customer_name="Ana", customer_phone="999888777", payment_method="efectivo",
        ))
        stored = await db.orders.find_one({"id": created["id"]})
        try:
            await public_routes.public_order_table_session(stored["tracking_code"], _Request())
            error = None
        except HTTPException as exc:
            error = exc
        return error

    error = asyncio.run(run())
    assert error is not None and error.status_code == 404


# ---------- abandono del prepago ----------

def test_cancelling_an_abandoned_prepayment_frees_the_table():
    """Si el cliente abre un pedido con prepago y se va, el local debe poder soltar la mesa.

    Sin esto, la intención reserva la mesa sin visita abierta y nadie puede
    volver a abrirla desde el QR.
    """
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        again = None
        blocked_after = None
        table_before = await db.tables.find_one({"id": "mesa-1"})
        # El local cancela la intención abandonada desde el panel.
        cancelled = await order_routes.change_status(
            stored["id"], _status_input("cancelado", "el cliente no pagó"), _cashier(),
        )
        table_after = await db.tables.find_one({"id": "mesa-1"})
        # Y la mesa vuelve a aceptar un pedido nuevo desde el QR.
        public_order_limiter.reset()
        try:
            again = await public_routes.public_create_order(
                _body(request_id="2e070dd1-69a5-42ef-afc9-e7247b8a86a9"), _Request("10.0.0.6"),
            )
        except HTTPException as exc:
            blocked_after = exc
        return table_before, cancelled, table_after, again, blocked_after, db

    table_before, cancelled, table_after, again, blocked_after, db = asyncio.run(run())
    assert table_before["opening_order_id"]  # la intención reservaba la mesa
    assert cancelled["status"] == "cancelado"
    assert "opening_order_id" not in table_after
    assert table_after["status"] == "disponible"
    assert blocked_after is None, f"la mesa quedó trabada: {blocked_after and blocked_after.detail}"
    assert again["id"] != cancelled["id"]


def _status_input(status, reason=None):
    return order_routes.OrderStatusUpdate(status=status, reason=reason)


# ---------- 2. sin prepago nada cambia ----------
def test_without_prepay_the_order_still_reaches_the_kitchen():
    async def run():
        db = _world()
        _bind(db)
        created = await _create(db, _body(payment_method="efectivo"))
        stored = await db.orders.find_one({"id": created["id"]})
        return created, stored, await _kitchen_ids(db)

    created, stored, board = asyncio.run(run())
    assert stored["status"] == "enviado_cocina"
    assert stored["prepay_required"] is False
    assert stored["payment_state"] == "no_requerido"
    assert stored["acceptance_status"] == "aceptado"
    assert stored["id"] in board
    assert created["sent_to_kitchen"] is True


# ---------- 3. con prepago, sin pago no hay cocina ----------

def test_with_prepay_a_transfer_order_never_reaches_the_kitchen_before_payment():
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        before = await _kitchen_ids(db)
        # El reporte del cliente solo avisa; no libera el pedido.
        await db.orders.update_one({"id": stored["id"]}, {"$set": {"payment_state": "reportado"}})
        still_hidden = await _kitchen_ids(db)
        # Caja verifica el pago: recién ahora entra a cocina.
        confirmed = await prepay_routes.confirm_public_prepayment(stored["id"], _cashier())
        after = await db.orders.find_one({"id": stored["id"]})
        return created, stored, before, still_hidden, confirmed, after, await _kitchen_ids(db), db

    created, stored, before, still_hidden, confirmed, after, board, db = asyncio.run(run())
    assert stored["acceptance_status"] == "pendiente"
    assert stored["payment_state"] == "pendiente"
    assert stored["prepay_required"] is True
    assert stored["sent_to_kitchen_at"] is None
    assert before == []
    assert still_hidden == []
    assert created["sent_to_kitchen"] is False
    assert confirmed["ok"] is True
    assert after["acceptance_status"] == "aceptado"
    assert after["payment_state"] == "confirmado"
    assert after["payment_status"] == "pagado"
    assert after["sent_to_kitchen_at"]
    assert stored["id"] in board
    # El cobro queda registrado una sola vez, con su referencia.
    payments = [p for p in db.payments.docs if p.get("order_id") == stored["id"]]
    assert len(payments) == 1
    assert payments[0]["amount"] == 32.0
    assert payments[0]["method"] == "yape"
    assert payments[0]["status"] == "completed"


def test_a_cancelled_prepayment_leaves_the_cashier_queue():
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        before = await prepay_routes.list_pending_prepayments(_cashier())
        await db.orders.update_one(
            {"id": stored["id"]},
            {"$set": {"status": "cancelado", "acceptance_status": "pendiente"}},
        )
        after = await prepay_routes.list_pending_prepayments(_cashier())
        return before, after

    before, after = asyncio.run(run())
    assert len(before) == 1
    assert after == []


def test_the_client_proof_is_only_a_report_and_never_a_confirmed_payment():
    """Una captura subida por el cliente no puede equivaler a un pago."""
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        await public_routes.upload_proof(
            stored["tracking_code"],
            public_routes.PublicProofUpload(payment_proof=_png_proof()),
            _Request(),
        )
        after = await db.orders.find_one({"id": stored["id"]})
        board = await _kitchen_ids(db)
        # Y desde caja aparece en la cola de verificación, no como pagado.
        queue = await prepay_routes.list_pending_prepayments(_cashier())
        return after, board, queue, db

    after, board, queue, db = asyncio.run(run())
    assert after["payment_state"] == "reportado"
    assert after["payment_status"] == "comprobante_subido"
    assert after["acceptance_status"] == "pendiente"
    assert board == []
    assert db.payments.docs == []
    assert [row["order_number"] for row in queue] == [after["order_number"]]
    assert queue[0]["has_proof"] is True
    assert queue[0]["payment_state"] == "reportado"


def test_confirming_a_prepayment_twice_charges_once():
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        first = await prepay_routes.confirm_public_prepayment(stored["id"], _cashier())
        second = await prepay_routes.confirm_public_prepayment(stored["id"], _cashier())
        return first, second, db

    first, second, db = asyncio.run(run())
    assert first["ok"] is True
    assert second.get("already_confirmed") is True
    assert len([p for p in db.payments.docs if p.get("order_id") == first["order_id"]]) == 1
    assert len(db.orders.docs) == 1


def test_a_rejected_prepayment_keeps_the_order_out_of_the_kitchen():
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="plin"))
        stored = await db.orders.find_one({"id": created["id"]})
        rejected = await prepay_routes.reject_public_prepayment(stored["id"], _cashier())
        after = await db.orders.find_one({"id": stored["id"]})
        board = await _kitchen_ids(db)
        # Y el cliente ya no puede tocarlo como si nada.
        try:
            await public_routes.public_add_items(
                stored["tracking_code"],
                public_routes.PublicItemsAdd(items=[OrderItemInput(product_id="prod-2", quantity=1)]),
                _Request(),
            )
            blocked = None
        except HTTPException as exc:
            blocked = exc
        return rejected, after, board, blocked

    rejected, after, board, blocked = asyncio.run(run())
    assert rejected["payment_state"] == "rechazado"
    assert after["acceptance_status"] == "pendiente"
    assert board == []
    assert blocked is not None and blocked.status_code == 400
    assert "verificar" in blocked.detail


def test_the_public_menu_does_not_offer_a_table_that_waits_for_payment():
    async def run():
        db = _world(table_prepay_mode="always", require_table_qr=False)
        _bind(db)
        listed_before = await public_routes.public_tables()
        await _create(db, _body(payment_method="yape"))
        listed_after = await public_routes.public_tables()
        return listed_before, listed_after

    listed_before, listed_after = asyncio.run(run())
    assert [t["id"] for t in listed_before] == ["mesa-1"]
    assert listed_after == []


# ---------- 4. el ticket de cocina ----------

def test_the_kitchen_ticket_says_how_the_money_stands_without_revealing_amounts():
    assert payment_label({"payment_status": "pagado"}) == "pagado"
    assert payment_label({"payment_state": "confirmado"}) == "pagado"
    assert payment_label({"prepay_required": True, "payment_state": "pendiente", "pay_at_counter": True}) == "cobra_en_caja"
    assert payment_label({"prepay_required": True, "payment_state": "pendiente"}) == "sin_confirmar"
    assert payment_label({}) == "al_final"


def test_only_a_verifiable_payment_waits_for_the_cashier():
    assert needs_counter_verification({"prepay_required": True, "payment_state": "yape"}) is False
    assert needs_counter_verification({
        "prepay_required": True, "payment_state": "reportado", "payment_method_choice": "yape",
    }) is True
    assert needs_counter_verification({
        "prepay_required": True, "payment_state": "pendiente", "payment_method_choice": "transferencia",
    }) is True
    assert needs_counter_verification({
        "prepay_required": False, "payment_state": "no_requerido", "payment_method_choice": "yape",
    }) is False


def test_the_kitchen_gate_is_the_single_acceptance_flag():
    assert kitchen_visible({"acceptance_status": "aceptado"}) is True
    assert kitchen_visible({}) is True
    assert kitchen_visible({"acceptance_status": "pendiente"}) is False


# ---------- 5. efectivo y tarjeta se cocinan y se cobran en caja ----------

def test_cash_orders_are_cooked_and_flagged_for_collection():
    decision = order_acceptance(collection_policy({"table_prepay_mode": "always"}, "local"), "efectivo")
    assert decision == {
        "payment_state": "pendiente",
        "prepay_required": True,
        "acceptance_status": "aceptado",
        "pay_at_counter": True,
    }


def test_card_and_transfer_get_different_treatment_under_prepay():
    policy = collection_policy({"table_prepay_mode": "always"}, "local")
    assert order_acceptance(policy, "tarjeta")["acceptance_status"] == "aceptado"
    assert order_acceptance(policy, "transferencia")["acceptance_status"] == "pendiente"
    assert order_acceptance(policy, "plin")["acceptance_status"] == "pendiente"


def test_a_cash_prepay_order_reaches_the_kitchen_flagged_for_collection():
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="efectivo"))
        stored = await db.orders.find_one({"id": created["id"]})
        board = await order_routes.kitchen_orders(_cashier())
        row = next((r for r in board if r["id"] == stored["id"]), None)
        return stored, row

    stored, row = asyncio.run(run())
    assert stored["acceptance_status"] == "aceptado"
    assert stored["pay_at_counter"] is True
    assert row is not None
    assert row["payment_label"] == "cobra_en_caja"
    assert row["pay_at_counter"] is True


# ---------- 6. una mesa admite varios pedidos y varios celulares ----------

def test_a_table_with_an_open_visit_accepts_another_device():
    async def run():
        db = _world()
        _bind(db)
        first = await _create(db, _body())
        second_body = _body(request_id="2e070dd1-69a5-42ef-afc9-e7247b8a86a9")
        second = await _create(db, second_body, host="10.0.0.6")
        rows = list(db.orders.docs)
        attention = db.attentions.docs[0] if db.attentions.docs else None
        context = await public_routes.public_table_session(sign_table("mesa-1", "nonce-1"))
        return first, second, rows, attention, context

    first, second, rows, attention, context = asyncio.run(run())
    assert len(rows) == 2
    assert {row["attention_id"] for row in rows} == {rows[0]["attention_id"]}
    assert attention is not None and attention["status"] == "open"
    assert sorted(attention["order_ids"]) == sorted([first["id"], second["id"]])
    assert len(context["session"]["orders"]) == 2
    assert context["session"]["open"] is True


def test_the_customer_sees_the_orders_of_the_table_grouped_with_their_totals():
    async def run():
        db = _world()
        _bind(db)
        await _create(db, _body())
        await _create(db, _body(
            request_id="2e070dd1-69a5-42ef-afc9-e7247b8a86a9",
            items=[OrderItemInput(product_id="prod-2", quantity=1)],
        ), host="10.0.0.6")
        return await public_routes.public_table_session(sign_table("mesa-1", "nonce-1"))

    context = asyncio.run(run())
    assert [o["total"] for o in context["session"]["orders"]] == [32.0, 14.0]
    assert context["session"]["total_paid"] == 0.0
    assert context["session"]["total_pending"] == 46.0


def test_each_additional_send_is_a_new_order_and_a_new_payment():
    """Cada envío genera su propio pedido y su propio cobro, sin tocar el anterior."""
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        first = await _create(db, _body(payment_method="yape"))
        first_row = await db.orders.find_one({"id": first["id"]})
        await prepay_routes.confirm_public_prepayment(first_row["id"], _cashier())
        paid_snapshot = await db.orders.find_one({"id": first["id"]})

        second = await _create(db, _body(
            request_id="2e070dd1-69a5-42ef-afc9-e7247b8a86a9",
            items=[OrderItemInput(product_id="prod-2", quantity=1)],
            payment_method="yape",
        ), host="10.0.0.6")
        second_row = await db.orders.find_one({"id": second["id"]})
        await prepay_routes.confirm_public_prepayment(second_row["id"], _cashier())
        final_first = await db.orders.find_one({"id": first["id"]})
        return paid_snapshot, second_row, final_first, db

    paid_snapshot, second_row, final_first, db = asyncio.run(run())
    # El pedido ya pagado conserva importe, estado y cobro intactos.
    assert final_first["total"] == paid_snapshot["total"] == 32.0
    assert final_first["payment_status"] == "pagado"
    # El adicional es un pedido aparte, con su propio importe y su propio cobro.
    assert second_row["id"] != final_first["id"]
    assert second_row["total"] == 14.0
    payments = {p["order_id"]: p["amount"] for p in db.payments.docs}
    assert payments == {final_first["id"]: 32.0, second_row["id"]: 14.0}


def test_an_additional_order_is_tagged_as_such_for_the_kitchen():
    async def run():
        db = _world()
        _bind(db)
        first = await _create(db, _body())
        await _create(db, _body(
            request_id="2e070dd1-69a5-42ef-afc9-e7247b8a86a9",
            items=[OrderItemInput(product_id="prod-2", quantity=1)],
        ), host="10.0.0.6")
        board = await order_routes.kitchen_orders(_cashier())
        return first, {row["id"]: row for row in board}

    first, by_id = asyncio.run(run())
    assert len(by_id) == 2
    assert all(row["is_additional"] for row in by_id.values())
    assert first["id"] in by_id


# ---------- 7. la apertura de la mesa ----------

def test_a_paid_prepay_order_opens_the_table_visit():
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        await prepay_routes.confirm_public_prepayment(stored["id"], _cashier())
        table = await db.tables.find_one({"id": "mesa-1"})
        attention = await db.attentions.find_one({"id": stored["attention_id"]})
        return table, attention

    table, attention = asyncio.run(run())
    assert table["status"] == "ocupada"
    assert table["active_attention_id"] == attention["id"]
    assert attention["status"] == "open"


def test_a_pending_prepay_order_still_holds_its_table():
    async def run():
        db = _world(table_prepay_mode="always")
        _bind(db)
        created = await _create(db, _body(payment_method="yape"))
        stored = await db.orders.find_one({"id": created["id"]})
        table = await db.tables.find_one({"id": "mesa-1"})
        # Un segundo celular no puede abrir otra visita en la misma mesa.
        public_order_limiter.reset()
        try:
            await public_routes.public_create_order(
                _body(request_id="2e070dd1-69a5-42ef-afc9-e7247b8a86a9"), _Request("10.0.0.6"),
            )
            blocked = None
        except HTTPException as exc:
            blocked = exc
        return created, stored, table, blocked

    created, stored, table, blocked = asyncio.run(run())
    assert table["opening_order_id"] == stored["id"]
    assert table["status"] == "disponible"
    assert blocked is not None and blocked.status_code == 409
    assert created["sent_to_kitchen"] is False
