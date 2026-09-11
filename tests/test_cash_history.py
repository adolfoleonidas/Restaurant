import os
import requests

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")


def test_cash_history_periods():
    login = requests.post(f"{BASE}/auth/login", json={"email": "cajero@resto.com", "password": "cajero123"}, timeout=10)
    login.raise_for_status()
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    for period in ("day", "week", "month"):
        r = requests.get(f"{BASE}/cash/history", params={"period": period}, headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["period"] == period
        assert "registers" in body
        assert "total_sales" in body
