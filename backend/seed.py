import logging
from datetime import datetime, timezone
import uuid

from database import db
from auth import hash_password

logger = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _id():
    return str(uuid.uuid4())


async def _ensure_new_fields():
    """Idempotent updates for new schema fields added in Phase 3."""
    rest = await db.restaurants.find_one({})
    if rest:
        rid = rest["id"]
        updates = {}
        if "delivery_fee" not in rest:
            updates["delivery_fee"] = 5.0
        if "cover_url" not in rest or not rest.get("cover_url"):
            updates["cover_url"] = "https://images.pexels.com/photos/14590691/pexels-photo-14590691.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=900&w=1600"
        if "public_description" not in rest:
            updates["public_description"] = "Cocina peruana de autor con productos frescos. Pide para recoger, delivery o disfruta en el local."
        if "social_instagram" not in rest:
            updates["social_instagram"] = "@saborperuano"
        if "social_whatsapp" not in rest:
            updates["social_whatsapp"] = "+51999888777"
        if updates:
            updates["updated_at"] = _now()
            await db.restaurants.update_one({"id": rid}, {"$set": updates})

        from routes.products import get_or_create_combos_category
        combos_cat = await get_or_create_combos_category(rid)
        await db.products.update_many(
            {"restaurant_id": rid, "is_combo": True},
            {"$set": {"category_id": combos_cat["id"]}},
        )

        cfg = await db.payment_configs.find_one({"restaurant_id": rid})
        if not cfg:
            await db.payment_configs.insert_one({
                "id": _id(),
                "restaurant_id": rid,
                "yape_number": "999 888 777",
                "yape_holder": rest.get("name", "Restaurante"),
                "yape_qr": None,
                "plin_number": "999 888 777",
                "plin_holder": rest.get("name", "Restaurante"),
                "plin_qr": None,
                "bank_name": "BCP",
                "bank_account": "194-12345678-0-12",
                "bank_cci": "00219400123456780123",
                "bank_holder": rest.get("name", "Restaurante"),
                "transfer_instructions": "Envía tu comprobante por WhatsApp indicando tu nº de pedido.",
                "enable_efectivo": True,
                "enable_yape": True,
                "enable_plin": True,
                "enable_transferencia": True,
                "enable_tarjeta": False,
                "created_at": _now(),
                "updated_at": _now(),
            })


async def run_seed():
    # Always ensure new fields/payment_config exist for existing data
    await _ensure_new_fields()
    # Skip first-time seed if already seeded
    existing = await db.restaurants.find_one({})
    if existing:
        return

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

    # Users
    users = [
        {"email": "admin@resto.com", "password": "admin123", "full_name": "Carlos Administrador", "role": "admin"},
        {"email": "cajero@resto.com", "password": "cajero123", "full_name": "María Cajera", "role": "cajero"},
        {"email": "mozo@resto.com", "password": "mozo123", "full_name": "Juan Mozo", "role": "mozo"},
        {"email": "cocina@resto.com", "password": "cocina123", "full_name": "Pedro Cocinero", "role": "cocina"},
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
            "status": "active",
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
            "status": "disponible",
            "created_at": _now(),
            "updated_at": _now(),
        })

    logger.info("Seed completed: 1 restaurant, 4 users, 5 categories, 14 products, 12 tables")
