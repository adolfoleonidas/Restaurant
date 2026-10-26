"""How much the app polices money at the table.

Most venues charge before a table is freed. Some only use the app as an order
pad: the waiter takes the order, the money changes hands outside the system, and
the table is freed as soon as the guests leave. That is a per-venue decision and
it is stored in one field, read from one place, so the floor, the release
endpoint and the close endpoint cannot drift apart.

Nothing in this module writes to the database.
"""

# Apagado por defecto: un local que nunca abrió Ajustes sigue exigiendo el cobro
# exactamente como antes de existir esta configuración.
DEFAULT_REQUIRE_PAYMENT_TO_CLOSE = True


def require_payment_to_close(restaurant: dict | None) -> bool:
    """Whether a table may only be freed once its accounts are settled.

    Only an explicit `false` turns the check off. A missing field, a legacy row
    or a non-boolean value keeps the original behaviour.
    """
    value = (restaurant or {}).get("require_payment_to_close")
    if value is None:
        return DEFAULT_REQUIRE_PAYMENT_TO_CLOSE
    return bool(value)
