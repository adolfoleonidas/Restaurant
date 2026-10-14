"""Plantillas del menú y repetición explícita.

Lo que se fija aquí:

* una plantilla guarda **los platos, no los precios** (un precio viejo arrastrado es
  cobrar mal sin que nadie lo note);
* **aplicar deja borrador**: preparar no es publicar;
* **la repetición es explícita**: hay que decir qué días, y no existe un «repetir
  siempre» que se active solo;
* una plantilla vieja **no resucita** platos que ya no existen.
"""

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from routes import menu as menu_routes

RID = "r1"
ADMIN = {"id": "u1", "restaurant_id": RID, "role": "admin", "full_name": "Dueña"}


class _Result:
    def __init__(self, matched=0, modified=0, deleted=0):
        self.matched_count = matched
        self.modified_count = modified
        self.deleted_count = deleted


class _Collection:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    def _matches(self, doc, query):
        return all(doc.get(k) == v for k, v in query.items())

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if self._matches(doc, query):
                return dict(doc)
        return None

    def find(self, query, projection=None):
        return _Cursor([dict(d) for d in self.docs if self._matches(d, query)])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if self._matches(doc, query):
                doc.update(update.get("$set") or {})
                return _Result(1, 1)
        if upsert:
            nuevo = dict(update.get("$setOnInsert") or {})
            nuevo.update(update.get("$set") or {})
            self.docs.append(nuevo)
            return _Result(0, 1)
        return _Result(0, 0)

    async def delete_one(self, query):
        for i, doc in enumerate(self.docs):
            if self._matches(doc, query):
                self.docs.pop(i)
                return _Result(0, 0, 1)
        return _Result(0, 0, 0)


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, limit):
        return self.docs[:limit]


class _DB:
    def __init__(self, products=None, days=None, templates=None):
        self.products = _Collection(products or [])
        self.menu_days = _Collection(days or [])
        self.menu_templates = _Collection(templates or [])

    def __getitem__(self, name):
        return getattr(self, name)


def _product(pid, name="Plato"):
    return {"id": pid, "restaurant_id": RID, "name": name, "price": 12.0, "is_available": True}


def _bind(monkeypatch, db):
    monkeypatch.setattr(menu_routes, "db", db)
    monkeypatch.setattr(menu_routes, "emit_notice", lambda *a, **k: None)


def _dia(docs, fecha, items, status="published"):
    docs.append({"id": f"d-{fecha}", "restaurant_id": RID, "date": fecha, "status": status, "items": items})


def _plantilla(docs, nombre="Almuerzo habitual", ids=("p1", "p2")):
    docs.append({"id": "t1", "restaurant_id": RID, "name": nombre, "items": [{"product_id": i} for i in ids]})


# ── Guardar ──────────────────────────────────────────────────────────────────

def test_guarda_los_platos_del_dia_sin_precios(monkeypatch):
    # El día trae un precio propio (9.5): la plantilla NO se lo lleva.
    dias = []
    _dia(dias, "2026-03-10", [{"product_id": "p1", "price": 9.5, "sold_out": False}])
    db = _DB([_product("p1")], dias)
    _bind(monkeypatch, db)

    salida = asyncio.run(menu_routes.save_template(
        menu_routes.TemplateSave(name="Almuerzo habitual", from_date="2026-03-10"), ADMIN))

    assert salida["count"] == 1
    guardada = db.menu_templates.docs[0]
    assert guardada["items"] == [{"product_id": "p1"}]
    assert "price" not in guardada["items"][0]


def test_un_nombre_muy_corto_se_rechaza(monkeypatch):
    _bind(monkeypatch, _DB([_product("p1")], []))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(menu_routes.save_template(
            menu_routes.TemplateSave(name="ab", from_date="2026-03-10"), ADMIN))
    assert exc.value.status_code == 400


def test_guardar_de_un_dia_vacio_se_rechaza(monkeypatch):
    _bind(monkeypatch, _DB([_product("p1")], []))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(menu_routes.save_template(
            menu_routes.TemplateSave(name="Almuerzo habitual", from_date="2026-03-10"), ADMIN))
    assert exc.value.status_code == 404


def test_el_mismo_nombre_reemplaza_en_vez_de_duplicar(monkeypatch):
    plantillas = []
    _plantilla(plantillas, ids=("p1",))
    dias = []
    _dia(dias, "2026-03-10", [{"product_id": "p1"}, {"product_id": "p2"}])
    db = _DB([_product("p1"), _product("p2")], dias, plantillas)
    _bind(monkeypatch, db)

    salida = asyncio.run(menu_routes.save_template(
        menu_routes.TemplateSave(name="Almuerzo habitual", from_date="2026-03-10"), ADMIN))

    assert salida["replaced"] is True
    assert len(db.menu_templates.docs) == 1
    assert len(db.menu_templates.docs[0]["items"]) == 2


# ── Aplicar ──────────────────────────────────────────────────────────────────

def test_aplicar_deja_borrador_y_no_publica(monkeypatch):
    plantillas = []
    _plantilla(plantillas)
    db = _DB([_product("p1"), _product("p2")], [], plantillas)
    _bind(monkeypatch, db)

    salida = asyncio.run(menu_routes.apply_template(
        "t1", menu_routes.TemplateTarget(date="2026-03-11"), ADMIN))

    assert salida["applied"] == 2
    assert salida["status"] == "draft"
    assert db.menu_days.docs[0]["status"] == "draft"


def test_aplicar_no_resucita_platos_borrados(monkeypatch):
    # La plantilla es de antes de que se borrara p2: no puede volver a ofrecerlo.
    plantillas = []
    _plantilla(plantillas, ids=("p1", "p2"))
    db = _DB([_product("p1")], [], plantillas)
    _bind(monkeypatch, db)

    salida = asyncio.run(menu_routes.apply_template(
        "t1", menu_routes.TemplateTarget(date="2026-03-11"), ADMIN))

    assert salida["applied"] == 1
    assert [i["product_id"] for i in db.menu_days.docs[0]["items"]] == ["p1"]


def test_una_plantilla_que_no_existe_se_rechaza(monkeypatch):
    _bind(monkeypatch, _DB([_product("p1")]))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(menu_routes.apply_template("fantasma", menu_routes.TemplateTarget(date="2026-03-11"), ADMIN))
    assert exc.value.status_code == 404


# ── Repetir: explícito ───────────────────────────────────────────────────────

def test_repetir_solo_toca_los_dias_que_se_le_dicen(monkeypatch):
    plantillas = []
    _plantilla(plantillas)
    db = _DB([_product("p1"), _product("p2")], [], plantillas)
    _bind(monkeypatch, db)

    # 2026-03-09 es lunes: pide lunes y miércoles de una semana.
    salida = asyncio.run(menu_routes.repeat_template(
        "t1", menu_routes.TemplateRepeat(from_date="2026-03-09", weekdays=[0, 2], weeks=1), ADMIN))

    assert salida["days"] == ["2026-03-09", "2026-03-11"]
    # Los demás días de esa semana quedan intactos: no se toca lo que no se pidió.
    assert [d["date"] for d in db.menu_days.docs] == ["2026-03-09", "2026-03-11"]


def test_repetir_varias_semanas_salta_a_la_siguiente(monkeypatch):
    plantillas = []
    _plantilla(plantillas)
    db = _DB([_product("p1"), _product("p2")], [], plantillas)
    _bind(monkeypatch, db)

    salida = asyncio.run(menu_routes.repeat_template(
        "t1", menu_routes.TemplateRepeat(from_date="2026-03-09", weekdays=[0], weeks=2), ADMIN))

    assert salida["days"] == ["2026-03-09", "2026-03-16"]


def test_repetir_sin_dias_se_rechaza(monkeypatch):
    # No hay «repetir siempre»: sin días no se hace nada, en vez de adivinar.
    plantillas = []
    _plantilla(plantillas)
    _bind(monkeypatch, _DB([_product("p1")], [], plantillas))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(menu_routes.repeat_template(
            "t1", menu_routes.TemplateRepeat(from_date="2026-03-09", weekdays=[]), ADMIN))
    assert exc.value.status_code == 400


def test_repetir_un_dia_invalido_se_rechaza(monkeypatch):
    plantillas = []
    _plantilla(plantillas)
    _bind(monkeypatch, _DB([_product("p1")], [], plantillas))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(menu_routes.repeat_template(
            "t1", menu_routes.TemplateRepeat(from_date="2026-03-09", weekdays=[9]), ADMIN))
    assert exc.value.status_code == 400


def test_listar_y_borrar(monkeypatch):
    plantillas = []
    _plantilla(plantillas)
    db = _DB([_product("p1")], [], plantillas)
    _bind(monkeypatch, db)

    listado = asyncio.run(menu_routes.list_templates(ADMIN))
    assert listado == [{"id": "t1", "name": "Almuerzo habitual", "count": 2, "updated_at": None}]

    asyncio.run(menu_routes.delete_template("t1", ADMIN))
    assert db.menu_templates.docs == []
    with pytest.raises(HTTPException):
        asyncio.run(menu_routes.delete_template("t1", ADMIN))
