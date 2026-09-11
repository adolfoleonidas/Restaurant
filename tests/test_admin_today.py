"""Admin Hoy: attention first, sold-out, approval, reassign without resetting kitchen."""
import os
import uuid

import requests

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")


def headers_for(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=10)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}, r.json()["user"]


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


def make_order(qty=1):
    mozo, _ = headers_for("mozo@resto.com", "mozo123")
    admin, admin_user = headers_for("admin@resto.com", "admin123")
    products = [p for p in requests.get(f"{BASE}/products", headers=admin, timeout=10).json() if not p.get("is_combo")]
    free = free_staff_table(mozo, admin)
    created = requests.post(
        f"{BASE}/orders",
        headers=mozo,
        json={"table_id": free["id"], "order_type": "mesa", "items": [{"product_id": products[0]["id"], "quantity": qty}]},
        timeout=10,
    )
    assert created.status_code == 200, created.text
    return mozo, admin, admin_user, products[0], created.json()


def test_today_returns_attention_and_summary():
    admin, _ = headers_for("admin@resto.com", "admin123")
    r = requests.get(f"{BASE}/reports/today", headers=admin, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "attention" in body
    assert "summary" in body
    assert "generated_at" in body
    for key in ("occupied_tables", "total_tables", "kitchen_orders", "bill_requests", "cash_open"):
        assert key in body["summary"]


def test_in_prep_item_with_zero_prep_time_is_delayed():
    mozo, admin, _, product, order = make_order()
    requests.patch(f"{BASE}/products/{product['id']}", headers=admin, json={"preparation_time": 0}, timeout=10)
    sent = requests.post(f"{BASE}/orders/{order['id']}/send-to-kitchen", headers=mozo, timeout=10)
    assert sent.status_code == 200, sent.text
    bump = requests.post(
        f"{BASE}/orders/{order['id']}/items/{order['items'][0]['id']}/status",
        headers=admin,
        json={"status": "en_preparacion"},
        timeout=10,
    )
    assert bump.status_code == 200, bump.text
    today = requests.get(f"{BASE}/reports/today", headers=admin, timeout=10)
    assert today.status_code == 200, today.text
    delays = [a for a in today.json()["attention"] if a.get("kind") == "delay" and a.get("order_id") == order["id"]]
    assert delays, today.json()["attention"]
    assert delays[0].get("href")
    requests.post(f"{BASE}/orders/{order['id']}/status", headers=admin, json={"status": "cancelado", "reason": "cleanup delay"}, timeout=10)
    requests.patch(f"{BASE}/products/{product['id']}", headers=admin, json={"preparation_time": 15}, timeout=10)


def test_sold_out_blocks_new_send_keeps_accepted_order():
    mozo, admin, _, product, order = make_order()
    cocina, _ = headers_for("cocina@resto.com", "cocina123")
    mark = requests.post(
        f"{BASE}/products/{product['id']}/availability",
        headers=cocina,
        json={"is_available": False},
        timeout=10,
    )
    assert mark.status_code == 200, mark.text
    assert mark.json()["product"]["is_available"] is False
    pending = mark.json().get("pending_orders") or []
    assert any(p["id"] == order["id"] for p in pending)
    again = requests.post(
        f"{BASE}/orders",
        headers=mozo,
        json={"table_id": None, "order_type": "recojo", "items": [{"product_id": product["id"], "quantity": 1}]},
        timeout=10,
    )
    assert again.status_code == 400, again.text
    still = requests.get(f"{BASE}/orders/{order['id']}", headers=admin, timeout=10)
    assert still.status_code == 200
    assert still.json()["status"] != "cancelado"
    requests.post(f"{BASE}/products/{product['id']}/availability", headers=admin, json={"is_available": True}, timeout=10)
    requests.post(f"{BASE}/orders/{order['id']}/status", headers=admin, json={"status": "cancelado", "reason": "cleanup soldout"}, timeout=10)


def test_cajero_requests_void_admin_approves():
    mozo, admin, _, product, order = make_order()
    cajero, _ = headers_for("cajero@resto.com", "cajero123")
    ensure_cash(cajero)
    sent = requests.post(f"{BASE}/orders/{order['id']}/send-to-kitchen", headers=mozo, timeout=10)
    assert sent.status_code == 200, sent.text
    pay = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={"order_id": order["id"], "method": "efectivo", "amount": order["total"], "received_amount": order["total"], "idempotency_key": str(uuid.uuid4())},
        timeout=10,
    )
    assert pay.status_code == 200, pay.text
    req = requests.post(
        f"{BASE}/approvals",
        headers=cajero,
        json={"kind": "void", "reason": "cobré la mesa equivocada", "payment_id": pay.json()["id"]},
        timeout=10,
    )
    assert req.status_code == 200, req.text
    assert req.json()["status"] == "pending"
    today = requests.get(f"{BASE}/reports/today", headers=admin, timeout=10).json()
    assert any(a.get("kind") == "approval" and a.get("approval_id") == req.json()["id"] for a in today["attention"])
    decide = requests.post(
        f"{BASE}/approvals/{req.json()['id']}/decide",
        headers=admin,
        json={"action": "approve", "note": "autorizado, avisar cocina si sigue en fuego"},
        timeout=10,
    )
    assert decide.status_code == 200, decide.text
    assert decide.json()["status"] == "approved"
    listed = requests.get(f"{BASE}/payments/by-order/{order['id']}", headers=admin, timeout=10).json()
    assert listed[0]["status"] == "voided"
    again = requests.get(f"{BASE}/orders/{order['id']}", headers=admin, timeout=10).json()
    assert again["status"] != "pagado"
    requests.post(f"{BASE}/orders/{order['id']}/status", headers=admin, json={"status": "cancelado", "reason": "cleanup approval"}, timeout=10)


def test_reassign_waiter_does_not_reset_kitchen_items():
    mozo, admin, admin_user, _, order = make_order()
    sent = requests.post(f"{BASE}/orders/{order['id']}/send-to-kitchen", headers=mozo, timeout=10)
    assert sent.status_code == 200, sent.text
    item_id = order["items"][0]["id"]
    bump = requests.post(
        f"{BASE}/orders/{order['id']}/items/{item_id}/status",
        headers=admin,
        json={"status": "en_preparacion"},
        timeout=10,
    )
    assert bump.status_code == 200, bump.text
    before = bump.json()["items"][0]["status"]
    re = requests.post(
        f"{BASE}/orders/{order['id']}/reassign",
        headers=admin,
        json={"waiter_id": admin_user["id"]},
        timeout=10,
    )
    assert re.status_code == 200, re.text
    assert re.json()["created_by"] == admin_user["id"]
    assert re.json()["items"][0]["status"] == before
    requests.post(f"{BASE}/orders/{order['id']}/status", headers=admin, json={"status": "cancelado", "reason": "cleanup reassign"}, timeout=10)
