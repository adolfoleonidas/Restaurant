import asyncio
from notify import subscribe, unsubscribe, publish, emit_order, emit_notice, public_allowed


def test_publish_reaches_subscriber():
    async def run():
        q = subscribe()
        try:
            emit_order("rest-1", "ord-1", "enviado_cocina", source="public")
            event = await asyncio.wait_for(q.get(), timeout=1)
            assert event["type"] == "order"
            assert event["order_id"] == "ord-1"
            assert event["status"] == "enviado_cocina"
        finally:
            unsubscribe(q)

    asyncio.run(run())


def test_public_allowed_tracking_mode_only_own_order_events():
    assert public_allowed({"type": "order", "restaurant_id": "r1", "order_id": "o1"}, "r1", "o1") is True
    assert public_allowed({"type": "order", "restaurant_id": "r1", "order_id": "o2"}, "r1", "o1") is False
    assert public_allowed({"type": "order", "restaurant_id": "r2", "order_id": "o1"}, "r1", "o1") is False
    assert public_allowed({"type": "product", "restaurant_id": "r1"}, "r1", "o1") is False


def test_public_allowed_restaurant_mode_only_product_and_table_events():
    assert public_allowed({"type": "product", "restaurant_id": "r1"}, "r1") is True
    assert public_allowed({"type": "table", "restaurant_id": "r1", "table_id": "t1"}, "r1") is True
    assert public_allowed({"type": "order", "restaurant_id": "r1", "order_id": "o1"}, "r1") is False
    assert public_allowed({"type": "cash", "restaurant_id": "r1"}, "r1") is False
    assert public_allowed({"type": "product", "restaurant_id": "r2"}, "r1") is False


def test_emit_notice_carries_kind_and_payload():
    async def run():
        q = subscribe()
        try:
            emit_notice("rest-9", "table", table_id="t-9", status="ocupada")
            event = await asyncio.wait_for(q.get(), timeout=1)
            assert event["type"] == "table"
            assert event["table_id"] == "t-9"
            assert event["status"] == "ocupada"
        finally:
            unsubscribe(q)

    asyncio.run(run())
