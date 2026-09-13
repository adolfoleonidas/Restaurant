"""Combos and optional guest data for dine-in."""
import os

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
        "cocina": login("cocina@resto.com", "cocina123"),
    }


@pytest.fixture(scope="module")
def catalog(tokens):
    r = requests.get(f"{BASE}/products", headers=headers(tokens["admin"]), timeout=10)
    r.raise_for_status()
    items = [p for p in r.json() if not p.get("is_combo")]
    assert len(items) >= 2
    cats = requests.get(f"{BASE}/categories", headers=headers(tokens["admin"]), timeout=10).json()
    return {"products": items, "category_id": cats[0]["id"]}


def test_local_order_allows_anonymous_guest(public_free_table):
    tables = [public_free_table]
    products = requests.get(f"{BASE}/public/products", timeout=10).json()
    product = next((p for p in products if p.get("is_available", True)), products[0])
    body = {
        "order_type": "local",
        "table_id": tables[0]["id"],
        "items": [{"product_id": product["id"], "quantity": 1}],
        "payment_method": "efectivo",
    }
    r = requests.post(f"{BASE}/public/orders", json=body, timeout=10)
    assert r.status_code in (200, 201), r.text
    oid = r.json()["id"]
    requests.post(
        f"{BASE}/orders/{oid}/status",
        headers=headers(login("admin@resto.com", "admin123")),
        json={"status": "cancelado", "reason": "cleanup anonymous local"},
        timeout=10,
    )


def test_recojo_requires_customer(catalog):
    body = {
        "order_type": "recojo",
        "items": [{"product_id": catalog["products"][0]["id"], "quantity": 1}],
        "payment_method": "yape",
    }
    r = requests.post(f"{BASE}/public/orders", json=body, timeout=10)
    assert r.status_code == 400
    assert "nombre" in r.json().get("detail", "").lower() or "celular" in r.json().get("detail", "").lower()


def test_combo_appears_on_kitchen_ticket(tokens, catalog, public_free_table):
    a, b = catalog["products"][0], catalog["products"][1]
    created = requests.post(
        f"{BASE}/products",
        headers=headers(tokens["admin"]),
        json={
            "category_id": catalog["category_id"],
            "name": "Combo test almuerzo",
            "description": "Test combo",
            "price": 29.9,
            "is_combo": True,
            "combo_items": [
                {"product_id": a["id"], "quantity": 1},
                {"product_id": b["id"], "quantity": 1},
            ],
        },
        timeout=10,
    )
    assert created.status_code in (200, 201), created.text
    combo = created.json()
    tables = [public_free_table]
    order = requests.post(
        f"{BASE}/public/orders",
        json={
            "order_type": "local",
            "table_id": tables[0]["id"],
            "items": [{"product_id": combo["id"], "quantity": 1}],
            "payment_method": "efectivo",
        },
        timeout=10,
    )
    assert order.status_code in (200, 201), order.text
    oid = order.json()["id"]
    kitchen = requests.get(f"{BASE}/orders/kitchen", headers=headers(tokens["cocina"]), timeout=10).json()
    ticket = next(o for o in kitchen if o["id"] == oid)
    line = ticket["items"][0]
    assert line.get("is_combo") is True
    names = {c["product_name"] for c in line.get("combo_components") or []}
    assert a["name"] in names
    assert b["name"] in names
    requests.post(
        f"{BASE}/orders/{oid}/status",
        headers=headers(tokens["admin"]),
        json={"status": "cancelado", "reason": "cleanup combo"},
        timeout=10,
    )
    requests.delete(f"{BASE}/products/{combo['id']}", headers=headers(tokens["admin"]), timeout=10)
