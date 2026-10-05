import os
import sys

# The suite signs tokens; make sure it never depends on the ambient env (and that
# it runs the same locally and in CI).
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-for-the-hermetic-suite")

import pytest
import requests

import database as _database

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")

# The real bindings, captured before any test swaps them.
_REAL_DB = _database.db
_BACKEND_DIR = os.path.dirname(os.path.abspath(_database.__file__))


@pytest.fixture(autouse=True)
def _isolate_backend_modules():
    """Put every backend module back the way the test found it.

    Test modules swap route-level bindings (`db`, `_get_restaurant`, `client_host`,
    `_next_order_number`, ...) by direct assignment instead of monkeypatch, and
    reconfigure the rate limiters in place. Left alone, one module's fakes leak
    into every later test and the suite fails depending on the order it runs in.
    """
    modules = {}
    for name, module in list(sys.modules.items()):
        if name.startswith("tests") or name.startswith("_"):
            continue
        path = getattr(module, "__file__", None)
        if path and os.path.abspath(path).startswith(_BACKEND_DIR):
            modules[name] = module

    snapshots = {name: dict(module.__dict__) for name, module in modules.items()}
    limiters = [
        (value, value.allow)
        for module in modules.values()
        for value in module.__dict__.values()
        if hasattr(value, "allow") and hasattr(value, "reset")
    ]

    yield

    _database.db = _REAL_DB
    for name, module in modules.items():
        original = snapshots[name]
        for key in list(module.__dict__):
            if key not in original:
                del module.__dict__[key]
        module.__dict__.update(original)
    for limiter, allow in limiters:
        limiter.allow = allow

# Modules that go over real HTTP against a running API and a seeded database.
# They share this conftest's helpers (login, free table). Marked automatically so
# CI can run the hermetic suite with -m "not integration".
INTEGRATION_MODULES = {
    "test_admin_today",
    "test_audit_fixes",
    "test_caja_charge",
    "test_caja_history",
    "test_caja_void",
    "test_cash_close",
    "test_cash_history",
    "test_combos_and_guest",
    "test_functions_combo",
    "test_invariants",
    "test_kitchen_kds",
    "test_mozo_floor",
    "test_product_import",
    "test_public_bridge",
    "test_zones",
}


def pytest_collection_modifyitems(config, items):
    for item in items:
        module = getattr(item, "module", None)
        name = getattr(module, "__name__", "").rsplit(".", 1)[-1]
        if name in INTEGRATION_MODULES:
            item.add_marker(pytest.mark.integration)


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
