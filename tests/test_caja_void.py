"""Voids and discounts: permission, reason, keep the record, reopen the account."""
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


def paid_order():
    mozo = headers_for("mozo@resto.com", "mozo123")
    admin = headers_for("admin@resto.com", "admin123")
    cajero = headers_for("cajero@resto.com", "cajero123")
    products = [p for p in requests.get(f"{BASE}/products", headers=admin, timeout=10).json() if not p.get("is_combo")]
    free = free_staff_table(mozo, admin)
    created = requests.post(
        f"{BASE}/orders",
        headers=mozo,
        json={"table_id": free["id"], "order_type": "mesa", "items": [{"product_id": products[0]["id"], "quantity": 1}]},
        timeout=10,
    )
    assert created.status_code == 200, created.text
    order = created.json()
    ensure_cash(cajero)
    pay = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={"order_id": order["id"], "method": "efectivo", "amount": order["total"], "received_amount": order["total"], "idempotency_key": str(uuid.uuid4())},
        timeout=10,
    )
    assert pay.status_code == 200, pay.text
    return mozo, admin, cajero, order, pay.json()


def test_cajero_cannot_void_without_permission():
    mozo, admin, cajero, order, payment = paid_order()
    r = requests.post(
        f"{BASE}/payments/{payment['id']}/void",
        headers=cajero,
        json={"reason": "me equivoqué de mesa", "kind": "void"},
        timeout=10,
    )
    assert r.status_code == 403, r.text
    listed = requests.get(f"{BASE}/payments/by-order/{order['id']}", headers=cajero, timeout=10).json()
    assert listed[0]["status"] == "completed"
    requests.post(f"{BASE}/tables/{order['table_id']}/release", headers=mozo, timeout=10)


def test_admin_void_keeps_record_and_reopens_account():
    mozo, admin, cajero, order, payment = paid_order()
    r = requests.post(
        f"{BASE}/payments/{payment['id']}/void",
        headers=admin,
        json={"reason": "cobré la mesa equivocada", "kind": "void"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "voided"
    assert body["void_kind"] == "void"
    assert body["void_reason"] == "cobré la mesa equivocada"
    assert body.get("voided_by_name")
    listed = requests.get(f"{BASE}/payments/by-order/{order['id']}", headers=admin, timeout=10).json()
    assert len(listed) == 1
    assert listed[0]["id"] == payment["id"]
    assert listed[0]["status"] == "voided"
    again = requests.get(f"{BASE}/orders/{order['id']}", headers=admin, timeout=10).json()
    assert again["status"] != "pagado"
    assert float(again.get("amount_paid") or 0) == 0
    tables = requests.get(f"{BASE}/tables", headers=mozo, timeout=10).json()
    row = next(t for t in tables if t["id"] == order["table_id"])
    assert row["status"] != "pagada"
    requests.post(f"{BASE}/orders/{order['id']}/status", headers=admin, json={"status": "cancelado", "reason": "cleanup void"}, timeout=10)


def test_refund_is_labeled_not_deleted():
    mozo, admin, cajero, order, payment = paid_order()
    r = requests.post(
        f"{BASE}/payments/{payment['id']}/void",
        headers=admin,
        json={"reason": "cliente devolvió el lomo", "kind": "refund"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "refunded"
    assert r.json()["void_kind"] == "refund"
    listed = requests.get(f"{BASE}/payments/by-order/{order['id']}", headers=admin, timeout=10).json()
    assert listed[0]["id"] == payment["id"]
    assert listed[0]["status"] == "refunded"
    requests.post(f"{BASE}/orders/{order['id']}/status", headers=admin, json={"status": "cancelado", "reason": "cleanup refund"}, timeout=10)


def test_cajero_cannot_discount_without_permission():
    mozo = headers_for("mozo@resto.com", "mozo123")
    admin = headers_for("admin@resto.com", "admin123")
    cajero = headers_for("cajero@resto.com", "cajero123")
    products = [p for p in requests.get(f"{BASE}/products", headers=admin, timeout=10).json() if not p.get("is_combo")]
    free = free_staff_table(mozo, admin)
    created = requests.post(
        f"{BASE}/orders",
        headers=mozo,
        json={"table_id": free["id"], "order_type": "mesa", "items": [{"product_id": products[0]["id"], "quantity": 1}]},
        timeout=10,
    )
    order = created.json()
    ensure_cash(cajero)
    r = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={
            "order_id": order["id"],
            "method": "efectivo",
            "amount": max(0.01, float(order["total"]) - 1),
            "received_amount": float(order["total"]),
            "discount": 1,
            "discount_reason": "promo",
            "idempotency_key": str(uuid.uuid4()),
        },
        timeout=10,
    )
    assert r.status_code == 403, r.text
    requests.post(f"{BASE}/orders/{order['id']}/status", headers=admin, json={"status": "cancelado", "reason": "cleanup discount"}, timeout=10)


def test_admin_discount_requires_reason():
    mozo = headers_for("mozo@resto.com", "mozo123")
    admin = headers_for("admin@resto.com", "admin123")
    products = [p for p in requests.get(f"{BASE}/products", headers=admin, timeout=10).json() if not p.get("is_combo")]
    free = free_staff_table(mozo, admin)
    created = requests.post(
        f"{BASE}/orders",
        headers=mozo,
        json={"table_id": free["id"], "order_type": "mesa", "items": [{"product_id": products[0]["id"], "quantity": 1}]},
        timeout=10,
    )
    order = created.json()
    ensure_cash(admin)
    missing = requests.post(
        f"{BASE}/payments",
        headers=admin,
        json={
            "order_id": order["id"],
            "method": "efectivo",
            "amount": float(order["total"]),
            "received_amount": float(order["total"]),
            "discount": 1,
            "idempotency_key": str(uuid.uuid4()),
        },
        timeout=10,
    )
    assert missing.status_code == 400, missing.text
    ok = requests.post(
        f"{BASE}/payments",
        headers=admin,
        json={
            "order_id": order["id"],
            "method": "efectivo",
            "amount": max(0.01, float(order["total"]) - 1),
            "received_amount": float(order["total"]),
            "discount": 1,
            "discount_reason": "cortesía de la casa",
            "idempotency_key": str(uuid.uuid4()),
        },
        timeout=10,
    )
    assert ok.status_code == 200, ok.text
    assert float(ok.json().get("discount") or 0) == 1
    requests.post(f"{BASE}/tables/{order['table_id']}/release", headers=mozo, timeout=10)
