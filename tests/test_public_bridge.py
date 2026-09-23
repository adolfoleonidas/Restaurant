"""Public ↔ salon bridge: local orders must pick a table."""
import os
from pathlib import Path

import pytest
import requests

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=10)
    r.raise_for_status()
    return r.json()["access_token"]


def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tokens():
    return {
        "admin": login("admin@resto.com", "admin123"),
        "mozo": login("mozo@resto.com", "mozo123"),
        "cocina": login("cocina@resto.com", "cocina123"),
    }


@pytest.fixture(scope="module")
def product_id(tokens):
    r = requests.get(f"{BASE}/products", headers=headers(tokens["admin"]), timeout=10)
    r.raise_for_status()
    items = r.json()
    assert items, "seed must create products"
    return items[0]["id"]


def test_public_products_include_sold_out(product_id, tokens):
    admin = headers(tokens["admin"])
    mark = requests.post(f"{BASE}/products/{product_id}/availability", headers=admin, json={"is_available": False}, timeout=10)
    assert mark.status_code == 200, mark.text
    try:
        again = requests.get(f"{BASE}/public/products", timeout=10).json()
        row = next(p for p in again if p["id"] == product_id)
        assert row["is_available"] is False
    finally:
        requests.post(f"{BASE}/products/{product_id}/availability", headers=admin, json={"is_available": True}, timeout=10)


def test_public_tables_lists_orderable_tables():
    r = requests.get(f"{BASE}/public/tables", timeout=10)
    assert r.status_code == 200, r.text
    tables = r.json()
    assert isinstance(tables, list)
    for t in tables:
        assert t["status"] in ("disponible", "ocupada", "esperando_pago"), t
        assert "id" in t and "number" in t


def test_public_local_order_requires_table(product_id):
    body = {
        "order_type": "local",
        "customer_name": "Luis Mesa",
        "customer_phone": "999000111",
        "items": [{"product_id": product_id, "quantity": 1}],
        "payment_method": "yape",
    }
    r = requests.post(f"{BASE}/public/orders", json=body, timeout=10)
    assert r.status_code == 400
    assert "mesa" in r.json().get("detail", "").lower()


def test_public_local_order_occupies_table(product_id, tokens, public_free_table):
    from conftest import guest_table_token
    table = public_free_table
    token = guest_table_token(table["id"], headers(tokens["mozo"]))
    body = {
        "order_type": "local",
        "table_token": token,
        "customer_name": "Lucia Local",
        "customer_phone": "999222333",
        "items": [{"product_id": product_id, "quantity": 1}],
        "payment_method": "efectivo",
    }
    created = requests.post(f"{BASE}/public/orders", json=body, timeout=10)
    assert created.status_code in (200, 201), created.text
    data = created.json()
    kitchen = requests.get(f"{BASE}/orders/kitchen", headers=headers(tokens["cocina"]), timeout=10)
    assert kitchen.status_code == 200
    ticket = next((o for o in kitchen.json() if o["id"] == data["id"]), None)
    assert ticket is not None
    assert ticket.get("customer_name") == "Lucia Local"
    assert ticket.get("customer_phone") == "999222333"

    staff_tables = requests.get(f"{BASE}/tables", headers=headers(tokens["mozo"]), timeout=10).json()
    occupied = next(t for t in staff_tables if t["id"] == table["id"])
    assert occupied["status"] == "ocupada"

    requests.post(
        f"{BASE}/orders/{data['id']}/status",
        headers=headers(tokens["admin"]),
        json={"status": "cancelado", "reason": "cleanup bridge test"},
        timeout=10,
    )


def test_public_second_order_on_occupied_table_rejected(product_id, tokens, public_free_table):
    from conftest import guest_table_token
    table = public_free_table
    token = guest_table_token(table["id"], headers(tokens["mozo"]))
    first = requests.post(f"{BASE}/public/orders", json={
        "order_type": "local",
        "table_token": token,
        "customer_name": "Primera Ronda",
        "customer_phone": "999000111",
        "items": [{"product_id": product_id, "quantity": 1}],
        "payment_method": "efectivo",
    }, timeout=10)
    assert first.status_code in (200, 201), first.text
    created = first.json()

    second = requests.post(f"{BASE}/public/orders", json={
        "order_type": "local",
        "table_token": token,
        "customer_name": "Otra Persona",
        "customer_phone": "999000222",
        "items": [{"product_id": product_id, "quantity": 1}],
        "payment_method": "efectivo",
    }, timeout=10)
    assert second.status_code == 400, second.text
    assert "ocupada" in second.json().get("detail", "").lower()

    tables = requests.get(f"{BASE}/tables", headers=headers(tokens["mozo"]), timeout=10).json()
    entry = next(t for t in tables if t["id"] == table["id"])
    assert entry["status"] == "ocupada"
    assert entry["active_order"]["order_number"] == created["order_number"]

    requests.post(
        f"{BASE}/orders/{created['id']}/status",
        headers=headers(tokens["admin"]),
        json={"status": "cancelado", "reason": "cleanup occupied table test"},
        timeout=10,
    )


def test_public_live_items_add_update_remove(product_id, tokens, public_free_table):
    from conftest import guest_table_token
    table = public_free_table
    token = guest_table_token(table["id"], headers(tokens["mozo"]))
    first = requests.post(f"{BASE}/public/orders", json={
        "order_type": "local",
        "table_token": token,
        "customer_name": "Live Items",
        "customer_phone": "999000222",
        "items": [{"product_id": product_id, "quantity": 1}],
        "payment_method": "efectivo",
    }, timeout=10)
    assert first.status_code in (200, 201), first.text
    created = first.json()
    code = created["tracking_code"]

    add = requests.post(f"{BASE}/public/orders/{code}/items", json={
        "items": [{"product_id": product_id, "quantity": 1}],
    }, timeout=10)
    assert add.status_code == 200, add.text
    view = add.json()
    lines = [i for i in view["items"] if i["product_id"] == product_id]
    assert len(lines) == 2
    unit = lines[0]["unit_price"]
    assert view["total"] == round(unit * 2, 2)

    target = lines[-1]
    patch = requests.patch(
        f"{BASE}/public/orders/{code}/items/{target['id']}",
        json={"quantity": 3},
        timeout=10,
    )
    assert patch.status_code == 200, patch.text
    view = patch.json()
    assert view["total"] == round(unit * 4, 2)

    delete = requests.delete(f"{BASE}/public/orders/{code}/items/{target['id']}", timeout=10)
    assert delete.status_code == 200, delete.text
    view = delete.json()
    assert view["total"] == round(unit, 2)
    remaining = [i for i in view["items"] if i["product_id"] == product_id]
    assert len(remaining) == 1

    requests.post(
        f"{BASE}/orders/{created['id']}/status",
        headers=headers(tokens["admin"]),
        json={"status": "cancelado", "reason": "cleanup live items test"},
        timeout=10,
    )
    after_cancel = requests.post(f"{BASE}/public/orders/{code}/items", json={
        "items": [{"product_id": product_id, "quantity": 1}],
    }, timeout=10)
    assert after_cancel.status_code == 400
