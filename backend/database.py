import logging
import os
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError, OperationFailure

logger = logging.getLogger(__name__)

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'restaurant_db')]

# Server error codes a startup may meet while indexing, and survive.
_DUPLICATE_KEY = 11000
_INDEX_OPTIONS_CONFLICT = 85
_INDEX_KEY_SPECS_CONFLICT = 86
_INDEX_CONFLICTS = (_INDEX_OPTIONS_CONFLICT, _INDEX_KEY_SPECS_CONFLICT)

# Every collection the routes read or write by its own `id`: (collection, the unique index,
# the plain index used instead while the stored data repeats an id). A collection looked up
# by `{"id": ...}` and missing from this list means every lookup scans it, which grows with
# the venue's history; tests/test_id_indexes.py scans the backend and fails when one is missing.
ID_INDEXES = (
    ("approvals", "uniq_approval_id", "approval_id_lookup"),
    ("attentions", "uniq_attention_id", "attention_id_lookup"),
    ("branches", "uniq_branch_id", "branch_id_lookup"),
    ("cash_registers", "uniq_cash_register_id", "cash_register_id_lookup"),
    ("categories", "uniq_category_id", "category_id_lookup"),
    ("orders", "uniq_order_id", "order_id_lookup"),
    ("payments", "uniq_payment_id", "payment_id_lookup"),
    ("products", "uniq_product_id", "product_id_lookup"),
    ("restaurants", "uniq_restaurant_id", "restaurant_id_lookup"),
    ("table_groups", "uniq_table_group_id", "table_group_id_lookup"),
    ("tables", "uniq_table_id", "table_id_lookup"),
    ("users", "uniq_user_id", "user_id_lookup"),
    ("zones", "uniq_zone_id", "zone_id_lookup"),
)

ID_UNIQUE = "unique"      # the unique index is in place
ID_LOOKUP = "lookup"      # only a plain index: lookups are fast, uniqueness is not enforced
ID_EXISTING = "existing"  # an index on `id` made some other way already serves; left alone


async def _repeated_ids(collection, collection_name: str):
    """`(ids that appear more than once, documents carrying them)`, or None when it cannot be counted.

    The count only explains a problem, so failing to get it must not become another one.
    """
    try:
        rows = await collection.aggregate(
            [
                {"$group": {"_id": "$id", "documents": {"$sum": 1}}},
                {"$match": {"documents": {"$gt": 1}}},
                {"$group": {"_id": None, "ids": {"$sum": 1}, "documents": {"$sum": "$documents"}}},
            ],
            allowDiskUse=True,
            maxTimeMS=30000,
        ).to_list(length=1)
    except Exception as exc:
        logger.warning("%s: could not count the repeated ids (%s)", collection_name, exc)
        return None
    return (rows[0]["ids"], rows[0]["documents"]) if rows else (0, 0)


def _log_repeated_ids(collection_name: str, repeats, unique_name: str, lookup_name: str) -> None:
    if repeats is None:
        what = "some id values are repeated"
    else:
        ids, documents = repeats
        what = f"{ids} id value{'' if ids == 1 else 's'} repeated across {documents} documents"
    logger.error(
        "%s: %s, so the unique index %s cannot be built. Lookups by id use the plain index %s meanwhile "
        "and no data was touched. Remove the duplicates, drop %s and restart to enforce uniqueness.",
        collection_name, what, unique_name, lookup_name, lookup_name,
    )


async def _ensure_lookup_index(collection, collection_name: str, lookup_name: str) -> None:
    try:
        await collection.create_index("id", name=lookup_name)
    except OperationFailure as exc:
        if exc.code not in _INDEX_CONFLICTS:
            raise
        logger.warning("%s: the plain id index %s could not be created (%s)", collection_name, lookup_name, exc)


async def _settle_index_conflict(
    collection, collection_name: str, unique_name: str, lookup_name: str, refusal: OperationFailure
) -> str:
    """The unique build was refused because an index already holds that key or that name."""
    indexes = await collection.list_indexes().to_list(length=None)
    on_id = [index for index in indexes if dict(index.get("key", {})) == {"id": 1}]
    if any(index.get("unique") for index in on_id):
        logger.info("%s: id is already unique through an index made by hand; %s not created", collection_name, unique_name)
        return ID_EXISTING
    plain = next(iter(on_id), None)
    if plain is None:
        # The name is taken by an index on other fields: `id` still needs one of its own.
        logger.warning(
            "%s: the unique id index %s was refused (%s). Lookups by id use the plain index %s. "
            "Rename or drop the index in the way and restart to enforce uniqueness.",
            collection_name, unique_name, refusal, lookup_name,
        )
        await _ensure_lookup_index(collection, collection_name, lookup_name)
        return ID_LOOKUP
    if plain.get("name") != lookup_name:
        logger.warning(
            "%s: %s was not built because the plain index %s on id is already there; lookups use it. "
            "Drop it and restart to enforce uniqueness.",
            collection_name, unique_name, plain.get("name"),
        )
        return ID_EXISTING
    # Our own plain index from an earlier start: it blocks the unique one until it is dropped.
    repeats = await _repeated_ids(collection, collection_name)
    if repeats is None or repeats[0]:
        _log_repeated_ids(collection_name, repeats, unique_name, lookup_name)
    else:
        logger.warning(
            "%s: no id is repeated any more. Drop the plain index %s and restart to build %s.",
            collection_name, lookup_name, unique_name,
        )
    return ID_LOOKUP


async def ensure_id_index(collection, collection_name: str, unique_name: str, lookup_name: str) -> str:
    """Index `collection` on `id`, unique when the data allows it, and never stop the startup for it.

    Stored data that repeats an id makes the unique build fail with a duplicate-key error. That
    would take the backend down, so it logs an ERROR naming the collection and how many ids
    repeat, and creates a plain index on the same key instead: lookups stay indexed, no document
    is deleted or changed, and fixing the data is left to the operator. Indexes that already exist
    (same spec, a unique index under another name, a plain one made by hand) are left alone.
    Anything else the server says is not about the data and still stops the startup.
    """
    try:
        await collection.create_index("id", unique=True, name=unique_name)
        return ID_UNIQUE
    except OperationFailure as exc:
        if isinstance(exc, DuplicateKeyError) or exc.code == _DUPLICATE_KEY:
            repeats = await _repeated_ids(collection, collection_name)
            _log_repeated_ids(collection_name, repeats, unique_name, lookup_name)
            await _ensure_lookup_index(collection, collection_name, lookup_name)
            return ID_LOOKUP
        if exc.code in _INDEX_CONFLICTS:
            return await _settle_index_conflict(collection, collection_name, unique_name, lookup_name, exc)
        raise


async def ensure_id_indexes() -> dict:
    """`ensure_id_index` for every collection in ID_INDEXES; returns what each one ended up with."""
    return {
        collection_name: await ensure_id_index(getattr(db, collection_name), collection_name, unique_name, lookup_name)
        for collection_name, unique_name, lookup_name in ID_INDEXES
    }


async def ensure_indexes():
    await ensure_id_indexes()
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
    # Multi-cuenta: una mesa puede tener varias órdenes activas simultáneas, así
    # que el índice de "una orden activa por mesa" deja de ser único.
    try:
        await db.orders.drop_index("uniq_active_order_per_table")
    except Exception:
        pass
    await db.orders.create_index(
        [("restaurant_id", 1), ("table_id", 1)],
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
        name="active_order_per_table",
    )
    # Los listados que el piso y la caja sondean cada 8 s acotan por sucursal y,
    # con un `$or`, por estado activo o por `attention_state` (ver
    # `routes/orders.py` `list_orders` y `routes/tables.py`). Sin estos dos, la rama
    # de `attention_state` no tenía ningún índice y el costo crecía con el
    # historial de pedidos del local, en cada dispositivo y para siempre. El
    # `created_at` final deja que el orden por fecha se resuelva sobre las filas ya
    # acotadas.
    await db.orders.create_index(
        [("restaurant_id", 1), ("branch_id", 1), ("status", 1), ("created_at", -1)],
        name="orders_by_branch_status",
    )
    await db.orders.create_index(
        [("restaurant_id", 1), ("branch_id", 1), ("attention_state", 1), ("created_at", -1)],
        name="orders_by_branch_attention",
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
    # Una versión anterior de este índice filtraba por el estado legado "abierta".
    # Con ese nombre ya ocupado, Mongo rechaza la definición nueva y el arranque
    # muere, así que se retira antes de recrearlo.
    attention_indexes = await db.attentions.list_indexes().to_list(length=100)
    stale_open_attention = next(
        (
            index for index in attention_indexes
            if index.get("name") == "uniq_open_attention_per_table"
            and (index.get("partialFilterExpression") or {}).get("status")
            != {"$in": ["opening", "open", "closing"]}
        ),
        None,
    )
    if stale_open_attention is not None:
        await db.attentions.drop_index("uniq_open_attention_per_table")
    await db.attentions.create_index(
        [("restaurant_id", 1), ("table_id", 1)], unique=True,
        partialFilterExpression={"status": {"$in": ["opening", "open", "closing"]}},
        name="uniq_open_attention_per_table",
    )
    await db.audit_logs.create_index("event_id", unique=True, sparse=True, name="uniq_audit_event_id")
    await db.audit_logs.create_index([("created_at", -1)])
    await db.table_groups.create_index(
        [("restaurant_id", 1), ("status", 1), ("created_at", -1)],
        name="table_groups_by_tenant_status",
    )
    await db.tables.create_index([("restaurant_id", 1), ("group_id", 1)], sparse=True, name="tables_by_group")
    await db.zones.create_index(
        [("restaurant_id", 1), ("branch_id", 1), ("name", 1)],
        unique=True,
        name="uniq_zone_name_per_branch",
    )
    try:
        await db.zones.drop_index("restaurant_id_1_name_1")
    except Exception:
        pass
    await db.branches.create_index([("restaurant_id", 1), ("name", 1)], name="branches_by_tenant_name")


def strip_id(doc):
    """Remove MongoDB _id field from doc."""
    if doc and "_id" in doc:
        doc = dict(doc)
        doc.pop("_id", None)
    return doc
