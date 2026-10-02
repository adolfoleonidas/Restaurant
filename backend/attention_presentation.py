"""Safe, additive public presentation fields for confirmed dine-in/pickup attention."""

from datetime import date


def public_attention_reference(order: dict) -> dict:
    """Return only a valid human reference; internal assignment state stays private."""
    if order.get("order_type") not in {"mesa", "local", "recojo"} or order.get("acceptance_status") != "aceptado":
        return {}

    number = order.get("attention_number")
    if isinstance(number, bool) or not isinstance(number, int) or number < 1 or number > 9007199254740991:
        return {}

    business_date = order.get("attention_business_date")
    if not isinstance(business_date, str):
        return {}
    try:
        parsed = date.fromisoformat(business_date)
    except ValueError:
        return {}
    if parsed.isoformat() != business_date:
        return {}

    return {
        "acceptance_status": "aceptado",
        "attention_number": number,
        "attention_business_date": business_date,
    }
