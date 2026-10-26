"""The statuses that mean an order no longer owns its table.

`cerrado_sin_cobro` only exists for venues that turned off
`require_payment_to_close`: the waiter frees the table, the account is filed as
closed without money, and no payment is invented. It is terminal like `pagado`
and `cancelado`, so every active-order query must exclude it.

Kept in one module so the next status does not have to be hunted through fifty
inline `["pagado", "cancelado"]` literals.
"""

PAID = "pagado"
CANCELLED = "cancelado"
CLOSED_WITHOUT_PAYMENT = "cerrado_sin_cobro"

TERMINAL_ORDER_STATUSES = (PAID, CANCELLED, CLOSED_WITHOUT_PAYMENT)


def is_terminal(order: dict | None) -> bool:
    return (order or {}).get("status") in TERMINAL_ORDER_STATUSES
