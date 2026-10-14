"""Endpoints de «Gestionar menú» (menú del día).

La lógica de decisión vive en `menu_day.py`; aquí sólo se lee y se escribe el
documento del día. Todo es admin: cambiar lo que se vende hoy es una decisión del
dueño o del encargado, no de cualquiera que tenga el móvil en la mano.
"""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import require_roles
from database import db
from menu_day import (
    COLLECTION,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    day_menu,
    index_items,
    resolve,
    service_date,
)
from notify import emit_notice

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


class DayItem(BaseModel):
    product_id: str
    # Sin precio, el plato se ofrece al del catálogo. Con precio, manda ese y solo
    # para este día: la plantilla no se lo lleva, para que un precio viejo no se
    # arrastre en silencio.
    price: Optional[float] = None


class DaySave(BaseModel):
    date: Optional[str] = None
    items: List[DayItem] = Field(default_factory=list)
    # Publicar es explícito: guardar no cambia lo que ve el cliente.
    publish: bool = False


class SoldOutToggle(BaseModel):
    date: Optional[str] = None
    product_id: str
    sold_out: bool = True


class CopyFrom(BaseModel):
    date: Optional[str] = None
    from_date: str


def _valid_date(value: str | None) -> str:
    date = (value or "").strip() or service_date()
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="La fecha debe ser YYYY-MM-DD")
    return date


def _day_payload(restaurant_id: str, date: str, day: Optional[dict]) -> dict:
    """El día tal como lo necesita la pantalla: la selección y el catálogo con su
    estado efectivo, resuelto por la misma función que usan los pedidos."""
    items = index_items(day)
    return {
        "date": date,
        "status": (day or {}).get("status", STATUS_DRAFT),
        "published": bool(day) and day.get("status") == STATUS_PUBLISHED,
        "selection": [
            {"product_id": item["product_id"], "price": item.get("price"), "sold_out": bool(item.get("sold_out"))}
            for item in (day or {}).get("items") or []
        ],
        "has_menu": bool(day),
    }


async def _load_day(restaurant_id: str, date: str) -> Optional[dict]:
    return await day_menu(db, restaurant_id, date, published_only=False)


@router.get("/day")
async def read_day(date: Optional[str] = Query(None), user: dict = Depends(require_roles(["admin"]))):
    """El menú de esa fecha (borrador o publicado) y el catálogo con su estado."""
    restaurant_id = user["restaurant_id"]
    fecha = _valid_date(date)
    day = await _load_day(restaurant_id, fecha)
    published = await day_menu(db, restaurant_id, fecha)  # solo el publicado

    products = await db.products.find({"restaurant_id": restaurant_id}, {"_id": 0}).sort("name", 1).to_list(1000)
    items = index_items(published)
    catalog = []
    for prod in products:
        decision = resolve(prod, items, published is not None, strict=False)
        catalog.append({
            "product_id": prod["id"],
            "name": prod.get("name"),
            "category_id": prod.get("category_id"),
            "base_price": float(prod.get("price") or 0),
            "is_fixed": bool(prod.get("is_fixed", False)),
            "offered_today": decision.offered,
            "today_price": decision.price,
            "sold_out": decision.reason == "agotado",
        })

    payload = _day_payload(restaurant_id, fecha, day)
    payload["catalog"] = catalog
    return payload


@router.put("/day")
async def save_day(data: DaySave, user: dict = Depends(require_roles(["admin"]))):
    """Guarda el día. Sin `publish`, queda en borrador y **no cambia la carta**."""
    restaurant_id = user["restaurant_id"]
    fecha = _valid_date(data.date)

    known = {p["id"] for p in await db.products.find({"restaurant_id": restaurant_id}, {"_id": 0, "id": 1}).to_list(1000)}
    items = []
    for row in data.items:
        if row.product_id not in known:
            raise HTTPException(status_code=400, detail=f"Producto {row.product_id} no existe")
        if row.price is not None and row.price < 0:
            raise HTTPException(status_code=400, detail="El precio no puede ser negativo")
        items.append({"product_id": row.product_id, "price": row.price, "sold_out": False})

    status = STATUS_PUBLISHED if data.publish else STATUS_DRAFT
    now = _now()
    await db[COLLECTION].update_one(
        {"restaurant_id": restaurant_id, "date": fecha},
        {
            "$set": {"items": items, "status": status, "updated_at": now, **({"published_at": now} if data.publish else {})},
            "$setOnInsert": {"id": str(uuid.uuid4()), "restaurant_id": restaurant_id, "date": fecha, "created_at": now},
        },
        upsert=True,
    )
    # Avisa a los dispositivos: la carta cambia cuando se publica, no al guardar.
    emit_notice(restaurant_id, "menu", date=fecha, published=data.publish)
    return _day_payload(restaurant_id, fecha, await _load_day(restaurant_id, fecha))


@router.post("/day/sold-out")
async def toggle_sold_out(data: SoldOutToggle, user: dict = Depends(require_roles(["admin", "cocina"]))):
    """Agotar es inmediato: no espera a publicar nada.

    Si hoy no hay menú del día, se marca en el catálogo —que es lo que ya hacía la
    pantalla de «Agotar o habilitar»— para no inventar un menú vacío que dejaría la
    carta en blanco.
    """
    restaurant_id = user["restaurant_id"]
    fecha = _valid_date(data.date)
    day = await _load_day(restaurant_id, fecha)

    if not day:
        result = await db.products.update_one(
            {"id": data.product_id, "restaurant_id": restaurant_id},
            {"$set": {"is_available": not data.sold_out, "updated_at": _now()}},
        )
        if result.matched_count != 1:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        emit_notice(restaurant_id, "product", product_id=data.product_id, is_available=not data.sold_out, change="availability")
        return {"ok": True, "scope": "catalog", "sold_out": data.sold_out}

    items = index_items(day)
    if data.product_id not in items:
        raise HTTPException(status_code=400, detail="Ese plato no está en el menú de hoy")
    result = await db[COLLECTION].update_one(
        {"restaurant_id": restaurant_id, "date": fecha, "items.product_id": data.product_id},
        {"$set": {"items.$.sold_out": data.sold_out, "updated_at": _now()}},
    )
    if result.matched_count != 1:
        raise HTTPException(status_code=409, detail="El menú cambió; vuelve a cargarlo")
    emit_notice(restaurant_id, "menu", date=fecha, published=True)
    return {"ok": True, "scope": "day", "sold_out": data.sold_out}


@router.post("/day/copy-from")
async def copy_from(data: CopyFrom, user: dict = Depends(require_roles(["admin"]))):
    """Trae la selección de otro día: los platos, no el estado ni el precio."""
    restaurant_id = user["restaurant_id"]
    fecha = _valid_date(data.date)
    origen = _valid_date(data.from_date)
    if origen == fecha:
        raise HTTPException(status_code=400, detail="El día de origen y el de destino son el mismo")

    source = await _load_day(restaurant_id, origen)
    if not source or not (source.get("items") or []):
        raise HTTPException(status_code=404, detail=f"El {origen} no tiene menú que copiar")

    copiados = [{"product_id": item["product_id"], "price": None, "sold_out": False} for item in source["items"]]
    now = _now()
    await db[COLLECTION].update_one(
        {"restaurant_id": restaurant_id, "date": fecha},
        {
            "$set": {"items": copiados, "status": STATUS_DRAFT, "updated_at": now},
            "$setOnInsert": {"id": str(uuid.uuid4()), "restaurant_id": restaurant_id, "date": fecha, "created_at": now},
        },
        upsert=True,
    )
    payload = _day_payload(restaurant_id, fecha, await _load_day(restaurant_id, fecha))
    payload["copied_from"] = origen
    payload["copied"] = len(copiados)
    return payload
