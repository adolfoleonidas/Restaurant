"""Batched draft-line sync (BS-01).

The composer no longer writes every tap. It saves the pending lines of one order
in a single idempotent request: `PUT /orders/{id}/draft-lines`.

  * a line is addressed by a client-generated `client_line_id`, so a replayed
    batch finds its line again instead of creating a second one;
  * quantities are absolute (0 removes a draft line);
  * only draft lines are ever changed, and a line that cannot be applied is
    rejected on its own while the others still apply;
  * the whole batch is one document write guarded by the order's version and
    publishes one realtime event the kitchen never sees.
"""
import asyncio
import copy
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import models  # noqa: E402
import routes.orders as order_routes  # noqa: E402
import routes.products as product_routes  # noqa: E402
from branch_isolation_fakes import _Collection  # noqa: E402
from notify import subscribe, unsubscribe  # noqa: E402

RID = "tenant-1"
STAMP = "2026-01-01T00:00:00+00:00"
CID_A = "6b0f4f0e-0f6a-4f0e-9a52-0d1f3a6e0001"
CID_B = "6b0f4f0e-0f6a-4f0e-9a52-0d1f3a6e0002"
CID_C = "6b0f4f0e-0f6a-4f0e-9a52-0d1f3a6e0003"


class _FakeDB:
    def __init__(self, *, orders=(), products=()):
        self.orders = _Collection(orders)
        self.products = _Collection(products)
        self.branches = _Collection([
            {"id": "branch-1", "restaurant_id": RID},
            {"id": "branch-2", "restaurant_id": RID},
            {"id": "branch-9", "restaurant_id": "tenant-2"},
        ])
        self.audit_logs = _Collection()
        self.counters = _Collection()


def _user(role="mozo", branch_id="branch-1", restaurant_id=RID):
    return {"id": "mozo-1", "restaurant_id": restaurant_id, "role": role, "full_name": "Mozo", "branch_id": branch_id}


def _product(product_id, name, price, **extra):
    return {"id": product_id, "restaurant_id": RID, "name": name, "price": price,
            "is_available": True, "is_combo": False, "preparation_time": 10, **extra}


def _line(item_id, product_id, name, price, quantity=1, status="borrador", **extra):
    return {"id": item_id, "product_id": product_id, "product_name": name, "quantity": quantity,
            "unit_price": price, "subtotal": price * quantity, "paid_qty": 0, "notes": None,
            "status": status, **extra}


def _order(items=(), status="nuevo", **extra):
    row = {
        "id": "order-1", "restaurant_id": RID, "branch_id": "branch-1", "table_id": "table-1",
        "order_number": 12, "status": status, "order_type": "mesa",
        "subtotal": sum(float(i.get("subtotal") or 0) for i in items),
        "discount": 0.0, "tip": 0.0, "delivery_fee": 0.0, "amount_paid": 0.0,
        "updated_at": STAMP, "items": [copy.deepcopy(i) for i in items],
    }
    row["total"] = row["subtotal"]
    row.update(extra)
    return row


def _catalog():
    return [_product("p-sopa", "Sopa", 10.0), _product("p-lomo", "Lomo", 30.0)]


def _up(client_line_id, product_id=None, quantity=1, notes=None):
    payload = {"client_line_id": client_line_id, "quantity": quantity}
    if product_id is not None:
        payload["product_id"] = product_id
    if notes is not None:
        payload["notes"] = notes
    return payload


def _batch(*lines, version=None):
    payload = {"lines": list(lines)}
    if version is not None:
        payload["version"] = version
    return models.DraftLinesBatch(**payload)


def _call(db, batch, user=None, order_id="order-1"):
    order_routes.db = db
    return order_routes.sync_draft_lines(order_id, batch, user or _user())


def _run(db, batch, user=None, order_id="order-1"):
    return asyncio.run(_call(db, batch, user, order_id))


def _stored(db, order_id="order-1"):
    return next(row for row in db.orders.rows if row["id"] == order_id)


def _results(order):
    return {r["client_line_id"]: r for r in order["line_results"]}


# ---------- the batch writes draft lines ----------

def test_a_batch_creates_draft_lines_priced_from_the_catalog():
    db = _FakeDB(orders=[_order()], products=_catalog())
    order = _run(db, _batch(_up(CID_A, "p-sopa", 2), _up(CID_B, "p-lomo", 1)))

    assert order["status"] == "nuevo"
    assert [(i["client_line_id"], i["product_id"], i["quantity"], i["status"]) for i in order["items"]] == [
        (CID_A, "p-sopa", 2, "borrador"), (CID_B, "p-lomo", 1, "borrador"),
    ]
    assert order["items"][0]["unit_price"] == 10.0 and order["items"][0]["subtotal"] == 20.0
    assert order["subtotal"] == 50.0 and order["total"] == 50.0
    assert [r["result"] for r in order["line_results"]] == ["applied", "applied"]
    # The server keeps its own line ids: the client id only identifies the request.
    assert all(i["id"] and i["id"] != i["client_line_id"] for i in order["items"])


def test_the_answer_is_the_whole_order_so_the_client_can_confirm_from_it():
    db = _FakeDB(orders=[_order([_line("l1", "p-lomo", "Lomo", 30.0, 1, status="pendiente")], status="enviado_cocina")],
                 products=_catalog())
    order = _run(db, _batch(_up(CID_A, "p-sopa", 1)))

    assert order["id"] == "order-1" and order["order_number"] == 12
    assert [i["id"] for i in order["items"]][0] == "l1"
    assert len(order["items"]) == 2
    assert order["status"] == "enviado_cocina"


def test_replaying_the_same_batch_changes_nothing_and_never_duplicates_a_line():
    db = _FakeDB(orders=[_order()], products=_catalog())
    batch = _batch(_up(CID_A, "p-sopa", 2), _up(CID_B, "p-lomo", 1))

    first = _run(db, batch)
    second = _run(db, batch)

    assert [i["id"] for i in second["items"]] == [i["id"] for i in first["items"]]
    assert len(second["items"]) == 2
    assert [r["result"] for r in second["line_results"]] == ["unchanged", "unchanged"]
    assert second["total"] == first["total"] == 50.0
    # Nothing to change: no second write, so the order keeps its version.
    assert len(db.orders.writes) == 1
    assert second["updated_at"] == first["updated_at"]


def test_the_quantity_is_absolute_so_the_last_batch_wins_whatever_arrived_before():
    db = _FakeDB(orders=[_order()], products=_catalog())
    _run(db, _batch(_up(CID_A, "p-sopa", 1)))
    _run(db, _batch(_up(CID_A, "p-sopa", 5)))
    order = _run(db, _batch(_up(CID_A, "p-sopa", 3)))

    assert [(i["quantity"], i["subtotal"]) for i in order["items"]] == [(3, 30.0)]
    assert order["total"] == 30.0
    assert order["line_results"][0]["result"] == "applied"


def test_a_line_created_in_an_earlier_batch_keeps_its_price_when_the_catalog_changes():
    db = _FakeDB(orders=[_order()], products=_catalog())
    _run(db, _batch(_up(CID_A, "p-sopa", 1)))
    db.products.rows[0]["price"] = 99.0
    order = _run(db, _batch(_up(CID_A, "p-sopa", 2)))

    assert order["items"][0]["unit_price"] == 10.0
    assert order["total"] == 20.0


def test_quantity_zero_removes_a_draft_line_and_removing_it_again_is_not_an_error():
    db = _FakeDB(orders=[_order()], products=_catalog())
    _run(db, _batch(_up(CID_A, "p-sopa", 2), _up(CID_B, "p-lomo", 1)))

    removed = _run(db, _batch(_up(CID_A, quantity=0)))
    assert [i["client_line_id"] for i in removed["items"]] == [CID_B]
    assert removed["line_results"][0]["result"] == "removed"
    assert removed["total"] == 30.0

    again = _run(db, _batch(_up(CID_A, quantity=0)))
    assert [i["client_line_id"] for i in again["items"]] == [CID_B]
    assert again["line_results"][0]["result"] == "unchanged"
    assert len(db.orders.writes) == 2


def test_removing_a_line_that_never_existed_creates_nothing():
    db = _FakeDB(orders=[_order()], products=_catalog())
    order = _run(db, _batch(_up(CID_A, "p-sopa", 0)))

    assert order["items"] == []
    assert order["line_results"][0]["result"] == "unchanged"
    assert db.orders.writes == []


# ---------- sent lines are never touched ----------

def _sent_order():
    return _order([
        _line("sent-1", "p-sopa", "Sopa", 10.0, 2, status="pendiente"),
        _line("draft-1", "p-lomo", "Lomo", 30.0, 1, status="borrador"),
    ], status="enviado_cocina")


def test_a_sent_line_is_never_changed_and_the_rest_of_the_batch_still_applies():
    db = _FakeDB(orders=[_sent_order()], products=_catalog())
    order = _run(db, _batch(
        _up("sent-1", quantity=5),
        _up("draft-1", quantity=3),
        _up(CID_A, "p-sopa", 1),
    ))

    sent = next(i for i in order["items"] if i["id"] == "sent-1")
    assert (sent["quantity"], sent["status"], sent["subtotal"]) == (2, "pendiente", 20.0)
    assert next(i for i in order["items"] if i["id"] == "draft-1")["quantity"] == 3
    assert any(i.get("client_line_id") == CID_A for i in order["items"])
    results = _results(order)
    assert results["sent-1"]["result"] == "rejected" and results["sent-1"]["code"] == "not_draft"
    assert "enviado a cocina" in results["sent-1"]["detail"]
    assert results["draft-1"]["result"] == "applied" and results[CID_A]["result"] == "applied"
    assert order["total"] == 20.0 + 90.0 + 10.0


def test_a_sent_line_cannot_be_removed_by_a_zero_quantity():
    db = _FakeDB(orders=[_sent_order()], products=_catalog())
    order = _run(db, _batch(_up("sent-1", quantity=0)))

    assert [i["id"] for i in order["items"]] == ["sent-1", "draft-1"]
    assert order["line_results"][0]["code"] == "not_draft"
    assert db.orders.writes == []


def test_replaying_a_batch_after_its_line_was_sent_is_not_an_error_when_it_already_matches():
    db = _FakeDB(orders=[_sent_order()], products=_catalog())
    order = _run(db, _batch(_up("sent-1", quantity=2)))

    assert order["line_results"][0]["result"] == "unchanged"
    assert db.orders.writes == []


def test_a_voided_line_is_not_a_draft_either():
    voided = _line("void-1", "p-sopa", "Sopa", 10.0, 1, status="cancelado")
    db = _FakeDB(orders=[_order([voided], status="enviado_cocina")], products=_catalog())
    order = _run(db, _batch(_up("void-1", quantity=4)))

    assert order["items"][0]["quantity"] == 1
    assert order["line_results"][0]["code"] == "not_draft"


# ---------- per-line validation ----------

def test_an_unavailable_product_is_rejected_per_line_while_the_others_apply():
    products = _catalog() + [_product("p-chicha", "Chicha", 6.0, is_available=False)]
    db = _FakeDB(orders=[_order()], products=products)
    order = _run(db, _batch(
        _up(CID_A, "p-sopa", 1), _up(CID_B, "p-chicha", 2), _up(CID_C, "p-ghost", 1),
    ))

    assert [i["client_line_id"] for i in order["items"]] == [CID_A]
    results = _results(order)
    assert results[CID_A]["result"] == "applied"
    assert results[CID_B] == {"client_line_id": CID_B, "result": "rejected", "code": "unavailable",
                              "detail": "Producto agotado: Chicha"}
    assert results[CID_C]["result"] == "rejected" and results[CID_C]["code"] == "unavailable"
    assert "no existe" in results[CID_C]["detail"]
    assert order["total"] == 10.0


def test_a_combo_with_an_unavailable_component_is_rejected_like_add_items():
    products = _catalog() + [_product(
        "p-combo", "Menú", 25.0, is_combo=True, combo_items=[{"product_id": "p-agotado", "quantity": 1}],
    ), _product("p-agotado", "Postre", 5.0, is_available=False)]
    db = _FakeDB(orders=[_order()], products=products)
    product_routes.db = db
    order = _run(db, _batch(_up(CID_A, "p-combo", 1)))

    assert order["items"] == []
    assert order["line_results"][0]["code"] == "unavailable"
    assert "combo" in order["line_results"][0]["detail"].lower()


def test_a_batch_where_every_line_is_rejected_writes_nothing():
    db = _FakeDB(orders=[_order()], products=_catalog())
    order = _run(db, _batch(_up(CID_A, "p-ghost", 1)))

    assert order["items"] == []
    assert order["line_results"][0]["result"] == "rejected"
    assert db.orders.writes == []


def test_an_unknown_line_without_a_product_cannot_be_created():
    db = _FakeDB(orders=[_order()], products=_catalog())
    order = _run(db, _batch(_up(CID_A, quantity=2)))

    assert order["items"] == []
    assert order["line_results"][0]["code"] == "not_found"


def test_a_line_cannot_be_reused_for_another_product():
    db = _FakeDB(orders=[_order()], products=_catalog())
    _run(db, _batch(_up(CID_A, "p-sopa", 1)))
    order = _run(db, _batch(_up(CID_A, "p-lomo", 4)))

    assert [(i["product_id"], i["quantity"]) for i in order["items"]] == [("p-sopa", 1)]
    assert order["line_results"][0]["code"] == "mismatch"


# ---------- existing lines keep working ----------

def test_a_line_without_a_client_id_is_addressed_by_its_server_id():
    db = _FakeDB(orders=[_order([_line("legacy-1", "p-sopa", "Sopa", 10.0, 2)])], products=_catalog())
    order = _run(db, _batch(_up("legacy-1", quantity=4)))

    assert [(i["id"], i["quantity"], i["subtotal"]) for i in order["items"]] == [("legacy-1", 4, 40.0)]
    assert "client_line_id" not in order["items"][0]
    assert order["total"] == 40.0
    removed = _run(db, _batch(_up("legacy-1", quantity=0)))
    assert removed["items"] == []


def test_a_line_created_by_a_batch_can_also_be_addressed_by_its_server_id():
    db = _FakeDB(orders=[_order()], products=_catalog())
    created = _run(db, _batch(_up(CID_A, "p-sopa", 1)))
    server_id = created["items"][0]["id"]
    order = _run(db, _batch(_up(server_id, quantity=3)))

    assert [(i["id"], i["quantity"]) for i in order["items"]] == [(server_id, 3)]


def test_notes_are_set_on_creation_updated_on_a_draft_and_left_alone_when_omitted():
    db = _FakeDB(orders=[_order()], products=_catalog())
    created = _run(db, _batch(_up(CID_A, "p-sopa", 1, notes="Sin cebolla")))
    assert created["items"][0]["notes"] == "Sin cebolla"

    kept = _run(db, _batch(_up(CID_A, "p-sopa", 2)))
    assert kept["items"][0]["notes"] == "Sin cebolla"

    changed = _run(db, _batch(_up(CID_A, "p-sopa", 2, notes="Poco picante")))
    assert changed["items"][0]["notes"] == "Poco picante"
    assert changed["line_results"][0]["result"] == "applied"


def test_a_charged_draft_cannot_be_removed_or_lowered_below_what_was_charged():
    charged = _line("l1", "p-sopa", "Sopa", 10.0, 3, paid_qty=2)
    db = _FakeDB(orders=[_order([charged], amount_paid=20.0)], products=_catalog())

    removed = _run(db, _batch(_up("l1", quantity=0)))
    lowered = _run(db, _batch(_up("l1", quantity=1)))
    raised = _run(db, _batch(_up("l1", quantity=4)))

    assert removed["line_results"][0]["code"] == "paid"
    assert lowered["line_results"][0]["code"] == "paid"
    assert raised["line_results"][0]["result"] == "applied"
    assert raised["items"][0]["quantity"] == 4


# ---------- one write, one event ----------

def _capture(db, batch, user=None):
    async def run():
        q = subscribe()
        try:
            order = await _call(db, batch, user)
            events = []
            while not q.empty():
                events.append(q.get_nowait())
            return order, events
        finally:
            unsubscribe(q)
    return asyncio.run(run())


def test_the_whole_batch_is_one_write_and_one_event_the_kitchen_never_sees():
    db = _FakeDB(orders=[_order()], products=_catalog())
    order, events = _capture(db, _batch(_up(CID_A, "p-sopa", 2), _up(CID_B, "p-lomo", 1), _up(CID_C, "p-sopa", 1)))

    assert len(order["items"]) == 3
    assert len(db.orders.writes) == 1
    assert len(events) == 1
    event = events[0]
    assert (event["type"], event["order_id"], event["restaurant_id"]) == ("order", "order-1", RID)
    assert event["topics"] == ["orders"] and event["topic"] == "orders"
    assert event["branch_id"] == "branch-1"


def test_a_batch_that_changes_nothing_publishes_no_event():
    db = _FakeDB(orders=[_order()], products=_catalog())
    batch = _batch(_up(CID_A, "p-sopa", 2))
    _run(db, batch)
    _, events = _capture(db, batch)

    assert events == []


def test_the_order_status_and_the_kitchen_state_are_left_alone():
    db = _FakeDB(orders=[_sent_order()], products=_catalog())
    order = _run(db, _batch(_up("draft-1", quantity=2), _up(CID_A, "p-sopa", 1)))

    assert order["status"] == "enviado_cocina"
    assert next(i for i in order["items"] if i["id"] == "sent-1")["status"] == "pendiente"
    assert _stored(db)["status"] == "enviado_cocina"


# ---------- concurrency ----------

def test_a_stale_version_is_a_conflict_and_nothing_is_applied():
    db = _FakeDB(orders=[_order()], products=_catalog())
    with pytest.raises(HTTPException) as caught:
        _run(db, _batch(_up(CID_A, "p-sopa", 1), version="2025-12-31T00:00:00+00:00"))

    assert caught.value.status_code == 409
    assert caught.value.detail["code"] == "account_changed"
    assert _stored(db)["items"] == []
    assert db.orders.writes == []


def test_the_version_the_client_saw_lets_the_batch_through():
    db = _FakeDB(orders=[_order()], products=_catalog())
    order = _run(db, _batch(_up(CID_A, "p-sopa", 1), version=STAMP))

    assert len(order["items"]) == 1
    assert order["updated_at"] != STAMP


class _RacyOrders(_Collection):
    """Someone else writes the order right after the handler read it."""

    async def find_one(self, query, projection=None):
        row = await super().find_one(query, projection)
        if self.writes == [] and row is not None and not getattr(self, "raced", False):
            self.raced = True
            self.rows[0]["updated_at"] = "2026-01-01T00:00:01+00:00"
        return row


def test_a_concurrent_write_is_a_conflict_not_a_lost_update():
    db = _FakeDB(orders=[_order()], products=_catalog())
    db.orders = _RacyOrders([_order()])
    with pytest.raises(HTTPException) as caught:
        _run(db, _batch(_up(CID_A, "p-sopa", 1)))

    assert caught.value.status_code == 409
    assert _stored(db)["items"] == []
    # The same batch goes through once the client resends it (it is idempotent).
    order = _run(db, _batch(_up(CID_A, "p-sopa", 1)))
    assert len(order["items"]) == 1


# ---------- who can call it ----------

@pytest.mark.parametrize("status", ["pagado", "cancelado"])
def test_a_closed_order_cannot_be_changed(status):
    db = _FakeDB(orders=[_order(status=status)], products=_catalog())
    with pytest.raises(HTTPException) as caught:
        _run(db, _batch(_up(CID_A, "p-sopa", 1)))

    assert caught.value.status_code == 400
    assert db.orders.writes == []


def test_an_unknown_order_is_not_found():
    db = _FakeDB(orders=[_order()], products=_catalog())
    with pytest.raises(HTTPException) as caught:
        _run(db, _batch(_up(CID_A, "p-sopa", 1)), order_id="nope")

    assert caught.value.status_code == 404


def test_an_order_of_another_branch_is_invisible_to_branch_staff():
    db = _FakeDB(orders=[_order()], products=_catalog())
    with pytest.raises(HTTPException) as caught:
        _run(db, _batch(_up(CID_A, "p-sopa", 1)), user=_user(branch_id="branch-2"))

    assert caught.value.status_code == 404
    assert _stored(db)["items"] == []


def test_an_order_of_another_tenant_is_invisible():
    db = _FakeDB(orders=[_order()], products=_catalog())
    with pytest.raises(HTTPException) as caught:
        _run(db, _batch(_up(CID_A, "p-sopa", 1)), user=_user(restaurant_id="tenant-2", branch_id="branch-9"))

    assert caught.value.status_code == 404
    assert _stored(db)["items"] == []


def test_the_admin_keeps_tenant_wide_access():
    db = _FakeDB(orders=[_order()], products=_catalog())
    admin = {"id": "admin-1", "restaurant_id": RID, "role": "admin", "full_name": "Admin"}
    order = _run(db, _batch(_up(CID_A, "p-sopa", 1)), user=admin)

    assert len(order["items"]) == 1


def test_the_catalog_lookup_stays_inside_the_tenant():
    other = _product("p-ajeno", "Ajeno", 1.0)
    other["restaurant_id"] = "tenant-2"
    db = _FakeDB(orders=[_order()], products=[other])
    order = _run(db, _batch(_up(CID_A, "p-ajeno", 1)))

    assert order["items"] == []
    assert order["line_results"][0]["code"] == "unavailable"


def _guard():
    route = next(r for r in order_routes.router.routes
                 if getattr(r, "path", "") == "/{order_id}/draft-lines")
    assert route.methods == {"PUT"}
    return route.dependant.dependencies[0].call


@pytest.mark.parametrize("role", ["mozo", "admin"])
def test_waiters_and_admins_may_sync_draft_lines(role):
    user = {"id": "u1", "restaurant_id": RID, "role": role}
    assert asyncio.run(_guard()(user)) is user


@pytest.mark.parametrize("role", ["cocina", "cajero"])
def test_kitchen_and_cashier_may_not(role):
    with pytest.raises(HTTPException) as caught:
        asyncio.run(_guard()({"id": "u1", "restaurant_id": RID, "role": role}))

    assert caught.value.status_code == 403


# ---------- the request body ----------

def test_the_body_is_validated():
    with pytest.raises(ValidationError):
        _batch()                                                      # no lines
    with pytest.raises(ValidationError):
        _batch(_up(CID_A, "p-sopa", -1))                              # negative quantity
    with pytest.raises(ValidationError):
        _batch(_up(CID_A, "p-sopa", 1), _up(CID_A, "p-lomo", 2))      # the same line twice
    with pytest.raises(ValidationError):
        _batch(_up("has spaces/and$symbols", "p-sopa", 1))            # not an id
    with pytest.raises(ValidationError):
        _batch(*[_up(f"line-{n:03d}", "p-sopa", 1) for n in range(101)])  # more than one order holds
    with pytest.raises(ValidationError):
        _batch(_up(CID_A, "p-sopa", 1, notes="x" * 201))              # notes longer than a line takes
    assert _batch(_up(CID_A, quantity=0)).lines[0].quantity == 0
