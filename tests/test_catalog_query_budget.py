"""What a menu and a draft-line batch cost in reads (TB-04).

`GET /products` resolved every combo component with a query of its own, so a menu
with C combos of K components cost `1 + C*K` round trips before it could be sent.
`PUT /orders/{id}/draft-lines` did the same per new line, so the batch the waiter
waits for when they pause paid up to `N + N*K`.

Both now read everything they may need up front, once, and then work in memory.
The fakes count reads, so the budget is asserted rather than assumed.
"""
import asyncio
import copy
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import models  # noqa: E402
import routes.orders as order_routes  # noqa: E402
import routes.products as product_routes  # noqa: E402
from branch_isolation_fakes import _Collection  # noqa: E402

RID = "tenant-1"
STAMP = "2026-01-01T00:00:00+00:00"
CID_A = "6b0f4f0e-0f6a-4f0e-9a52-0d1f3a6e0001"
CID_B = "6b0f4f0e-0f6a-4f0e-9a52-0d1f3a6e0002"


class _FakeDB:
    def __init__(self, *, orders=(), products=()):
        self.orders = _Collection(orders)
        self.products = _Collection(products)
        self.branches = _Collection([{"id": "branch-1", "restaurant_id": RID}])
        self.audit_logs = _Collection()
        self.counters = _Collection()


def _user():
    return {"id": "mozo-1", "restaurant_id": RID, "role": "mozo", "full_name": "Mozo", "branch_id": "branch-1"}


def _product(product_id, name, price=10.0, **extra):
    return {"id": product_id, "restaurant_id": RID, "name": name, "price": price,
            "is_available": True, "is_combo": False, "preparation_time": 10, **extra}


def _combo(product_id, components, name="Combo"):
    return {"id": product_id, "restaurant_id": RID, "name": name, "price": 25.0,
            "is_available": True, "is_combo": True, "preparation_time": 10,
            "combo_items": [{"product_id": pid, "quantity": qty} for pid, qty in components]}


def _line(item_id, product_id, quantity=1, status="borrador"):
    return {"id": item_id, "product_id": product_id, "product_name": product_id, "quantity": quantity,
            "unit_price": 10.0, "subtotal": 10.0 * quantity, "paid_qty": 0, "notes": None, "status": status}


def _order(items=(), status="nuevo"):
    row = {"id": "order-1", "restaurant_id": RID, "branch_id": "branch-1", "table_id": "table-1",
           "order_number": 12, "status": status, "order_type": "mesa", "subtotal": 0.0,
           "discount": 0.0, "tip": 0.0, "delivery_fee": 0.0, "amount_paid": 0.0,
           "updated_at": STAMP, "items": [copy.deepcopy(i) for i in items]}
    row["total"] = row["subtotal"]
    return row


def _batch(*lines):
    return models.DraftLinesBatch(lines=list(lines))


def _up(client_line_id, product_id=None, quantity=1):
    payload = {"client_line_id": client_line_id, "quantity": quantity}
    if product_id is not None:
        payload["product_id"] = product_id
    return payload


def _menu(db):
    # Both modules hold the same `db` singleton in production; the fake has to be
    # installed in each of them for the test to see every read.
    product_routes.db = db
    order_routes.db = db
    return asyncio.run(product_routes.list_products(_user()))


def _sync(db, batch):
    product_routes.db = db
    order_routes.db = db
    return asyncio.run(order_routes.sync_draft_lines("order-1", batch, _user()))


def _combo_of(items, product_id):
    return next(item for item in items if item["id"] == product_id)


# ---------- the menu ----------

def test_the_menu_reads_every_combo_component_in_one_query():
    db = _FakeDB(products=[
        _combo("p-combo", [("p-a", 1), ("p-b", 2), ("p-c", 1)]),
        _product("p-a", "A"), _product("p-b", "B"), _product("p-c", "C"),
    ])

    combo = _combo_of(_menu(db), "p-combo")

    # One read for the menu and one for every component any combo uses.
    assert len(db.products.reads) == 2
    assert [c["product_id"] for c in combo["combo_components"]] == ["p-a", "p-b", "p-c"]
    assert [c["quantity"] for c in combo["combo_components"]] == [1, 2, 1]
    assert [c["product_name"] for c in combo["combo_components"]] == ["A", "B", "C"]
    assert combo["components_available"] is True


def test_two_combos_sharing_a_component_still_cost_one_component_query():
    db = _FakeDB(products=[
        _combo("p-c1", [("p-a", 1), ("p-b", 1)]),
        _combo("p-c2", [("p-a", 2)]),
        _product("p-a", "A"), _product("p-b", "B"),
    ])

    items = _menu(db)

    assert len(db.products.reads) == 2
    assert set(db.products.reads[1]["id"]["$in"]) == {"p-a", "p-b"}
    assert [c["quantity"] for c in _combo_of(items, "p-c2")["combo_components"]] == [2]


def test_a_sold_out_component_still_makes_its_combo_unavailable():
    db = _FakeDB(products=[
        _combo("p-combo", [("p-a", 1), ("p-b", 1)]),
        _product("p-a", "A"), _product("p-b", "B", is_available=False),
    ])

    combo = _combo_of(_menu(db), "p-combo")

    assert combo["components_available"] is False
    assert {c["product_id"]: c["is_available"] for c in combo["combo_components"]} == {
        "p-a": True, "p-b": False,
    }


def test_a_combo_whose_components_are_gone_stays_unavailable():
    db = _FakeDB(products=[_combo("p-combo", [("p-missing", 1)]), _product("p-a", "A")])

    combo = _combo_of(_menu(db), "p-combo")

    assert combo["combo_components"] == []
    assert combo["components_available"] is False


def test_a_combo_component_that_is_itself_a_combo_is_not_a_component():
    db = _FakeDB(products=[
        _combo("p-combo", [("p-inner", 1)]),
        _combo("p-inner", [("p-a", 1)], name="Combo interno"),
        _product("p-a", "A"),
    ])

    combo = _combo_of(_menu(db), "p-combo")

    assert combo["combo_components"] == []
    assert combo["components_available"] is False


def test_a_menu_without_combos_reads_the_products_once():
    db = _FakeDB(products=[_product("p-a", "A"), _product("p-b", "B")])

    items = _menu(db)

    assert len(db.products.reads) == 1
    assert [item["id"] for item in items] == ["p-a", "p-b"]


# ---------- the batch ----------

def test_a_batch_reads_the_products_of_all_its_lines_once():
    db = _FakeDB(
        orders=[_order()],
        products=[_product("p-sopa", "Sopa"), _product("p-lomo", "Lomo", 30.0)],
    )

    _sync(db, _batch(_up(CID_A, "p-sopa", 2), _up(CID_B, "p-lomo", 1)))

    assert len(db.products.reads) == 1
    assert set(db.products.reads[0]["id"]["$in"]) == {"p-sopa", "p-lomo"}


def test_a_long_batch_still_reads_the_products_once():
    products = [_product(f"p-{index}", f"Plato {index}") for index in range(30)]
    db = _FakeDB(orders=[_order()], products=products)

    order = _sync(db, _batch(*[_up(f"cid-{index}", f"p-{index}", 1) for index in range(30)]))

    assert len(db.products.reads) == 1
    assert len(order["items"]) == 30
    assert all(result["result"] == "applied" for result in order["line_results"])


def test_a_batch_with_a_combo_reads_the_combo_and_its_components_once():
    db = _FakeDB(
        orders=[_order()],
        products=[_combo("p-combo", [("p-a", 1), ("p-b", 2)]), _product("p-a", "A"), _product("p-b", "B")],
    )

    order = _sync(db, _batch(_up(CID_A, "p-combo", 1)))

    assert len(db.products.reads) == 2
    assert set(db.products.reads[1]["id"]["$in"]) == {"p-a", "p-b"}
    created = order["items"][0]
    assert created["product_id"] == "p-combo"
    assert [c["product_id"] for c in created["combo_components"]] == ["p-a", "p-b"]


def test_a_batch_that_only_changes_quantities_reads_no_products():
    db = _FakeDB(
        orders=[_order(items=[_line("l1", "p-sopa")])],
        products=[_product("p-sopa", "Sopa")],
    )

    order = _sync(db, _batch(_up("l1", quantity=3)))

    assert db.products.reads == []
    assert [item["quantity"] for item in order["items"]] == [3]


def test_a_batch_that_removes_a_line_reads_no_products():
    db = _FakeDB(
        orders=[_order(items=[_line("l1", "p-sopa")])],
        products=[_product("p-sopa", "Sopa")],
    )

    order = _sync(db, _batch(_up("l1", quantity=0)))

    assert db.products.reads == []
    assert order["items"] == []


def test_a_line_whose_product_does_not_exist_is_rejected_without_a_second_read():
    db = _FakeDB(orders=[_order()], products=[_product("p-sopa", "Sopa")])

    order = _sync(db, _batch(_up(CID_A, "p-nope", 1)))

    assert len(db.products.reads) == 1
    assert order["line_results"][0]["result"] == "rejected"
    assert order["line_results"][0]["code"] == "unavailable"


def test_a_rejected_line_does_not_stop_the_others():
    db = _FakeDB(
        orders=[_order()],
        products=[_product("p-sopa", "Sopa"), _product("p-agotado", "Agotado", is_available=False)],
    )

    order = _sync(db, _batch(_up(CID_A, "p-agotado", 1), _up(CID_B, "p-sopa", 2)))

    results = {result["client_line_id"]: result for result in order["line_results"]}
    assert results[CID_A]["result"] == "rejected"
    assert results[CID_B]["result"] == "applied"
    assert [item["product_id"] for item in order["items"]] == ["p-sopa"]
