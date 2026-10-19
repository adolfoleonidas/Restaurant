"""`client_host` feeds the public rate limiters, so it must not be spoofable.

nginx replaces X-Forwarded-For with the address it actually saw
(`proxy_set_header X-Forwarded-For $remote_addr`), but a value a client sends
can still reach the backend in front of it when another proxy appends instead
of replacing. The only entry we can trust is the LAST one: the hop our own
proxy added. Trusting the first lets any caller pick its own rate-limit key.
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "in_memory_only")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-for-the-client-host-tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from guest_access import client_host  # noqa: E402


class _Request:
    def __init__(self, headers=None, host="172.18.0.5"):
        self.headers = headers or {}
        self.client = type("Client", (), {"host": host})() if host else None


def test_a_client_supplied_first_hop_does_not_choose_the_key():
    request = _Request({"x-forwarded-for": "6.6.6.6, 203.0.113.9"})
    assert client_host(request) == "203.0.113.9"


def test_rotating_the_spoofed_prefix_keeps_the_same_key():
    first = client_host(_Request({"x-forwarded-for": "1.1.1.1, 203.0.113.9"}))
    second = client_host(_Request({"x-forwarded-for": "2.2.2.2, 203.0.113.9"}))
    assert first == second == "203.0.113.9"


def test_a_single_value_from_the_proxy_is_used_as_is():
    assert client_host(_Request({"x-forwarded-for": "203.0.113.9"})) == "203.0.113.9"


def test_whitespace_and_empty_trailing_hops_are_ignored():
    assert client_host(_Request({"x-forwarded-for": "6.6.6.6 ,  203.0.113.9  "})) == "203.0.113.9"
    assert client_host(_Request({"x-forwarded-for": "203.0.113.9, "})) == "203.0.113.9"


def test_without_the_header_the_direct_peer_is_used():
    assert client_host(_Request(host="127.0.0.1")) == "127.0.0.1"


def test_without_header_or_peer_the_key_is_unknown():
    assert client_host(_Request(host=None)) == "unknown"
    assert client_host(_Request({"x-forwarded-for": " , "}, host=None)) == "unknown"
