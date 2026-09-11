"""Waiter floor: occupy a table without creating a kitchen ticket."""
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


def test_mozo_seats_table_without_order():
    h = headers_for("mozo@resto.com", "mozo123")
    admin = headers_for("admin@resto.com", "admin123")
    free = free_staff_table(h, admin)
    seated = requests.post(f"{BASE}/tables/{free['id']}/seat", headers=h, timeout=10)
    assert seated.status_code == 200, seated.text
    body = seated.json()
    assert body["status"] == "ocupada"
    assert body.get("active_order") is None

    listed = requests.get(f"{BASE}/tables", headers=h, timeout=10).json()
    row = next(t for t in listed if t["id"] == free["id"])
    assert row["status"] == "ocupada"
    assert not row.get("active_order")

    released = requests.post(f"{BASE}/tables/{free['id']}/release", headers=h, timeout=10)
    assert released.status_code == 200, released.text
    assert released.json()["status"] == "disponible"


def test_cannot_release_table_with_active_order():
    h = headers_for("mozo@resto.com", "mozo123")
    admin = headers_for("admin@resto.com", "admin123")
    products = requests.get(f"{BASE}/products", headers=admin, timeout=10).json()
    prod = next(p for p in products if not p.get("is_combo"))
    free = free_staff_table(h, admin)
    created = requests.post(
        f"{BASE}/orders",
        headers=h,
        json={"table_id": free["id"], "order_type": "mesa", "items": [{"product_id": prod["id"], "quantity": 1}]},
        timeout=10,
    )
    assert created.status_code == 200, created.text
    rel = requests.post(f"{BASE}/tables/{free['id']}/release", headers=h, timeout=10)
    assert rel.status_code == 400
    requests.post(
        f"{BASE}/orders/{created.json()['id']}/status",
        headers=admin,
        json={"status": "cancelado", "reason": "cleanup mozo floor test"},
        timeout=10,
    )


def test_adding_item_to_ready_order_returns_to_kitchen():
    h = headers_for("mozo@resto.com", "mozo123")
    admin = headers_for("admin@resto.com", "admin123")
    cocina = headers_for("cocina@resto.com", "cocina123")
    products = requests.get(f"{BASE}/products", headers=admin, timeout=10).json()
    simples = [p for p in products if not p.get("is_combo")]
    free = free_staff_table(h, admin)
    created = requests.post(
        f"{BASE}/orders",
        headers=h,
        json={"table_id": free["id"], "order_type": "mesa", "items": [{"product_id": simples[0]["id"], "quantity": 1}]},
        timeout=10,
    )
    assert created.status_code == 200, created.text
    oid = created.json()["id"]
    assert requests.post(f"{BASE}/orders/{oid}/send-to-kitchen", headers=h, timeout=10).status_code == 200
    assert requests.post(f"{BASE}/orders/{oid}/status", headers=cocina, json={"status": "listo"}, timeout=10).status_code == 200
    added = requests.post(
        f"{BASE}/orders/{oid}/items",
        headers=h,
        json=[{"product_id": simples[1]["id"], "quantity": 1}],
        timeout=10,
    )
    assert added.status_code == 200, added.text
    body = added.json()
    assert body["status"] == "enviado_cocina"
    statuses = {i["product_id"]: i["status"] for i in body["items"]}
    assert statuses[simples[0]["id"]] == "listo"
    assert statuses[simples[1]["id"]] == "pendiente"
    kitchen = requests.get(f"{BASE}/orders/kitchen", headers=cocina, timeout=10).json()
    ticket = next(o for o in kitchen if o["id"] == oid)
    pending = [i for i in ticket["items"] if i["status"] == "pendiente"]
    assert len(pending) == 1
    assert pending[0]["product_id"] == simples[1]["id"]
    requests.post(
        f"{BASE}/orders/{oid}/status",
        headers=admin,
        json={"status": "cancelado", "reason": "cleanup extra drink"},
        timeout=10,
    )
