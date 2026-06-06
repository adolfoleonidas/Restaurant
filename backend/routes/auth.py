from fastapi import APIRouter, HTTPException, Depends
from database import db
from auth import verify_password, create_token, get_current_user
from models import LoginInput, TokenOut

router = APIRouter()


@router.post("/login", response_model=TokenOut)
async def login(data: LoginInput):
    user = await db.users.find_one({"email": data.email.lower()}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    if user.get("status") != "active":
        raise HTTPException(status_code=403, detail="Usuario inactivo")

    token = create_token(user["id"], user["role"], user["restaurant_id"])
    user_public = {k: v for k, v in user.items() if k != "password_hash"}
    return {"access_token": token, "token_type": "bearer", "user": user_public}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user
