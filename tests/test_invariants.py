"""Architecture invariants for the restaurant POS.

These tests talk to the local API + Mongo. They encode the four holes
found in the architecture review.
"""
import os
import uuid
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")
ENV_PATH = Path(__file__).resolve().parents[1] / "backend" / ".env"


def _load_env():
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


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
        "cajero": login("cajero@resto.com", "cajero123"),
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


@pytest.fixture
def free_table(tokens):
    r = requests.get(f"{BASE}/tables", headers=headers(tokens["mozo"]), timeout=10)
    r.raise_for_status()
    for t in r.json():
        if t.get("status") == "disponible":
            return t
    pytest.skip("no free table")


def test_cocina_order_list_hides_payment_fields(tokens):
    """Cocina GET /orders must not leak discount, tip, total, paid_at."""
    r = requests.get(f"{BASE}/orders", headers=headers(tokens["cocina"]), timeout=10)
    assert r.status_code == 200
    hidden = {"discount", "tip", "total", "paid_at"}
    for order in r.json():
        leak = hidden.intersection(order.keys())
        assert not leak, f"cocina saw payment fields {leak} on order {order.get('id')}"


def test_public_order_appears_on_kitchen_board(product_id, tokens):
    """A public web order shows up on the kitchen board without a per-table QR."""
    body = {
        "order_type": "recojo",
        "customer_name": "Ana Test",
        "customer_phone": "999111222",
        "items": [{"product_id": product_id, "quantity": 1}],
        "payment_method": "yape",
    }
    created = requests.post(f"{BASE}/public/orders", json=body, timeout=10)
    assert created.status_code in (200, 201), created.text
    order_id = created.json()["id"]

    kitchen = requests.get(f"{BASE}/orders/kitchen", headers=headers(tokens["cocina"]), timeout=10)
    assert kitchen.status_code == 200
    ids = {o["id"] for o in kitchen.json()}
    assert order_id in ids, "public order never reached kitchen board"


def test_payment_rejected_when_cash_register_closed(tokens, product_id, free_table):
    """Staff cobro must fail if there is no open cash register."""
    admin = headers(tokens["admin"])
    mozo = headers(tokens["mozo"])
    cajero = headers(tokens["cajero"])

    current = requests.get(f"{BASE}/cash/current", headers=cajero, timeout=10)
    assert current.status_code == 200
    if current.json():
        close = requests.post(
            f"{BASE}/cash/close",
            headers=cajero,
            json={"closing_amount": 0, "notes": "cierre para test invariante"},
            timeout=10,
        )
        assert close.status_code == 200, close.text

    created = requests.post(
        f"{BASE}/orders",
        headers=mozo,
        json={
            "table_id": free_table["id"],
            "order_type": "mesa",
            "items": [{"product_id": product_id, "quantity": 1}],
        },
        timeout=10,
    )
    assert created.status_code == 200, created.text
    order = created.json()

    pay = requests.post(
        f"{BASE}/payments",
        headers=cajero,
        json={
            "order_id": order["id"],
            "method": "efectivo",
            "amount": order["total"],
            "received_amount": order["total"],
        },
        timeout=10,
    )
    assert pay.status_code == 400
    assert "caja" in pay.json().get("detail", "").lower()

    # leave no dangling active order
    requests.post(
        f"{BASE}/orders/{order['id']}/status",
        headers=admin,
        json={"status": "cancelado", "reason": "cleanup test caja"},
        timeout=10,
    )


def test_mongo_rejects_second_active_order_same_table():
    """Partial unique index: two active orders on the same table cannot exist."""
    env = _load_env()
    mongo_url = env.get("MONGO_URL") or os.environ.get("MONGO_URL")
    db_name = env.get("DB_NAME") or os.environ.get("DB_NAME", "restaurant_db")
    assert mongo_url, "MONGO_URL required"
    client = MongoClient(mongo_url)
    db = client[db_name]
    table_id = f"test-table-{uuid.uuid4()}"
    restaurant_id = "test-restaurant"
    doc = {
        "id": str(uuid.uuid4()),
        "restaurant_id": restaurant_id,
        "table_id": table_id,
        "status": "nuevo",
    }
    db.orders.insert_one(dict(doc))
    try:
        with pytest.raises(DuplicateKeyError):
            db.orders.insert_one({
                "id": str(uuid.uuid4()),
                "restaurant_id": restaurant_id,
                "table_id": table_id,
                "status": "en_preparacion",
            })
    finally:
        db.orders.delete_many({"table_id": table_id})
        client.close()
