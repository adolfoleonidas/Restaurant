import os
import jwt
import bcrypt
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import List, Optional

from database import db, strip_id

JWT_SECRET = os.environ.get("JWT_SECRET", "change-this-secret-in-production-restaurant-app")
JWT_ALG = "HS256"
JWT_EXP_HOURS = 24 * 7  # 7 days

bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, role: str, restaurant_id: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "restaurant_id": restaurant_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXP_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


def apply_permissions(user: dict) -> dict:
    out = dict(user)
    if out.get("role") == "admin":
        out["can_discount"] = True
        out["can_void"] = True
    else:
        out["can_discount"] = bool(out.get("can_discount"))
        out["can_void"] = bool(out.get("can_void"))
    return out


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> dict:
    if creds is None:
        raise HTTPException(status_code=401, detail="No autorizado")
    payload = decode_token(creds.credentials)
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")
    if user.get("status") != "active":
        raise HTTPException(status_code=403, detail="Usuario inactivo")
    return apply_permissions(user)


def require_roles(roles: List[str]):
    async def _checker(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail=f"Requiere rol: {', '.join(roles)}")
        return user
    return _checker
