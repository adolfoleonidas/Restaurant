"""Endpoints del menú del día, llamando a los handlers directamente.

Estos tests cierran el hueco que quedó abierto en la rebanada anterior: que las
reglas se apliquen de verdad al guardar, publicar, agotar y copiar, no solo que la
función de decisión sepa decidir.
"""

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from menu_day import STATUS_DRAFT, STATUS_PUBLISHED, index_items, resolve
from routes import menu as menu_routes

RID = "r1"
ADMIN = {"id": "u1", "restaurant_id": RID, "role": "admin", "full_name": "Dueña"}


class _Result:
    def __init__(self, matched=0, modified=0):
        self.matched_count = matched
        self.modified_count = modified


class _Collection:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    def _matches(self, doc, query):
        for key, value in query.items():
            if key == "items.product_id":
                if not any(i.get("product_id") == value for i in doc.get("items") or []):
                    return False
            elif doc.get(key) != value:
                return False
        return True

    def _copy(self, doc):
        return dict(doc)

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if self._matches(doc, query):
                return self._copy(doc)
        return None

    def find(self, query, projection=None):
        found = [self._copy(d) for d in self.docs if self._matches(d, query)]
        return _Cursor(found)

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if self._matches(doc, query):
                for key, value in (update.get("$set") or {}).items():
                    if key == "items.$.sold_out":
                        objetivo = query.get("items.product_id")
                        for item in doc.get("items") or []:
                            if item.get("product_id") == objetivo:
                                item["sold_out"] = value
                    elif key.startswith("items.$.attr."):
                        # `items.$.attr.<nombre>` del endpoint de atributos.
                        objetivo = query.get("items.product_id")
                        nombre = key.rsplit(".", 1)[1]
                        for item in doc.get("items") or []:
                            if item.get("product_id") == objetivo:
                                item.setdefault("attr", {})[nombre] = value
                    else:
                        doc[key] = value
                return _Result(1, 1)
        if upsert:
            doc = dict(update.get("$setOnInsert") or {})
            doc.update(update.get("$set") or {})
            self.docs.append(doc)
            return _Result(0, 1)
        return _Result(0, 0)

    async def delete_many(self, query):
        antes = len(self.docs)
        self.docs = [d for d in self.docs if not self._matches(d, query)]
        return _Result(antes - len(self.docs), antes - len(self.docs))


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, limit):
        return self.docs[:limit]


class _DB:
    def __init__(self, products, days=None):
        self.products = _Collection(products)
        self.menu_days = _Collection(days)

    def __getitem__(self, name):
        return getattr(self, name)


def _product(pid, name, price, **extra):
    base = {"id": pid, "restaurant_id": RID, "name": name, "price": price, "category_id": "c1", "is_available": True}
    base.update(extra)
    return base


def _bind(monkeypatch, db):
    monkeypatch.setattr(menu_routes, "db", db)
    monkeypatch.setattr(menu_routes, "emit_notice", lambda *a, **k: None)


def _day(docs, fecha="2026-03-10", status=STATUS_PUBLISHED, items=None):
    docs.append({
        "id": "d1", "restaurant_id": RID, "date": fecha, "status": status,
        "items": items if items is not None else [{"product_id": "p1", "price": None, "sold_out": False}],
    })
    return docs


# ── Guardar no es publicar ───────────────────────────────────────────────────

def test_guardar_sin_publicar_no_cambia_la_carta(monkeypatch):
    db = _DB([_product("p1", "Arroz con pollo", 12.0), _product("p2", "Ceviche", 38.0)])
    _bind(monkeypatch, db)
    asyncio.run(menu_routes.save_day(menu_routes.DaySave(date="2026-03-10", items=[menu_routes.DayItem(product_id="p1")]), ADMIN))

    assert db.menu_days.docs[0]["status"] == STATUS_DRAFT
    # Y el cliente sigue viendo el plato que no se seleccionó: sin publicar, la
    # carta no se toca. Es la garantía de retrocompatibilidad.
    d = resolve(_product("p2", "Ceviche", 38.0), {}, day_published=False, strict=True)
    assert d.offered is True


def test_publicar_si_cambia_la_carta(monkeypatch):
    db = _DB([_product("p1", "Arroz con pollo", 12.0), _product("p2", "Ceviche", 38.0)])
    _bind(monkeypatch, db)
    asyncio.run(menu_routes.save_day(
        menu_routes.DaySave(date="2026-03-10", items=[menu_routes.DayItem(product_id="p1")], publish=True), ADMIN))

    assert db.menu_days.docs[0]["status"] == STATUS_PUBLISHED
    items = index_items(db.menu_days.docs[0])
    # El publicado manda: p2 no está en el menú de hoy → el cliente no lo ve…
    assert resolve(_product("p2", "Ceviche", 38.0), items, True, strict=True).offered is False
    # …pero el mozo sí puede pedirlo.
    assert resolve(_product("p2", "Ceviche", 38.0), items, True, strict=False).offered is True


def test_el_precio_del_dia_se_guarda_y_manda(monkeypatch):
    db = _DB([_product("p1", "Arroz con pollo", 12.0)])
    _bind(monkeypatch, db)
    asyncio.run(menu_routes.save_day(
        menu_routes.DaySave(date="2026-03-10", items=[menu_routes.DayItem(product_id="p1", price=9.5)], publish=True), ADMIN))

    items = index_items(db.menu_days.docs[0])
    assert resolve(_product("p1", "Arroz con pollo", 12.0), items, True, strict=True).price == 9.5


def test_guardar_un_plato_que_no_existe_se_rechaza(monkeypatch):
    db = _DB([_product("p1", "Arroz con pollo", 12.0)])
    _bind(monkeypatch, db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(menu_routes.save_day(
            menu_routes.DaySave(date="2026-03-10", items=[menu_routes.DayItem(product_id="fantasma")]), ADMIN))
    assert exc.value.status_code == 400


def test_una_fecha_mal_escrita_se_rechaza(monkeypatch):
    _bind(monkeypatch, _DB([_product("p1", "Arroz", 12.0)]))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(menu_routes.read_day(date="10/03/2026", user=ADMIN))
    assert exc.value.status_code == 400


# ── El menú vence solo ───────────────────────────────────────────────────────

def test_publicar_un_dia_no_afecta_al_siguiente(monkeypatch):
    db = _DB([_product("p1", "Arroz con pollo", 12.0), _product("p2", "Ceviche", 38.0)])
    _bind(monkeypatch, db)
    asyncio.run(menu_routes.save_day(
        menu_routes.DaySave(date="2026-03-10", items=[menu_routes.DayItem(product_id="p1")], publish=True), ADMIN))

    # Al día siguiente no hay documento: la selección de ayer no se arrastra.
    siguiente = asyncio.run(menu_routes.read_day(date="2026-03-11", user=ADMIN))
    assert siguiente["published"] is False
    assert siguiente["has_menu"] is False
    assert all(d["offered_today"] for d in siguiente["catalog"])


# ── Agotar es inmediato ──────────────────────────────────────────────────────

def test_agotar_en_el_menu_del_dia_corta_las_dos_puertas(monkeypatch):
    db = _DB([_product("p1", "Arroz con pollo", 12.0)], _day([]))
    _bind(monkeypatch, db)
    asyncio.run(menu_routes.toggle_sold_out(menu_routes.SoldOutToggle(date="2026-03-10", product_id="p1"), ADMIN))

    items = index_items(db.menu_days.docs[0])
    assert items["p1"]["sold_out"] is True
    assert resolve(_product("p1", "Arroz con pollo", 12.0), items, True, strict=True).offered is False
    assert resolve(_product("p1", "Arroz con pollo", 12.0), items, True, strict=False).offered is False


def test_agotar_sin_menu_del_dia_marca_el_catalogo(monkeypatch):
    # No se inventa un menú vacío (dejaría la carta en blanco): se marca el plato,
    # que es lo que ya hacía la pantalla de «Agotar o habilitar».
    db = _DB([_product("p1", "Arroz con pollo", 12.0)])
    _bind(monkeypatch, db)
    salida = asyncio.run(menu_routes.toggle_sold_out(
        menu_routes.SoldOutToggle(date="2026-03-10", product_id="p1"), ADMIN))

    assert salida["scope"] == "catalog"
    assert db.products.docs[0]["is_available"] is False
    assert db.menu_days.docs == []


def test_agotar_algo_que_hoy_no_se_ofrece_se_rechaza(monkeypatch):
    db = _DB([_product("p1", "Arroz con pollo", 12.0), _product("p2", "Ceviche", 38.0)], _day([]))
    _bind(monkeypatch, db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(menu_routes.toggle_sold_out(
            menu_routes.SoldOutToggle(date="2026-03-10", product_id="p2"), ADMIN))
    assert exc.value.status_code == 400


# ── Copiar de otro día ───────────────────────────────────────────────────────

def test_copiar_trae_los_platos_pero_no_el_estado_ni_el_precio(monkeypatch):
    origen = []
    _day(origen, fecha="2026-03-09", items=[
        {"product_id": "p1", "price": 9.5, "sold_out": True},
        {"product_id": "p2", "price": None, "sold_out": False},
    ])
    db = _DB([_product("p1", "Arroz con pollo", 12.0), _product("p2", "Ceviche", 38.0)], origen)
    _bind(monkeypatch, db)

    salida = asyncio.run(menu_routes.copy_from(
        menu_routes.CopyFrom(date="2026-03-10", from_date="2026-03-09"), ADMIN))

    assert salida["copied"] == 2
    destino = [d for d in db.menu_days.docs if d["date"] == "2026-03-10"][0]
    # Un plato que ayer se agotó no llega agotado hoy, y el precio de ayer no se
    # arrastra: eso es cobrar mal en silencio.
    assert [(i["product_id"], i["price"], i["sold_out"]) for i in destino["items"]] == [
        ("p1", None, False), ("p2", None, False),
    ]
    # Y entra como borrador: copiar no publica.
    assert destino["status"] == STATUS_DRAFT


def test_copiar_de_un_dia_vacio_se_rechaza(monkeypatch):
    _bind(monkeypatch, _DB([_product("p1", "Arroz", 12.0)]))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(menu_routes.copy_from(
            menu_routes.CopyFrom(date="2026-03-10", from_date="2026-03-09"), ADMIN))
    assert exc.value.status_code == 404
