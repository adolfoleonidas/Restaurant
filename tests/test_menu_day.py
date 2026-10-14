"""Menú del día: la decisión de «¿se ofrece hoy y a qué precio?».

Lo que se prueba aquí es la tabla de decisión, que es donde está el riesgo: si
esto se equivoca, o se le esconde al cliente un plato que sí vende, o se le deja
pedir uno agotado. Las dos cosas cuestan dinero.
"""

from datetime import datetime, timezone

import asyncio

import pytest

from menu_day import (
    NOT_IN_MENU,
    SOLD_OUT,
    index_items,
    resolve,
    service_date,
    today_menu,
)


def producto(**extra):
    base = {"id": "p1", "name": "Arroz con pollo", "price": 12.0, "is_available": True}
    base.update(extra)
    return base


def dia(items, status="published"):
    return {"date": "2026-03-10", "status": status, "items": items}


# ── Sin menú publicado: todo como siempre ────────────────────────────────────
# Es la garantía de retrocompatibilidad: desplegar esto no le cambia la carta a
# quien no use la función.

def test_sin_menu_publicado_todo_se_ofrece_al_precio_del_catalogo():
    d = resolve(producto(), {}, day_published=False, strict=True)
    assert d.offered is True
    assert d.price == 12.0
    assert d.reason is None


def test_sin_menu_publicado_el_mozo_tambien_lo_tiene():
    d = resolve(producto(), {}, day_published=False, strict=False)
    assert d.offered is True


# ── Con menú publicado: manda la selección del día ───────────────────────────

def test_un_plato_del_menu_de_hoy_se_ofrece():
    items = index_items(dia([{"product_id": "p1", "price": 12.0}]))
    d = resolve(producto(), items, day_published=True, strict=True)
    assert d.offered is True
    assert d.price == 12.0


def test_un_plato_fuera_del_menu_no_se_le_ofrece_al_cliente():
    items = index_items(dia([{"product_id": "otro", "price": 5.0}]))
    d = resolve(producto(), items, day_published=True, strict=True)
    assert d.offered is False
    assert d.reason == NOT_IN_MENU


def test_pero_el_mozo_si_puede_pedirlo():
    # Parar a un mozo a media atención es peor que la excepción: se le deja, y la
    # pantalla se encarga de avisarle de que hoy no está en el menú.
    items = index_items(dia([{"product_id": "otro", "price": 5.0}]))
    d = resolve(producto(), items, day_published=True, strict=False)
    assert d.offered is True
    assert d.reason is None


def test_la_carta_fija_se_ofrece_aunque_no_este_en_el_menu():
    # Bebidas y clásicos: no hay que volver a seleccionarlos cada mañana.
    items = index_items(dia([{"product_id": "otro", "price": 5.0}]))
    d = resolve(producto(is_fixed=True), items, day_published=True, strict=True)
    assert d.offered is True
    assert d.price == 12.0


# ── El precio del día ────────────────────────────────────────────────────────

def test_el_precio_del_dia_manda_sobre_el_del_catalogo():
    items = index_items(dia([{"product_id": "p1", "price": 9.5}]))
    d = resolve(producto(), items, day_published=True, strict=False)
    assert d.price == 9.5


def test_sin_precio_en_el_dia_se_usa_el_del_catalogo():
    items = index_items(dia([{"product_id": "p1", "price": None}]))
    d = resolve(producto(), items, day_published=True, strict=False)
    assert d.price == 12.0


# ── Agotado: corta en las dos puertas ────────────────────────────────────────

def test_agotado_en_el_dia_corta_al_cliente_y_al_mozo():
    items = index_items(dia([{"product_id": "p1", "price": 12.0, "sold_out": True}]))
    for strict in (True, False):
        d = resolve(producto(), items, day_published=True, strict=strict)
        assert d.offered is False, f"strict={strict}"
        assert d.reason == SOLD_OUT


def test_agotado_en_el_catalogo_corta_aunque_no_haya_menu():
    # La regla vieja sigue mandando: es la que protege al cliente hoy en producción.
    for published in (True, False):
        d = resolve(producto(is_available=False), {}, day_published=published, strict=False)
        assert d.offered is False
        assert d.reason == SOLD_OUT


def test_un_plato_fijo_pero_agotado_no_se_ofrece():
    items = index_items(dia([{"product_id": "p1", "price": 12.0, "sold_out": True}]))
    d = resolve(producto(is_fixed=True), items, day_published=True, strict=True)
    assert d.offered is False


# ── Piezas sueltas ───────────────────────────────────────────────────────────

def test_index_items_tolera_que_no_haya_menu():
    assert index_items(None) == {}
    assert index_items({}) == {}
    assert index_items({"items": None}) == {}
    # Un item sin producto no puede tumbar el índice.
    assert index_items({"items": [{"price": 1}, {"product_id": "p1"}]}) == {"p1": {"product_id": "p1"}}


def test_la_fecha_del_servicio_es_la_del_negocio_no_la_de_utc():
    # 02:00 UTC del 1 de enero son las 21:00 del 31 de diciembre en Lima: si se
    # usara UTC, el menú del día cambiaría cinco horas antes de tiempo.
    momento = datetime(2026, 1, 1, 2, 0, tzinfo=timezone.utc)
    assert service_date(momento) == "2025-12-31"


def test_una_fecha_sin_zona_se_toma_como_utc_y_no_revienta():
    assert service_date(datetime(2026, 3, 10, 18, 0)) == "2026-03-10"


# ── Cargar el menú del día ───────────────────────────────────────────────────
# La base entra por parámetro: si este módulo capturara el cliente global al
# importar, los tests se irían a un Mongo real (pasó, y tumbó 66 tests).

class _MenuDays:
    def __init__(self, doc=None):
        self.doc = doc
        self.queried = []

    async def find_one(self, query, projection=None):
        self.queried.append(query)
        return self.doc


class _DB:
    def __init__(self, doc=None):
        self.menu_days = _MenuDays(doc)


MEDIODIA = datetime(2026, 3, 10, 18, 0, tzinfo=timezone.utc)


def test_un_borrador_no_manda_sobre_la_carta():
    # Guardar el menú de hoy sin publicarlo no puede cambiar lo que se ofrece.
    borrador = {"date": "2026-03-10", "status": "draft", "items": [{"product_id": "p1"}]}
    fecha, day = asyncio.run(today_menu(_DB(borrador), "r1", moment=MEDIODIA))
    assert fecha == "2026-03-10"
    assert day is None


def test_el_publicado_si_manda_y_se_busca_por_fecha_del_negocio():
    publicado = {"date": "2026-03-10", "status": "published", "items": [{"product_id": "p1"}]}
    db = _DB(publicado)
    fecha, day = asyncio.run(today_menu(db, "r1", moment=MEDIODIA))
    assert day is publicado
    # Se pide por la fecha del negocio y por restaurante: sin eso, un menú de otro
    # local o de otro día podría aplicarse aquí.
    assert db.menu_days.queried == [{"restaurant_id": "r1", "date": fecha}]


def test_sin_documento_no_hay_nada_que_aplicar():
    fecha, day = asyncio.run(today_menu(_DB(None), "r1", moment=MEDIODIA))
    assert fecha == "2026-03-10"
    assert day is None
