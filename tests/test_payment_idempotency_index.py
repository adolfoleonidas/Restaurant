"""La clave de idempotencia de un pago es única por restaurante, no global.

Dos cosas que costaban dinero:

1. El índice era `{idempotency_key: 1}` único para toda la base. La clave la elige
   el cliente, así que dos restaurantes pueden mandar la misma ("retry-1", o el
   patrón propio `prepay-confirm:<id>`). La colisión daba E11000, y como el
   reintento busca "su" pago por `{restaurant_id, idempotency_key}` tampoco lo
   encontraba: la caja se quedaba sin poder cobrar ese pedido.
2. El índice era `sparse`, y un sparse SÍ indexa `null`. El pago guardaba
   `idempotency_key: None` cuando el cliente no mandaba clave, así que el segundo
   pago sin clave chocaba contra el primero (comprobado contra MongoDB 7: el
   segundo insert con `null` falla con E11000; con el campo ausente, no).

El índice pasa a ser parcial por tipo de dato —deja fuera el campo ausente y el
nulo— y la clave se escribe solo cuando existe.

El catálogo falso imita lo que MongoDB rechaza: nombre tomado con otra clave (86),
mismo par clave+parcial con otro nombre (85) y build único sobre valores repetidos
(11000). Los pagos se ejercitan con las fakes compartidas de `test_money_integrity`,
que ya modelan la colección real (incluida la unicidad de la clave).
"""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from pymongo.errors import DuplicateKeyError, OperationFailure

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import database  # noqa: E402
from test_money_integrity import (  # noqa: E402
    RID, _DB, _bind, _cashier, _open_register, _order, _payment_body,
)
from routes.payments import create_payment  # noqa: E402

INDEX_NAME = "uniq_payment_idempotency"
INDEX_KEY = {"restaurant_id": 1, "idempotency_key": 1}
INDEX_PARTIAL = {"idempotency_key": {"$type": "string"}}


def _pairs(keys):
    return [(keys, 1)] if isinstance(keys, str) else [(field, direction) for field, direction in keys]


def _options(spec):
    return {key: spec[key] for key in ("unique", "sparse", "partial")}


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return [dict(row) for row in self.rows][:length]


class _CatalogCollection:
    """Colección cuyo único trabajo es llevar el catálogo de índices."""

    def __init__(self, name, docs=()):
        self.name = name
        self.docs = [dict(doc) for doc in docs]
        self.catalog = {}

    def _covered(self, doc, spec):
        if spec["sparse"] and all(doc.get(field) is None for field in spec["key"]):
            return False
        if spec["partial"] == INDEX_PARTIAL and not isinstance(doc.get("idempotency_key"), str):
            # Un índice parcial solo indexa los documentos que cumplen el filtro:
            # el campo ausente y el nulo se quedan fuera, así que no agrupan.
            return False
        return True

    def _repeated(self, spec):
        groups = {}
        for doc in self.docs:
            if not self._covered(doc, spec):
                continue
            values = tuple(doc.get(field) for field in spec["key"])
            groups[values] = groups.get(values, 0) + 1
        return [values for values, count in groups.items() if count > 1]

    async def create_index(self, keys, **options):
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
        # La unicidad se valida dentro del filtro parcial: `_repeated` ya descarta
        # los documentos que el filtro deja fuera, que es justo lo que hace Mongo.
        if spec["unique"] and self._repeated(spec):
            raise DuplicateKeyError(f"E11000 duplicate key error collection: {self.name} index: {name}", 11000)
        self.catalog[name] = spec
        return name

    def list_indexes(self):
        rows = [{"v": 2, "name": "_id_", "key": {"_id": 1}}]
        for spec in self.catalog.values():
            row = {"v": 2, "name": spec["name"], "key": dict(spec["key"])}
            if spec["unique"]:
                row["unique"] = True
            if spec["sparse"]:
                row["sparse"] = True
            if spec["partial"] is not None:
                row["partialFilterExpression"] = spec["partial"]
            rows.append(row)
        return _Cursor(rows)

    async def drop_index(self, name):
        if self.catalog.pop(name, None) is None:
            raise OperationFailure(f"index not found with name [{name}]", code=27)


class _CatalogDB:
    def __init__(self, **docs):
        self._docs = docs
        self._collections = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._collections.setdefault(name, _CatalogCollection(name, self._docs.get(name, ())))


@pytest.fixture
def indexed_db(monkeypatch):
    """Sustituye la base por una que entiende índices, para poder arrancar."""
    def build(**docs):
        fake = _CatalogDB(**docs)
        monkeypatch.setattr(database, "db", fake)
        return fake
    return build


def _start():
    asyncio.run(database.ensure_indexes())


def _spec(fake):
    return fake.payments.catalog.get(INDEX_NAME)


def test_the_idempotency_index_is_scoped_to_the_restaurant(indexed_db):
    """La clave sola dejaba que el restaurante A bloqueara un cobro del B."""
    fake = indexed_db()
    _start()

    spec = _spec(fake)
    assert spec is not None, "payments lost its idempotency index entirely"
    assert spec["key"] == INDEX_KEY, (
        "the index must be per tenant: a global key lets one restaurant's key "
        "collide with another's and leaves the till unable to charge"
    )
    assert spec["unique"] is True, "without uniqueness the same key charges twice"


def test_the_idempotency_index_ignores_payments_without_a_key(indexed_db):
    """Dos cobros sin clave tienen que poder convivir."""
    fake = indexed_db()
    _start()

    spec = _spec(fake)
    assert spec["sparse"] is False, (
        "a sparse index still indexes `null`, so two keyless payments would collide"
    )
    assert spec["partial"] == INDEX_PARTIAL, (
        "the partial filter is what leaves the absent and the null key out"
    )


def test_startup_replaces_the_global_index_instead_of_dying(indexed_db):
    """Una instalación ya en marcha tiene el índice viejo con el mismo nombre.

    Mongo rechaza ese nombre con otra clave, así que sin retirarlo antes el
    arranque moriría en la primera actualización.
    """
    fake = indexed_db(payments=[{"id": "p1", "restaurant_id": "r1", "idempotency_key": "retry-1"}])
    fake.payments.catalog[INDEX_NAME] = {
        "name": INDEX_NAME, "key": {"idempotency_key": 1},
        "unique": True, "sparse": True, "partial": None,
    }

    _start()

    spec = _spec(fake)
    assert spec is not None, "the index disappeared instead of being replaced"
    assert spec["key"] == INDEX_KEY
    assert spec["partial"] == INDEX_PARTIAL


def test_startup_is_idempotent_over_the_new_index(indexed_db):
    """Arrancar dos veces seguidas no puede romper el arranque."""
    fake = indexed_db()
    _start()
    _start()
    assert _spec(fake)["key"] == INDEX_KEY


def test_the_same_key_in_another_restaurant_does_not_collide(indexed_db):
    """El caso del dinero: A y B mandan "retry-1" y ninguno bloquea al otro."""
    fake = indexed_db(payments=[
        {"id": "a", "restaurant_id": "r1", "idempotency_key": "retry-1"},
        {"id": "b", "restaurant_id": "r2", "idempotency_key": "retry-1"},
    ])
    _start()  # un build único y global habría lanzado E11000 aquí
    assert _spec(fake) is not None


def test_the_same_key_twice_in_one_restaurant_is_still_rejected(indexed_db):
    """La idempotencia propiamente dicha no puede perderse con el cambio."""
    fake = indexed_db(payments=[
        {"id": "a", "restaurant_id": "r1", "idempotency_key": "retry-1"},
        {"id": "b", "restaurant_id": "r1", "idempotency_key": "retry-1"},
    ])
    with pytest.raises(DuplicateKeyError):
        _start()


def test_two_payments_without_a_key_do_not_collide(indexed_db):
    """Sin clave no hay nada que deduplicar: conviven."""
    fake = indexed_db(payments=[
        {"id": "a", "restaurant_id": "r1"},
        {"id": "b", "restaurant_id": "r1"},
    ])
    _start()
    assert _spec(fake) is not None


def test_a_payment_without_a_key_does_not_store_the_field_as_null():
    """Lo que entraba a la base era `null`, no el campo ausente.

    Se comprueba sobre el documento que `create_payment` deja guardado, que es
    donde el `null` nacía: un sparse indexa `null`, así que el segundo cobro sin
    clave chocaba con el primero.
    """
    async def run():
        db = _DB()
        db.orders.docs.append(_order(total=20.0))
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        await create_payment(_payment_body(idempotency_key=None), _cashier())
        return db.payments.docs

    payments = asyncio.run(run())
    assert len(payments) == 1
    assert "idempotency_key" not in payments[0], (
        "a keyless payment must leave the field out: `null` is indexed and "
        "collides with the next keyless payment"
    )


def test_two_keyless_payments_can_be_charged_in_a_row():
    """El bug tal como lo vivía la caja: el segundo cobro sin clave fallaba.

    La cuenta vale 40 y se cobra en dos partes de 20, así que el pedido sigue
    abierto después del primer cobro: es el escenario real de dos cobros sin clave.
    """
    async def run():
        db = _DB()
        db.orders.docs.append(_order(total=40.0, subtotal=40.0))
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        await create_payment(_payment_body(amount=20, received_amount=20, idempotency_key=None), _cashier())
        second = await create_payment(
            _payment_body(amount=20, received_amount=20, idempotency_key=None), _cashier()
        )
        return second, db.payments.docs

    second, payments = asyncio.run(run())
    assert second["amount"] == 20
    assert len(payments) == 2, "the second keyless charge did not reach the ledger"
    assert all("idempotency_key" not in doc for doc in payments)


def test_a_keyed_payment_still_stores_its_key():
    """El otro lado: con clave, la clave viaja y sigue deduplicando."""
    async def run():
        db = _DB()
        db.orders.docs.append(_order(total=40.0, subtotal=40.0))
        db.cash_registers.docs.append(_open_register())
        _bind(db)
        await create_payment(_payment_body(amount=20, received_amount=20, idempotency_key="key-a"), _cashier())
        replay = await create_payment(
            _payment_body(amount=20, received_amount=20, idempotency_key="key-a"), _cashier()
        )
        return replay, db.payments.docs

    replay, payments = asyncio.run(run())
    assert payments[0]["idempotency_key"] == "key-a"
    assert len(payments) == 1, "the retry with the same key charged twice"
    assert replay["amount"] == 20
