import os
from motor.motor_asyncio import AsyncIOMotorClient

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'restaurant_db')]


async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    # Table numbers and zone names are unique per branch, not per restaurant:
    # two salons each need their own "Mesa 1" and "Salón". The old per-restaurant
    # unique indexes are dropped so an existing venue can keep operating.
    await db.tables.create_index(
        [("restaurant_id", 1), ("branch_id", 1), ("number", 1)],
        unique=True,
        name="uniq_table_number_per_branch",
    )
    try:
        await db.tables.drop_index("restaurant_id_1_number_1")
    except Exception:
        pass
    await db.orders.create_index([("restaurant_id", 1), ("status", 1), ("created_at", -1)])
    await db.orders.create_index("tracking_code", sparse=True)
    await db.orders.create_index(
        [("restaurant_id", 1), ("request_id", 1)],
        unique=True,
        partialFilterExpression={"request_id": {"$type": "string"}},
        name="uniq_public_order_request",
    )
    await db.orders.create_index(
        [("restaurant_id", 1), ("table_id", 1)],
        unique=True,
        partialFilterExpression={
            "table_id": {"$type": "string"},
            "status": {
                "$in": [
                    "nuevo",
                    "enviado_cocina",
                    "en_preparacion",
                    "listo",
                    "entregado",
                    "pendiente_pago",
                ]
            },
        },
        name="uniq_active_order_per_table",
    )
    await db.payment_configs.create_index("restaurant_id", unique=True)
    await db.products.create_index([("restaurant_id", 1), ("category_id", 1)])
    await db.payments.create_index([("restaurant_id", 1), ("created_at", -1)])
    try:
        await db.payments.drop_index("uniq_payment_per_order")
    except Exception:
        pass
    await db.payments.create_index("order_id")
    await db.payments.create_index([("cash_register_id", 1), ("created_at", -1)])
    await db.payments.create_index(
        "idempotency_key",
        unique=True,
        sparse=True,
        name="uniq_payment_idempotency",
    )
    await db.cash_registers.create_index([("restaurant_id", 1), ("status", 1), ("opened_at", -1)])
    cash_indexes = await db.cash_registers.list_indexes().to_list(length=100)
    legacy_tenant_open_index = any(
        index.get("unique")
        and list(dict(index.get("key", {})).items()) == [("restaurant_id", 1)]
        and (index.get("partialFilterExpression") or {}).get("status") == "open"
        and "branch_id" not in (index.get("partialFilterExpression") or {})
        for index in cash_indexes
    )
    if not legacy_tenant_open_index:
        await db.cash_registers.create_index(
            [("restaurant_id", 1), ("branch_id", 1)],
            unique=True,
            partialFilterExpression={"status": "open", "branch_id": {"$type": "string"}},
            name="uniq_open_cash_register_by_branch",
        )
        await db.cash_registers.create_index(
            [("restaurant_id", 1)],
            unique=True,
            partialFilterExpression={"status": "open", "branch_id": None},
            name="uniq_open_legacy_cash_register",
        )
    await db.attentions.create_index("id", unique=True, name="uniq_attention_id")
    await db.attentions.create_index(
        [("restaurant_id", 1), ("table_id", 1)], unique=True,
        partialFilterExpression={"status": {"$in": ["opening", "open", "closing"]}},
        name="uniq_open_attention_per_table",
    )
    await db.audit_logs.create_index("event_id", unique=True, sparse=True, name="uniq_audit_event_id")
    await db.audit_logs.create_index([("created_at", -1)])
    await db.zones.create_index(
        [("restaurant_id", 1), ("branch_id", 1), ("name", 1)],
        unique=True,
        name="uniq_zone_name_per_branch",
    )
    try:
        await db.zones.drop_index("restaurant_id_1_name_1")
    except Exception:
        pass
    await db.branches.create_index("id", unique=True, name="uniq_branch_id")
    await db.branches.create_index([("restaurant_id", 1), ("name", 1)], name="branches_by_tenant_name")


def strip_id(doc):
    """Remove MongoDB _id field from doc."""
    if doc and "_id" in doc:
        doc = dict(doc)
        doc.pop("_id", None)
    return doc
