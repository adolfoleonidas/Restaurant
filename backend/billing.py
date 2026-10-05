"""Money rules shared by orders, payments, cash, and reports."""


class BillError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def money(value) -> float:
    return round(float(value or 0), 2)


def account_total(*, subtotal, delivery_fee=0, discount=0, tip=0) -> float:
    base = money(subtotal) + money(delivery_fee) - money(discount)
    return money(max(0.0, base) + money(tip))


def guarded_totals(order: dict, items: list, removed_item: dict = None):
    if removed_item is not None and int(removed_item.get("paid_qty") or 0) > 0:
        raise BillError("No podés quitar un producto que ya fue cobrado")
    for item in items:
        quantity = int(item.get("quantity") or 0)
        paid = int(item.get("paid_qty") or 0)
        if quantity < 1 or quantity < paid:
            raise BillError("No podés dejar un producto por debajo de lo ya cobrado")
    subtotal = money(sum(float(item.get("subtotal") or 0) for item in items))
    total = account_total(
        subtotal=subtotal,
        delivery_fee=order.get("delivery_fee") or 0,
        discount=order.get("discount") or 0,
        tip=order.get("tip") or 0,
    )
    if total + 0.009 < money(order.get("amount_paid") or 0):
        raise BillError("El total no puede quedar por debajo de lo ya cobrado")
    return subtotal, total


def assert_can_cancel(order: dict):
    if money(order.get("amount_paid") or 0) > 0.009:
        raise BillError("Devolvé o anulá los cobros antes de cancelar el pedido")


DRAWER_METHODS = ("efectivo", "yape", "plin", "tarjeta", "transferencia")


def method_amounts(payment: dict) -> dict:
    amount = money(payment.get("amount") or 0)
    method = payment.get("method")
    if method != "mixto":
        key = method if method in DRAWER_METHODS else "efectivo"
        return {key: amount} if amount else {}
    out = {name: 0.0 for name in DRAWER_METHODS}
    for split in payment.get("splits") or []:
        take = money(split.get("amount") or 0)
        if take <= 0:
            continue
        key = split.get("method") if split.get("method") in DRAWER_METHODS else "efectivo"
        out[key] = money(out[key] + take)
    # The change is handed back in cash, so it leaves the drawer. Without this
    # the cash portion stays at the amount handed over and the shift closes with
    # a phantom surplus.
    change = money(payment.get("change_amount") or 0)
    if change > 0:
        out["efectivo"] = money(max(0.0, out["efectivo"] - change))
    # Whatever the splits could not cover lands in cash, so the attribution
    # always adds up to the amount actually charged.
    residual = money(amount - sum(out.values()))
    if residual:
        out["efectivo"] = money(max(0.0, out["efectivo"] + residual))
    return {key: value for key, value in out.items() if value}


def cash_portion(payment: dict) -> float:
    return money(method_amounts(payment).get("efectivo") or 0)


def reversal_is_inside_open_shift(payment: dict, owned_register, open_register) -> bool:
    if owned_register and owned_register.get("status") == "open":
        return True
    if not payment.get("cash_register_id") and open_register:
        return (payment.get("created_at") or "") >= (open_register.get("opened_at") or "")
    return False


def shift_payment_filter(register: dict) -> dict:
    created = {"$gte": register.get("opened_at") or ""}
    if register.get("closed_at"):
        created["$lt"] = register["closed_at"]
    legacy_registerless = {
        "created_at": created,
        "$or": [
            {"cash_register_id": {"$exists": False}},
            {"cash_register_id": None},
        ],
    }
    if register.get("branch_id"):
        legacy_registerless["branch_id"] = register["branch_id"]
    else:
        legacy_registerless["$and"] = [{"$or": [
            {"branch_id": {"$exists": False}}, {"branch_id": None},
        ]}]
    return {
        "restaurant_id": register["restaurant_id"],
        "$or": [
            {"cash_register_id": register["id"]},
            legacy_registerless,
        ],
    }


def _in_window(stamp: str, start: str, end: str) -> bool:
    return bool(stamp) and start <= stamp <= end


def payment_deltas(payment: dict, start: str, end: str):
    status = payment.get("status") or "completed"
    parts = method_amounts(payment)
    created = payment.get("created_at") or ""
    deltas = []
    if status in ("completed", "voided", "refunded") and _in_window(created, start, end):
        deltas.append((created, 1, parts))
    if status in ("voided", "refunded"):
        voided = payment.get("voided_at") or ""
        if _in_window(voided, start, end):
            deltas.append((voided, -1, parts))
    return deltas


def build_sold_lines(items: list, line_payload: list, fully_paid: bool) -> list:
    by_id = {item.get("id"): item for item in items}
    taken = {}
    lines = []
    for line in line_payload or []:
        item = by_id.get(line.get("item_id"))
        if not item:
            continue
        qty = int(line.get("quantity") or 0)
        if qty <= 0:
            continue
        taken[line["item_id"]] = taken.get(line["item_id"], 0) + qty
        lines.append({
            "item_id": line["item_id"],
            "product_id": item.get("product_id"),
            "name": item.get("product_name") or line.get("name") or "Ítem",
            "quantity": qty,
            "unit_price": float(item.get("unit_price") or 0),
        })
    if fully_paid:
        for item in items:
            unpaid = int(item.get("quantity") or 0) - int(item.get("paid_qty") or 0) - taken.get(item.get("id"), 0)
            if unpaid <= 0:
                continue
            lines.append({
                "item_id": item.get("id"),
                "product_id": item.get("product_id"),
                "name": item.get("product_name") or "Ítem",
                "quantity": unpaid,
                "unit_price": float(item.get("unit_price") or 0),
            })
    return lines


def rank_products(payments, start: str, end: str, limit: int = None) -> list:
    grouped = {}
    for payment in payments:
        lines = payment.get("sold_lines") or []
        if not lines:
            continue
        status = payment.get("status") or "completed"
        signs = []
        if status in ("completed", "voided", "refunded") and _in_window(payment.get("created_at") or "", start, end):
            signs.append(1)
        if status in ("voided", "refunded") and _in_window(payment.get("voided_at") or "", start, end):
            signs.append(-1)
        for sign in signs:
            for line in lines:
                qty = int(line.get("quantity") or 0) * sign
                if qty == 0:
                    continue
                pid = line.get("product_id") or line.get("item_id")
                row = grouped.setdefault(pid, {
                    "product_id": pid,
                    "name": line.get("name") or "Ítem",
                    "quantity": 0,
                    "revenue": 0.0,
                })
                row["quantity"] += qty
                row["revenue"] = money(row["revenue"] + sign * int(line.get("quantity") or 0) * float(line.get("unit_price") or 0))
    rows = [row for row in grouped.values() if row["quantity"] != 0]
    rows.sort(key=lambda row: (-row["quantity"], row["name"]))
    if limit:
        return rows[:limit]
    return rows


def summarize_payments(payments, start: str, end: str) -> dict:
    total = 0.0
    count = 0
    by_method = {}
    by_day = {}
    for payment in payments:
        for stamp, sign, parts in payment_deltas(payment, start, end):
            chunk = money(sign * sum(parts.values()))
            total = money(total + chunk)
            if sign > 0:
                count += 1
            day = stamp[:10]
            by_day[day] = money(by_day.get(day, 0) + chunk)
            for method, value in parts.items():
                by_method[method] = money(by_method.get(method, 0) + sign * value)
    return {
        "total_sales": total,
        "orders_count": count,
        "by_method": by_method,
        "sales_by_day": by_day,
    }
