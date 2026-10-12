import asyncio
from typing import Any, Dict

# Realtime hub: subscribers live in THIS process's memory, so events only reach
# clients connected to the same process. The backend must therefore run as a
# single process (one uvicorn worker); security_config.assert_single_process
# refuses to start when WEB_CONCURRENCY/UVICORN_WORKERS is greater than 1.
# Scaling out needs a shared broker (e.g. Redis pub/sub) in place of this set.
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


def emit_notice(restaurant_id: str, kind: str, **extra) -> None:
    payload = {"type": kind, "restaurant_id": restaurant_id}
    payload.update(extra)
    publish(payload)


def public_allowed(event: Dict[str, Any], rid: str, order_id: str = None) -> bool:
    if not rid or event.get("restaurant_id") != rid:
        return False
    if order_id:
        return event.get("type") == "order" and event.get("order_id") == order_id
    return event.get("type") in ("product", "table")
