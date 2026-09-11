"""Cashier history: payments are searchable; sold dishes count paid units."""
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


def ensure_cash(cajero):
    cur = requests.get(f"{BASE}/cash/current", headers=cajero, timeout=10)
    if not cur.json():
        requests.post(f"{BASE}/cash/open", headers=cajero, json={"opening_amount": 200}, timeout=10)


def ready_order(qty=3):
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
    return mozo, admin, cajero, created.json()


def test_payments_query_does_not_return_unrelated():
    cajero = headers_for("cajero@resto.com", "cajero123")
    r = requests.get(f"{BASE}/payments", params={"q": "__no_match_xyz__"}, headers=cajero, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_payment_is_listed_and_found_by_order_number():
    mozo, admin, cajero, order = ready_order(qty=1)
    ensure_cash(cajero)
    pay = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={
            "order_id": order["id"],
            "method": "yape",
            "amount": order["total"],
            "idempotency_key": str(uuid.uuid4()),
        },
        timeout=10,
    )
    assert pay.status_code == 200, pay.text
    pid = pay.json()["id"]
    listed = requests.get(f"{BASE}/payments", params={"period": "day"}, headers=cajero, timeout=10)
    assert listed.status_code == 200, listed.text
    ids = [p["id"] for p in listed.json()]
    assert pid in ids
    found = requests.get(
        f"{BASE}/payments",
        params={"q": str(order["order_number"])},
        headers=cajero,
        timeout=10,
    )
    assert found.status_code == 200, found.text
    assert any(p["id"] == pid for p in found.json())
    requests.post(f"{BASE}/tables/{order['table_id']}/release", headers=mozo, timeout=10)


def test_sold_dishes_count_paid_qty_not_unpaid_remainder():
    mozo, admin, cajero, order = ready_order(qty=3)
    ensure_cash(cajero)
    item = order["items"][0]
    product_id = item["product_id"]
    unit = float(item["unit_price"])
    before = requests.get(f"{BASE}/reports/products", params={"period": "day"}, headers=cajero, timeout=10)
    assert before.status_code == 200, before.text
    prev = next((p for p in before.json()["products"] if p["product_id"] == product_id), {"quantity": 0, "revenue": 0})
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
    after = requests.get(f"{BASE}/reports/products", params={"period": "day"}, headers=cajero, timeout=10)
    assert after.status_code == 200, after.text
    row = next(p for p in after.json()["products"] if p["product_id"] == product_id)
    assert row["quantity"] == prev["quantity"] + 1
    requests.post(
        f"{BASE}/orders/{order['id']}/status",
        headers=admin,
        json={"status": "cancelado", "reason": "cleanup sold dishes"},
        timeout=10,
    )
