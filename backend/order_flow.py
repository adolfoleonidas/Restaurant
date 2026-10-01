"""Forward-only order and kitchen transitions."""


class FlowError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class VersionError(Exception):
    def __init__(self):
        super().__init__("El pedido cambió. Volvé a cargarlo.")
        self.detail = "El pedido cambió. Volvé a cargarlo."


def version_conflict(order: dict) -> dict:
    return {
        "code": "account_changed",
        "message": "El pedido cambió. Volvé a cargarlo.",
        "updated_at": order.get("updated_at"),
    }


async def claim_order(orders, order: dict, fields: dict):
    """Write the order only if nobody else changed it since it was read."""
    stamp = order.get("updated_at")
    filt = {"id": order["id"], "restaurant_id": order.get("restaurant_id")}
    if stamp is None:
        filt["$or"] = [{"updated_at": None}, {"updated_at": {"$exists": False}}]
    else:
        filt["updated_at"] = stamp
    result = await orders.update_one(filt, {"$set": fields})
    if getattr(result, "modified_count", 0) != 1:
        raise VersionError()


_ORDER_NEXT = {
    "nuevo": {"cancelado"},
    "enviado_cocina": {"en_preparacion", "cancelado"},
    "en_preparacion": {"listo", "cancelado"},
    "listo": {"entregado", "pendiente_pago", "cancelado"},
    "entregado": {"pendiente_pago", "cancelado"},
    "pendiente_pago": {"cancelado"},
    "pagado": set(),
    "cancelado": set(),
}

_ITEM_NEXT = {
    "pendiente": {"en_preparacion"},
    "en_preparacion": {"listo"},
    "listo": {"entregado"},
    "entregado": set(),
    "cancelado": set(),
}

_KITCHEN_CLOSED = {"pagado", "cancelado", "entregado"}


def _item_status(item: dict) -> str:
    status = item.get("status")
    if status in (None, "", "nuevo"):
        return "pendiente"
    return status


def assert_order_transition(current: str, new: str):
    if current == "pagado":
        raise FlowError("El pedido ya está pagado")
    if current == "cancelado":
        raise FlowError("El pedido está cancelado")
    if new not in _ORDER_NEXT.get(current, set()):
        raise FlowError("Ese cambio de estado no está permitido")


def assert_item_transition(current: str, new: str):
    if current in (None, "", "nuevo"):
        current = "pendiente"
    if new not in _ITEM_NEXT.get(current, set()):
        raise FlowError("Ese cambio de estado no está permitido")


def assert_kitchen_open(order: dict):
    if order.get("status") in _KITCHEN_CLOSED:
        raise FlowError("La cocina ya no puede mover este pedido")


def _unready(items: list) -> list:
    return [item for item in items if _item_status(item) not in ("listo", "entregado", "cancelado")]


def assert_items_ready_to_finish(order: dict):
    for item in order.get("items") or []:
        if _item_status(item) == "pendiente":
            raise FlowError("Todavía hay productos sin preparar")


_PROOF_STATES = {"comprobante_subido", "confirmado"}
_FOOD_OUT = {"entregado"}


def ticket_fields(order: dict, fulfillment: str, amount_paid, total) -> dict:
    """Keep the money state independent from how far the food has gone."""
    paid = round(float(amount_paid or 0), 2)
    bill = round(float(total or 0), 2)
    current_payment = order.get("payment_status")
    if paid <= 0.009 and current_payment in _PROOF_STATES:
        payment = current_payment
    elif paid <= 0.009:
        payment = "pendiente"
    elif paid + 0.009 >= bill:
        payment = "pagado"
    else:
        payment = "parcial"

    food = fulfillment or order.get("fulfillment_status") or order.get("status") or "nuevo"
    if food == "pagado":
        food = order.get("fulfillment_status") or "entregado"
    if food == "cancelado":
        return {
            "fulfillment_status": "cancelado",
            "payment_status": current_payment or payment,
            "status": "cancelado",
        }
    closed = payment == "pagado" and food in _FOOD_OUT
    return {
        "fulfillment_status": food,
        "payment_status": payment,
        "status": "pagado" if closed else food,
    }


def assert_can_serve(order: dict):
    status = order.get("status")
    if status in ("pagado", "cancelado"):
        raise FlowError("El pedido ya está cerrado")
    items = order.get("items") or []
    if (
        status not in ("listo", "pendiente_pago")
        or _unready(items)
        or not any(_item_status(item) == "listo" for item in items)
        or order.get("fulfillment_status") == "entregado"
    ):
        raise FlowError("Todavía hay productos en preparación")
