"""Bulk product import: creation, auto-categories, validation, duplicates."""
import os
import uuid

import requests

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")


def headers_for(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=10)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


def test_product_import():
    admin = headers_for("admin@resto.com", "admin123")
    mozo = headers_for("mozo@resto.com", "mozo123")
    suffix = uuid.uuid4().hex[:6]
    cat = f"Categoría Imp {suffix}"
    p1 = f"Plato Import {suffix} A"
    p2 = f"Plato Import {suffix} B"

    # Non-admin cannot import
    denied = requests.post(
        f"{BASE}/products/import",
        headers=mozo,
        json={"items": [{"name": p1, "category": cat, "price": "10.00"}]},
        timeout=10,
    )
    assert denied.status_code == 403, denied.text

    # Valid rows + one broken + one duplicate (case-insensitive)
    res = requests.post(
        f"{BASE}/products/import",
        headers=admin,
        json={"items": [
            {"name": p1, "category": cat, "price": "S/ 18,50", "description": "Con pollo", "preparation_time": "10"},
            {"name": p2, "category": cat, "price": "no-price"},
            {"name": p1.lower(), "category": cat, "price": "5"},
        ]},
        timeout=10,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["created"]) == 1, body
    assert body["created"][0]["price"] == 18.5
    assert cat in body["categories_created"]
    reasons = {s["row"] for s in body["skipped"]}
    assert reasons == {2, 3}, body

    # Category exists now
    cats = requests.get(f"{BASE}/categories", headers=admin, timeout=10).json()
    new_cat = next((c for c in cats if c["name"] == cat), None)
    assert new_cat, cats

    # Cleanup
    products = requests.get(f"{BASE}/products", headers=admin, timeout=10).json()
    for p in products:
        if p["name"].lower() in (p1.lower(), p2.lower()):
            requests.delete(f"{BASE}/products/{p['id']}", headers=admin, timeout=10)
    if new_cat:
        requests.delete(f"{BASE}/categories/{new_cat['id']}", headers=admin, timeout=10)
