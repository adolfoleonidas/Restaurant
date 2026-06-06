import os
from motor.motor_asyncio import AsyncIOMotorClient

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'restaurant_db')]


async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.tables.create_index([("restaurant_id", 1), ("number", 1)], unique=True)
    await db.orders.create_index([("restaurant_id", 1), ("status", 1), ("created_at", -1)])
    await db.orders.create_index("tracking_code", sparse=True)
    await db.payment_configs.create_index("restaurant_id", unique=True)
    await db.products.create_index([("restaurant_id", 1), ("category_id", 1)])
    await db.payments.create_index([("restaurant_id", 1), ("created_at", -1)])
    await db.cash_registers.create_index([("restaurant_id", 1), ("status", 1), ("opened_at", -1)])
    await db.audit_logs.create_index([("created_at", -1)])


def strip_id(doc):
    """Remove MongoDB _id field from doc."""
    if doc and "_id" in doc:
        doc = dict(doc)
        doc.pop("_id", None)
    return doc
