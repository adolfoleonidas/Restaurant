"""Durable one-order table visits with an order-document concurrency fence."""
import uuid

from pymongo.errors import DuplicateKeyError


class AttentionBlocked(Exception):
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


def _money(value) -> float:
    return round(float(value or 0), 2)


def _item_status(item: dict) -> str:
    status = item.get("status")
    return "pendiente" if status in (None, "", "nuevo") else status


def food_is_delivered(order: dict) -> bool:
    items = order.get("items") or []
    if order.get("status") == "cancelado":
        return all(_item_status(item) in ("cancelado", "entregado") for item in items)
    return bool(items) and all(_item_status(item) in ("entregado", "cancelado") for item in items)


def close_block_reason(order: dict, payments: list) -> str | None:
    payment_status = order.get("payment_status")
    if payment_status in ("comprobante_subido", "confirmado"):
        return "Hay un pago por verificar"
    total = _money(order.get("total"))
    paid = _money(order.get("amount_paid"))
    # Una cuenta sin nada que cobrar ya está liquidada: todos los platos se
    # anularon y no entró dinero. Sin esto la mesa quedaba **atrapada**: el pedido
    # no está «cancelado» —se anularon los platos, no el pedido—, así que el
    # cierre exigía un pago que ya no existe, «Finalizar mesa» desaparecía y no
    # había ninguna otra salida desde el piso.
    settled_without_money = total <= 0.009 and paid <= 0.009
    if order.get("status") == "cancelado":
        if payment_status not in (None, "pendiente", "cancelado"):
            return "El estado del pago cancelado requiere revisión"
    elif payment_status != "pagado" and not settled_without_money:
        return "El estado del pago no confirma una liquidación completa"
    if not food_is_delivered(order):
        return "Todavía hay productos sin entregar"

    if any(payment.get("status") not in ("completed", "voided", "refunded") for payment in payments):
        return "Hay un cobro sin estado final verificable"
    completed = _money(sum(
        payment.get("amount") or 0
        for payment in payments
        if payment.get("status") == "completed"
    ))
    if order.get("status") == "cancelado":
        if paid > 0.009 or completed > 0.009:
            return "Hay pagos que deben resolverse antes de cerrar"
        return None
    if abs(paid - completed) > 0.009:
        return "La cuenta no cuadra con los cobros registrados"
    if paid + 0.009 < total or completed + 0.009 < total:
        return "La cuenta no está cubierta"
    return None


async def _load_attention(db, order: dict) -> dict | None:
    attention_id = order.get("attention_id")
    if not attention_id:
        return None
    # La visita (attention) ahora puede contener varias órdenes (cuentas); se
    # identifica por su id, no por la orden. `order_id` sigue siendo la cuenta
    # principal (canónica) para el fence de cierre.
    query = {
        "id": attention_id,
        "restaurant_id": order.get("restaurant_id"),
        "table_id": order.get("table_id"),
    }
    if "branch_id" in order:
        query["branch_id"] = order["branch_id"]
    else:
        query["branch_id"] = {"$exists": False}
    return await db.attentions.find_one(query, {"_id": 0})


async def reserve_table_opening(db, *, table: dict, order_id: str, restaurant_id: str,
                               allowed_statuses: tuple[str, ...], intent: dict | None = None) -> str | None:
    """Atomically reserve a table and persist its private order intent."""
    query = {
        "id": table["id"], "restaurant_id": restaurant_id,
        "status": {"$in": list(allowed_statuses)},
        "active_attention_id": {"$exists": False},
        "opening_order_id": {"$exists": False},
        "branch_id": table.get("branch_id") if "branch_id" in table else {"$exists": False},
    }
    branch_id = table.get("branch_id")
    if intent is not None:
        intent = dict(intent)
        intent.setdefault("_id", order_id)
        if "branch_id" in table:
            intent["branch_id"] = branch_id
        else:
            intent.pop("branch_id", None)
    claimed = await db.tables.update_one(query, {"$set": {
        "opening_order_id": order_id, "opening_branch_id": branch_id,
        **({"opening_intent": intent} if intent is not None else {}),
    }})
    if getattr(claimed, "modified_count", 0) != 1:
        raise AttentionBlocked("La mesa cambió; vuelva a cargarla antes de abrir el pedido")
    return branch_id


async def recover_opening_intent(db, *, table: dict, order_id: str,
                                 restaurant_id: str) -> dict | None:
    """Materialize only the immutable intent owned by this table and tenant."""
    intent = table.get("opening_intent")
    if (not isinstance(intent, dict) or table.get("opening_order_id") != order_id
            or intent.get("id") != order_id or intent.get("restaurant_id") != restaurant_id
            or intent.get("table_id") != table.get("id")
            or intent.get("branch_id") != table.get("opening_branch_id")):
        return None
    # Recovery needs Mongo's actual _id to prove that this is the same intent.
    existing = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if existing:
        return existing if _same_opening_order(existing, intent) else None
    try:
        await db.orders.insert_one(dict(intent))
    except DuplicateKeyError:
        pass
    except Exception:
        # The insert outcome can be ambiguous. Leave the durable reservation intact.
        existing = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
        if existing and _same_opening_order(existing, intent):
            return existing
        raise
    existing = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    return existing if existing and _same_opening_order(existing, intent) else None


def _same_opening_order(existing: dict, intent: dict) -> bool:
    keys = ("_id", "id", "restaurant_id", "table_id", "attention_id", "branch_id", "order_number",
            "request_id", "request_fingerprint")
    return all(existing.get(key) == intent.get(key) for key in keys)


async def release_table_opening(db, *, table_id: str, restaurant_id: str, order_id: str) -> bool:
    """Release only a reservation still owned by this opening order."""
    released = await db.tables.update_one({
        "id": table_id, "restaurant_id": restaurant_id, "opening_order_id": order_id,
        "opening_intent": {"$exists": False},
    }, {"$unset": {"opening_order_id": "", "opening_branch_id": ""}})
    return getattr(released, "modified_count", 0) == 1


async def discard_table_opening(db, *, table_id: str, restaurant_id: str, order_id: str) -> bool:
    """Suelta una apertura abandonada, incluida su intención durable.

    `release_table_opening` se niega a tocar una reserva que todavía conserva la
    intención, porque esa intención es la prueba de que hay un pedido en vuelo.
    Cuando ese pedido ya fue cancelado no queda nada que proteger, y sin esto la
    mesa quedaría reservada para siempre sin visita abierta.
    """
    released = await db.tables.update_one({
        "id": table_id, "restaurant_id": restaurant_id, "opening_order_id": order_id,
    }, {"$unset": {"opening_order_id": "", "opening_branch_id": "", "opening_intent": ""}})
    return getattr(released, "modified_count", 0) == 1

async def open_table_attention(db, *, order: dict, user: dict, now: str) -> dict:
    """Recover an explicit opening intent; never joins an existing visit."""
    if not order.get("attention_id") or not order.get("table_id"):
        raise AttentionBlocked("La atención no tiene una mesa asociada")
    restaurant_id, table_id, attention_id = (
        order["restaurant_id"], order["table_id"], order["attention_id"]
    )
    if order.get("attention_state") in ("mutating", "closing", "closed"):
        raise AttentionBlocked("La visita ya no admite reapertura")
    existing = await _load_attention(db, order)
    if existing and existing.get("status") in ("closing", "closed"):
        raise AttentionBlocked("La visita ya no admite reapertura")
    table_query = {
        "id": table_id,
        "restaurant_id": restaurant_id,
        "status": {"$in": ["disponible", "ocupada"]},
        "$or": [
            {"active_attention_id": {"$exists": False}, "opening_order_id": order["id"], "opening_branch_id": order.get("branch_id")},
            {"active_attention_id": attention_id},
            {"active_attention_id": {"$exists": False}, "opening_order_id": {"$exists": False}},
        ],
        "branch_id": order.get("branch_id"),
    }
    table_claim = await db.tables.update_one(table_query, {"$set": {
        "status": "ocupada", "active_attention_id": attention_id, "updated_at": now,
    }, "$unset": {"opening_order_id": "", "opening_branch_id": "", "opening_intent": ""}})
    if getattr(table_claim, "modified_count", 0) != 1:
        table = await db.tables.find_one(
            {"id": table_id, "restaurant_id": restaurant_id}, {"_id": 0}
        )
        active_order = await db.orders.find_one({
            "id": order["id"], "restaurant_id": restaurant_id, "table_id": table_id,
            "attention_id": attention_id, "attention_state": {"$in": ["opening", "open"]},
            "branch_id": order.get("branch_id") if "branch_id" in order else {"$exists": False},
        }, {"_id": 0})
        if (not table or not active_order or table.get("active_attention_id") != attention_id
                or table.get("restaurant_id") != restaurant_id
                or table.get("id") != table_id
                or table.get("status") not in ("disponible", "ocupada")
                or table.get("branch_id") != order.get("branch_id")):
            raise AttentionBlocked("La mesa ya pertenece a otra visita o no está disponible")

    attention = await _load_attention(db, order)
    if not attention:
        attention = {
            "id": attention_id,
            "restaurant_id": restaurant_id,
            "table_id": table_id,
            "order_id": order["id"],
            "order_ids": [order["id"]],
            **({"branch_id": order["branch_id"]} if "branch_id" in order else {}),
            "status": "opening",
            "opened_by": user.get("id"),
            "opened_at": now,
        }
        try:
            await db.attentions.insert_one(attention)
        except Exception:
            attention = await _load_attention(db, order)
            if not attention:
                raise
    elif attention.get("status") not in ("opening", "open"):
        raise AttentionBlocked("La visita ya no se puede abrir")

    if attention.get("status") == "opening":
        changed = await db.attentions.update_one({
            "id": attention_id,
            "restaurant_id": restaurant_id,
            "order_id": order["id"],
            **({"branch_id": order["branch_id"]} if "branch_id" in order else {}),
            "status": "opening",
        }, {"$set": {"status": "open", "opened_by": user.get("id"), "opened_at": now}})
        if getattr(changed, "modified_count", 0) != 1:
            latest = await _load_attention(db, order)
            if (not latest or latest.get("status") != "open"
                    or latest.get("id") != attention_id
                    or latest.get("restaurant_id") != restaurant_id
                    or latest.get("order_id") != order["id"]
                    or latest.get("table_id") != table_id
                    or latest.get("branch_id") != order.get("branch_id")):
                raise AttentionBlocked("No se pudo confirmar la apertura; reintenta la misma visita")

    latest_order = await db.orders.find_one({
        "id": order["id"], "restaurant_id": restaurant_id,
        "attention_id": attention_id,
    })
    if not latest_order:
        raise AttentionBlocked("No se encontró el pedido asociado a la apertura")
    if latest_order.get("attention_state") != "open":
        current_stamp = latest_order.get("updated_at")
        order_filter = {
            "id": order["id"], "restaurant_id": restaurant_id,
            "attention_id": attention_id, "attention_state": "opening",
        }
        if current_stamp is None:
            order_filter["$or"] = [{"updated_at": None}, {"updated_at": {"$exists": False}}]
        else:
            order_filter["updated_at"] = current_stamp
        changed = await db.orders.update_one(order_filter, {"$set": {
            "attention_state": "open", "attention_open": True, "updated_at": now,
        }})
        if getattr(changed, "modified_count", 0) != 1:
            latest_order = await db.orders.find_one({"id": order["id"], "restaurant_id": restaurant_id})
            if not latest_order or latest_order.get("attention_id") != attention_id or latest_order.get("attention_state") != "open":
                raise AttentionBlocked("No se pudo completar la apertura de la visita")

    opened = await _load_attention(db, order)
    if not opened or opened.get("status") != "open":
        raise AttentionBlocked("La apertura de la visita requiere reintento")
    return opened


async def _completed_payments(db, order: dict) -> list:
    return await db.payments.find({
        "restaurant_id": order["restaurant_id"],
        "order_id": order["id"],
    }, {"_id": 0}).to_list(None)


async def _attention_orders(db, attention: dict) -> list:
    """Todas las cuentas (órdenes) que pertenecen a una visita."""
    return await db.orders.find({
        "restaurant_id": attention["restaurant_id"],
        "attention_id": attention["id"],
    }, {"_id": 0}).to_list(None)


async def _restore_open(db, order: dict, attention: dict) -> bool:
    # The order remains fenced until the final state write succeeds.
    restored = await db.attentions.update_one({
        "id": attention["id"], "restaurant_id": order["restaurant_id"],
        "status": "closing",
    }, {"$set": {"status": "open"}, "$unset": {
        "closed_by": "", "closed_by_name": "", "closed_at": ""}})
    if getattr(restored, "modified_count", 0) != 1:
        latest = await _load_attention(db, order)
        if not latest or latest.get("status") != "open":
            return False
    opened = await db.orders.update_one({
        "id": order["id"], "restaurant_id": order["restaurant_id"],
        "attention_id": attention["id"], "attention_state": "closing",
        "attention_close_token": attention["id"],
    }, {"$set": {"attention_state": "open", "attention_open": True},
        "$unset": {"attention_close_token": "", "attention_close_actor": "",
                    "attention_close_actor_name": ""}})
    if getattr(opened, "modified_count", 0) == 1:
        return True
    latest = await db.orders.find_one({"id": order["id"], "restaurant_id": order["restaurant_id"]})
    return bool(latest and latest.get("attention_state") == "open")


async def _write_close_audit(db, order: dict, attention: dict, user: dict, now: str) -> None:
    event_id = f"attention-close:{attention['id']}"
    entry = {
        "id": str(uuid.uuid4()), "event_id": event_id,
        "restaurant_id": order["restaurant_id"],
        "user_id": attention.get("closed_by") or user.get("id"),
        "action": "close_attention", "entity": "attention",
        "entity_id": attention["id"],
        "details": {"order_id": order["id"], "amount_paid": _money(order.get("amount_paid"))},
        "created_at": attention.get("closed_at") or now,
    }
    existing = await db.audit_logs.find_one({"event_id": event_id}, {"_id": 0})
    if existing:
        if (existing.get("restaurant_id") != order["restaurant_id"]
                or existing.get("entity_id") != attention["id"]
                or existing.get("user_id") != (attention.get("closed_by") or user.get("id"))
                or existing.get("details") != entry["details"]):
            raise AttentionBlocked("El registro de cierre existente no coincide con esta visita")
        return
    try:
        await db.audit_logs.insert_one(entry)
    except DuplicateKeyError:
        existing = await db.audit_logs.find_one({"event_id": event_id}, {"_id": 0})
        if (not existing or existing.get("restaurant_id") != order["restaurant_id"]
                or existing.get("entity_id") != attention["id"]
                or existing.get("user_id") != (attention.get("closed_by") or user.get("id"))
                or existing.get("details") != entry["details"]):
            raise


async def _finish_closed(db, order: dict, attention: dict, user: dict, now: str) -> dict:
    await _write_close_audit(db, order, attention, user, now)
    if order.get("table_id"):
        # An old retry cannot release a table already claimed by a later visit.
        await db.tables.update_one({
            "id": order["table_id"], "restaurant_id": order["restaurant_id"],
            "active_attention_id": attention["id"],
        }, {"$set": {"status": "disponible", "updated_at": now},
            "$unset": {"active_attention_id": ""}})
    # Cierra todas las cuentas (órdenes) de la visita, no solo la canónica.
    for sibling in await _attention_orders(db, attention):
        await db.orders.update_one(
            {"id": sibling["id"], "restaurant_id": order["restaurant_id"], "attention_id": attention["id"]},
            {"$set": {"attention_state": "closed", "attention_open": False, "updated_at": now},
             "$unset": {"attention_close_token": "", "attention_close_actor": "", "attention_close_actor_name": ""}},
        )
    # Verifica que ninguna cuenta quedó abierta (reconciliación).
    for sibling in await _attention_orders(db, attention):
        if sibling.get("attention_state") != "closed":
            raise AttentionBlocked("El cierre quedó pendiente de reconciliación; reintenta la misma visita")
    return await _load_attention(db, order) or attention


async def close_table_attention(db, *, order: dict, user: dict, now: str) -> dict:
    """Claim the canonical order fence, verify ledger, close, then release by visit id.

    La visita se identifica por su propio id, nunca por `order["id"]`: `order_id`
    del documento guarda sólo la cuenta canónica, así que anclar el cierre a esa
    cuenta dejaba sin salida a cualquier otra cuenta de la misma visita —el mozo
    veía "reintenta la misma visita" para siempre y la mesa quedaba tomada—.
    """
    current = await db.orders.find_one({
        "id": order["id"], "restaurant_id": order["restaurant_id"],
    }, {"_id": 0})
    if not current:
        raise AttentionBlocked("No se encontró el pedido")
    order = current
    attention = await _load_attention(db, order)
    if not attention:
        raise AttentionBlocked("El pedido no pertenece a una visita explícita")
    state = order.get("attention_state")
    if attention.get("status") == "closed":
        if state not in ("closing", "closed"):
            raise AttentionBlocked("El registro de visita y el pedido no coinciden")
        return await _finish_closed(db, order, attention, user, now)

    if state == "open" and attention.get("status") == "open":
        claimed = await db.orders.update_one({
            "id": order["id"], "restaurant_id": order["restaurant_id"],
            "attention_id": attention["id"], "attention_state": "open",
            "updated_at": order.get("updated_at"),
        }, {"$set": {
            "attention_state": "closing", "attention_close_token": attention["id"],
            "attention_close_actor": user.get("id"),
            "attention_close_actor_name": user.get("full_name"),
        }})
        if getattr(claimed, "modified_count", 0) != 1:
            raise AttentionBlocked("El pedido cambió; vuelve a cargarlo antes de cerrar")
        order = await db.orders.find_one({"id": order["id"], "restaurant_id": order["restaurant_id"]})
        close_user = {"id": order.get("attention_close_actor"),
                      "full_name": order.get("attention_close_actor_name")}
        changed = await db.attentions.update_one({
            "id": attention["id"], "restaurant_id": order["restaurant_id"],
            "status": "open",
        }, {"$set": {"status": "closing", "closed_by": close_user["id"],
            "closed_by_name": close_user["full_name"], "closed_at": now}})
        if getattr(changed, "modified_count", 0) != 1:
            attention = await _load_attention(db, order)
            if not attention or attention.get("status") not in ("open", "closing", "closed"):
                raise AttentionBlocked("No se pudo confirmar el intento de cierre")
            if attention.get("status") == "closed":
                return await _finish_closed(db, order, attention, user, now)
            if attention.get("status") == "open":
                raise AttentionBlocked("El cierre quedó pendiente; reintenta la misma visita")
        attention = await _load_attention(db, order)
    elif state == "closing" and attention.get("status") == "open":
        # Recover a crash between the canonical order claim and its attention projection.
        close_user = {"id": order.get("attention_close_actor"),
                      "full_name": order.get("attention_close_actor_name")}
        if not close_user["id"]:
            raise AttentionBlocked("El cierre previo no conserva su operador; requiere conciliación")
        changed = await db.attentions.update_one({
            "id": attention["id"], "restaurant_id": order["restaurant_id"],
            "status": "open",
        }, {"$set": {"status": "closing", "closed_by": close_user["id"],
            "closed_by_name": close_user["full_name"], "closed_at": now}})
        if getattr(changed, "modified_count", 0) != 1:
            raise AttentionBlocked("El cierre quedó pendiente; reintenta la misma visita")
        attention = await _load_attention(db, order)
    elif state != "closing" or attention.get("status") != "closing":
        raise AttentionBlocked("La visita no está abierta para cierre")

    if not order or order.get("attention_close_token") != attention["id"]:
        raise AttentionBlocked("El cierre no conserva su reclamo; reintenta la misma visita")
    payments = await _completed_payments(db, order)
    reason = close_block_reason(order, payments)
    if reason:
        if not await _restore_open(db, order, attention):
            raise AttentionBlocked("No se pudo revertir el intento; la visita permanece bloqueada")
        raise AttentionBlocked(reason)

    # Multi-cuenta: cada cuenta de la visita debe estar liquidada antes de cerrar.
    siblings = [o for o in await _attention_orders(db, attention) if o["id"] != order["id"]]
    for sibling in siblings:
        sreason = close_block_reason(sibling, await _completed_payments(db, sibling))
        if sreason:
            if not await _restore_open(db, order, attention):
                raise AttentionBlocked("No se pudo revertir el intento; la visita permanece bloqueada")
            raise AttentionBlocked(f"La cuenta #{sibling.get('order_number')} no está lista: {sreason}")

    await _write_close_audit(db, order, attention, user, now)
    changed = await db.attentions.update_one({
        "id": attention["id"], "restaurant_id": order["restaurant_id"],
        "status": "closing",
    }, {"$set": {"status": "closed", "closed_by": attention.get("closed_by"),
        "closed_by_name": attention.get("closed_by_name"), "closed_at": attention.get("closed_at") or now}})
    if getattr(changed, "matched_count", 0) != 1:
        attention = await _load_attention(db, order)
        if not attention or attention.get("status") != "closed":
            raise AttentionBlocked("No se pudo confirmar el cierre; reintenta la misma visita")
    else:
        attention = await _load_attention(db, order)
    return await _finish_closed(db, order, attention, user, now)
