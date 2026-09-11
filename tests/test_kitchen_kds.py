"""Kitchen KDS: bump card and item-level ready."""
import os
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
        if t.get("status") == "ocupada" and not t.get("active_order"):
            rel = requests.post(f"{BASE}/tables/{t['id']}/release", headers=h, timeout=10)
            if rel.status_code == 200:
                return rel.json()
    orders = requests.get(f"{BASE}/orders", params={"active_only": "true"}, headers=admin, timeout=10).json()
    for o in orders:
        if o.get("table_id"):
            requests.post(f"{BASE}/orders/{o['id']}/status", headers=admin, json={"status": "cancelado", "reason": "cleanup"}, timeout=10)
            break
    tables = requests.get(f"{BASE}/tables", headers=h, timeout=10).json()
    return next(t for t in tables if t.get("status") == "disponible" and not t.get("active_order"))


def test_bump_moves_items_pendiente_to_fuego_then_listo():
    mozo = headers_for("mozo@resto.com", "mozo123")
    admin = headers_for("admin@resto.com", "admin123")
    cocina = headers_for("cocina@resto.com", "cocina123")
    products = [p for p in requests.get(f"{BASE}/products", headers=admin, timeout=10).json() if not p.get("is_combo")]
    free = free_staff_table(mozo, admin)
    created = requests.post(
        f"{BASE}/orders",
        headers=mozo,
        json={"table_id": free["id"], "order_type": "mesa", "items": [{"product_id": products[0]["id"], "quantity": 1}]},
        timeout=10,
    )
    oid = created.json()["id"]
    requests.post(f"{BASE}/orders/{oid}/send-to-kitchen", headers=mozo, timeout=10)
    bumped = requests.post(f"{BASE}/orders/{oid}/bump", headers=cocina, json={"from_status": "pendiente"}, timeout=10)
    assert bumped.status_code == 200, bumped.text
    assert bumped.json()["items"][0]["status"] == "en_preparacion"
    ready = requests.post(f"{BASE}/orders/{oid}/bump", headers=cocina, json={"from_status": "en_preparacion"}, timeout=10)
    assert ready.status_code == 200, ready.text
    assert ready.json()["status"] == "listo"
    assert ready.json()["items"][0]["status"] == "listo"
    requests.post(f"{BASE}/orders/{oid}/status", headers=admin, json={"status": "cancelado", "reason": "cleanup kds bump"}, timeout=10)
