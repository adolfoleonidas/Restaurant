from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import secrets
import uuid
from database import db
from auth import get_current_user, require_roles
from models import TableCreate, TableUpdate
from notify import emit_notice
from guest_access import sign_table

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _validate_area(restaurant_id: str, area: str):
    if not area or not area.strip():
        raise HTTPException(status_code=400, detail="La zona es obligatoria")
    area = area.strip()
    zones = await db.zones.find({"restaurant_id": restaurant_id}).to_list(1000)
    if zones and not any(z.get("name") == area for z in zones):
        raise HTTPException(status_code=400, detail="La zona no existe")
    return area


@router.get("")
async def list_tables(user: dict = Depends(get_current_user)):
    items = await db.tables.find(
        {"restaurant_id": user["restaurant_id"]},
        {"_id": 0}
    ).sort("number", 1).to_list(1000)
    # Attach active order id if any
    proj = {
        "_id": 0, "id": 1, "table_id": 1, "created_at": 1,
        "source": 1, "order_type": 1, "customer_name": 1, "status": 1, "items": 1,
    }
    if user.get("role") != "cocina":
        proj["total"] = 1
        proj["payment_status"] = 1
        proj["amount_paid"] = 1
        proj["fulfillment_status"] = 1
        proj["attention_open"] = 1
        proj["attention_id"] = 1
    active_orders = await db.orders.find(
        {
            "restaurant_id": user["restaurant_id"],
            "$or": [
                {"status": {"$nin": ["pagado", "cancelado"]}},
                {"attention_open": True},
            ],
        },
        proj,
    ).to_list(1000)
    by_table = {o["table_id"]: o for o in active_orders if o.get("table_id")}
    for t in items:
        active = by_table.get(t["id"])
        if active:
            raw_items = active.pop("items", None) or []
            active["item_count"] = sum(int(i.get("quantity") or 0) for i in raw_items)
        t["active_order"] = active
        nonce = t.pop("qr_nonce", None)
        if t.pop("qr_revoked", False):
            t["qr_status"] = "revoked"
        elif nonce:
            t["qr_status"] = "active"
        else:
            t["qr_status"] = "none"
    return items


@router.post("")
async def create_table(data: TableCreate, user: dict = Depends(require_roles(["admin"]))):
    exists = await db.tables.find_one({"restaurant_id": user["restaurant_id"], "number": data.number})
    if exists:
        raise HTTPException(status_code=400, detail="Número de mesa ya existe")
    t = {
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "number": data.number,
        "name": data.name or f"Mesa {data.number}",
        "capacity": data.capacity,
        "area": await _validate_area(user["restaurant_id"], data.area),
        "status": "disponible",
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.tables.insert_one(t)
    return {k: v for k, v in t.items() if k != "_id"}


def _qr_payload(table: dict, nonce: str) -> dict:
    token = sign_table(table["id"], nonce)
    return {
        "token": token,
        "path": f"/checkout?mesa={token}",
        "table_number": table.get("number"),
    }


@router.get("/{table_id}/guest-link")
async def guest_link(table_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    table = await db.tables.find_one(
        {"id": table_id, "restaurant_id": user["restaurant_id"]},
        {"_id": 0, "id": 1, "number": 1, "qr_nonce": 1, "qr_revoked": 1},
    )
    if not table:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    if table.get("qr_revoked"):
        raise HTTPException(status_code=400, detail="El QR está revocado. Regeneralo desde el panel.")
    nonce = table.get("qr_nonce")
    if not nonce:
        nonce = secrets.token_urlsafe(16)
        await db.tables.update_one(
            {"id": table_id, "restaurant_id": user["restaurant_id"]},
            {"$set": {"qr_nonce": nonce, "updated_at": _now()}},
        )
    return _qr_payload(table, nonce)


@router.post("/{table_id}/qr/rotate")
async def rotate_qr(table_id: str, user: dict = Depends(require_roles(["admin"]))):
    table = await db.tables.find_one(
        {"id": table_id, "restaurant_id": user["restaurant_id"]},
        {"_id": 0, "id": 1, "number": 1},
    )
    if not table:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    nonce = secrets.token_urlsafe(16)
    await db.tables.update_one(
        {"id": table_id, "restaurant_id": user["restaurant_id"]},
        {"$set": {"qr_nonce": nonce, "qr_revoked": False, "updated_at": _now()}},
    )
    return _qr_payload(table, nonce)


@router.post("/{table_id}/qr/revoke")
async def revoke_qr(table_id: str, user: dict = Depends(require_roles(["admin"]))):
    res = await db.tables.update_one(
        {"id": table_id, "restaurant_id": user["restaurant_id"]},
        {"$set": {"qr_revoked": True, "updated_at": _now()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    return {"ok": True, "qr_status": "revoked"}


@router.post("/{table_id}/seat")
async def seat_table(table_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    t = await db.tables.find_one({"id": table_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    active = await db.orders.find_one({
        "restaurant_id": user["restaurant_id"],
        "table_id": table_id,
        "status": {"$nin": ["pagado", "cancelado"]},
    })
    if active:
        raise HTTPException(status_code=400, detail="La mesa ya tiene un pedido activo")
    open_attention = await db.orders.find_one({
        "restaurant_id": user["restaurant_id"],
        "table_id": table_id,
        "attention_open": True,
    })
    if open_attention:
        raise HTTPException(status_code=400, detail="Cerrá la atención para tomar la mesa")
    if t.get("status") not in ("disponible", "ocupada", "pagada"):
        raise HTTPException(status_code=400, detail="Esta mesa no se puede tomar")
    await db.tables.update_one(
        {"id": table_id},
        {"$set": {"status": "ocupada", "updated_at": _now()}},
    )
    emit_notice(user["restaurant_id"], "table", table_id=table_id, status="ocupada")
    t = await db.tables.find_one({"id": table_id}, {"_id": 0})
    t["active_order"] = None
    return t


@router.post("/{table_id}/release")
async def release_table(table_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    t = await db.tables.find_one({"id": table_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    active = await db.orders.find_one({
        "restaurant_id": user["restaurant_id"],
        "table_id": table_id,
        "status": {"$nin": ["pagado", "cancelado"]},
    })
    open_attention = await db.orders.find_one({
        "restaurant_id": user["restaurant_id"],
        "table_id": table_id,
        "attention_open": True,
    })
    if open_attention:
        raise HTTPException(status_code=400, detail="Cerrá la atención para liberar la mesa.")
    if active:
        raise HTTPException(status_code=400, detail="Hay un pedido enviado. No se puede liberar como borrador.")
    await db.tables.update_one(
        {"id": table_id},
        {"$set": {"status": "disponible", "updated_at": _now()}},
    )
    emit_notice(user["restaurant_id"], "table", table_id=table_id, status="disponible")
    t = await db.tables.find_one({"id": table_id}, {"_id": 0})
    t["active_order"] = None
    return t


@router.patch("/{table_id}")
async def update_table(table_id: str, data: TableUpdate, user: dict = Depends(require_roles(["admin"]))):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "area" in update:
        update["area"] = await _validate_area(user["restaurant_id"], update["area"])
    update["updated_at"] = _now()
    res = await db.tables.update_one(
        {"id": table_id, "restaurant_id": user["restaurant_id"]},
        {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    t = await db.tables.find_one({"id": table_id}, {"_id": 0})
    return t


@router.delete("/{table_id}")
async def delete_table(table_id: str, user: dict = Depends(require_roles(["admin"]))):
    res = await db.tables.delete_one({"id": table_id, "restaurant_id": user["restaurant_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    return {"ok": True}
