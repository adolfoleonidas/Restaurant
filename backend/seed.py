import logging
import os
from datetime import datetime, timezone
import uuid

from database import db
from auth import hash_password
from security_config import resolve_seed_passwords

logger = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _id():
    return str(uuid.uuid4())


def _demo_seed_enabled() -> bool:
    return os.environ.get("SEED_DEMO", "").strip().lower() in {"true", "1", "yes"}


def _empty_payment_config(*, restaurant_id: str, now: str, config_id: str) -> dict:
    """Blank payment identity: only cash on, no demo numbers or QRs."""
    return {
        "id": config_id,
        "restaurant_id": restaurant_id,
        "yape_number": "",
        "yape_holder": "",
        "yape_qr": None,
        "plin_number": "",
        "plin_holder": "",
        "plin_qr": None,
        "bank_name": "",
        "bank_account": "",
        "bank_cci": "",
        "bank_holder": "",
        "transfer_instructions": "",
        "enable_efectivo": True,
        "enable_yape": False,
        "enable_plin": False,
        "enable_transferencia": False,
        "enable_tarjeta": False,
        "created_at": now,
        "updated_at": now,
    }


async def _ensure_new_fields():
    """Fill missing operational fields. Never restore demo identity."""
    rest = await db.restaurants.find_one({})
    if not rest:
        return
    rid = rest["id"]
    updates = {}
    if "delivery_fee" not in rest:
        updates["delivery_fee"] = 0
    if updates:
        updates["updated_at"] = _now()
        await db.restaurants.update_one({"id": rid}, {"$set": updates})

    if await db.products.find_one({"restaurant_id": rid, "is_combo": True}, {"id": 1}):
        from routes.products import get_or_create_combos_category
        combos_cat = await get_or_create_combos_category(rid)
        await db.products.update_many(
            {"restaurant_id": rid, "is_combo": True},
            {"$set": {"category_id": combos_cat["id"]}},
        )

    if not await db.payment_configs.find_one({"restaurant_id": rid}):
        now = _now()
        await db.payment_configs.insert_one(_empty_payment_config(restaurant_id=rid, now=now, config_id=_id()))

    zones = await db.zones.find({"restaurant_id": rid}).to_list(1000)
    if not zones:
        areas = [t.get("area") for t in await db.tables.find(
            {"restaurant_id": rid, "area": {"$ne": None}}, {"area": 1}
        ).to_list(1000)]
        seen = []
        for a in areas:
            if a and a not in seen:
                seen.append(a)
        now = _now()
        for i, name in enumerate(seen):
            await db.zones.insert_one({
                "id": _id(),
                "restaurant_id": rid,
                "name": name,
                "sort_order": i,
                "created_at": now,
                "updated_at": now,
            })


async def _seed_blank():
    """First boot without demo data: one empty house and the operator's admin."""
    resolved = resolve_seed_passwords()
    if not os.environ.get("SEED_ADMIN_PASSWORD"):
        logger.warning("Seed de desarrollo con contraseñas de demo. No uses este modo en un deploy real.")
    restaurant_id = _id()
    now = _now()
    await db.restaurants.insert_one({
        "id": restaurant_id,
        "name": "Restaurante",
        "ruc": "",
        "address": "",
        "phone": "",
        "logo_url": None,
        "cover_url": None,
        "currency": "PEN",
        "currency_symbol": "S/",
        "timezone": "America/Lima",
        "opening_hours": "",
        "delivery_fee": 0,
        "public_description": "",
        "social_facebook": None,
        "social_instagram": None,
        "social_whatsapp": None,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    })
    await db.payment_configs.insert_one(_empty_payment_config(restaurant_id=restaurant_id, now=now, config_id=_id()))
    await db.users.insert_one({
        "id": _id(),
        "restaurant_id": restaurant_id,
        "email": "admin@resto.com",
        "password_hash": hash_password(resolved["SEED_ADMIN_PASSWORD"]),
        "full_name": "Administrador",
        "role": "admin",
        "phone": None,
        "status": "active",
        "can_discount": True,
        "can_void": True,
        "created_at": now,
        "updated_at": now,
    })
    logger.info("Seed completed: blank restaurant and admin")


async def run_seed():
    # Always ensure new fields/payment_config exist for existing data
    await _ensure_new_fields()
    # Skip first-time seed if already seeded
    existing = await db.restaurants.find_one({})
    if existing:
        return
    if not _demo_seed_enabled():
        await _seed_blank()
        return

    resolved = resolve_seed_passwords()
    logger.info("Seeding initial data...")
    restaurant_id = _id()
    restaurant = {
        "id": restaurant_id,
        "name": "Sabor Peruano",
        "ruc": "20123456789",
        "address": "Av. Larco 123, Miraflores, Lima",
        "phone": "+51 999 888 777",
        "logo_url": None,
        "cover_url": "https://images.pexels.com/photos/14590691/pexels-photo-14590691.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=900&w=1600",
        "currency": "PEN",
        "currency_symbol": "S/",
        "timezone": "America/Lima",
        "opening_hours": "L-D 11:00 - 23:00",
        "delivery_fee": 5.0,
        "public_description": "Cocina peruana de autor con productos frescos. Pide para recoger, delivery o disfruta en el local.",
        "social_facebook": None,
        "social_instagram": "@saborperuano",
        "social_whatsapp": "+51999888777",
        "status": "active",
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.restaurants.insert_one(restaurant)

    # Default branch: staff and tables are branch-bound, so a first run without
    # one would answer 403 to every non-admin call.
    branch_id = _id()
    await db.branches.insert_one({
        "id": branch_id,
        "restaurant_id": restaurant_id,
        "name": "Sucursal principal",
        "timezone": restaurant["timezone"],
        "business_day_cutoff": "04:00",
        "pickup_enabled": True,
        "created_at": _now(),
        "updated_at": _now(),
    })

    # Default payment config (no QR uploaded yet; admin completes from UI)
    await db.payment_configs.insert_one({
        "id": _id(),
        "restaurant_id": restaurant_id,
        "yape_number": "999 888 777",
        "yape_holder": "Sabor Peruano S.A.C.",
        "yape_qr": None,
        "plin_number": "999 888 777",
        "plin_holder": "Sabor Peruano S.A.C.",
        "plin_qr": None,
        "bank_name": "BCP",
        "bank_account": "194-12345678-0-12",
        "bank_cci": "00219400123456780123",
        "bank_holder": "Sabor Peruano S.A.C.",
        "transfer_instructions": "Envía tu comprobante por WhatsApp al +51 999 888 777 indicando tu nº de pedido.",
        "enable_efectivo": True,
        "enable_yape": True,
        "enable_plin": True,
        "enable_transferencia": True,
        "enable_tarjeta": False,
        "created_at": _now(),
        "updated_at": _now(),
    })

    seed_passwords = {
        "admin": resolved["SEED_ADMIN_PASSWORD"],
        "cajero": resolved["SEED_CAJERO_PASSWORD"],
        "mozo": resolved["SEED_MOZO_PASSWORD"],
        "cocina": resolved["SEED_COCINA_PASSWORD"],
    }
    if any(not os.environ.get(key) for key in resolved):
        logger.warning("Seed de desarrollo con contraseñas de demo. No uses este modo en un deploy real.")
    users = [
        {"email": "admin@resto.com", "password": seed_passwords["admin"], "full_name": "Carlos Administrador", "role": "admin"},
        {"email": "cajero@resto.com", "password": seed_passwords["cajero"], "full_name": "María Cajera", "role": "cajero"},
        {"email": "mozo@resto.com", "password": seed_passwords["mozo"], "full_name": "Juan Mozo", "role": "mozo"},
        {"email": "cocina@resto.com", "password": seed_passwords["cocina"], "full_name": "Pedro Cocinero", "role": "cocina"},
    ]
    for u in users:
        await db.users.insert_one({
            "id": _id(),
            "restaurant_id": restaurant_id,
            "email": u["email"],
            "password_hash": hash_password(u["password"]),
            "full_name": u["full_name"],
            "role": u["role"],
            "phone": None,
            **({} if u["role"] == "admin" else {"branch_id": branch_id}),
            "status": "active",
            "can_discount": u["role"] == "admin",
            "can_void": u["role"] == "admin",
            "created_at": _now(),
            "updated_at": _now(),
        })

    # Categories
    cat_specs = [
        ("Entradas", "Para comenzar", 1),
        ("Platos principales", "Especialidad de la casa", 2),
        ("Bebidas", "Refrescantes y calientes", 3),
        ("Postres", "Para cerrar con dulzura", 4),
        ("Promociones", "Ofertas del día", 5),
    ]
    cat_ids = {}
    for name, desc, sort_order in cat_specs:
        cid = _id()
        cat_ids[name] = cid
        await db.categories.insert_one({
            "id": cid,
            "restaurant_id": restaurant_id,
            "name": name,
            "description": desc,
            "sort_order": sort_order,
            "status": "active",
            "created_at": _now(),
            "updated_at": _now(),
        })

    # Products
    products = [
        ("Entradas", "Causa Limeña", "Puré de papa amarilla con pollo y ají", 18.0, 10, "https://images.pexels.com/photos/26586571/pexels-photo-26586571.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=400&w=600"),
        ("Entradas", "Anticuchos", "Brochetas de corazón con ají panca", 22.0, 15, None),
        ("Entradas", "Papa Rellena", "Rellena de carne y huevo", 14.0, 10, None),
        ("Platos principales", "Ceviche Clásico", "Pescado fresco, limón, cebolla, ají", 38.0, 12, "https://images.pexels.com/photos/29188618/pexels-photo-29188618.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=400&w=600"),
        ("Platos principales", "Lomo Saltado", "Lomo de res salteado con papas", 35.0, 18, None),
        ("Platos principales", "Ají de Gallina", "Clásico cremoso con ají amarillo", 28.0, 20, None),
        ("Platos principales", "Arroz Chaufa", "Arroz frito estilo chifa", 24.0, 15, None),
        ("Bebidas", "Chicha Morada", "Bebida tradicional de maíz", 8.0, 2, None),
        ("Bebidas", "Inca Kola", "Gaseosa nacional 500ml", 6.0, 1, None),
        ("Bebidas", "Pisco Sour", "Coctel bandera del Perú", 22.0, 5, None),
        ("Bebidas", "Agua Mineral", "Sin gas / con gas", 5.0, 1, None),
        ("Postres", "Suspiro Limeño", "Crema de leche y merengue", 14.0, 5, None),
        ("Postres", "Mazamorra Morada", "Postre clásico de maíz morado", 10.0, 5, None),
        ("Promociones", "Combo Familiar", "Ceviche + Lomo + 2 Chichas", 75.0, 25, None),
    ]
    for cat_name, name, desc, price, prep, img in products:
        await db.products.insert_one({
            "id": _id(),
            "restaurant_id": restaurant_id,
            "category_id": cat_ids[cat_name],
            "name": name,
            "description": desc,
            "price": price,
            "image_url": img,
            "is_available": True,
            "preparation_time": prep,
            "created_at": _now(),
            "updated_at": _now(),
        })

    # Zones
    zone_specs = ["Salón", "Terraza", "Segundo piso"]
    for i, name in enumerate(zone_specs):
        await db.zones.insert_one({
            "id": _id(),
            "restaurant_id": restaurant_id,
            "branch_id": branch_id,
            "name": name,
            "sort_order": i,
            "created_at": _now(),
            "updated_at": _now(),
        })

    # Tables
    table_specs = [
        (1, "Salón", 4), (2, "Salón", 4), (3, "Salón", 2), (4, "Salón", 6),
        (5, "Salón", 4), (6, "Salón", 4), (7, "Terraza", 2), (8, "Terraza", 4),
        (9, "Terraza", 4), (10, "Terraza", 6), (11, "Segundo piso", 8), (12, "Segundo piso", 4),
    ]
    for num, area, cap in table_specs:
        await db.tables.insert_one({
            "id": _id(),
            "restaurant_id": restaurant_id,
            "number": num,
            "name": f"Mesa {num}",
            "capacity": cap,
            "area": area,
            "branch_id": branch_id,
            "status": "disponible",
            "created_at": _now(),
            "updated_at": _now(),
        })

    logger.info("Seed completed: 1 restaurant, 1 branch, 4 users, 5 categories, 14 products, 3 zones, 12 tables")
