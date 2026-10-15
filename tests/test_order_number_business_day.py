"""El número de pedido se numera por el día del negocio, no por UTC.

Salón y público comparten la colección `counters`, pero cada uno calculaba la clave
del día a su manera: `routes/orders.py` con el día de Lima y `routes/public.py` con
el de UTC. Lima es UTC-5, así que entre las 19:00 y las 24:00 de Lima la fecha UTC
ya es la de mañana: en esa ventana el público incrementaba el contador de mañana
mientras el salón usaba el de hoy, y dos pedidos del mismo día podían recibir el
mismo número.

La prueba fija la hora del reloj a las 02:00 UTC —las 21:00 del día anterior en
Lima—, que es exactamente la ventana donde las dos claves discrepaban.
"""
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from business_time import BUSINESS_TIMEZONE  # noqa: E402
import routes.public as public_routes  # noqa: E402

# 02:00 UTC del 11 de marzo = 21:00 del 10 de marzo en Lima. Las dos fechas
# discrepan, que es cuando el bug se veía.
CLOCK_UTC = datetime(2026, 3, 11, 2, 0, tzinfo=public_routes.timezone.utc)


class _Clock(datetime):
    """`datetime` con el reloj congelado, para no depender de la hora real."""

    @classmethod
    def now(cls, tz=None):
        return CLOCK_UTC.astimezone(tz) if tz is not None else CLOCK_UTC.replace(tzinfo=None)


class _Counters:
    def __init__(self):
        self.keys = []

    async def find_one_and_update(self, filt, update, **options):
        self.keys.append(filt["key"])
        return {"value": len(self.keys)}

    async def find_one(self, filt):
        return {"value": len(self.keys)}


class _DB:
    def __init__(self):
        self.counters = _Counters()


def _key_for(module, monkeypatch):
    db = _DB()
    monkeypatch.setattr(module, "db", db)
    monkeypatch.setattr(module, "datetime", _Clock)
    asyncio.run(module._next_order_number("rest-1"))
    return db.counters.keys[-1]


def test_public_order_numbers_use_the_business_day(monkeypatch):
    """Con el reloj en la ventana del bug, la clave debe ser la de Lima."""
    key = _key_for(public_routes, monkeypatch)
    assert key == "order_2026-03-10", (
        "public.py numbered by the UTC date: in this window it used tomorrow's "
        "counter while the floor used today's, so two orders could share a number"
    )


def test_public_and_floor_agree_on_the_counter_key(monkeypatch):
    """La comprobación que importa: las dos rutas escriben la MISMA clave."""
    import routes.orders as order_routes

    public_key = _key_for(public_routes, monkeypatch)
    floor_key = _key_for(order_routes, monkeypatch)
    assert public_key == floor_key, (
        "the floor and the public menu must increment the same daily counter, "
        "or the venue hands out the same order number twice"
    )


def test_the_business_day_is_not_utc_in_that_window(monkeypatch):
    """Deja explícito que el reloj de la prueba cae en la ventana del bug.

    Sin esto, la prueba pasaría también con el código viejo si la hora elegida no
    distinguiera las dos fechas.
    """
    utc_day = CLOCK_UTC.strftime("%Y-%m-%d")
    business_day = CLOCK_UTC.astimezone(BUSINESS_TIMEZONE).strftime("%Y-%m-%d")
    assert utc_day != business_day, "the chosen clock does not exercise the bug's window"
    assert business_day == "2026-03-10"
