"""Every collection the routes look up by `id` has an `id` index, and startup survives bad data.

`orders` lookups by `{id, restaurant_id}` used to examine every order of the venue
(50,000 documents, about 60 ms, on a synthetic collection); the `id` index makes it
one document. A unique build can fail when the stored data repeats an id, and a
failed index build used to stop the backend, so the build falls back to a plain
index instead and says so in the log.

The fake below keeps documents plus an index catalog that refuses what MongoDB
refuses: a unique build over repeated values (E11000, code 11000), a second index
with the same key but other options (code 85) and a taken name with another key
(code 86).
"""
import ast
import asyncio
import logging
import os
import re
import sys
from pathlib import Path

import pytest
from pymongo.errors import DuplicateKeyError, OperationFailure

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

import database  # noqa: E402

# collection -> the explicit name of its unique `id` index. Written out here, not read
# from the module, so renaming an index of a running system is a visible decision.
UNIQUE_ID_INDEXES = {
    "approvals": "uniq_approval_id",
    "attentions": "uniq_attention_id",
    "branches": "uniq_branch_id",
    "cash_registers": "uniq_cash_register_id",
    "categories": "uniq_category_id",
    "orders": "uniq_order_id",
    "payments": "uniq_payment_id",
    "products": "uniq_product_id",
    "restaurants": "uniq_restaurant_id",
    "table_groups": "uniq_table_group_id",
    "tables": "uniq_table_id",
    "users": "uniq_user_id",
    "zones": "uniq_zone_id",
}
LOOKUP_NAME = "order_id_lookup"


def _pairs(keys):
    return [(keys, 1)] if isinstance(keys, str) else [(field, direction) for field, direction in keys]


def _options(spec):
    return {key: spec[key] for key in ("unique", "sparse", "partial")}


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return [dict(row) for row in self.rows][:length]


class _Collection:
    def __init__(self, name, docs=()):
        self.name = name
        self.docs = [dict(doc) for doc in docs]
        self.catalog = {}
        self.fail_with = None

    def _repeated(self, spec):
        groups = {}
        for doc in self.docs:
            values = tuple(doc.get(field) for field in spec["key"])
            if spec["sparse"] and all(value is None for value in values):
                continue
            groups[values] = groups.get(values, 0) + 1
        return [values for values, count in groups.items() if count > 1]

    async def create_index(self, keys, **options):
        if self.fail_with is not None:
            raise self.fail_with
        pairs = _pairs(keys)
        name = options.get("name") or "_".join(f"{field}_{direction}" for field, direction in pairs)
        spec = {"name": name, "key": dict(pairs), "unique": bool(options.get("unique")),
                "sparse": bool(options.get("sparse")), "partial": options.get("partialFilterExpression")}
        taken = self.catalog.get(name)
        if taken is not None:
            if taken["key"] != spec["key"]:
                raise OperationFailure(f"Index with name: {name} already exists with a different key", code=86)
            if _options(taken) != _options(spec):
                raise OperationFailure(f"Index with name: {name} already exists with different options", code=85)
            return name
        for other in self.catalog.values():
            if other["key"] == spec["key"] and other["partial"] == spec["partial"]:
                raise OperationFailure(f"Index already exists with a different name: {other['name']}", code=85)
        if spec["unique"] and spec["partial"] is None and self._repeated(spec):
            raise DuplicateKeyError(f"E11000 duplicate key error collection: {self.name} index: {name}", 11000)
        self.catalog[name] = spec
        return name

    def list_indexes(self):
        rows = [{"v": 2, "name": "_id_", "key": {"_id": 1}}]
        for spec in self.catalog.values():
            row = {"v": 2, "name": spec["name"], "key": dict(spec["key"])}
            if spec["unique"]:
                row["unique"] = True
            if spec["partial"] is not None:
                row["partialFilterExpression"] = spec["partial"]
            rows.append(row)
        return _Cursor(rows)

    async def drop_index(self, name):
        if self.catalog.pop(name, None) is None:
            raise OperationFailure(f"index not found with name [{name}]", code=27)

    def aggregate(self, pipeline, **kwargs):
        """Just the shapes the id check uses: $group by a field, $match with $gt, $group to one row."""
        rows = [dict(doc) for doc in self.docs]
        for stage in pipeline:
            ((operator, spec),) = stage.items()
            if operator == "$match":
                ((field, condition),) = spec.items()
                rows = [row for row in rows if row.get(field, 0) > condition["$gt"]]
            elif operator == "$group":
                groups = {}
                for row in rows:
                    key = row.get(spec["_id"][1:]) if isinstance(spec["_id"], str) else spec["_id"]
                    group = groups.setdefault(key, {"_id": key})
                    for field, accumulator in spec.items():
                        if field == "_id":
                            continue
                        ((_, argument),) = accumulator.items()
                        amount = 1 if argument == 1 else row.get(argument[1:], 0)
                        group[field] = group.get(field, 0) + amount
                rows = list(groups.values())
            else:
                raise NotImplementedError(operator)
        return _Cursor(rows)


class _FakeDB:
    def __init__(self, **docs):
        self._docs = docs
        self._collections = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._collections.setdefault(name, _Collection(name, self._docs.get(name, ())))


@pytest.fixture
def fake_db(monkeypatch):
    def build(**docs):
        fake = _FakeDB(**docs)
        monkeypatch.setattr(database, "db", fake)
        return fake
    return build


def _start():
    asyncio.run(database.ensure_indexes())


def _catalogs(fake):
    return {f"{collection}.{name}": dict(spec)
            for collection, rows in fake._collections.items() for name, spec in rows.catalog.items()}


def _id_indexes(fake, collection):
    return [spec for spec in getattr(fake, collection).catalog.values() if spec["key"] == {"id": 1}]


def _repeated_ids():
    ids = ["a", "a", "b", "b", "b", "c"]
    return [{"id": value, "restaurant_id": "r1", "n": index} for index, value in enumerate(ids)]


def _messages(caplog, level):
    return [record.getMessage() for record in caplog.records if record.levelno == level]


def test_the_order_lists_the_floor_polls_have_their_filter_indexed(fake_db):
    """`/orders` and `/tables` filter by branch and, with an `$or`, by active status
    or by `attention_state` (see `list_orders`). The `attention_state` branch had no
    index of its own, so that poll's cost grew with the venue's order history — on
    every device, every 8 seconds.
    """
    fake = fake_db()
    _start()

    by_status = fake.orders.catalog.get("orders_by_branch_status")
    assert by_status is not None, "orders has no index for the branch + active status filter"
    assert by_status["key"] == {"restaurant_id": 1, "branch_id": 1, "status": 1, "created_at": -1}

    by_attention = fake.orders.catalog.get("orders_by_branch_attention")
    assert by_attention is not None, "orders has no index for the branch + attention_state filter"
    assert by_attention["key"] == {
        "restaurant_id": 1, "branch_id": 1, "attention_state": 1, "created_at": -1,
    }


def test_every_collection_looked_up_by_id_gets_a_unique_index_with_an_explicit_name(fake_db):
    fake = fake_db()
    _start()

    for collection, name in UNIQUE_ID_INDEXES.items():
        spec = getattr(fake, collection).catalog.get(name)
        assert spec is not None, f"{collection} has no {name}"
        # Plain and on `id` alone, so the planner uses it for any `{id: ...}` lookup.
        assert spec["key"] == {"id": 1} and spec["unique"] is True
        assert spec["partial"] is None and spec["sparse"] is False


def test_ensure_id_indexes_reports_what_it_did_per_collection(fake_db):
    fake_db(orders=_repeated_ids())

    outcome = asyncio.run(database.ensure_id_indexes())

    assert outcome["orders"] == "lookup"
    assert {name for name, result in outcome.items() if result == "unique"} == set(UNIQUE_ID_INDEXES) - {"orders"}


def _literal_id_lookups():
    """Collections the backend queries with a literal `{"id": ...}` filter: db.<name>.<call>({... "id" ...})."""
    methods = {"find_one", "find", "update_one", "update_many", "delete_one", "delete_many",
               "find_one_and_update", "find_one_and_delete", "replace_one", "count_documents"}

    def mentions_id(node):
        if not isinstance(node, ast.Dict):
            return False
        for key, value in zip(node.keys, node.values):
            if isinstance(key, ast.Constant) and key.value == "id":
                return True
            if isinstance(key, ast.Constant) and key.value in ("$and", "$or") and isinstance(value, ast.List):
                if any(mentions_id(item) for item in value.elts):
                    return True
        return False

    found = {}
    for path in sorted(BACKEND.rglob("*.py")):
        if {"venv", ".venv", "site-packages", "__pycache__"} & set(path.parts):
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.args):
                continue
            target = node.func.value
            if (node.func.attr in methods and isinstance(target, ast.Attribute)
                    and isinstance(target.value, ast.Name) and target.value.id == "db" and mentions_id(node.args[0])):
                found.setdefault(target.attr, f"{path.name}:{node.lineno}")
    return found


def test_the_rule_holds_for_the_code_as_written_not_just_for_the_list_above(fake_db):
    """A route that starts looking a new collection up by id must give it an id index."""
    fake = fake_db()
    _start()

    looked_up = _literal_id_lookups()
    assert looked_up, "the scan found nothing: the test is broken"
    unindexed = {name: where for name, where in looked_up.items() if not _id_indexes(fake, name)}
    assert unindexed == {}, f"looked up by id without an id index: {unindexed}"


def test_a_second_start_changes_nothing(fake_db):
    fake = fake_db()
    _start()
    first = _catalogs(fake)

    _start()

    assert _catalogs(fake) == first


def test_repeated_ids_do_not_stop_the_start_and_keep_lookups_indexed(fake_db):
    docs = _repeated_ids()
    fake = fake_db(orders=docs)

    _start()

    orders = fake.orders
    assert "uniq_order_id" not in orders.catalog
    assert orders.catalog[LOOKUP_NAME]["key"] == {"id": 1}
    assert orders.catalog[LOOKUP_NAME]["unique"] is False
    # Nothing is deleted or rewritten to make the index fit.
    assert orders.docs == docs
    # The other collections are not held back by it.
    assert fake.tables.catalog["uniq_table_id"]["unique"] is True
    assert fake.users.catalog["uniq_user_id"]["unique"] is True


def test_repeated_ids_are_logged_as_an_error_naming_the_collection_and_the_count(fake_db, caplog):
    fake_db(orders=_repeated_ids())
    caplog.set_level(logging.INFO, logger="database")

    _start()

    errors = [record for record in caplog.records if record.levelno >= logging.ERROR]
    assert len(errors) == 1
    message = errors[0].getMessage()
    assert message.startswith("orders:")
    # a and b repeat; together they cover five documents (c is alone).
    assert re.search(r"\b2 id values repeated across 5 documents\b", message)
    assert "uniq_order_id" in message and LOOKUP_NAME in message


def test_one_repeated_id_reads_as_singular(fake_db, caplog):
    # Distinct numbers keep the per-branch table-number index out of the way: only the id repeats.
    fake_db(tables=[{"id": "t", "restaurant_id": "r1", "branch_id": "b1", "number": number} for number in (1, 2)])
    caplog.set_level(logging.INFO, logger="database")

    _start()

    (message,) = _messages(caplog, logging.ERROR)
    assert message.startswith("tables:") and "1 id value repeated across 2 documents" in message


def test_a_start_that_finds_the_plain_index_already_there_still_reports_the_repeats(fake_db, caplog):
    fake = fake_db(orders=_repeated_ids())
    _start()
    before = _catalogs(fake)
    caplog.clear()
    caplog.set_level(logging.INFO, logger="database")

    _start()

    assert _catalogs(fake) == before
    (message,) = _messages(caplog, logging.ERROR)
    assert message.startswith("orders:") and "5 documents" in message


def test_once_the_repeats_are_gone_the_operator_is_told_which_index_to_drop(fake_db, caplog):
    fake = fake_db(orders=_repeated_ids())
    _start()
    fake.orders.docs[:] = [{"id": f"o{n}", "restaurant_id": "r1"} for n in range(4)]
    caplog.clear()
    caplog.set_level(logging.INFO, logger="database")

    _start()

    # Still serving: the plain index stays, nothing is dropped behind the operator's back.
    assert LOOKUP_NAME in fake.orders.catalog and "uniq_order_id" not in fake.orders.catalog
    (warning,) = _messages(caplog, logging.WARNING)
    assert LOOKUP_NAME in warning and "drop" in warning.lower()
    assert not _messages(caplog, logging.ERROR)

    # The operator drops it and restarts: uniqueness is enforced.
    asyncio.run(fake.orders.drop_index(LOOKUP_NAME))
    _start()
    assert fake.orders.catalog["uniq_order_id"]["unique"] is True
    assert LOOKUP_NAME not in fake.orders.catalog


def test_a_unique_index_under_another_name_counts_and_is_left_alone(fake_db, caplog):
    fake = fake_db()
    asyncio.run(fake.orders.create_index("id", unique=True, name="orders_by_id"))
    caplog.set_level(logging.INFO, logger="database")

    _start()

    assert [spec["name"] for spec in _id_indexes(fake, "orders")] == ["orders_by_id"]
    assert not [record for record in caplog.records if record.levelno >= logging.WARNING]


def test_a_plain_index_made_by_hand_keeps_serving_and_is_not_replaced(fake_db, caplog):
    fake = fake_db()
    asyncio.run(fake.orders.create_index("id"))
    caplog.set_level(logging.INFO, logger="database")

    _start()

    assert [spec["name"] for spec in _id_indexes(fake, "orders")] == ["id_1"]
    (warning,) = _messages(caplog, logging.WARNING)
    assert warning.startswith("orders:") and "id_1" in warning


def test_the_name_taken_by_a_different_index_is_reported_and_lookups_are_still_indexed(fake_db, caplog):
    fake = fake_db()
    asyncio.run(fake.orders.create_index([("restaurant_id", 1), ("table_id", 1)], name="uniq_order_id"))
    caplog.set_level(logging.INFO, logger="database")

    _start()

    assert fake.orders.catalog["uniq_order_id"]["key"] == {"restaurant_id": 1, "table_id": 1}
    assert fake.orders.catalog[LOOKUP_NAME]["key"] == {"id": 1}
    (warning,) = _messages(caplog, logging.WARNING)
    assert warning.startswith("orders:") and "uniq_order_id" in warning


def test_a_failure_that_is_not_about_the_data_still_stops_the_start(fake_db):
    fake = fake_db()
    fake.orders.fail_with = OperationFailure("not authorized on restaurant_db to execute command", code=13)

    with pytest.raises(OperationFailure):
        _start()


def test_a_plain_driver_error_still_stops_the_start(fake_db):
    fake = fake_db()
    fake.orders.fail_with = ConnectionError("mongo is down")

    with pytest.raises(ConnectionError):
        _start()


def test_the_duplicate_count_failing_cannot_stop_the_start(fake_db, caplog):
    fake = fake_db(orders=_repeated_ids())

    def broken(*args, **kwargs):
        raise OperationFailure("aggregate is not allowed here", code=13)
    fake.orders.aggregate = broken
    caplog.set_level(logging.INFO, logger="database")

    _start()

    assert fake.orders.catalog[LOOKUP_NAME]["key"] == {"id": 1}
    (message,) = _messages(caplog, logging.ERROR)
    assert message.startswith("orders:") and "uniq_order_id" in message


def test_orders_are_indexed_by_attention_for_the_visit_lookups(fake_db):
    """Los pedidos de una visita se buscan por `{restaurant_id, attention_id}` (cocina,
    mesas, caja); sin índice cada búsqueda recorría el historial del local."""
    fake = fake_db()
    _start()

    assert any(spec["key"] == {"restaurant_id": 1, "attention_id": 1} and not spec["unique"]
               for spec in fake.orders.catalog.values()), "orders has no (restaurant_id, attention_id) index"


def test_counters_are_unique_per_tenant_and_key_without_touching_attention_counters(fake_db):
    """Dos upserts concurrentes del primer pedido del día creaban dos contadores y repetían
    el número. El índice es parcial: los contadores de atención usan `_id` y `tenant_id`, sin
    `key`, y no deben entrar."""
    fake = fake_db()
    _start()

    (spec,) = [s for s in fake.counters.catalog.values() if s["key"] == {"restaurant_id": 1, "key": 1}]
    assert spec["unique"] is True
    assert spec["partial"] == {"key": {"$type": "string"}}


def test_a_counters_collection_that_already_repeats_a_key_cannot_stop_the_start(fake_db, caplog):
    fake = fake_db()
    fake.counters.fail_with = DuplicateKeyError("E11000 duplicate key error collection: counters", 11000)
    caplog.set_level(logging.INFO, logger="database")

    _start()

    (message,) = [m for m in _messages(caplog, logging.ERROR) if m.startswith("counters:")]
    assert "restaurant_id" in message or "unique" in message
