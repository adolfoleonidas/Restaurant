import asyncio
from notify import subscribe, unsubscribe, publish, emit_order


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
