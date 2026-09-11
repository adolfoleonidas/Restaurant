from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from database import db
from auth import get_current_user, require_roles
from models import ProductCreate, ProductUpdate


async def get_or_create_combos_category(restaurant_id: str):
    cat = await db.categories.find_one({
        "restaurant_id": restaurant_id,
        "$or": [{"slug": "combos"}, {"name": {"$regex": "^combos$", "$options": "i"}}],
    })
    if cat:
        if not cat.get("slug"):
            await db.categories.update_one({"id": cat["id"]}, {"$set": {"slug": "combos"}})
            cat["slug"] = "combos"
        return cat
    cat = {
        "id": str(uuid.uuid4()),
        "restaurant_id": restaurant_id,
        "name": "Combos",
        "slug": "combos",
        "description": "Menús armados de la casa",
        "sort_order": 0,
        "status": "active",
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.categories.insert_one(cat)
    return cat


async def combo_components_for(prod: dict, restaurant_id: str):
    if not prod.get("is_combo"):
        return []
    comps = []
    for raw in prod.get("combo_items") or []:
        pid = raw.get("product_id")
        qty = int(raw.get("quantity") or 1)
        if not pid or qty < 1:
            continue
        child = await db.products.find_one(
            {"id": pid, "restaurant_id": restaurant_id},
            {"_id": 0, "id": 1, "name": 1, "is_combo": 1},
        )
        if not child or child.get("is_combo"):
            continue
        comps.append({"product_id": child["id"], "product_name": child["name"], "quantity": qty})
    return comps


async def validate_combo_items(restaurant_id: str, is_combo: bool, combo_items):
    if not is_combo:
        return []
    items = combo_items or []
    if len(items) < 1:
        raise HTTPException(status_code=400, detail="Un combo necesita al menos un producto")
    normalized = []
    for raw in items:
        pid = raw.product_id if hasattr(raw, "product_id") else raw.get("product_id")
        qty = int((raw.quantity if hasattr(raw, "quantity") else raw.get("quantity")) or 1)
        child = await db.products.find_one(
            {"id": pid, "restaurant_id": restaurant_id},
            {"_id": 0, "id": 1, "is_combo": 1, "name": 1},
        )
        if not child:
            raise HTTPException(status_code=400, detail="Producto del combo no existe")
        if child.get("is_combo"):
            raise HTTPException(status_code=400, detail="Un combo no puede incluir otro combo")
        normalized.append({"product_id": child["id"], "quantity": max(1, qty)})
    return normalized

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_products(user: dict = Depends(get_current_user)):
    return await db.products.find(
        {"restaurant_id": user["restaurant_id"]},
        {"_id": 0}
    ).sort("name", 1).to_list(1000)


@router.post("")
async def create_product(data: ProductCreate, user: dict = Depends(require_roles(["admin"]))):
    combo_items = await validate_combo_items(user["restaurant_id"], data.is_combo, data.combo_items)
    category_id = data.category_id
    if data.is_combo:
        combos_cat = await get_or_create_combos_category(user["restaurant_id"])
        category_id = combos_cat["id"]
    if data.is_combo and not (data.name or "").strip():
        raise HTTPException(status_code=400, detail="El combo necesita un nombre")
    p = {
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "category_id": category_id,
        "name": data.name,
        "description": data.description,
        "price": data.price,
        "image_url": data.image_url,
        "is_available": data.is_available,
        "preparation_time": data.preparation_time,
        "is_combo": data.is_combo,
        "combo_items": combo_items,
        "code": (data.code or "").strip() or None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.products.insert_one(p)
    return {k: v for k, v in p.items() if k != "_id"}


@router.patch("/{product_id}")
async def update_product(product_id: str, data: ProductUpdate, user: dict = Depends(require_roles(["admin"]))):
    dumped = data.model_dump(exclude_unset=True)
    if "combo_items" in dumped or dumped.get("is_combo"):
        is_combo = dumped.get("is_combo")
        if is_combo is None:
            existing = await db.products.find_one({"id": product_id, "restaurant_id": user["restaurant_id"]})
            is_combo = bool(existing and existing.get("is_combo"))
        dumped["combo_items"] = await validate_combo_items(
            user["restaurant_id"], is_combo, dumped.get("combo_items")
        )
        dumped["is_combo"] = is_combo
        if is_combo:
            combos_cat = await get_or_create_combos_category(user["restaurant_id"])
            dumped["category_id"] = combos_cat["id"]
    if "code" in dumped and isinstance(dumped["code"], str):
        dumped["code"] = dumped["code"].strip() or None
    update = {k: v for k, v in dumped.items() if v is not None}
    update["updated_at"] = _now()
    res = await db.products.update_one(
        {"id": product_id, "restaurant_id": user["restaurant_id"]},
        {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return await db.products.find_one({"id": product_id}, {"_id": 0})


@router.delete("/{product_id}")
async def delete_product(product_id: str, user: dict = Depends(require_roles(["admin"]))):
    res = await db.products.delete_one({"id": product_id, "restaurant_id": user["restaurant_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return {"ok": True}
