"""Shift close: expected cash uses payment amounts, digital stays out of the drawer."""
import os
import uuid

import requests

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")


def headers_for(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=10)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


def free_staff_table(h, admin):
    tables = requests.get(f"{BASE}/tables", headers=h, timeout=10).json()
    for t in tables:
        if t.get("status") == "disponible" and not t.get("active_order"):
            return t
    for t in tables:
        if t.get("status") in ("ocupada", "pagada") and not t.get("active_order"):
            rel = requests.post(f"{BASE}/tables/{t['id']}/release", headers=h, timeout=10)
            if rel.status_code == 200:
                return rel.json()
    orders = requests.get(f"{BASE}/orders", params={"active_only": "true"}, headers=admin, timeout=10).json()
    for o in orders:
        if not o.get("table_id"):
            continue
        requests.post(
            f"{BASE}/orders/{o['id']}/status",
            headers=admin,
            json={"status": "cancelado", "reason": "test cleanup free table"},
            timeout=10,
        )
        break
    tables = requests.get(f"{BASE}/tables", headers=h, timeout=10).json()
    return next(t for t in tables if t.get("status") == "disponible" and not t.get("active_order"))


def fresh_shift(cajero, opening=200.0):
    cur = requests.get(f"{BASE}/cash/current", headers=cajero, timeout=10).json()
    if cur:
        requests.post(
            f"{BASE}/cash/close",
            headers=cajero,
            json={"closing_amount": float(cur.get("opening_amount") or 0)},
            timeout=10,
        )
    opened = requests.post(f"{BASE}/cash/open", headers=cajero, json={"opening_amount": opening}, timeout=10)
    assert opened.status_code == 200, opened.text
    return opened.json()


def ready_order(qty=2):
    mozo = headers_for("mozo@resto.com", "mozo123")
    admin = headers_for("admin@resto.com", "admin123")
    cajero = headers_for("cajero@resto.com", "cajero123")
    products = [p for p in requests.get(f"{BASE}/products", headers=admin, timeout=10).json() if not p.get("is_combo")]
    free = free_staff_table(mozo, admin)
    created = requests.post(
        f"{BASE}/orders",
        headers=mozo,
        json={"table_id": free["id"], "order_type": "mesa", "items": [{"product_id": products[0]["id"], "quantity": qty}]},
        timeout=10,
    )
    assert created.status_code == 200, created.text
    body = created.json()
    return mozo, admin, cajero, body


def reopen_demo(cajero):
    cur = requests.get(f"{BASE}/cash/current", headers=cajero, timeout=10).json()
    if not cur:
        requests.post(f"{BASE}/cash/open", headers=cajero, json={"opening_amount": 200}, timeout=10)


def test_partial_cash_expected_uses_payment_amount_not_bill_total():
    mozo, admin, cajero, order = ready_order(qty=2)
    fresh_shift(cajero, 200)
    item = order["items"][0]
    unit = round(float(item["unit_price"]), 2)
    bill = round(float(order["total"]), 2)
    assert bill > unit

    pay = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={
            "order_id": order["id"],
            "method": "efectivo",
            "amount": unit,
            "received_amount": unit,
            "lines": [{"item_id": item["id"], "quantity": 1}],
            "idempotency_key": str(uuid.uuid4()),
        },
        timeout=10,
    )
    assert pay.status_code == 200, pay.text

    cur = requests.get(f"{BASE}/cash/current", headers=cajero, timeout=10).json()
    assert round(float(cur["cash_sales"]), 2) == unit
    assert round(float(cur["total_sales"]), 2) == unit
    assert round(float(cur["expected_amount"]), 2) == round(200 + unit, 2)
    assert round(float(cur["by_method"]["efectivo"]), 2) == unit

    closed = requests.post(
        f"{BASE}/cash/close",
        headers=cajero,
        json={"closing_amount": round(200 + unit, 2)},
        timeout=10,
    )
    assert closed.status_code == 200, closed.text
    body = closed.json()
    assert round(float(body["expected_amount"]), 2) == round(200 + unit, 2)
    assert round(float(body["cash_sales"]), 2) == unit
    assert round(float(body["difference"]), 2) == 0.0
    requests.post(f"{BASE}/orders/{order['id']}/status", headers=admin, json={"status": "cancelado", "reason": "cleanup close"}, timeout=10)
    reopen_demo(cajero)


def test_yape_does_not_increase_expected_cash():
    mozo, admin, cajero, order = ready_order(qty=1)
    fresh_shift(cajero, 200)
    total = round(float(order["total"]), 2)
    pay = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={"order_id": order["id"], "method": "yape", "amount": total, "idempotency_key": str(uuid.uuid4())},
        timeout=10,
    )
    assert pay.status_code == 200, pay.text
    cur = requests.get(f"{BASE}/cash/current", headers=cajero, timeout=10).json()
    assert round(float(cur["expected_amount"]), 2) == 200.0
    assert round(float(cur["cash_sales"]), 2) == 0.0
    assert round(float(cur["by_method"]["yape"]), 2) == total
    assert round(float(cur["total_sales"]), 2) == total
    requests.post(f"{BASE}/tables/{order['table_id']}/release", headers=mozo, timeout=10)
    reopen_demo(cajero)


def test_mixto_puts_only_cash_split_in_the_drawer():
    mozo, admin, cajero, order = ready_order(qty=1)
    fresh_shift(cajero, 200)
    total = round(float(order["total"]), 2)
    cash_part = round(min(40.0, total), 2)
    yape_part = round(total - cash_part, 2)
    pay = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={
            "order_id": order["id"],
            "method": "mixto",
            "amount": total,
            "splits": [{"method": "yape", "amount": yape_part}, {"method": "efectivo", "amount": cash_part}],
            "idempotency_key": str(uuid.uuid4()),
        },
        timeout=10,
    )
    assert pay.status_code == 200, pay.text
    cur = requests.get(f"{BASE}/cash/current", headers=cajero, timeout=10).json()
    assert round(float(cur["cash_sales"]), 2) == cash_part
    assert round(float(cur["by_method"]["yape"]), 2) == yape_part
    assert round(float(cur["expected_amount"]), 2) == round(200 + cash_part, 2)
    requests.post(f"{BASE}/tables/{order['table_id']}/release", headers=mozo, timeout=10)
    reopen_demo(cajero)
