import asyncio
from typing import Any, Dict

_subs: set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=64)
    _subs.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subs.discard(q)


def publish(event: Dict[str, Any]) -> None:
    dead = []
    for q in list(_subs):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _subs.discard(q)


def emit_order(restaurant_id: str, order_id: str, status: str, **extra) -> None:
    payload = {
        "type": "order",
        "restaurant_id": restaurant_id,
        "order_id": order_id,
        "status": status,
    }
    payload.update(extra)
    publish(payload)
