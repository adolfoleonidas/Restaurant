import asyncio
from typing import Any, Dict

# Realtime hub: subscribers live in THIS process's memory, so events only reach
# clients connected to the same process. The backend must therefore run as a
# single process (one uvicorn worker); security_config.assert_single_process
# refuses to start when WEB_CONCURRENCY/UVICORN_WORKERS is greater than 1.
# Scaling out needs a shared broker (e.g. Redis pub/sub) in place of this set.
_subs: set[asyncio.Queue] = set()

# Marker a stream generator reads as "your subscription was dropped: end the
# response". Without it a subscriber whose queue overflowed would stay connected
# (the stream keeps sending pings) but never receive another event.
CLOSED = object()


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
        _close(q)


def _close(q: asyncio.Queue) -> None:
    """Drop what the slow client never read and leave only the close marker.

    Events lost here are recovered by the client: it reconnects and refetches.
    """
    while True:
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            break
    q.put_nowait(CLOSED)


# Topics: what a client refetches when an event arrives. Every event carries
# `topic` (the primary one) and `topics` (all of them). An event without a topic
# makes clients refresh everything, which is the safe default for unknown kinds.
#
#   orders    any change to an order (its lines, totals, status, account)
#   kitchen   the subset of order changes the kitchen board / kitchen alerts show
#   payments  collections, voids, refunds and payment-proof reviews
#   prepay    prepaid / pay-at-counter proofs waiting for the cashier
#   tables    floor state: seating, releasing, moving, table and zone CRUD
#   cash      cash register open / close / movements
#   catalog   products, categories and availability
#   approvals void / refund requests waiting for an owner decision
ORDERS = "orders"
KITCHEN = "kitchen"
PAYMENTS = "payments"
PREPAY = "prepay"
TABLES = "tables"
CASH = "cash"
CATALOG = "catalog"
APPROVALS = "approvals"

# Notice kind -> topics. Kinds not listed carry no topic.
_NOTICE_TOPICS = {
    "table": (TABLES,),
    "zone": (TABLES,),
    "product": (CATALOG,),
    "category": (CATALOG,),
    "cash": (CASH,),
    "approval": (APPROVALS,),
}


def _with_topics(payload: Dict[str, Any], topics) -> Dict[str, Any]:
    ordered = list(dict.fromkeys(topics))
    if ordered:
        payload["topic"] = ordered[0]
        payload["topics"] = ordered
    return payload


def order_topics(status, payment_status=None, kitchen: bool = True, extra_topics=()) -> list:
    topics = [ORDERS]
    if kitchen:
        topics.append(KITCHEN)
    if payment_status or status == "pagado":
        topics.append(PAYMENTS)
    if payment_status == "comprobante_subido":
        topics.append(PREPAY)
    topics.extend(extra_topics)
    return list(dict.fromkeys(topics))


def emit_order(restaurant_id: str, order_id: str, status: str, *, kitchen: bool = True, topics=(), **extra) -> None:
    """Publish an order change.

    `kitchen=False` is for edits the kitchen never sees (draft lines), so the
    kitchen board and its alerts are not refetched for them.

    `actor_user_id` names the user whose action caused the change, when it is
    known. A client uses it to skip the echo of its OWN write: the write already
    answered with the order, so re-reading the screen for it is pure cost. An
    event without an actor (every other publisher) is treated as somebody else's
    and refreshes as usual.
    """
    payload = {
        "type": "order",
        "restaurant_id": restaurant_id,
        "order_id": order_id,
        "status": status,
    }
    payload.update(extra)
    _with_topics(payload, order_topics(status, extra.get("payment_status"), kitchen, topics))
    publish(payload)


def emit_notice(restaurant_id: str, kind: str, **extra) -> None:
    payload = {"type": kind, "restaurant_id": restaurant_id}
    payload.update(extra)
    _with_topics(payload, _NOTICE_TOPICS.get(kind, ()))
    publish(payload)


def public_allowed(event: Dict[str, Any], rid: str, order_id: str = None) -> bool:
    if not rid or event.get("restaurant_id") != rid:
        return False
    if order_id:
        return event.get("type") == "order" and event.get("order_id") == order_id
    return event.get("type") in ("product", "category", "table")
