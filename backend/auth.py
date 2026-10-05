import jwt
import bcrypt
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import List, Optional

from database import db, strip_id
from security_config import jwt_secret

JWT_SECRET = jwt_secret()
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


ROLE_FUNCTIONS = {
    "admin": ["atencion", "preparacion", "cobro", "administracion"],
    "mozo": ["atencion"],
    "cocina": ["preparacion"],
    "cajero": ["cobro"],
}

ROLE_TO_FN = {
    "admin": "administracion",
    "cajero": "cobro",
    "mozo": "atencion",
    "cocina": "preparacion",
}


def user_functions(user: dict) -> list:
    stored = user.get("functions")
    if isinstance(stored, list) and stored:
        return [f for f in stored if f in ("atencion", "preparacion", "cobro", "administracion")]
    return list(ROLE_FUNCTIONS.get(user.get("role"), []))


def home_for(user: dict) -> str:
    if user.get("home_view"):
        return {
            "servicio": "/salon",
            "mesas": "/salon",
            "cocina": "/cocina",
            "caja": "/caja",
            "hoy": "/dashboard",
        }.get(user["home_view"], "/salon")
    fns = set(user_functions(user))
    floor = "atencion" in fns
    prep = "preparacion" in fns
    cash = "cobro" in fns
    admin = "administracion" in fns
    if floor and (prep or cash):
        return "/salon"
    if floor and not prep and not cash:
        return "/salon"
    if prep and not floor and not cash:
        return "/cocina"
    if cash and not floor:
        return "/caja"
    if admin:
        return "/dashboard"
    return "/salon"


def apply_permissions(user: dict) -> dict:
    out = dict(user)
    out["functions"] = user_functions(out)
    out["home"] = home_for(out)
    fns = set(out["functions"])
    if out.get("role") == "admin" or "administracion" in fns:
        out["can_discount"] = True
        out["can_void"] = True
        out["can_mark_sold_out"] = True
    else:
        out["can_discount"] = bool(out.get("can_discount"))
        out["can_void"] = bool(out.get("can_void"))
        if "preparacion" in fns:
            out["can_mark_sold_out"] = True if out.get("can_mark_sold_out") is None else bool(out.get("can_mark_sold_out"))
        else:
            out["can_mark_sold_out"] = bool(out.get("can_mark_sold_out"))
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
        if user.get("role") in roles:
            return user
        fns = set(user_functions(user))
        if "administracion" in fns:
            return user
        needed = {ROLE_TO_FN[r] for r in roles if r in ROLE_TO_FN}
        if fns & needed:
            return user
        raise HTTPException(status_code=403, detail=f"Requiere rol: {', '.join(roles)}")
    return _checker
