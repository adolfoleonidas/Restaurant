import os

import pytest
import requests

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")


def admin_headers():
    r = requests.post(f"{BASE}/auth/login", json={"email": "admin@resto.com", "password": "admin123"}, timeout=10)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


def ensure_free_public_table():
    tables = requests.get(f"{BASE}/public/tables", timeout=10).json()
    if tables:
        return tables[0]
    headers = admin_headers()
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
    tables = requests.get(f"{BASE}/public/tables", timeout=10).json()
    assert tables, "could not free a table for tests"
    return tables[0]


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
