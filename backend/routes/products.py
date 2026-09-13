from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import re
import uuid
from database import db
from auth import get_current_user, require_roles
from models import ProductCreate, ProductUpdate, ProductAvailability, ProductsImport
from notify import emit_notice


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


@router.post("/import")
async def import_products(data: ProductsImport, user: dict = Depends(require_roles(["admin"]))):
    created = []
    skipped = []
    categories_created = []
    restaurant_id = user["restaurant_id"]

    for idx, row in enumerate(data.items):
        row_num = idx + 1
        name = (row.name or "").strip()
        if not name:
            skipped.append({"row": row_num, "name": "", "reason": "Nombre vacío"})
            continue
        price = _parse_price(row.price)
        if price is None:
            skipped.append({"row": row_num, "name": name, "reason": "Precio inválido"})
            continue
        category = (row.category or "").strip() or "General"
        prep = _parse_int(row.preparation_time, 15, 1, 240)

        dup = await db.products.find_one({
            "restaurant_id": restaurant_id,
            "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"},
        })
        if dup:
            skipped.append({"row": row_num, "name": name, "reason": "Ya existe un producto con ese nombre"})
            continue

        cat = await db.categories.find_one({
            "restaurant_id": restaurant_id,
            "name": {"$regex": f"^{re.escape(category)}$", "$options": "i"},
        })
        if not cat:
            cat = {
                "id": str(uuid.uuid4()),
                "restaurant_id": restaurant_id,
                "name": category,
                "description": None,
                "sort_order": 0,
                "status": "active",
                "created_at": _now(),
                "updated_at": _now(),
            }
            await db.categories.insert_one(cat)
            categories_created.append(category)

        p = {
            "id": str(uuid.uuid4()),
            "restaurant_id": restaurant_id,
            "category_id": cat["id"],
            "name": name,
            "description": (row.description or "").strip() or None,
            "price": price,
            "image_url": (row.image_url or "").strip() or None,
            "is_available": True,
            "preparation_time": prep,
            "is_combo": False,
            "combo_items": [],
            "code": (row.code or "").strip() or None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.products.insert_one(p)
        created.append({"id": p["id"], "name": name, "category": category, "price": price})

    return {"created": created, "skipped": skipped, "categories_created": categories_created}


def _parse_price(raw):
    s = str(raw or "").strip()
    s = re.sub(r"[^\d,.\-]", "", s)
    if not s or s in (".", ",", "-"):
        return None
    s = s.replace(",", ".")
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v >= 0 else None


def _parse_int(raw, default, low, high):
    s = str(raw or "").strip()
    if not s:
        return default
    try:
        v = int(float(s))
    except ValueError:
        return default
    return max(low, min(high, v))


@router.post("/{product_id}/availability")
async def set_availability(product_id: str, data: ProductAvailability, user: dict = Depends(get_current_user)):
    if not (user.get("role") in ("admin", "cocina") or user.get("can_mark_sold_out")):
        raise HTTPException(status_code=403, detail="No tenés permiso para marcar agotado")
    prod = await db.products.find_one({"id": product_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
    if not prod:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    await db.products.update_one(
        {"id": product_id},
        {"$set": {"is_available": data.is_available, "updated_at": _now()}},
    )
    pending = []
    if not data.is_available:
        orders = await db.orders.find(
            {
                "restaurant_id": user["restaurant_id"],
                "status": {"$nin": ["pagado", "cancelado"]},
                "items.product_id": product_id,
            },
            {"_id": 0, "id": 1, "order_number": 1, "table_id": 1, "status": 1, "items": 1},
        ).to_list(200)
        for o in orders:
            qty = sum(int(it.get("quantity") or 0) for it in (o.get("items") or []) if it.get("product_id") == product_id and it.get("status") != "cancelado")
            if qty:
                pending.append({
                    "id": o["id"],
                    "order_number": o.get("order_number"),
                    "table_id": o.get("table_id"),
                    "status": o.get("status"),
                    "quantity": qty,
                })
    emit_notice(user["restaurant_id"], "product", product_id=product_id, is_available=data.is_available)
    updated = await db.products.find_one({"id": product_id}, {"_id": 0})
    return {"product": updated, "pending_orders": pending}


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
