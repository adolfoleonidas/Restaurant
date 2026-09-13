"""Zones CRUD: create, rename (cascade to tables), delete protections, table validation."""
import os
import random
import uuid

import requests

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")


def headers_for(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=10)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


def test_zone_crud_and_permissions():
    admin = headers_for("admin@resto.com", "admin123")
    mozo = headers_for("mozo@resto.com", "mozo123")
    suffix = uuid.uuid4().hex[:6]
    name = f"Zona Test {suffix}"
    renamed = f"Zona Test Ren {suffix}"
    numbers = random.sample(range(900, 1000), 2)

    # List is visible to staff
    listed = requests.get(f"{BASE}/zones", headers=mozo, timeout=10)
    assert listed.status_code == 200, listed.text

    # Non-admin cannot create
    denied = requests.post(f"{BASE}/zones", headers=mozo, json={"name": name}, timeout=10)
    assert denied.status_code == 403, denied.text

    # Admin creates
    created = requests.post(f"{BASE}/zones", headers=admin, json={"name": name}, timeout=10)
    assert created.status_code == 200, created.text
    zone = created.json()
    assert zone["name"] == name

    # Duplicate name rejected
    dup = requests.post(f"{BASE}/zones", headers=admin, json={"name": name}, timeout=10)
    assert dup.status_code == 400, dup.text

    # Table can be created in that zone
    table = requests.post(
        f"{BASE}/tables",
        headers=admin,
        json={"number": numbers[0], "name": "Mesa Test Zona", "capacity": 2, "area": name},
        timeout=10,
    )
    assert table.status_code == 200, table.text
    assert table.json()["area"] == name
    table_id = table.json()["id"]

    # Table with unknown zone rejected
    bad = requests.post(
        f"{BASE}/tables",
        headers=admin,
        json={"number": numbers[1], "name": "Mesa Zona Rota", "capacity": 2, "area": f"NoExiste {suffix}"},
        timeout=10,
    )
    assert bad.status_code == 400, bad.text

    # Delete blocked while tables use the zone
    blocked = requests.delete(f"{BASE}/zones/{zone['id']}", headers=admin, timeout=10)
    assert blocked.status_code == 400, blocked.text

    # Rename cascades to tables
    patched = requests.patch(f"{BASE}/zones/{zone['id']}", headers=admin, json={"name": renamed}, timeout=10)
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == renamed
    tables = requests.get(f"{BASE}/tables", headers=admin, timeout=10).json()
    row = next(t for t in tables if t["id"] == table_id)
    assert row["area"] == renamed

    # Still in use after rename
    still_blocked = requests.delete(f"{BASE}/zones/{zone['id']}", headers=admin, timeout=10)
    assert still_blocked.status_code == 400, still_blocked.text

    # Cleanup table, then zone deletion works
    requests.delete(f"{BASE}/tables/{table_id}", headers=admin, timeout=10)
    deleted = requests.delete(f"{BASE}/zones/{zone['id']}", headers=admin, timeout=10)
    assert deleted.status_code == 200, deleted.text
    remaining = requests.get(f"{BASE}/zones", headers=admin, timeout=10).json()
    assert all(z["name"] != renamed for z in remaining)
