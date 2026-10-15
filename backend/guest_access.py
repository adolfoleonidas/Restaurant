"""Signed table QR and a small public-order rate limit."""
import base64
import hmac
import time
from hashlib import sha256

from security_config import jwt_secret


def sign_table(table_id: str, nonce: str, ttl_seconds: int = 10 * 365 * 24 * 60 * 60) -> str:
    expires = int(time.time()) + ttl_seconds
    payload = f"{table_id}|{nonce}|{expires}"
    signature = hmac.new(jwt_secret().encode(), payload.encode(), sha256).hexdigest()[:32]
    raw = f"{payload}|{signature}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def read_table_token(token: str, *, allow_expired: bool = False) -> tuple[str, str]:
    """Verifica la firma del QR de mesa y devuelve (mesa, nonce).

    Un QR impreso y pegado en la mesa no debería dejar de funcionar porque pasó
    el tiempo: el vencimiento se valida, pero `allow_expired` permite al llamador
    renovarlo en el momento en vez de rechazar al cliente parado en la mesa.
    """
    padded = token + "=" * (-len(token) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        body, signature = raw.rsplit("|", 1)
        table_id, nonce, expires = body.split("|")
        expires_at = int(expires)
    except (ValueError, UnicodeError):
        raise ValueError("invalid table token")
    payload = f"{table_id}|{nonce}|{expires_at}"
    expected = hmac.new(jwt_secret().encode(), payload.encode(), sha256).hexdigest()[:32]
    if not hmac.compare_digest(signature, expected):
        raise ValueError("invalid table token")
    if expires_at < int(time.time()) and not allow_expired:
        raise ValueError("invalid table token")
    return table_id, nonce


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

# The tracking endpoints take the code as a bearer token and return the
# customer's name, phone and address. Only *failed* lookups are counted, per
# client: a customer browsing their own order never spends this budget, while
# someone enumerating codes hits it fast.
public_miss_limiter = RateLimiter(limit=30, window_seconds=600)

# Successful reads of a tracking code were not counted anywhere, so one code that
# leaked (a shared link, a screenshot of a receipt) could be read without limit,
# and `/orders/{code}/table` had no limiter at all while exposing the whole
# table's consumption. The budget is sized well above the real client: the
# tracking screen polls every 30 s while visible and every 5 min while hidden
# (~22 requests per 10 min), and the table summary is fetched once per order.
public_read_limiter = RateLimiter(limit=120, window_seconds=600)


def client_host(request) -> str:
    forwarded = ""
    headers = getattr(request, "headers", None) or {}
    if hasattr(headers, "get"):
        forwarded = headers.get("x-forwarded-for") or ""
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    client = getattr(request, "client", None)
    return getattr(client, "host", None) or "unknown"
