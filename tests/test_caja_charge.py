"""Cashier: pay does not free the table; split + idempotent retry."""
import math
import os
import uuid

import requests

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")


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


def headers_for(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=10)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


def _ensure_cash(cajero):
    cur = requests.get(f"{BASE}/cash/current", headers=cajero, timeout=10)
    if not cur.json():
        requests.post(f"{BASE}/cash/open", headers=cajero, json={"opening_amount": 100}, timeout=10)


def _ready_order(qty=1):
    mozo = headers_for("mozo@resto.com", "mozo123")
    admin = headers_for("admin@resto.com", "admin123")
    cajero = headers_for("cajero@resto.com", "cajero123")
    products = [p for p in requests.get(f"{BASE}/products", headers=admin, timeout=10).json() if not p.get("is_combo") and p.get("is_available", True)]
    free = free_staff_table(mozo, admin)
    created = requests.post(
        f"{BASE}/orders",
        headers=mozo,
        json={"table_id": free["id"], "order_type": "mesa", "items": [{"product_id": products[0]["id"], "quantity": qty}]},
        timeout=10,
    )
    assert created.status_code == 200, created.text
    body = created.json()
    return mozo, admin, cajero, body["id"], free["id"], body["total"]


def test_payment_does_not_free_table():
    mozo, admin, cajero, oid, table_id, total = _ready_order()
    _ensure_cash(cajero)
    pay = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={"order_id": oid, "method": "efectivo", "amount": total, "received_amount": total, "idempotency_key": str(uuid.uuid4())},
        timeout=10,
    )
    assert pay.status_code == 200, pay.text
    assert pay.json().get("fully_paid") is True
    assert pay.json().get("table_released") is False
    tables = requests.get(f"{BASE}/tables", headers=mozo, timeout=10).json()
    row = next(t for t in tables if t["id"] == table_id)
    assert row["status"] == "pagada"
    assert not row.get("active_order")
    requests.post(f"{BASE}/tables/{table_id}/release", headers=mozo, timeout=10)


def test_payment_idempotency_does_not_double_charge():
    mozo, admin, cajero, oid, table_id, total = _ready_order()
    _ensure_cash(cajero)
    key = str(uuid.uuid4())
    payload = {"order_id": oid, "method": "yape", "amount": total, "idempotency_key": key}
    a = requests.post(f"{BASE}/payments", headers=cajero, json=payload, timeout=10)
    b = requests.post(f"{BASE}/payments", headers=cajero, json=payload, timeout=10)
    assert a.status_code == 200, a.text
    assert b.status_code == 200, b.text
    assert a.json()["id"] == b.json()["id"]
    pays = requests.get(f"{BASE}/payments/by-order/{oid}", headers=cajero, timeout=10).json()
    assert len(pays) == 1
    requests.post(f"{BASE}/tables/{table_id}/release", headers=mozo, timeout=10)


def test_pay_one_unit_of_line_marks_paid_qty():
    mozo, admin, cajero, oid, table_id, total = _ready_order(qty=3)
    _ensure_cash(cajero)
    order = requests.get(f"{BASE}/orders/{oid}", headers=cajero, timeout=10).json()
    item = order["items"][0]
    unit = float(item["unit_price"])
    pay = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={
            "order_id": oid,
            "method": "efectivo",
            "amount": unit,
            "received_amount": unit,
            "lines": [{"item_id": item["id"], "quantity": 1}],
            "idempotency_key": str(uuid.uuid4()),
        },
        timeout=10,
    )
    assert pay.status_code == 200, pay.text
    assert pay.json().get("fully_paid") is False
    again = requests.get(f"{BASE}/orders/{oid}", headers=cajero, timeout=10).json()
    assert again["items"][0]["paid_qty"] == 1
    assert again["status"] != "pagado"
    assert round(float(again["amount_paid"]), 2) == round(unit, 2)
    requests.post(
        f"{BASE}/orders/{oid}/status",
        headers=admin,
        json={"status": "cancelado", "reason": "cleanup item split"},
        timeout=10,
    )


def test_equal_parts_then_remainder_closes():
    mozo, admin, cajero, oid, table_id, total = _ready_order()
    _ensure_cash(cajero)
    part = math.floor(total / 2 * 100) / 100
    rest = round(total - part, 2)
    first = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={"order_id": oid, "method": "efectivo", "amount": part, "received_amount": part, "idempotency_key": str(uuid.uuid4())},
        timeout=10,
    )
    assert first.status_code == 200, first.text
    assert first.json().get("fully_paid") is False
    second = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={"order_id": oid, "method": "efectivo", "amount": rest, "received_amount": rest, "idempotency_key": str(uuid.uuid4())},
        timeout=10,
    )
    assert second.status_code == 200, second.text
    assert second.json().get("fully_paid") is True
    tables = requests.get(f"{BASE}/tables", headers=mozo, timeout=10).json()
    row = next(t for t in tables if t["id"] == table_id)
    assert row["status"] == "pagada"
    requests.post(f"{BASE}/tables/{table_id}/release", headers=mozo, timeout=10)
