from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timezone, timedelta
from typing import Optional
from zoneinfo import ZoneInfo
import base64
import copy
import hashlib
import re
import uuid
from pymongo.errors import DuplicateKeyError
from database import db
from auth import get_current_user, require_roles
from branch_access import has_tenantwide_branch_access, read_branch_filter, validate_user_branch
from models import PaymentCreate, PaymentVoid, StaffPaymentProof
from billing import account_total, build_sold_lines, cash_portion, reversal_is_inside_open_shift
from order_flow import VersionError, claim_order, claim_attention_mutation, finish_attention_mutation, ticket_fields, version_conflict
from notify import emit_order, emit_notice

LIMA = ZoneInfo("America/Lima")
router = APIRouter()

_STAFF_PROOF_DATA_URL = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$")
_STAFF_PROOF_MAX_BYTES = 1_800_000


def proof_is_pending(order: dict) -> bool:
    """Whether the order carries a proof still waiting for review.

    Newer orders track it in `payment_proof_status`; legacy ones only carried
    `payment_status == 'comprobante_subido'`.
    """
    status = order.get("payment_proof_status")
    if status:
        return status == "pendiente"
    return order.get("payment_status") == "comprobante_subido"


async def _authorized_order(order_id: str, user: dict) -> dict:
    order = await db.orders.find_one(
        {"id": order_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if not has_tenantwide_branch_access(user):
        branch_id = await validate_user_branch(user, db.branches)
        if not branch_id or order.get("branch_id") != branch_id:
            raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return order


async def _payment_branch_scope(user: dict) -> dict:
    if has_tenantwide_branch_access(user):
        return {"restaurant_id": user["restaurant_id"]}
    branch_id = await validate_user_branch(user, db.branches)
    return {"restaurant_id": user["restaurant_id"], "branch_id": branch_id}


async def _register_for_order(order: dict, restaurant_id: str) -> dict | None:
    branch_id = order.get("branch_id")
    query = {"restaurant_id": restaurant_id, "status": "open"}
    query["branch_id"] = branch_id
    return await db.cash_registers.find_one(query, {"_id": 0})


def _check_payment_replay(payment: dict, order: dict, order_id: str) -> dict:
    if payment.get("order_id") != order_id or payment.get("branch_id") != order.get("branch_id"):
        raise HTTPException(status_code=409, detail="El pago existente no coincide con el pedido y sucursal originales")
    # Same shape as a fresh charge. The dialog and the printed receipt read these
    # to decide whether the bill is settled, and a retry after a network cut used
    # to come back without them (the cashier saw a blank remainder).
    total = round(float(order.get("total") or 0), 2)
    paid = round(float(order.get("amount_paid") or 0), 2)
    replay = {key: value for key, value in payment.items() if key != "_id"}
    replay["remaining"] = round(max(0.0, total - paid), 2)
    replay["fully_paid"] = paid + 0.009 >= total
    replay["table_released"] = False
    return replay


def _validated_staff_proof(value: str) -> tuple[str, str]:
    if len(value) > 2_500_000:
        raise HTTPException(status_code=400, detail="La imagen supera el tamaño permitido")
    match = _STAFF_PROOF_DATA_URL.fullmatch(value)
    if not match:
        raise HTTPException(status_code=400, detail="Imagen inválida")
    image_type, encoded = match.groups()
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error):
        raise HTTPException(status_code=400, detail="Imagen inválida")
    if not payload or len(payload) > _STAFF_PROOF_MAX_BYTES:
        raise HTTPException(status_code=400, detail="La imagen supera el tamaño permitido")
    signatures = {
        "png": payload.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpeg": payload.startswith(b"\xff\xd8\xff"),
        "webp": len(payload) >= 12 and payload[:4] == b"RIFF" and payload[8:12] == b"WEBP",
    }
    if not signatures[image_type]:
        raise HTTPException(status_code=400, detail="El contenido de la imagen no coincide")
    return value, hashlib.sha256(payload).hexdigest()


@router.post("/{order_id}/proof")
async def upload_staff_proof(
    order_id: str,
    data: StaffPaymentProof,
    user: dict = Depends(require_roles(["cajero"])),
):
    proof, digest = _validated_staff_proof(data.payment_proof)
    restaurant_id = user["restaurant_id"]
    order = await _authorized_order(order_id, user)

    config = await db.payment_configs.find_one({"restaurant_id": restaurant_id}, {"_id": 0})
    method = data.method
    if not config or not config.get(f"enable_{method}"):
        raise HTTPException(status_code=400, detail="El método de pago no está disponible")

    if order.get("status") in ("pagado", "cancelado") or order.get("payment_status") in ("pagado", "confirmado", "cancelado"):
        raise HTTPException(status_code=409, detail="El pedido ya tiene un estado de pago final")

    existing_proof = order.get("payment_proof_url")
    if order.get("payment_status") == "comprobante_subido":
        if (existing_proof == proof and order.get("payment_proof_method") == method):
            return {"ok": True, "payment_status": "comprobante_subido"}
        raise HTTPException(status_code=409, detail="El pedido ya tiene un comprobante pendiente de verificación")

    attention_id = order.get("attention_id")
    if attention_id:
        if (not order.get("table_id") or order.get("attention_state") != "open"):
            raise HTTPException(status_code=409, detail="La visita no está abierta para recibir comprobantes")
        attention = await db.attentions.find_one({
            "id": attention_id, "restaurant_id": restaurant_id,
            "order_id": order_id, "table_id": order["table_id"], "status": "open",
        }, {"_id": 0})
        table = await db.tables.find_one({
            "id": order["table_id"], "restaurant_id": restaurant_id,
            "active_attention_id": attention_id,
        }, {"_id": 0})
        if not attention or not table:
            raise HTTPException(status_code=409, detail="La mesa ya no pertenece a esta visita")

    now = _now()
    order_filter = {
        "id": order_id, "restaurant_id": restaurant_id,
        "status": {"$nin": ["pagado", "cancelado"]},
        "payment_status": {"$nin": ["pagado", "confirmado", "cancelado", "comprobante_subido"]},
        "updated_at": order.get("updated_at"),
    }
    if order.get("branch_id"):
        order_filter["branch_id"] = order["branch_id"]
    if attention_id:
        order_filter.update({"attention_id": attention_id, "attention_state": "open"})
    elif order.get("attention_state") in ("opening", "mutating", "closing", "closed"):
        raise HTTPException(status_code=409, detail="La visita está cambiando; vuelva a cargar el pedido")
    result = await db.orders.update_one(order_filter, {"$set": {
        "payment_status": "comprobante_subido",
        # Its own field: `payment_status` moves to parcial/pagado on the first
        # payment and used to take the pending proof out of review with it.
        "payment_proof_status": "pendiente",
        "payment_proof_url": proof,
        "payment_proof_method": method,
        "payment_proof_sha256": digest,
        "payment_proof_uploaded_by": user["id"],
        "payment_proof_uploaded_at": now,
        "updated_at": now,
    }})
    if getattr(result, "matched_count", 0) != 1:
        latest = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id}, {"_id": 0})
        if (latest and latest.get("payment_status") == "comprobante_subido"
                and latest.get("payment_proof_url") == proof
                and latest.get("payment_proof_method") == method):
            return {"ok": True, "payment_status": "comprobante_subido"}
        raise HTTPException(status_code=409, detail="El pedido cambió; vuelva a cargarlo antes de adjuntar el comprobante")
    emit_order(restaurant_id, order_id, order.get("status"), source="staff", payment_status="comprobante_subido", branch_id=order.get("branch_id"))
    return {"ok": True, "payment_status": "comprobante_subido"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _period_start(period: str) -> str:
    now = datetime.now(LIMA)
    if period == "day":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).isoformat()


@router.get("")
async def list_payments(
    user: dict = Depends(require_roles(["admin", "cajero"])),
    limit: int = 200,
    q: Optional[str] = None,
    period: Optional[str] = Query(None, regex="^(day|week|month)$"),
    branch_id: Optional[str] = None,
    legacy_only: bool = False,
):
    filt = {"restaurant_id": user["restaurant_id"], **await read_branch_filter(
        user, db.branches, branch_id, legacy_only=legacy_only
    )}
    if period:
        filt["created_at"] = {"$gte": _period_start(period)}
    items = await db.payments.find(filt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    needle = (q or "").strip().lower()
    if needle:
        items = [
            payment for payment in items
            if needle in " ".join([
                str(payment.get("order_number") or ""),
                str(payment.get("method") or ""),
                str(payment.get("paid_by_name") or ""),
                str(payment.get("notes") or ""),
                str(payment.get("id") or ""),
            ]).lower()
        ]
    return items


@router.get("/proofs")
async def list_payment_proofs(
    user: dict = Depends(require_roles(["admin", "cajero"])),
    pending: bool = False,
    limit: int = 100,
    branch_id: Optional[str] = None,
    legacy_only: bool = False,
):
    """Orders carrying a captured Yape/Plin proof, pending verification first.

    Returns metadata only: the base64 image is fetched on demand from the order
    (``GET /orders/{id}``) so this list stays light.
    """
    filt = {
        "restaurant_id": user["restaurant_id"],
        "payment_proof_url": {"$type": "string"},
        **await read_branch_filter(user, db.branches, branch_id, legacy_only=legacy_only),
    }
    if pending:
        # Legacy orders only carried payment_status; new ones track the proof in
        # its own field so a partial payment cannot hide it from review.
        filt["$or"] = [
            {"payment_proof_status": "pendiente"},
            {"payment_proof_status": {"$exists": False}, "payment_status": "comprobante_subido"},
        ]

    rows = await db.orders.find(filt, {
        "_id": 0, "id": 1, "order_number": 1, "status": 1, "payment_status": 1,
        "payment_proof_status": 1,
        "payment_proof_method": 1, "payment_proof_uploaded_at": 1, "payment_proof_uploaded_by": 1,
        "total": 1, "amount_paid": 1, "table_id": 1, "customer_name": 1, "source": 1,
        "order_type": 1, "created_at": 1, "branch_id": 1,
    }).sort("payment_proof_uploaded_at", -1).limit(limit).to_list(limit)

    table_ids = [row["table_id"] for row in rows if row.get("table_id")]
    if table_ids:
        tables = await db.tables.find(
            {"restaurant_id": user["restaurant_id"], "id": {"$in": table_ids}},
            {"_id": 0, "id": 1, "number": 1, "name": 1},
        ).to_list(len(table_ids))
        table_map = {table["id"]: table for table in tables}
        for row in rows:
            row["table"] = table_map.get(row.get("table_id"))

    uploader_ids = [row["payment_proof_uploaded_by"] for row in rows if row.get("payment_proof_uploaded_by")]
    if uploader_ids:
        uploaders = await db.users.find(
            {"id": {"$in": uploader_ids}}, {"_id": 0, "id": 1, "full_name": 1}
        ).to_list(len(uploader_ids))
        name_map = {u["id"]: u.get("full_name") for u in uploaders}
        for row in rows:
            row["payment_proof_uploaded_by_name"] = name_map.get(row.get("payment_proof_uploaded_by"))

    pending_rows = [row for row in rows if proof_is_pending(row)]
    other_rows = [row for row in rows if not proof_is_pending(row)]
    return {"pending": len(pending_rows), "items": pending_rows + other_rows}


@router.get("/by-order/{order_id}")
async def payments_for_order(order_id: str, user: dict = Depends(require_roles(["admin", "cajero"]))):
    await _authorized_order(order_id, user)
    branch_scope = await _payment_branch_scope(user)
    query = {"restaurant_id": user["restaurant_id"], "order_id": order_id}
    if "branch_id" in branch_scope:
        query["branch_id"] = branch_scope["branch_id"]
    return await db.payments.find(
        query,
        {"_id": 0},
    ).sort("created_at", 1).to_list(50)


@router.post("")
async def create_payment(data: PaymentCreate, user: dict = Depends(require_roles(["admin", "cajero"]))):
    order = await _authorized_order(data.order_id, user)
    if data.idempotency_key:
        existing = await db.payments.find_one(
            {"restaurant_id": user["restaurant_id"], "idempotency_key": data.idempotency_key},
            {"_id": 0},
        )
        if existing:
            return _check_payment_replay(existing, order, data.order_id)

    open_reg = await _register_for_order(order, user["restaurant_id"])
    if not open_reg:
        raise HTTPException(status_code=400, detail="No hay caja abierta para la sucursal del pedido")
    if order["status"] in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="El pedido ya está cerrado")
    if order.get("attention_state") in ("opening", "mutating", "closing", "closed"):
        raise HTTPException(status_code=409, detail="La visita está cambiando; volvé a cargar el pedido")

    if data.expected_updated_at and order.get("updated_at") and data.expected_updated_at != order.get("updated_at"):
        raise HTTPException(status_code=409, detail={
            "code": "account_changed",
            "message": "La cuenta cambió mientras la revisabas. Revisá el nuevo importe antes de cobrar.",
            "previous_total": data.expected_total,
            "new_total": order.get("total"),
            "updated_at": order.get("updated_at"),
        })

    subtotal = float(order.get("subtotal", 0.0))
    stored_discount = float(order.get("discount") or 0.0)
    discount = float(data.discount or 0.0)
    if discount > 0.009:
        # A discount that is new or changed needs permission and a motive; reusing
        # the one the account already carries does not.
        if abs(discount - stored_discount) > 0.009:
            if not user.get("can_discount"):
                raise HTTPException(status_code=403, detail="No tenés permiso para aplicar descuentos")
            if len((data.discount_reason or "").strip()) < 5:
                raise HTTPException(status_code=400, detail="El descuento requiere un motivo")
    else:
        # No new discount requested: keep the account's. Otherwise voiding a
        # payment silently raises the bill back to the undiscounted total.
        discount = stored_discount
    tip = float(data.tip or 0.0)
    if tip <= 0.009:
        tip = float(order.get("tip") or 0.0)
    bill_total = account_total(
        subtotal=subtotal,
        delivery_fee=order.get("delivery_fee") or 0,
        discount=discount,
        tip=tip,
    )
    prior = await db.payments.find({"restaurant_id": user["restaurant_id"], "order_id": data.order_id, "status": "completed"}, {"_id": 0, "amount": 1}).to_list(50)
    paid_so_far = round(sum(float(p.get("amount") or 0) for p in prior), 2)
    remaining = round(bill_total - paid_so_far, 2)
    if remaining <= 0:
        raise HTTPException(status_code=400, detail="El pedido ya está cerrado")

    line_payload = []
    line_total = 0.0
    items = order.get("items") or []
    if data.lines:
        by_id = {i["id"]: i for i in items}
        line_total = 0.0
        for line in data.lines:
            it = by_id.get(line.item_id)
            if not it:
                raise HTTPException(status_code=400, detail="Ítem no está en la cuenta")
            unpaid = int(it.get("quantity") or 0) - int(it.get("paid_qty") or 0)
            if line.quantity > unpaid:
                raise HTTPException(status_code=400, detail=f"Solo quedan {unpaid} de {it.get('product_name')}")
            line_total += float(it.get("unit_price") or 0) * line.quantity
            line_payload.append({"item_id": line.item_id, "quantity": line.quantity, "name": it.get("product_name")})
        data.amount = round(line_total, 2)

    if data.method == "mixto":
        if not data.splits or len(data.splits) < 2:
            raise HTTPException(status_code=400, detail="Pago mixto requiere al menos 2 métodos")
        sum_splits = round(sum(s.amount for s in data.splits), 2)
        amount = min(sum_splits, remaining)
        received = sum_splits
        change = max(0.0, round(sum_splits - remaining, 2)) if sum_splits >= remaining else 0.0
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Monto inválido")
    elif data.method == "efectivo":
        received = data.received_amount if data.received_amount is not None else data.amount
        amount = min(float(data.amount or remaining), remaining)
        if received < amount:
            raise HTTPException(status_code=400, detail=f"Monto insuficiente. A pagar: {amount}, Recibido: {received}")
        change = round(received - amount, 2)
    else:
        amount = min(float(data.amount or remaining), remaining)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Monto inválido")
        received = amount
        change = 0.0

    amount = round(amount, 2)
    now = _now()
    new_paid = round(paid_so_far + amount, 2)
    fully_paid = new_paid >= bill_total - 0.009
    if line_payload and not fully_paid and round(line_total, 2) > amount + 0.009:
        raise HTTPException(status_code=400, detail="El pago no cubre los platos seleccionados")
    previous_items = copy.deepcopy(order.get("items") or [])
    sold_lines = build_sold_lines(previous_items, line_payload, fully_paid)
    items = copy.deepcopy(previous_items)
    if line_payload:
        by_pay = {line["item_id"]: line["quantity"] for line in line_payload}
        for it in items:
            extra = by_pay.get(it["id"], 0)
            if extra:
                it["paid_qty"] = int(it.get("paid_qty") or 0) + extra

    order_set = {
        "discount": discount,
        "tip": tip,
        "total": bill_total,
        "amount_paid": new_paid,
        "updated_at": now,
        "items": items,
    }
    if fully_paid:
        for it in items:
            it["paid_qty"] = int(it.get("quantity") or 0)
        order_set["items"] = items
    order_set.update(ticket_fields(
        order,
        order.get("fulfillment_status") or order.get("status"),
        new_paid,
        bill_total,
    ))
    if order_set["status"] == "pagado":
        order_set["paid_at"] = now

    claim_filter = {
            "id": data.order_id,
            "restaurant_id": user["restaurant_id"],
            "status": {"$nin": ["pagado", "cancelado"]},
            "updated_at": order.get("updated_at"),
            "attention_state": {"$nin": ["opening", "mutating", "closing", "closed"]},
        }
    if order.get("branch_id"):
        claim_filter["branch_id"] = order["branch_id"]
    claim = await db.orders.update_one(
        claim_filter,
        {"$set": order_set},
    )
    if claim.modified_count != 1:
        if data.idempotency_key:
            existing = await db.payments.find_one(
                {"restaurant_id": user["restaurant_id"], "idempotency_key": data.idempotency_key},
                {"_id": 0},
            )
            if existing:
                return _check_payment_replay(existing, order, data.order_id)
        raise HTTPException(status_code=409, detail={
            "code": "account_changed",
            "message": "La cuenta cambió mientras la revisabas. Revisá el nuevo importe antes de cobrar.",
            "previous_total": data.expected_total,
            "new_total": order.get("total"),
            "updated_at": order.get("updated_at"),
        })

    payment_id = str(uuid.uuid4())
    payment = {
        "id": payment_id,
        "restaurant_id": user["restaurant_id"],
        "order_id": data.order_id,
        "order_number": order.get("order_number"),
        "cash_register_id": open_reg["id"],
        "branch_id": order.get("branch_id"),
        "method": data.method,
        "amount": amount,
        "received_amount": received,
        "change_amount": change,
        "discount": discount,
        "tip": tip,
        "total": bill_total,
        "splits": [s.model_dump() for s in (data.splits or [])],
        "lines": line_payload,
        "sold_lines": sold_lines,
        "status": "completed",
        "paid_by": user["id"],
        "paid_by_name": user["full_name"],
        "notes": data.notes,
        "discount_reason": (data.discount_reason or "").strip() or None,
        "idempotency_key": data.idempotency_key,
        "created_at": now,
    }
    async def _release_claim():
        await db.orders.update_one(
            {"id": data.order_id, "updated_at": now},
            {"$set": {
                "discount": order.get("discount", 0.0),
                "tip": order.get("tip", 0.0),
                "total": order.get("total"),
                "amount_paid": order.get("amount_paid", 0.0),
                "updated_at": order.get("updated_at"),
                "items": previous_items,
                "status": order.get("status"),
                "payment_status": order.get("payment_status"),
                "fulfillment_status": order.get("fulfillment_status"),
                "paid_at": order.get("paid_at"),
            }},
        )

    try:
        await db.payments.insert_one(payment)
    except DuplicateKeyError:
        await _release_claim()
        existing = await db.payments.find_one(
            {"restaurant_id": user["restaurant_id"], "idempotency_key": data.idempotency_key},
            {"_id": 0},
        )
        if existing:
            return _check_payment_replay(existing, order, data.order_id)
        raise HTTPException(status_code=400, detail="No se pudo registrar el pago")
    except Exception:
        await _release_claim()
        raise

    emit_order(user["restaurant_id"], data.order_id, order_set.get("status", order.get("status")), source=order.get("source"), payment_status="pagado" if fully_paid else "parcial", branch_id=order.get("branch_id"))
    if order_set.get("status") == "pagado" and order.get("table_id") and not order.get("attention_id"):
        r = await db.restaurants.find_one({"id": user["restaurant_id"]}, {"_id": 0})
        new_status = "disponible" if (r or {}).get("auto_release_table") else "pagada"
        await db.tables.update_one(
            {"id": order["table_id"], "restaurant_id": user["restaurant_id"], **({"branch_id": order["branch_id"]} if order.get("branch_id") else {})},
            {"$set": {"status": new_status, "updated_at": _now()}},
        )
        emit_notice(user["restaurant_id"], "table", table_id=order["table_id"], status=new_status, branch_id=order.get("branch_id"))

    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "user_id": user["id"],
        "action": "payment_create",
        "entity": "payment",
        "entity_id": payment_id,
        "details": {"order_id": data.order_id, "method": data.method, "amount": amount, "remaining": round(bill_total - new_paid, 2)},
        "created_at": _now(),
    })

    payment["remaining"] = round(max(0.0, bill_total - new_paid), 2)
    payment["fully_paid"] = fully_paid
    payment["table_released"] = False
    return {k: v for k, v in payment.items() if k != "_id"}


async def _attention_void_intent(pay: dict, order: dict, user: dict, reason: str, kind: str,
                                register: dict | None, record_refund: bool) -> dict:
    items = copy.deepcopy(order.get("items") or [])
    if pay.get("lines"):
        by_payment = {line.get("item_id"): int(line.get("quantity") or 0) for line in pay["lines"]}
        for item in items:
            quantity = by_payment.get(item.get("id"), 0)
            if quantity:
                item["paid_qty"] = max(0, int(item.get("paid_qty") or 0) - quantity)
    else:
        other_payments = await db.payments.count_documents({
            "order_id": pay["order_id"], "status": "completed", "id": {"$ne": pay["id"]},
        })
        if other_payments == 0:
            for item in items:
                item["paid_qty"] = 0

    amount = float(pay.get("amount") or 0)
    new_paid = round(max(0.0, float(order.get("amount_paid") or 0) - amount), 2)
    timestamp = _now()
    order_patch = {"amount_paid": new_paid, "items": items, "updated_at": timestamp}
    order_patch.update(ticket_fields(
        order, order.get("fulfillment_status") or order.get("status"),
        new_paid, float(order.get("total") or 0),
    ))
    if new_paid < float(order.get("total") or 0) - 0.009:
        order_patch["paid_at"] = None
    order_patch["voided_payment_ids"] = sorted(set(order.get("voided_payment_ids") or []) | {pay["id"]})

    movement = None
    cash_amount = cash_portion(pay)
    if record_refund and cash_amount > 0.009:
        movement = {
            "_id": f"payment-refund:{pay['id']}",
            "id": f"payment-refund:{pay['id']}",
            "cash_register_id": register["id"],
            "restaurant_id": order["restaurant_id"],
            "branch_id": order.get("branch_id"),
            "type": "egreso", "amount": cash_amount,
            "description": f"Devolución pedido {pay.get('order_number') or pay.get('order_id')}",
            "source_payment_id": pay["id"],
            "created_by": user["id"], "created_by_name": user.get("full_name"),
            "created_at": timestamp,
        }
    status_label = "refunded" if kind == "refund" else "voided"
    event_id = f"payment-void:{pay['id']}"
    audit = {
        "id": event_id, "event_id": event_id,
        "restaurant_id": order["restaurant_id"], "user_id": user["id"],
        "action": "payment_refund" if kind == "refund" else "payment_void",
        "entity": "payment", "entity_id": pay["id"],
        "details": {"order_id": order["id"], "kind": kind,
                    "reason": reason, "amount": pay.get("amount")},
        "created_at": timestamp,
    }
    return {
        "id": event_id, "payment_id": pay["id"], "restaurant_id": order["restaurant_id"],
        "kind": kind, "reason": reason, "actor_id": user["id"],
        "actor_name": user.get("full_name"), "status": status_label,
        "order_patch": order_patch, "movement": movement, "audit": audit,
        "created_at": timestamp,
    }


async def _ensure_void_audit(intent: dict) -> None:
    expected = intent["audit"]
    existing = await db.audit_logs.find_one({"event_id": expected["event_id"]}, {"_id": 0})
    if existing:
        for key in ("restaurant_id", "user_id", "action", "entity", "entity_id", "details"):
            if existing.get(key) != expected.get(key):
                raise HTTPException(status_code=409, detail="El registro de devolución existente no coincide")
        return
    try:
        await db.audit_logs.insert_one(expected)
    except DuplicateKeyError:
        existing = await db.audit_logs.find_one({"event_id": expected["event_id"]}, {"_id": 0})
        if not existing or any(existing.get(key) != expected.get(key) for key in (
            "restaurant_id", "user_id", "action", "entity", "entity_id", "details"
        )):
            raise


async def _ensure_refund_movement(intent: dict) -> None:
    expected = intent.get("movement")
    if not expected:
        return
    existing = await db.cash_movements.find_one({"_id": expected["_id"]})
    keys = ("cash_register_id", "restaurant_id", "branch_id", "type", "amount", "source_payment_id",
            "created_by", "created_by_name", "description")
    if existing:
        if any(existing.get(key) != expected.get(key) for key in keys):
            raise HTTPException(status_code=409, detail="El movimiento de devolución existente no coincide")
        return
    try:
        await db.cash_movements.insert_one(expected)
    except DuplicateKeyError:
        existing = await db.cash_movements.find_one({"_id": expected["_id"]})
        if not existing or any(existing.get(key) != expected.get(key) for key in keys):
            raise


async def _stage_attention_void(payment: dict, intent: dict) -> None:
    if payment.get("void_intent_id") == intent["id"]:
        if payment.get("void_intent") != intent or payment.get("status") not in ("voiding", intent["status"]):
            raise HTTPException(status_code=409, detail="El estado del cobro no coincide con su intención")
        return
    if payment.get("status") != "completed":
        raise HTTPException(status_code=409, detail="El cobro ya tiene otra resolución")
    result = await db.payments.update_one({
        "id": payment["id"], "restaurant_id": intent["restaurant_id"],
        "status": "completed",
    }, {"$set": {
        "status": "voiding", "void_intent_id": intent["id"], "void_intent": intent,
        "void_kind": intent["kind"], "void_reason": intent["reason"],
        "voided_by": intent["actor_id"], "voided_by_name": intent["actor_name"],
        "voided_at": intent["created_at"],
    }})
    if getattr(result, "matched_count", 0) != 1:
        current = await db.payments.find_one({"id": payment["id"], "restaurant_id": intent["restaurant_id"]})
        if not current or current.get("void_intent_id") != intent["id"]:
            raise HTTPException(status_code=409, detail="El cobro cambió antes de guardar la resolución")


async def _resume_attention_void(order: dict, payment: dict, intent: dict) -> dict:
    token = f"void:{payment['id']}"
    await _stage_attention_void(payment, intent)
    patch = copy.deepcopy(intent["order_patch"])
    projected = await db.orders.update_one({
        "id": order["id"], "restaurant_id": order["restaurant_id"],
        "attention_id": order["attention_id"], "attention_state": "mutating",
        "attention_mutation_token": token,
    }, {"$set": patch})
    if getattr(projected, "matched_count", 0) != 1:
        raise HTTPException(status_code=409, detail="La cuenta no pudo reconciliar la intención de devolución")
    await _ensure_refund_movement(intent)
    await _ensure_void_audit(intent)

    current_payment = await db.payments.find_one({"id": payment["id"], "restaurant_id": intent["restaurant_id"]})
    if current_payment.get("status") == "voiding":
        result = await db.payments.update_one({
            "id": payment["id"], "restaurant_id": intent["restaurant_id"],
            "status": "voiding", "void_intent_id": intent["id"],
        }, {"$set": {"status": intent["status"]}})
        if getattr(result, "matched_count", 0) != 1:
            current_payment = await db.payments.find_one({"id": payment["id"], "restaurant_id": intent["restaurant_id"]})
            if not current_payment or current_payment.get("status") != intent["status"]:
                raise HTTPException(status_code=409, detail="El estado final del cobro quedó pendiente")
    elif current_payment.get("status") != intent["status"]:
        raise HTTPException(status_code=409, detail="El cobro quedó en un estado inesperado")

    released = await db.orders.update_one({
        "id": order["id"], "restaurant_id": order["restaurant_id"],
        "attention_id": order["attention_id"], "attention_state": "mutating",
        "attention_mutation_token": token,
    }, {"$set": {"attention_state": "open", "attention_open": True},
        "$unset": {"attention_mutation_token": "", "attention_mutation": ""}})
    if getattr(released, "matched_count", 0) != 1:
        latest = await db.orders.find_one({"id": order["id"], "restaurant_id": order["restaurant_id"]})
        if not latest or latest.get("attention_state") != "open" or payment["id"] not in latest.get("voided_payment_ids", []):
            raise HTTPException(status_code=409, detail="La devolución quedó pendiente; reintentá la misma operación")

    if intent.get("movement"):
        emit_notice(intent["restaurant_id"], "cash", status="movement",
                    register_id=intent["movement"]["cash_register_id"],
                    branch_id=intent["movement"].get("branch_id"))
    emit_order(intent["restaurant_id"], order["id"], intent["order_patch"].get("status"),
               source=order.get("source"), payment_status=intent["status"], branch_id=order.get("branch_id"))
    return await db.payments.find_one({"id": payment["id"], "restaurant_id": intent["restaurant_id"]}, {"_id": 0})


async def _verify_attention_void(order: dict, payment: dict) -> dict:
    intent = payment.get("void_intent")
    if not intent or payment.get("void_intent_id") != intent.get("id"):
        raise HTTPException(status_code=409, detail="El cobro tiene una resolución antigua que requiere conciliación")
    if payment.get("status") != intent.get("status") or payment["id"] not in order.get("voided_payment_ids", []):
        raise HTTPException(status_code=409, detail="La devolución no tiene todas sus proyecciones confirmadas")
    if intent.get("movement"):
        expected = intent["movement"]
        movement = await db.cash_movements.find_one({"_id": expected["_id"]})
        keys = ("cash_register_id", "restaurant_id", "branch_id", "type", "amount", "source_payment_id",
                "created_by", "created_by_name", "description")
        if not movement or any(movement.get(key) != expected.get(key) for key in keys):
            raise HTTPException(status_code=409, detail="Falta o no coincide el movimiento de devolución")
    expected_audit = intent["audit"]
    audit = await db.audit_logs.find_one({"event_id": expected_audit["event_id"]}, {"_id": 0})
    keys = ("restaurant_id", "user_id", "action", "entity", "entity_id", "details")
    if not audit or any(audit.get(key) != expected_audit.get(key) for key in keys):
        raise HTTPException(status_code=409, detail="Falta o no coincide el registro de auditoría de la devolución")
    return payment


def _has_open_visit(order: dict) -> bool:
    """Whether the order belongs to a visit (table/attention).

    A public pickup carries an `attention_id` for numbering but no visit state,
    so checking the id alone made its payments impossible to void (permanent 409).
    """
    return bool(order.get("attention_id") and order.get("attention_state"))


async def _apply_attention_void(payment: dict, order: dict, user: dict, reason: str, kind: str) -> dict:
    payment_id = payment["id"]
    token = f"void:{payment_id}"
    intent = order.get("attention_mutation")
    if order.get("attention_state") == "mutating":
        if order.get("attention_mutation_token") != token or not intent or intent.get("payment_id") != payment_id:
            raise HTTPException(status_code=409, detail="Otra actualización de la visita requiere recuperación")
        return await _resume_attention_void(order, payment, intent)
    if order.get("attention_state") != "open":
        raise HTTPException(status_code=409, detail="La visita está cambiando; volvé a cargar el pedido")
    if payment.get("status") in ("voided", "refunded"):
        return await _verify_attention_void(order, payment)
    if payment.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Ese cobro ya no está vigente")
    if order.get("status") == "cancelado":
        raise HTTPException(status_code=400, detail="El pedido está cancelado")

    owned = None
    if payment.get("cash_register_id"):
        owned = await db.cash_registers.find_one({
            "id": payment["cash_register_id"], "restaurant_id": user["restaurant_id"],
            "branch_id": payment.get("branch_id", order.get("branch_id")),
        }, {"_id": 0})
    register = await db.cash_registers.find_one({
        "restaurant_id": user["restaurant_id"], "status": "open",
        "branch_id": payment.get("branch_id", order.get("branch_id")),
    }, {"_id": 0})
    cash_amount = cash_portion(payment)
    record_refund = (not reversal_is_inside_open_shift(payment, owned, register)) and cash_amount > 0.009
    if record_refund and not register:
        raise HTTPException(status_code=400, detail="Abrí la caja para registrar la devolución")
    intent = await _attention_void_intent(payment, order, user, reason, kind, register, record_refund)
    try:
        await claim_attention_mutation(db.orders, order, token, {"attention_mutation": intent})
    except VersionError:
        current = await db.orders.find_one({"id": order["id"], "restaurant_id": order["restaurant_id"]})
        if current and current.get("attention_state") == "mutating" and current.get("attention_mutation_token") == token:
            return await _resume_attention_void(current, payment, current.get("attention_mutation"))
        raise HTTPException(status_code=409, detail=version_conflict(order))
    claimed = {**order, "attention_state": "mutating", "attention_mutation_token": token,
               "attention_mutation": intent}
    return await _resume_attention_void(claimed, payment, intent)


async def apply_void_payment(payment_id: str, user: dict, reason: str, kind: str = "void"):
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="La anulación requiere un motivo")
    kind = kind if kind in ("void", "refund") else "void"
    pay = await db.payments.find_one(
        {"id": payment_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0}
    )
    if not pay:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    order = await db.orders.find_one(
        {"id": pay["order_id"], "restaurant_id": user["restaurant_id"]}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    order = await _authorized_order(pay["order_id"], user)
    if (not has_tenantwide_branch_access(user) and pay.get("branch_id") != order.get("branch_id")):
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    if (has_tenantwide_branch_access(user) and pay.get("branch_id") is not None
            and pay.get("branch_id") != order.get("branch_id")):
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    if _has_open_visit(order):
        return await _apply_attention_void(payment=pay, order=order, user=user, reason=reason, kind=kind)

    token = f"void:{payment_id}"
    recovering = bool(
        order.get("attention_id")
        and order.get("attention_state") == "mutating"
        and order.get("attention_mutation_token") == token
        and pay.get("status") in ("voided", "refunded")
    )
    if pay.get("status") != "completed" and not recovering:
        if pay.get("status") in ("voided", "refunded") and order.get("attention_id") and order.get("attention_state") == "open":
            return pay
        raise HTTPException(status_code=400, detail="Ese cobro ya no está vigente")
    if order.get("status") == "cancelado":
        raise HTTPException(status_code=400, detail="El pedido está cancelado")
    if order.get("attention_state") in ("opening", "mutating", "closing", "closed") and not recovering:
        raise HTTPException(status_code=409, detail="La visita está cambiando; volvé a cargar el pedido")
    if recovering:
        kind = pay.get("void_kind") or "void"
        reason = pay.get("void_reason") or reason

    items = order.get("items") or []
    if pay.get("lines"):
        by_pay = {line.get("item_id"): int(line.get("quantity") or 0) for line in pay["lines"]}
        for item in items:
            cut = by_pay.get(item.get("id"), 0)
            if cut:
                item["paid_qty"] = max(0, int(item.get("paid_qty") or 0) - cut)
    else:
        others = await db.payments.count_documents({
            "order_id": pay["order_id"], "status": "completed", "id": {"$ne": pay["id"]},
        })
        if others == 0:
            for item in items:
                item["paid_qty"] = 0

    new_paid = round(max(0.0, float(order.get("amount_paid") or 0) - float(pay.get("amount") or 0)), 2)
    bill = float(order.get("total") or 0)
    was_closed = order.get("status") == "pagado"
    order_set = {"amount_paid": new_paid, "items": items, "updated_at": _now()}
    order_set.update(ticket_fields(
        order, order.get("fulfillment_status") or order.get("status"), new_paid, bill,
    ))
    reopened = new_paid < bill - 0.009
    if reopened:
        order_set["paid_at"] = None

    status_label = "refunded" if kind == "refund" else "voided"
    owned = None
    if pay.get("cash_register_id"):
        owned = await db.cash_registers.find_one(
            {"id": pay["cash_register_id"], "restaurant_id": user["restaurant_id"],
             "branch_id": pay.get("branch_id", order.get("branch_id"))}, {"_id": 0}
        )
    order_branch = pay.get("branch_id", order.get("branch_id"))
    open_reg = await db.cash_registers.find_one(
        {"restaurant_id": user["restaurant_id"], "status": "open", "branch_id": order_branch}, {"_id": 0}
    )
    cash_out = cash_portion(pay)
    record_refund = (not reversal_is_inside_open_shift(pay, owned, open_reg)) and cash_out > 0.009
    if record_refund and not open_reg:
        raise HTTPException(status_code=400, detail="Abrí la caja para registrar la devolución")

    mutation_claimed = False
    if _has_open_visit(order) and not recovering:
        try:
            await claim_attention_mutation(db.orders, order, token)
        except VersionError:
            raise HTTPException(status_code=409, detail=version_conflict(order))
        mutation_claimed = True
        order = {**order, "attention_state": "mutating", "attention_mutation_token": token}

    if not recovering:
        payment_claim = await db.payments.update_one(
            {"id": payment_id, "restaurant_id": user["restaurant_id"], "status": "completed"},
            {"$set": {
                "status": status_label, "void_kind": kind, "void_reason": reason,
                "voided_by": user["id"], "voided_by_name": user.get("full_name"), "voided_at": _now(),
            }},
        )
        if payment_claim.modified_count != 1:
            if mutation_claimed:
                await finish_attention_mutation(db.orders, order, token)
            raise HTTPException(status_code=400, detail="Ese cobro ya no está vigente")

    try:
        if _has_open_visit(order):
            await finish_attention_mutation(db.orders, order, token, order_set)
        else:
            await claim_order(db.orders, order, order_set)
    except VersionError:
        if not recovering:
            await db.payments.update_one(
                {"id": payment_id, "restaurant_id": user["restaurant_id"], "status": status_label},
                {"$set": {"status": "completed"}, "$unset": {
                    "void_kind": "", "void_reason": "", "voided_by": "",
                    "voided_by_name": "", "voided_at": "",
                }},
            )
        if mutation_claimed:
            await finish_attention_mutation(db.orders, order, token)
        raise HTTPException(status_code=409, detail=version_conflict(order))

    if record_refund:
        await db.cash_movements.insert_one({
            "id": str(uuid.uuid4()), "cash_register_id": open_reg["id"],
            "restaurant_id": user["restaurant_id"], "branch_id": order_branch,
            "type": "egreso", "amount": cash_out,
            "description": f"Devolución pedido {pay.get('order_number') or pay.get('order_id')}",
            "source_payment_id": payment_id, "created_by": user["id"],
            "created_by_name": user.get("full_name"), "created_at": _now(),
        })
        emit_notice(user["restaurant_id"], "cash", status="movement", register_id=open_reg["id"], branch_id=order_branch)
    emit_order(
        user["restaurant_id"], order["id"], order_set.get("status", order.get("status")),
        source=order.get("source"), payment_status="voided" if kind == "void" else "refunded", branch_id=order.get("branch_id"),
    )
    if reopened and was_closed and order.get("table_id") and not order.get("attention_id"):
        table_filter = {"id": order["table_id"], "restaurant_id": user["restaurant_id"]}
        if order.get("branch_id"):
            table_filter["branch_id"] = order["branch_id"]
        table = await db.tables.find_one(table_filter)
        if table and table.get("status") == "pagada":
            await db.tables.update_one(
                table_filter | {"status": "pagada"}, {"$set": {"status": "ocupada", "updated_at": _now()}}
            )
            emit_notice(user["restaurant_id"], "table", table_id=table["id"], status="ocupada", branch_id=order.get("branch_id"))

    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "restaurant_id": user["restaurant_id"], "user_id": user["id"],
        "action": "payment_void" if kind == "void" else "payment_refund",
        "entity": "payment", "entity_id": payment_id,
        "details": {"order_id": pay["order_id"], "kind": kind, "reason": reason, "amount": pay.get("amount")},
        "created_at": _now(),
    })
    return await db.payments.find_one({"id": payment_id}, {"_id": 0})

@router.post("/{payment_id}/void")
async def void_payment(payment_id: str, data: PaymentVoid, user: dict = Depends(require_roles(["admin", "cajero"]))):
    if not user.get("can_void"):
        raise HTTPException(status_code=403, detail="No tenés permiso para anular o devolver un cobro")
    return await apply_void_payment(payment_id, user, data.reason, data.kind)
