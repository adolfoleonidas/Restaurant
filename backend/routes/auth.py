from fastapi import APIRouter, HTTPException, Depends, Request
from database import db
from auth import verify_password_async, create_token, get_current_user, apply_permissions
from models import LoginInput, TokenOut
import time

router = APIRouter()

_LOGIN_WINDOW = 300
_LOGIN_MAX = 10
# Defence in depth behind the nginx limit_req zone: the table is keyed by
# "ip|email" and email is attacker-chosen, so it must not grow without bound.
_LOGIN_MAX_KEYS = 10_000
# key -> failure timestamps. Insertion order doubles as recency order: a key that
# fails again is moved to the end, so the first key is always the least recent.
_login_failures: dict = {}


def _is_rate_limited(key: str) -> bool:
    attempts = _login_failures.get(key)
    if not attempts:
        return False
    now = time.time()
    attempts = [t for t in attempts if now - t < _LOGIN_WINDOW]
    if attempts:
        _login_failures[key] = attempts
    else:
        _login_failures.pop(key, None)
    return len(attempts) >= _LOGIN_MAX


def _evict_for_new_key() -> None:
    now = time.time()
    for stale in [k for k, ts in _login_failures.items() if not ts or now - ts[-1] >= _LOGIN_WINDOW]:
        del _login_failures[stale]
    while len(_login_failures) >= _LOGIN_MAX_KEYS:
        del _login_failures[next(iter(_login_failures))]


def _record_failure(key: str) -> None:
    now = time.time()
    attempts = _login_failures.pop(key, None)
    if attempts is None:
        if len(_login_failures) >= _LOGIN_MAX_KEYS:
            _evict_for_new_key()
        attempts = []
    attempts.append(now)
    _login_failures[key] = attempts


@router.post("/login", response_model=TokenOut)
async def login(request: Request, data: LoginInput):
    key = f"{request.client.host}|{data.email.lower()}"
    if _is_rate_limited(key):
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera unos minutos.")
    user = await db.users.find_one({"email": data.email.lower()}, {"_id": 0})
    if not user or not await verify_password_async(data.password, user["password_hash"]):
        _record_failure(key)
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    if user.get("status") != "active":
        raise HTTPException(status_code=403, detail="Usuario inactivo")

    token = create_token(user["id"], user["role"], user["restaurant_id"])
    user_public = apply_permissions({k: v for k, v in user.items() if k != "password_hash"})
    return {"access_token": token, "token_type": "bearer", "user": user_public}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user
