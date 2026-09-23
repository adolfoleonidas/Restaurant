"""Combinable functions: one person can floor+charge; owner home is Servicio; serve != pay."""
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


def test_owner_login_exposes_all_functions_and_servicio_home():
    _headers, user = headers_for("admin@resto.com", "admin123")
    for fn in ("atencion", "preparacion", "cobro", "administracion"):
        assert fn in user.get("functions", []), user
    assert user.get("home") == "/servicio"


def test_mozo_with_cobro_can_charge():
    admin, _ = headers_for("admin@resto.com", "admin123")
    mozo, mozo_user = headers_for("mozo@resto.com", "mozo123")
    users = requests.get(f"{BASE}/users", headers=admin, timeout=10).json()
    mid = next(u["id"] for u in users if u["email"] == "mozo@resto.com")
    patch = requests.patch(
        f"{BASE}/users/{mid}",
        headers=admin,
        json={"functions": ["atencion", "cobro"]},
        timeout=10,
    )
    assert patch.status_code == 200, patch.text
    mozo, mozo_user = headers_for("mozo@resto.com", "mozo123")
    assert "cobro" in mozo_user["functions"]
    products = [p for p in requests.get(f"{BASE}/products", headers=admin, timeout=10).json() if not p.get("is_combo") and p.get("is_available", True)]
    free = free_staff_table(mozo, admin)
    created = requests.post(
        f"{BASE}/orders",
        headers=mozo,
        json={"table_id": free["id"], "order_type": "mesa", "items": [{"product_id": products[0]["id"], "quantity": 1}]},
        timeout=10,
    )
    assert created.status_code == 200, created.text
    order = created.json()
    cur = requests.get(f"{BASE}/cash/current", headers=mozo, timeout=10)
    if not cur.json():
        opened = requests.post(f"{BASE}/cash/open", headers=mozo, json={"opening_amount": 50}, timeout=10)
        assert opened.status_code == 200, opened.text
    pay = requests.post(
        f"{BASE}/payments",
        headers=mozo,
        json={"order_id": order["id"], "method": "efectivo", "amount": order["total"], "received_amount": order["total"], "idempotency_key": str(uuid.uuid4())},
        timeout=10,
    )
    assert pay.status_code == 200, pay.text
    assert pay.json().get("fully_paid") is True
    again = requests.get(f"{BASE}/orders/{order['id']}", headers=mozo, timeout=10).json()
    assert again["status"] == "nuevo"
    assert again["fulfillment_status"] == "nuevo"
    assert again["payment_status"] == "pagado"
    tables = requests.get(f"{BASE}/tables", headers=mozo, timeout=10).json()
    row = next(t for t in tables if t["id"] == order["table_id"])
    assert row["status"] == "ocupada"
    requests.post(
        f"{BASE}/payments/{pay.json()['id']}/void",
        headers=admin,
        json={"reason": "cleanup prepaid before kitchen", "kind": "void"},
        timeout=10,
    )
    requests.post(
        f"{BASE}/orders/{order['id']}/status",
        headers=admin,
        json={"status": "cancelado", "reason": "cleanup prepaid before kitchen"},
        timeout=10,
    )
    requests.patch(f"{BASE}/users/{mid}", headers=admin, json={"functions": ["atencion"]}, timeout=10)


def test_serve_does_not_mark_paid():
    mozo, _ = headers_for("mozo@resto.com", "mozo123")
    admin, _ = headers_for("admin@resto.com", "admin123")
    products = [p for p in requests.get(f"{BASE}/products", headers=admin, timeout=10).json() if not p.get("is_combo") and p.get("is_available", True)]
    free = free_staff_table(mozo, admin)
    created = requests.post(
        f"{BASE}/orders",
        headers=mozo,
        json={"table_id": free["id"], "order_type": "mesa", "items": [{"product_id": products[0]["id"], "quantity": 1}]},
        timeout=10,
    )
    assert created.status_code == 200, created.text
    order = created.json()
    early = requests.post(f"{BASE}/orders/{order['id']}/serve", headers=mozo, timeout=10)
    assert early.status_code == 400, early.text
    cocina, _ = headers_for("cocina@resto.com", "cocina123")
    sent = requests.post(f"{BASE}/orders/{order['id']}/send-to-kitchen", headers=mozo, timeout=10)
    assert sent.status_code == 200, sent.text
    requests.post(f"{BASE}/orders/{order['id']}/bump", headers=cocina, json={"from_status": "pendiente"}, timeout=10)
    ready = requests.post(f"{BASE}/orders/{order['id']}/bump", headers=cocina, json={"from_status": "en_preparacion"}, timeout=10)
    assert ready.status_code == 200, ready.text
    served = requests.post(f"{BASE}/orders/{order['id']}/serve", headers=mozo, timeout=10)
    assert served.status_code == 200, served.text
    body = served.json()
    assert body["status"] == "entregado"
    assert body["status"] != "pagado"
    assert all(it.get("status") == "entregado" for it in body["items"])
    requests.post(f"{BASE}/orders/{order['id']}/status", headers=admin, json={"status": "cancelado", "reason": "cleanup serve"}, timeout=10)
