"""Confirmación del pago previo de un pedido hecho por el cliente.

Con la regla de prepago activa, un pedido por transferencia (Yape, Plin, banco)
queda guardado como intención: no llega a cocina. Caja mira el comprobante, lo
verifica en su propia app y desde acá se registra el cobro, se abre la visita y
el pedido entra a cocina. Todo en un solo paso para que no exista un pedido
pagado que nadie está preparando, ni un pedido en cocina sin pago confirmado.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from attention import AttentionBlocked, open_table_attention
from attention_acceptance import AttentionAcceptanceError, number_accepted_order
from auth import require_roles
from branch_access import has_tenantwide_branch_access, validate_user_branch
from database import db
from models import PaymentCreate
from notify import emit_notice, emit_order
from payment_policy import needs_counter_verification
from routes.payments import create_payment

router = APIRouter()

_PAYABLE_STATES = ("pendiente", "reportado")


async def _branch_scope(user: dict) -> dict:
    """Filtro de sucursal para quien está atado a una, y fallo cerrado si no tiene.

    Antes esto era `if user.get("branch_id")`: un cajero sin sucursal asignada —o
    con una que ya no existe— no entraba por ninguna rama del `if`, así que veía y
    confirmaba pedidos de todas las sucursales del restaurante. Los helpers de
    `branch_access` fallan cerrado a propósito; usarlos mantiene este endpoint
    alineado con el resto del backend.
    """
    if has_tenantwide_branch_access(user):
        return {}
    branch_id = await validate_user_branch(user, db.branches)
    return {"branch_id": branch_id} if branch_id else {}


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def is_awaiting_prepayment(order: dict) -> bool:
    return (
        bool(order.get("prepay_required"))
        and order.get("acceptance_status") == "pendiente"
        and order.get("payment_state") in _PAYABLE_STATES
    )


async def record_public_prepayment(order: dict, user: dict, *, reason: str = None) -> dict:
    """Registra el cobro confirmado y libera el pedido hacia cocina.

    Idempotente por pedido: reintentar una confirmación ya aplicada devuelve el
    mismo cobro sin duplicarlo ni volver a abrir la visita.

    El pago se registra primero: si la caja no está abierta, el pedido sigue
    esperando en vez de quedar aceptado y sin cobro detrás. Después se acepta el
    pedido, que es lo que lo hace visible para cocina.
    """
    restaurant_id = order["restaurant_id"]
    if order.get("payment_state") == "confirmado":
        existing = await db.payments.find_one(
            {"restaurant_id": restaurant_id, "idempotency_key": f"prepay-confirm:{order['id']}"},
            {"_id": 0},
        )
        return existing or {"id": None, "amount": order.get("total")}
    payment = await create_payment(
        PaymentCreate(
            order_id=order["id"],
            method=order.get("payment_method_choice") or "efectivo",
            amount=float(order.get("total") or 0),
            notes=reason or f"Prepago confirmado · pedido #{order.get('order_number')}",
            idempotency_key=f"prepay-confirm:{order['id']}",
            expected_updated_at=order.get("updated_at"),
            expected_total=order.get("total"),
        ),
        user,
    )
    now = _now()
    fields = {
        "acceptance_status": "aceptado",
        "payment_state": "confirmado",
        "payment_confirmed_at": now,
        "payment_confirmed_by": user.get("id"),
        "updated_at": now,
    }
    if not order.get("sent_to_kitchen_at"):
        fields["sent_to_kitchen_at"] = now
    await db.orders.update_one(
        {"id": order["id"], "restaurant_id": restaurant_id},
        {"$set": fields},
    )
    stored = await db.orders.find_one({"id": order["id"], "restaurant_id": restaurant_id}, {"_id": 0})
    number_accepted_order_needed = bool(stored and stored.get("attention_number_pending"))
    if number_accepted_order_needed:
        try:
            await number_accepted_order(db, order=stored)
        except AttentionAcceptanceError as exc:
            raise HTTPException(status_code=409, detail="El pedido quedó pagado y requiere conciliación") from exc
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": restaurant_id,
        "user_id": user.get("id"),
        "action": "public_prepay_confirmed",
        "entity": "order",
        "entity_id": order["id"],
        "details": {
            "order_number": order.get("order_number"),
            "method": order.get("payment_method_choice"),
            "amount": payment.get("amount"),
            "payment_id": payment.get("id"),
        },
        "created_at": _now(),
    })
    emit_order(restaurant_id, order["id"], stored.get("status") if stored else order.get("status"),
               source="public", payment_status="pagado", branch_id=order.get("branch_id"),
               topics=("prepay",))
    if order.get("table_id"):
        emit_notice(restaurant_id, "table", table_id=order["table_id"], status="ocupada", branch_id=order.get("branch_id"))
    return payment


async def open_paid_table_order(order: dict) -> None:
    """Abre la visita de una mesa cuyo pedido prepagado acaba de confirmarse."""
    if not order.get("table_id") or order.get("attention_state") != "opening":
        return
    try:
        await open_table_attention(db, order=order, user={"id": None}, now=_now())
    except AttentionBlocked as exc:
        raise HTTPException(
            status_code=409,
            detail=f"El pago quedó registrado pero la mesa cambió: revisa la mesa antes de continuar. {exc.detail}",
        ) from exc


@router.get("/pending")
async def list_pending_prepayments(user: dict = Depends(require_roles(["admin", "cajero", "mozo"]))):
    """Pedidos esperando verificación de pago, para la cola de caja."""
    query = {
        "restaurant_id": user["restaurant_id"],
        "acceptance_status": "pendiente",
        "prepay_required": True,
        # Un pedido cancelado ya no espera nada: sin esto seguía en la cola.
        "status": {"$nin": ["pagado", "cancelado"]},
    }
    query.update(await _branch_scope(user))
    orders = await db.orders.find(query, {"_id": 0}).sort("created_at", 1).to_list(200)
    table_ids = [o["table_id"] for o in orders if o.get("table_id")]
    numbers = {}
    if table_ids:
        tables = await db.tables.find(
            {"restaurant_id": user["restaurant_id"], "id": {"$in": table_ids}},
            {"_id": 0, "id": 1, "number": 1},
        ).to_list(len(table_ids))
        numbers = {t["id"]: t.get("number") for t in tables}
    result = []
    for order in orders:
        if not needs_counter_verification(order) and order.get("payment_state") == "pendiente":
            # Efectivo/tarjeta no se verifican por adelantado.
            continue
        result.append({
            "id": order["id"],
            "order_number": order.get("order_number"),
            "tracking_code": order.get("tracking_code"),
            "table_id": order.get("table_id"),
            "table_number": numbers.get(order.get("table_id")),
            "order_type": order.get("order_type"),
            "total": order.get("total"),
            "items": order.get("items") or [],
            "payment_method_choice": order.get("payment_method_choice"),
            "payment_state": order.get("payment_state"),
            "has_proof": bool(order.get("payment_proof_url")),
            "customer_name": order.get("customer_name"),
            "created_at": order.get("created_at"),
        })
    return result


@router.post("/{order_id}/confirm")
async def confirm_public_prepayment(order_id: str, user: dict = Depends(require_roles(["admin", "cajero"]))):
    """El restaurante verifica el pago y el pedido pasa a cocina."""
    order = await db.orders.find_one(
        {"id": order_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    scope = await _branch_scope(user)
    if scope and order.get("branch_id") != scope["branch_id"]:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if order.get("status") in ("pagado", "cancelado"):
        raise HTTPException(status_code=400, detail="El pedido ya está cerrado")
    if order.get("payment_state") == "confirmado":
        return {"ok": True, "already_confirmed": True, "order_id": order_id}
    if not is_awaiting_prepayment(order):
        raise HTTPException(status_code=400, detail="Este pedido no está esperando confirmación de pago")
    await open_paid_table_order(order)
    # La apertura actualiza el pedido: el cobro se registra contra el estado ya
    # refrescado para no chocar con su control de versión.
    fresh = await db.orders.find_one({"id": order_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
    payment = await record_public_prepayment(fresh or order, user)
    stored = await db.orders.find_one({"id": order_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
    return {"ok": True, "order_id": order_id, "payment_id": payment.get("id"), "order": {
        "status": stored.get("status"),
        "payment_status": stored.get("payment_status"),
        "payment_state": stored.get("payment_state"),
        "acceptance_status": stored.get("acceptance_status"),
    }}


@router.post("/{order_id}/reject")
async def reject_public_prepayment(order_id: str, user: dict = Depends(require_roles(["admin", "cajero"]))):
    """El pago reportado no se pudo verificar: el pedido no llega a cocina."""
    order = await db.orders.find_one(
        {"id": order_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if not is_awaiting_prepayment(order):
        raise HTTPException(status_code=400, detail="Este pedido no está esperando confirmación de pago")
    now = _now()
    await db.orders.update_one(
        {"id": order_id, "restaurant_id": user["restaurant_id"], "acceptance_status": "pendiente"},
        {"$set": {"payment_state": "rechazado", "payment_rejected_at": now, "updated_at": now}},
    )
    changed = await db.orders.find_one({"id": order_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "user_id": user.get("id"),
        "action": "public_prepay_rejected",
        "entity": "order",
        "entity_id": order_id,
        "details": {"order_number": order.get("order_number")},
        "created_at": now,
    })
    return {"ok": True, "order_id": order_id, "payment_state": changed.get("payment_state")}
