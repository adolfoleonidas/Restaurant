"""Fase 1 / T9: cuatro medios del backend.

  1. `quantity` no tenía tope: un cliente podía pedir 10^9 unidades de un plato.
  2. Los listados de pedidos enviaban el comprobante base64 (hasta ~2.4 MB por
     pedido) en cada sondeo; la imagen se pide por id, las listas solo dicen
     `has_proof`. Y los `limit` sin tope dejaban pedir listas enormes.
  3. Los dos asignadores de número de pedido hacen un upsert sobre `counters`; con
     el índice único, el primer pedido del día concurrente puede perder la carrera
     (DuplicateKeyError) y debe reintentar una vez en lugar de devolver un 500.
  (4. El reset por `tenant_id` vive en test_data_reset.py; los índices, en test_id_indexes.py.)
"""
import asyncio
import copy
import os
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "restaurant_db_unit")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-for-the-fase1-mediums-tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import routes.cash as cash_routes  # noqa: E402
import routes.orders as order_routes  # noqa: E402
import routes.payments as payment_routes  # noqa: E402
import routes.public as public_routes  # noqa: E402
from models import DraftLineUpsert, OrderItemInput, OrderItemUpdate, PublicItemUpdate  # noqa: E402

RID = "tenant-1"
PROOF = "data:image/png;base64," + "A" * 4096


# ---------- 1. tope de cantidad ----------

@pytest.mark.parametrize("build", [
    lambda q: OrderItemInput(product_id="p1", quantity=q),
    lambda q: PublicItemUpdate(quantity=q),
    lambda q: OrderItemUpdate(quantity=q),
    lambda q: DraftLineUpsert(client_line_id="line-1", product_id="p1", quantity=q),
], ids=["OrderItemInput", "PublicItemUpdate", "OrderItemUpdate", "DraftLineUpsert"])
def test_client_supplied_quantity_is_capped_at_99(build):
    assert build(99).quantity == 99
    for too_many in (100, 1_000_000_000):
        with pytest.raises(ValidationError):
            build(too_many)


# ---------- 2. el comprobante no viaja en las listas ----------

def _matches(row, query):
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, part) for part in expected):
                return False
        elif key == "$or":
            if not any(_matches(row, part) for part in expected):
                return False
        elif isinstance(expected, dict):
            if "$in" in expected and row.get(key) not in expected["$in"]:
                return False
            if "$nin" in expected and row.get(key) in expected["$nin"]:
                return False
            if "$type" in expected and (expected["$type"] != "string" or not isinstance(row.get(key), str)):
                return False
        elif row.get(key) != expected:
            return False
    return True


def _project(row, projection):
    row = copy.deepcopy(row)
    include = {k for k, v in (projection or {}).items() if v and k != "_id"}
    if include:
        return {k: v for k, v in row.items() if k in include}
    return {k: v for k, v in row.items() if (projection or {}).get(k, 1)}


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_):
        return self

    def limit(self, *_):
        return self

    async def to_list(self, length=None):
        return self.rows[:length] if length else self.rows


class _Orders:
    def __init__(self, rows):
        self.rows = rows
        self.finds = []

    def find(self, query, projection=None):
        self.finds.append((copy.deepcopy(query), copy.deepcopy(projection)))
        return _Cursor([_project(r, projection) for r in self.rows if _matches(r, query)])

    async def find_one(self, query, projection=None):
        row = next((r for r in self.rows if _matches(r, query)), None)
        return _project(row, projection) if row is not None else None


class _Empty:
    def find(self, *_a, **_k):
        return _Cursor([])

    async def find_one(self, *_a, **_k):
        return None


class _DB:
    def __init__(self, orders):
        self.orders = _Orders(orders)
        self.branches = _Orders([{"id": "branch-a", "restaurant_id": RID}])
        self.tables = _Empty()
        self.users = _Empty()
        self.payments = _Orders([])


def _order(order_id, **extra):
    row = {"id": order_id, "restaurant_id": RID, "branch_id": "branch-a", "status": "nuevo",
           "created_at": order_id, "total": 10.0, "items": []}
    row.update(extra)
    return row


def _world(monkeypatch):
    db = _DB([
        _order("with-proof", payment_status="comprobante_subido", payment_proof_url=PROOF,
               payment_proof_method="yape", payment_proof_sha256="abc"),
        _order("no-proof", payment_proof_url=None),
        _order("absent-proof"),
    ])
    monkeypatch.setattr(order_routes, "db", db)
    return db


def _user(role, **extra):
    branch = {} if role == "admin" else {"branch_id": "branch-a"}
    return {"id": "u1", "restaurant_id": RID, "role": role, **branch, **extra}


@pytest.mark.parametrize("role", ["admin", "cajero"])
def test_order_list_replaces_the_proof_image_with_has_proof(monkeypatch, role):
    _world(monkeypatch)
    rows = asyncio.run(order_routes.list_orders(user=_user(role)))
    by_id = {row["id"]: row for row in rows}
    assert all("payment_proof_url" not in row for row in rows), "the base64 must not travel in a list"
    assert by_id["with-proof"]["has_proof"] is True
    assert by_id["no-proof"]["has_proof"] is False
    assert by_id["absent-proof"]["has_proof"] is False
    # La metadata liviana sigue disponible para quien cobra.
    assert by_id["with-proof"]["payment_proof_method"] == "yape"


@pytest.mark.parametrize("role", ["mozo", "cocina"])
def test_order_list_tells_staff_without_cobro_nothing_about_proofs(monkeypatch, role):
    _world(monkeypatch)
    rows = asyncio.run(order_routes.list_orders(user=_user(role)))
    for row in rows:
        assert "payment_proof_url" not in row
        assert "has_proof" not in row
        assert "payment_proof_method" not in row


def test_order_detail_still_returns_the_full_proof_to_the_cashier(monkeypatch):
    _world(monkeypatch)
    order = asyncio.run(order_routes.get_order("with-proof", _user("cajero")))
    assert order["payment_proof_url"] == PROOF


def test_order_detail_still_hides_the_proof_from_staff_without_cobro(monkeypatch):
    _world(monkeypatch)
    order = asyncio.run(order_routes.get_order("with-proof", _user("mozo")))
    assert "payment_proof_url" not in order


def test_proof_queue_returns_metadata_only(monkeypatch):
    db = _world(monkeypatch)
    monkeypatch.setattr(payment_routes, "db", db)
    result = asyncio.run(payment_routes.list_payment_proofs(user=_user("cajero")))
    assert [row["id"] for row in result["items"]] == ["with-proof"]
    assert all("payment_proof_url" not in row for row in result["items"])


def test_payment_history_never_selects_the_proof_image(monkeypatch):
    class Payments(_Orders):
        pass

    db = _world(monkeypatch)
    db.payments = Payments([{"id": "pay-1", "restaurant_id": RID, "order_id": "with-proof",
                             "branch_id": "branch-a", "created_at": "t", "payment_proof_url": PROOF}])
    monkeypatch.setattr(payment_routes, "db", db)
    rows = asyncio.run(payment_routes.list_payments(user=_user("cajero"), limit=50, q=None, period=None,
                                                    branch_id=None, legacy_only=False))
    assert [row["id"] for row in rows] == ["pay-1"]
    assert "payment_proof_url" not in rows[0]


def _query_param(module, path, name="limit"):
    route = next(r for r in module.router.routes if r.path == path and "GET" in r.methods)
    return next(p for p in route.dependant.query_params if p.name == name)


@pytest.mark.parametrize("module,path", [
    (order_routes, ""),
    (payment_routes, ""),
    (payment_routes, "/proofs"),
    (cash_routes, ""),
])
def test_list_limits_have_an_upper_bound(module, path):
    param = _query_param(module, path)
    caps = [getattr(item, "le", None) for item in param.field_info.metadata]
    assert 500 in caps, f"{module.__name__}{path} accepts an unbounded limit"


# ---------- 3. reintento del asignador de número ----------

class _RacyCounters:
    """El primer upsert pierde la carrera contra otro (E11000); el segundo ya encuentra el contador."""

    def __init__(self, losses):
        self.losses = losses
        self.calls = []

    async def find_one_and_update(self, filt, update, **options):
        self.calls.append((dict(filt), options))
        if len(self.calls) <= self.losses:
            raise DuplicateKeyError("E11000 duplicate key error collection: counters", 11000)
        return {"value": 7}

    async def find_one(self, filt):
        return {"value": 7}


class _CounterDB:
    def __init__(self, losses):
        self.counters = _RacyCounters(losses)


@pytest.mark.parametrize("module", [order_routes, public_routes], ids=["salon", "public"])
def test_order_number_allocator_retries_once_when_the_first_upsert_loses_the_race(monkeypatch, module):
    db = _CounterDB(losses=1)
    monkeypatch.setattr(module, "db", db)
    assert asyncio.run(module._next_order_number(RID)) == 7
    assert len(db.counters.calls) == 2
    assert db.counters.calls[0][0] == db.counters.calls[1][0], "the retry must hit the same counter"


@pytest.mark.parametrize("module", [order_routes, public_routes], ids=["salon", "public"])
def test_order_number_allocator_gives_up_after_one_retry(monkeypatch, module):
    db = _CounterDB(losses=2)
    monkeypatch.setattr(module, "db", db)
    with pytest.raises(DuplicateKeyError):
        asyncio.run(module._next_order_number(RID))
    assert len(db.counters.calls) == 2
