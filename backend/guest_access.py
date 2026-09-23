"""Signed table QR and a small public-order rate limit."""
import base64
import hmac
import time
from hashlib import sha256

from security_config import jwt_secret


def sign_table(table_id: str, ttl_seconds: int = 12 * 60 * 60) -> str:
    expires = int(time.time()) + ttl_seconds
    payload = f"{table_id}|{expires}"
    signature = hmac.new(jwt_secret().encode(), payload.encode(), sha256).hexdigest()[:32]
    raw = f"{payload}|{signature}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def read_table_token(token: str) -> str:
    padded = token + "=" * (-len(token) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        table_id, expires, signature = raw.rsplit("|", 2)
        expires_at = int(expires)
    except (ValueError, UnicodeError):
        raise ValueError("invalid table token")
    payload = f"{table_id}|{expires_at}"
    expected = hmac.new(jwt_secret().encode(), payload.encode(), sha256).hexdigest()[:32]
    if not hmac.compare_digest(signature, expected) or expires_at < int(time.time()):
        raise ValueError("invalid table token")
    return table_id


class RateLimiter:
    def __init__(self, limit: int = 8, window_seconds: int = 600):
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits = {}

    def reset(self):
        self._hits = {}

    def allow(self, key: str, now: float = None) -> bool:
        moment = time.time() if now is None else now
        recent = [stamp for stamp in self._hits.get(key, []) if moment - stamp < self.window_seconds]
        if len(recent) >= self.limit:
            self._hits[key] = recent
            return False
        recent.append(moment)
        self._hits[key] = recent
        return True


public_order_limiter = RateLimiter()


def client_host(request) -> str:
    forwarded = ""
    headers = getattr(request, "headers", None) or {}
    if hasattr(headers, "get"):
        forwarded = headers.get("x-forwarded-for") or ""
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    client = getattr(request, "client", None)
    return getattr(client, "host", None) or "unknown"
