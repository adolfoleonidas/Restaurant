from fastapi import APIRouter, HTTPException, Depends, Request
from database import db
from auth import verify_password, create_token, get_current_user, apply_permissions
from models import LoginInput, TokenOut
import time
from collections import defaultdict

router = APIRouter()

_LOGIN_WINDOW = 300
_LOGIN_MAX = 10
_login_failures = defaultdict(list)


def _is_rate_limited(key: str) -> bool:
    now = time.time()
    attempts = [t for t in _login_failures[key] if now - t < _LOGIN_WINDOW]
    _login_failures[key] = attempts
    return len(attempts) >= _LOGIN_MAX


def _record_failure(key: str) -> None:
    _login_failures[key].append(time.time())


@router.post("/login", response_model=TokenOut)
async def login(request: Request, data: LoginInput):
    key = f"{request.client.host}|{data.email.lower()}"
    if _is_rate_limited(key):
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera unos minutos.")
    user = await db.users.find_one({"email": data.email.lower()}, {"_id": 0})
    if not user or not verify_password(data.password, user["password_hash"]):
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
