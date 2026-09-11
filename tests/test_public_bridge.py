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


def test_public_tables_lists_available_only():
    r = requests.get(f"{BASE}/public/tables", timeout=10)
    assert r.status_code == 200, r.text
    tables = r.json()
    assert isinstance(tables, list)
    for t in tables:
        assert t["status"] == "disponible"
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
    table = public_free_table
    body = {
        "order_type": "local",
        "table_id": table["id"],
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
