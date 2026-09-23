"""Forward-only order and kitchen transitions."""


class FlowError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


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

_KITCHEN_CLOSED = {"pagado", "cancelado", "entregado", "pendiente_pago"}


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


def assert_can_serve(order: dict):
    status = order.get("status")
    if status in ("pagado", "cancelado"):
        raise FlowError("El pedido ya está cerrado")
    if status != "listo" or _unready(order.get("items") or []):
        raise FlowError("Todavía hay productos en preparación")
