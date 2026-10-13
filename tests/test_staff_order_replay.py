"""A staff create sent again with the same request id gives back the order it made.

The composer retries a create when the answer is lost (`lineSyncQueue` stalls and tries again). Before
the request id the retry made a second account at the table or a second take-out order. With it the
server finds the order of the first attempt by `(restaurant_id, request_id)` and answers with it,
without taking a number, reserving the table, opening a visit, writing an audit entry or publishing
an event again.
"""
import asyncio
import copy
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import OrderCreate, OrderItemInput  # noqa: E402
from staff_order_world import OTHER_TENANT, REUSED, World, create, staff  # noqa: E402

R1 = "6b0f4f0e-0f6a-4f0e-9a52-0d1f3a6e0001"
R2 = "6b0f4f0e-0f6a-4f0e-9a52-0d1f3a6e0002"
MOZO = staff()


def run(world, scenario):
    return asyncio.run(scenario(world))


def test_a_repeated_first_account_create_returns_the_same_order_and_changes_nothing(monkeypatch):
    world = World(monkeypatch)

    async def scenario(world):
        first = await create(OrderCreate(table_id="table-1", request_id=R1), MOZO)
        before = world.state()
        # The table is occupied now: without the request id this is refused (see the last test).
        second = await create(OrderCreate(table_id="table-1", request_id=R1), MOZO)
        return first, second, before

    first, second, before = run(world, scenario)

    assert second == first
    assert first["request_id"] == R1 and first["attention_state"] == "open"
    assert world.state() == before
    assert len(world.db.orders.docs) == 1 and len(world.db.attentions.docs) == 1
    assert len(world.db.audit_logs.docs) == 1 and len(world.events) == 1 and len(world.numbers) == 1
    assert world.table("table-1")["active_attention_id"] == first["attention_id"]


def test_a_repeated_extra_account_create_adds_the_account_once(monkeypatch):
    world = World(monkeypatch)

    async def scenario(world):
        visit = await create(OrderCreate(table_id="table-1", request_id=R1), MOZO)
        extra = await create(OrderCreate(table_id="table-1", new_account=True, request_id=R2), MOZO)
        before = world.state()
        again = await create(OrderCreate(table_id="table-1", new_account=True, request_id=R2), MOZO)
        return visit, extra, again, before

    visit, extra, again, before = run(world, scenario)

    assert again == extra and extra["id"] != visit["id"]
    assert world.state() == before
    assert len(world.db.orders.docs) == 2 and len(world.numbers) == 2
    assert set(world.db.attentions.docs[0]["order_ids"]) == {visit["id"], extra["id"]}


def test_a_repeated_order_without_a_table_is_made_once(monkeypatch):
    world = World(monkeypatch)
    request = dict(order_type="recojo", customer_name="Ana", request_id=R1)

    async def scenario(world):
        first = await create(OrderCreate(**request), MOZO)
        before = world.state()
        return first, await create(OrderCreate(**request), MOZO), before

    first, second, before = run(world, scenario)

    assert second == first and first["branch_id"] == "branch-1"
    assert world.state() == before
    assert len(world.db.orders.docs) == 1 and len(world.events) == 1


def test_the_replay_answers_with_the_order_as_stored_not_as_recomputed(monkeypatch):
    world = World(monkeypatch)
    request = dict(order_type="recojo", items=[OrderItemInput(product_id="p-sopa", quantity=2)], request_id=R1)

    async def scenario(world):
        first = await create(OrderCreate(**request), MOZO)
        world.db.products.docs[0]["price"] = 99.0
        return first, await create(OrderCreate(**request), MOZO)

    first, second = run(world, scenario)

    assert first["total"] == 20.0 and second == first
    assert len(world.db.orders.docs) == 1


def test_without_a_request_id_nothing_changes(monkeypatch):
    world = World(monkeypatch)

    async def scenario(world):
        one = await create(OrderCreate(order_type="recojo"), MOZO)
        two = await create(OrderCreate(order_type="recojo"), MOZO)
        visit = await create(OrderCreate(table_id="table-1"), MOZO)
        first_extra = await create(OrderCreate(table_id="table-1", new_account=True), MOZO)
        second_extra = await create(OrderCreate(table_id="table-1", new_account=True), MOZO)
        with pytest.raises(HTTPException) as refused:
            await create(OrderCreate(table_id="table-1"), MOZO)
        return one, two, visit, first_extra, second_extra, refused.value

    one, two, visit, first_extra, second_extra, refused = run(world, scenario)

    assert len({one["id"], two["id"], visit["id"], first_extra["id"], second_extra["id"]}) == 5
    assert all("request_id" not in row for row in world.db.orders.docs)
    assert (refused.status_code, refused.detail) == (400, "La mesa pertenece a una visita abierta")
    # One audit entry per order, as before, and none of them carries an event id.
    assert len(world.db.audit_logs.docs) == 5 and not any("event_id" in row for row in world.db.audit_logs.docs)


def test_two_attempts_of_the_same_request_running_together_make_one_order(monkeypatch):
    world = World(monkeypatch, yield_on_number=True)
    request = dict(order_type="recojo", request_id=R1)

    async def scenario(world):
        return await asyncio.gather(create(OrderCreate(**request), MOZO), create(OrderCreate(**request), MOZO))

    first, second = run(world, scenario)

    assert first == second
    assert len(world.db.orders.docs) == 1
    # The loser really lost at the insert (the unique index), it did not stop at the first lookup.
    assert world.duplicate_inserts == 1 and len(world.numbers) == 2
    assert len(world.db.audit_logs.docs) == 1 and len(world.events) == 1


def test_two_attempts_on_the_same_free_table_make_one_account_and_one_visit(monkeypatch):
    world = World(monkeypatch, yield_on_number=True)
    request = dict(table_id="table-1", request_id=R1)

    async def scenario(world):
        return await asyncio.gather(create(OrderCreate(**request), MOZO), create(OrderCreate(**request), MOZO))

    first, second = run(world, scenario)

    assert first == second and first["attention_state"] == "open"
    assert len(world.numbers) == 2, "the second attempt was supposed to be in flight, not turned away early"
    assert len(world.db.orders.docs) == 1 and len(world.db.attentions.docs) == 1
    assert len(world.db.audit_logs.docs) == 1 and len(world.events) == 1


def test_the_audit_entry_alone_keeps_a_replay_from_announcing_twice(monkeypatch):
    """Even if the unique `event_id` index were missing, the replay looks the entry up first."""
    world = World(monkeypatch)

    async def scenario(world):
        async def insert_without_unique_index(doc):
            world.db.audit_logs.docs.append(copy.deepcopy(doc))

        world.db.audit_logs.insert_one = insert_without_unique_index
        first = await create(OrderCreate(order_type="recojo", request_id=R1), MOZO)
        before = world.state()
        return first, await create(OrderCreate(order_type="recojo", request_id=R1), MOZO), before

    first, second, before = run(world, scenario)

    assert second == first and world.state() == before
    assert len(world.db.audit_logs.docs) == 1 and len(world.events) == 1


def test_losing_the_race_for_the_audit_entry_announces_nothing(monkeypatch):
    """Two replays can both miss the entry; the unique `event_id` index lets only one write it."""
    world = World(monkeypatch)

    async def scenario(world):
        first = await create(OrderCreate(order_type="recojo", request_id=R1), MOZO)

        async def not_there_yet(filt, projection=None):
            return None

        world.db.audit_logs.find_one = not_there_yet
        before = world.state()
        return first, await create(OrderCreate(order_type="recojo", request_id=R1), MOZO), before

    first, second, before = run(world, scenario)

    assert second == first and world.state() == before


def test_an_attempt_that_stopped_before_the_visit_opened_is_finished_by_the_retry(monkeypatch):
    world = World(monkeypatch)

    async def scenario(world):
        world.db.fail_attention_insert = True
        with pytest.raises(RuntimeError, match="insert failure"):
            await create(OrderCreate(table_id="table-1", request_id=R1), MOZO)
        stuck = copy.deepcopy(world.db.orders.docs[0])
        assert stuck["attention_state"] == "opening" and not world.db.audit_logs.docs and not world.events
        return stuck, await create(OrderCreate(table_id="table-1", request_id=R1), MOZO)

    stuck, answer = run(world, scenario)

    assert answer["id"] == stuck["id"] and answer["attention_state"] == "open"
    assert len(world.db.orders.docs) == 1 and len(world.db.attentions.docs) == 1
    assert world.db.attentions.docs[0]["status"] == "open"
    assert world.table("table-1")["status"] == "ocupada"
    # The retry took no number of its own and announced the order that was never announced.
    assert len(world.numbers) == 1 and len(world.db.audit_logs.docs) == 1 and len(world.events) == 1


def test_an_attempt_that_died_holding_the_table_is_recovered_by_the_retry(monkeypatch):
    world = World(monkeypatch)

    async def scenario(world):
        store = world.db.orders.insert_one
        died = []

        async def die_once(doc):
            if not died:
                died.append(doc["id"])
                raise RuntimeError("the process died before the order was stored")
            return await store(doc)

        world.db.orders.insert_one = die_once
        with pytest.raises(RuntimeError, match="died"):
            await create(OrderCreate(table_id="table-1", request_id=R1), MOZO)
        # The table keeps the order the dead attempt meant to write; the order itself does not exist.
        assert world.db.orders.docs == []
        assert world.table("table-1")["opening_intent"]["request_id"] == R1
        return died[0], await create(OrderCreate(table_id="table-1", request_id=R1), MOZO)

    meant_id, answer = run(world, scenario)

    assert answer["id"] == meant_id and answer["order_number"] == 1 and answer["attention_state"] == "open"
    assert len(world.db.orders.docs) == 1 and len(world.db.attentions.docs) == 1
    table = world.table("table-1")
    assert table["active_attention_id"] == answer["attention_id"]
    assert "opening_order_id" not in table and "opening_intent" not in table
    assert len(world.db.audit_logs.docs) == 1 and len(world.events) == 1


def test_a_request_id_of_another_branch_is_refused_and_creates_nothing(monkeypatch):
    world = World(monkeypatch)

    async def scenario(world):
        first = await create(OrderCreate(order_type="recojo", request_id=R1), MOZO)
        before = world.state()
        with pytest.raises(HTTPException) as refused:
            await create(OrderCreate(order_type="recojo", request_id=R1), staff(branch="branch-2"))
        return first, before, refused.value

    first, before, refused = run(world, scenario)

    assert (refused.status_code, refused.detail) == (409, REUSED)
    assert world.state() == before and first["branch_id"] == "branch-1"


def test_the_owner_can_replay_any_branch_but_must_ask_for_the_same_one(monkeypatch):
    world = World(monkeypatch)
    admin = staff("admin", branch=None)

    async def scenario(world):
        first = await create(OrderCreate(order_type="recojo", request_id=R1), MOZO)
        same = await create(OrderCreate(order_type="recojo", branch_id="branch-1", request_id=R1), admin)
        unnamed = await create(OrderCreate(order_type="recojo", request_id=R1), admin)
        with pytest.raises(HTTPException) as other_branch:
            await create(OrderCreate(order_type="recojo", branch_id="branch-2", request_id=R1), admin)
        return first, same, unnamed, other_branch.value

    first, same, unnamed, other_branch = run(world, scenario)

    assert same == unnamed == first
    assert (other_branch.status_code, other_branch.detail) == (409, REUSED)
    assert len(world.db.orders.docs) == 1


def test_the_same_id_in_another_restaurant_is_another_request(monkeypatch):
    world = World(monkeypatch)

    async def scenario(world):
        mine = await create(OrderCreate(order_type="recojo", request_id=R1), MOZO)
        theirs = await create(OrderCreate(order_type="recojo", request_id=R1), staff(branch="branch-9", tenant=OTHER_TENANT))
        return mine, theirs

    mine, theirs = run(world, scenario)

    assert mine["id"] != theirs["id"] and theirs["restaurant_id"] == OTHER_TENANT
    assert len(world.db.orders.docs) == 2


@pytest.mark.parametrize("changed", [
    dict(table_id="table-3"),                      # another table of the same branch
    dict(table_id=None, order_type="recojo"),      # no table at all
    dict(order_type="llevar"),                     # the same table, another kind of order
])
def test_a_request_id_cannot_stand_for_a_different_order(monkeypatch, changed):
    world = World(monkeypatch)

    async def scenario(world):
        first = await create(OrderCreate(table_id="table-1", request_id=R1), MOZO)
        before = world.state()
        with pytest.raises(HTTPException) as refused:
            await create(OrderCreate(**{"table_id": "table-1", "request_id": R1, **changed}), MOZO)
        return first, before, refused.value

    first, before, refused = run(world, scenario)

    assert (refused.status_code, refused.detail) == (409, REUSED)
    assert world.state() == before


def test_a_refused_create_keeps_its_own_error_and_does_not_use_up_the_id(monkeypatch):
    world = World(monkeypatch)

    async def scenario(world):
        with pytest.raises(HTTPException) as missing_product:
            await create(OrderCreate(order_type="recojo", items=[OrderItemInput(product_id="nope")], request_id=R1), MOZO)
        with pytest.raises(HTTPException) as missing_table:
            await create(OrderCreate(table_id="table-404", request_id=R1), MOZO)
        nothing_yet = copy.deepcopy(world.db.orders.docs)
        made = await create(OrderCreate(order_type="recojo", request_id=R1), MOZO)
        return missing_product.value, missing_table.value, nothing_yet, made

    missing_product, missing_table, nothing_yet, made = run(world, scenario)

    assert (missing_product.status_code, missing_table.status_code) == (400, 404)
    assert "no existe" in missing_product.detail and missing_table.detail == "Mesa no encontrada"
    assert nothing_yet == [] and made["request_id"] == R1 and len(world.db.orders.docs) == 1
