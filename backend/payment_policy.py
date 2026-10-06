"""Who has to pay before the kitchen starts, per venue and order type.

The venue decides how it collects money from remote orders. Three questions are
answered here, always from the same place so the public checkout, the kitchen
board and the cashier cannot drift apart:

* does this order need to be paid before anybody cooks it?
* can the guest hand over a transfer receipt (Yape, Plin, bank) at all?
* is the payment already proven, or does a person still have to check it?

Nothing in this module writes to the database.
"""

TABLE_PREPAY_MODE = "table"

PREPAY_NEVER = "never"
PREPAY_ALWAYS = "always"
PREPAY_BY_TYPE = "by_order_type"

VALID_PREPAY_MODES = (PREPAY_NEVER, PREPAY_ALWAYS, PREPAY_BY_TYPE)
DEFAULT_PREPAY_MODE = PREPAY_NEVER

# Methods that carry a receipt worth checking. Cash and card are handed over in
# person, so there is nothing to verify up front: the order is cooked and the
# money is taken at the counter.
VERIFIABLE_METHODS = ("yape", "plin", "transferencia")

# Guest-visible state of the money for one order.
PAYMENT_STATES = (
    "no_requerido",   # postpaid: the guest settles at the end
    "pendiente",      # waiting for the guest to pay
    "reportado",      # the guest says it is paid; nobody has checked yet
    "confirmado",     # a person (later, a gateway) confirmed the money arrived
    "rechazado",      # the venue refused the reported payment
    "expirado",       # the guest walked away before paying
    "reembolsado",    # the money went back
)


def venue_policy(restaurant: dict | None) -> dict:
    """Read the venue's collection settings with safe defaults.

    Todo arranca apagado: un local que nunca abrió Ajustes sigue cobrando igual
    que antes de existir esta configuración.
    """
    config = restaurant or {}
    mode = config.get("table_prepay_mode")
    if mode not in VALID_PREPAY_MODES:
        mode = DEFAULT_PREPAY_MODE
    return {
        "table_prepay_mode": mode,
        "prepay_pickup": bool(config.get("prepay_pickup", False)),
        "prepay_delivery": bool(config.get("prepay_delivery", False)),
    }


def _prepay(mode: str, *, is_table: bool) -> bool:
    if mode == PREPAY_ALWAYS:
        return True
    if mode == PREPAY_BY_TYPE:
        return is_table
    return False


def collection_policy(restaurant: dict | None, order_type: str) -> dict:
    """Collection rules for one order type, in a shape the public UI can render.

    `table_token` and `staff` orders both travel as `local`, so callers that
    already know the guest scanned a table pass `staff=True` to bypass the
    prepay setting: a waiter taking the order at the table never charges first.
    """
    policy = venue_policy(restaurant)
    mode = policy["table_prepay_mode"]
    is_table = order_type == "local"

    if order_type in ("recojo", "delivery"):
        prepay_required = policy[f"prepay_{'pickup' if order_type == 'recojo' else 'delivery'}"]
    else:
        prepay_required = _prepay(mode, is_table=is_table)

    return {
        "prepay_mode": mode,
        "prepay_required": prepay_required,
        "table_prepay_mode": mode,
        "prepay_table": _prepay(mode, is_table=True),
        "prepay_pickup": policy["prepay_pickup"],
        "prepay_delivery": policy["prepay_delivery"],
        "verify_methods": list(VERIFIABLE_METHODS),
    }


def order_acceptance(policy: dict, payment_method: str, *, pay_at_counter: bool | None = None) -> dict:
    """Money state and kitchen gate for a newly created order.

    Returns the fields the order document needs:

    * `payment_state` — guest-visible money state.
    * `prepay_required` — whether this order was created under a prepay rule.
    * `acceptance_status` — `pendiente` means the kitchen must not see it yet.
    * `pay_at_counter` — cook now, collect at the counter.

    With prepay on, a transfer receipt cannot be proven by the guest, so the
    order waits for a person to confirm the money. Cash and card are different:
    they are taken in person, so the order goes to the kitchen flagged for
    collection instead of being blocked.
    """
    required = bool(policy.get("prepay_required"))
    verifiable = payment_method in VERIFIABLE_METHODS
    if pay_at_counter is None:
        pay_at_counter = required and not verifiable

    if not required:
        return {
            "payment_state": "no_requerido",
            "prepay_required": False,
            "acceptance_status": "aceptado",
            "pay_at_counter": False,
        }
    if pay_at_counter:
        return {
            "payment_state": "pendiente",
            "prepay_required": True,
            "acceptance_status": "aceptado",
            "pay_at_counter": True,
        }
    return {
        "payment_state": "pendiente",
        "prepay_required": True,
        "acceptance_status": "pendiente",
        "pay_at_counter": False,
    }


def needs_counter_verification(order: dict) -> bool:
    """Whether this order is still waiting for somebody to check the money."""
    return (
        bool(order.get("prepay_required"))
        and order.get("payment_state") in ("pendiente", "reportado")
        and order.get("payment_method_choice") in VERIFIABLE_METHODS
    )


def kitchen_visible(order: dict) -> bool:
    """The single gate the kitchen board trusts."""
    return order.get("acceptance_status") != "pendiente"


def payment_label(order: dict) -> str:
    """Short tag the kitchen reads on a ticket."""
    if order.get("payment_status") == "pagado" or order.get("payment_state") == "confirmado":
        return "pagado"
    if order.get("pay_at_counter"):
        return "cobra_en_caja"
    if order.get("prepay_required"):
        return "sin_confirmar"
    return "al_final"
