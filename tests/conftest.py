import os

import pytest
import requests

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")


def admin_headers():
    r = requests.post(f"{BASE}/auth/login", json={"email": "admin@resto.com", "password": "admin123"}, timeout=10)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


def ensure_free_public_table():
    headers = admin_headers()

    def free_tables():
        tables = requests.get(f"{BASE}/tables", headers=headers, timeout=10).json()
        return [t for t in tables if t.get("status") == "disponible" and not t.get("active_order")]

    found = free_tables()
    if found:
        return found[0]
    orders = requests.get(f"{BASE}/orders", params={"active_only": "true"}, headers=headers, timeout=10).json()
    for o in orders:
        if not o.get("table_id"):
            continue
        requests.post(
            f"{BASE}/orders/{o['id']}/status",
            headers=headers,
            json={"status": "cancelado", "reason": "test cleanup: free table"},
            timeout=10,
        )
        break
    found = free_tables()
    assert found, "could not free a table for tests"
    return found[0]


def guest_table_token(table_id, headers):
    link = requests.get(f"{BASE}/tables/{table_id}/guest-link", headers=headers, timeout=10)
    link.raise_for_status()
    return link.json()["token"]


@pytest.fixture
def public_free_table():
    return ensure_free_public_table()


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
