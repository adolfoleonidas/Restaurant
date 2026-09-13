"""Regression tests for audit fixes POS-001..005."""
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


def _staff():
    return (
        headers_for("mozo@resto.com", "mozo123"),
        headers_for("admin@resto.com", "admin123"),
        headers_for("cajero@resto.com", "cajero123"),
    )


def _ensure_cash(cajero):
    cur = requests.get(f"{BASE}/cash/current", headers=cajero, timeout=10)
    if not cur.json():
        requests.post(f"{BASE}/cash/open", headers=cajero, json={"opening_amount": 100}, timeout=10)


def _new_order(mozo, admin, qty=2):
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
    return body["id"], free["id"], body["subtotal"], body["total"]


def _cleanup(mozo, admin, oid, table_id):
    for h in (admin,):
        r = requests.post(f"{BASE}/orders/{oid}/status", headers=h, json={"status": "cancelado", "reason": "cleanup audit fix test"}, timeout=10)
        if r.status_code == 200:
            break
    requests.post(f"{BASE}/tables/{table_id}/release", headers=mozo, timeout=10)


def test_status_endpoint_rejects_manual_pagado():
    mozo, admin, cajero = _staff()
    oid, table_id, _subtotal, _total = _new_order(mozo, admin)
    try:
        r = requests.post(f"{BASE}/orders/{oid}/status", headers=mozo, json={"status": "pagado"}, timeout=10)
        assert r.status_code == 400, r.text
    finally:
        _cleanup(mozo, admin, oid, table_id)


def test_partial_payment_inherits_discount():
    mozo, admin, cajero = _staff()
    _ensure_cash(cajero)
    oid, table_id, subtotal, total = _new_order(mozo, admin, qty=4)
    try:
        first = requests.post(
            f"{BASE}/payments",
            headers=admin,
            json={
                "order_id": oid,
                "method": "efectivo",
                "amount": 10,
                "received_amount": 10,
                "discount": 2,
                "discount_reason": "cortesía de prueba",
                "idempotency_key": str(uuid.uuid4()),
            },
            timeout=10,
        )
        assert first.status_code == 200, first.text
        second = requests.post(
            f"{BASE}/payments",
            headers=admin,
            json={
                "order_id": oid,
                "method": "efectivo",
                "amount": 999,
                "received_amount": 999,
                "idempotency_key": str(uuid.uuid4()),
            },
            timeout=10,
        )
        assert second.status_code == 200, second.text
        assert second.json().get("fully_paid") is True
        pays = requests.get(f"{BASE}/payments/by-order/{oid}", headers=cajero, timeout=10).json()
        paid = sum(float(p.get("amount") or 0) for p in pays if p.get("status") == "completed")
        assert round(paid, 2) == round(subtotal - 2, 2), f"paid {paid} != subtotal-2 {subtotal - 2}"
    finally:
        _cleanup(mozo, admin, oid, table_id)


def test_add_items_to_bill_requested_goes_to_kitchen():
    mozo, admin, cajero = _staff()
    oid, table_id, _subtotal, _total = _new_order(mozo, admin)
    try:
        r = requests.post(f"{BASE}/orders/{oid}/status", headers=mozo, json={"status": "pendiente_pago"}, timeout=10)
        assert r.status_code == 200, r.text
        products = [p for p in requests.get(f"{BASE}/products", headers=admin, timeout=10).json() if not p.get("is_combo") and p.get("is_available", True)]
        add = requests.post(
            f"{BASE}/orders/{oid}/items",
            headers=mozo,
            json=[{"product_id": products[0]["id"], "quantity": 1}],
            timeout=10,
        )
        assert add.status_code == 200, add.text
        assert add.json().get("status") == "enviado_cocina", add.text
        board = requests.get(f"{BASE}/orders/kitchen", headers=headers_for("cocina@resto.com", "cocina123"), timeout=10).json()
        ids = {o["id"] for o in board}
        assert oid in ids, "order with added item not on kitchen board"
    finally:
        _cleanup(mozo, admin, oid, table_id)


def test_sales_report_uses_payment_amount_on_partial_payments():
    mozo, admin, cajero = _staff()
    _ensure_cash(cajero)
    oid, table_id, subtotal, total = _new_order(mozo, admin, qty=4)
    try:
        half = round(total / 2, 2)
        for _ in range(2):
            pay = requests.post(
                f"{BASE}/payments",
                headers=cajero,
                json={
                    "order_id": oid,
                    "method": "efectivo",
                    "amount": half,
                    "received_amount": half,
                    "idempotency_key": str(uuid.uuid4()),
                },
                timeout=10,
            )
            assert pay.status_code == 200, pay.text
        r = requests.get(f"{BASE}/reports/sales", headers=cajero, params={"period": "day"}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        orders = requests.get(f"{BASE}/orders/{oid}", headers=admin, timeout=10).json()
        order_total = round(orders["subtotal"], 2)
        today_payments = [
            p for p in requests.get(f"{BASE}/payments", headers=cajero, timeout=10).json()
            if p.get("order_id") == oid and p.get("status") == "completed"
        ]
        paid_total = round(sum(float(p.get("amount") or 0) for p in today_payments), 2)
        assert round(data["total_sales"], 2) >= round(paid_total - 0.02, 2), data
        assert paid_total == order_total, f"paid_total {paid_total} != order_total {order_total}"
    finally:
        _cleanup(mozo, admin, oid, table_id)


def test_login_rate_limited_after_failures():
    email = f"brute-{uuid.uuid4().hex[:8]}@test.com"
    statuses = []
    for _ in range(12):
        r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": "wrong-password"}, timeout=10)
        statuses.append(r.status_code)
    assert 429 in statuses, f"expected 429 after repeated failures, got {statuses}"
