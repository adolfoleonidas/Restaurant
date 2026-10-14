"""Menú del día: separa el catálogo de lo que se vende hoy.

El catálogo (`products`) es lo que el restaurante tiene registrado y no cambia al
cambiar el menú. `menu_days` guarda, por fecha, **qué se ofrece ese día** y a qué
precio. Sin esta capa, vender 6 de 40 platos obligaba a apagar 34 a mano y a
volver a encenderlos al día siguiente.

Tres reglas mandan aquí:

1. **Sin menú publicado para hoy, nada cambia.** Si no hay documento para la
   fecha, la disponibilidad es la de siempre (`is_available`). Es lo que permite
   desplegar esto sin tocarle la carta a nadie que no lo use.
2. **El menú vence solo.** Va guardado por fecha: mañana no hay documento, así que
   la selección de ayer no se ofrece por accidente. No hace falta ningún barredor.
3. **El precio efectivo sale de aquí.** Si el día trae precio, manda ese; si no,
   el del catálogo. Los dos caminos de pedido (mozo y QR) escriben ese precio en
   la línea del pedido, y por eso cambiar un precio después **no** toca lo ya
   confirmado.
"""

from datetime import datetime, timezone
from typing import NamedTuple

from business_time import BUSINESS_TIMEZONE

# Un plato es «de hoy» (solo se ofrece si está en el menú del día) salvo que esté
# marcado como carta fija: bebidas y clásicos que se ofrecen siempre.
DEFAULT_IS_FIXED = False

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"

# El nombre de la colección, en un solo sitio: el lector (aquí) y el escritor que
# vendrá en la siguiente rebanada tienen que coincidir, y un nombre repetido a
# mano es la forma más fácil de que dejen de coincidir sin que nadie se entere.
COLLECTION = "menu_days"

# Motivos por los que un plato no se ofrece. Se devuelven para que cada puerta dé
# su mensaje: al cliente «no está en el menú de hoy» y al mozo «agotado» no son lo
# mismo, y confundirlos hace perder tiempo en el pase.
SOLD_OUT = "agotado"
NOT_IN_MENU = "fuera_del_menu"


class Decision(NamedTuple):
    offered: bool
    price: float
    reason: str | None = None


def service_date(moment: datetime | None = None) -> str:
    """La fecha del servicio (YYYY-MM-DD) en la zona del negocio, no en UTC."""
    moment = moment or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(BUSINESS_TIMEZONE).strftime("%Y-%m-%d")


def index_items(day: dict | None) -> dict:
    """`{product_id: item}` del menú del día. Vacío si no hay menú."""
    if not day:
        return {}
    return {
        item["product_id"]: item
        for item in (day.get("items") or [])
        if item.get("product_id")
    }


def resolve(product: dict, day_items: dict, day_published: bool, strict: bool) -> Decision:
    """¿Se ofrece este plato hoy, a qué precio y —si no— por qué?

    `strict` distingue las dos puertas a propósito: la carta del cliente (QR)
    ofrece **solo** el menú de hoy, mientras que el mozo puede seguir añadiendo
    algo que hoy no está en el menú —parar a alguien a media atención es peor que
    la excepción—. Lo que sí corta en las dos es lo agotado.
    """
    price = float(product.get("price") or 0)

    # Agotado es agotado en las dos puertas: es la regla que protege al cliente.
    if not product.get("is_available", True):
        return Decision(False, price, SOLD_OUT)
    item = day_items.get(product.get("id"))
    if item and item.get("sold_out"):
        return Decision(False, price, SOLD_OUT)

    # Sin menú publicado para hoy, todo sigue como siempre.
    if not day_published:
        return Decision(True, price)

    if product.get("is_fixed", DEFAULT_IS_FIXED):
        return Decision(True, price)

    if item is None:
        # Fuera del menú de hoy: el cliente no lo ve; el mozo sí puede pedirlo.
        return Decision(not strict, price, None if not strict else NOT_IN_MENU)

    if item.get("price") is not None:
        price = float(item["price"])
    return Decision(True, price)


async def day_menu(db, restaurant_id: str, date: str, *, published_only: bool = True) -> dict | None:
    """El menú de esa fecha, o None si no hay nada que aplicar.

    La base entra por parámetro a propósito: este módulo no captura el cliente
    global al importar. El arnés de pruebas sustituye `db` módulo a módulo, así
    que un `from database import db` aquí se quedaría con el cliente real y
    intentaría hablar con un Mongo que no existe.
    """
    day = await _collection(db).find_one({"restaurant_id": restaurant_id, "date": date}, {"_id": 0})
    if not day:
        return None
    if published_only and day.get("status") != STATUS_PUBLISHED:
        return None
    return day


def _collection(db):
    """La colección del menú, si esta base la expone.

    En producción el driver resuelve cualquier colección al vuelo y una que no
    tenga documentos devuelve `None` —que es justo «hoy no hay menú»—. Las bases
    falsas de los tests son dobles explícitos que solo declaran las colecciones
    que ya existían, así que aquí la ausencia significa lo mismo: no hay menú.
    """
    return getattr(db, COLLECTION, None)


async def today_menu(db, restaurant_id: str, *, published_only: bool = True, moment: datetime | None = None):
    """Atajo: `(fecha, menú)` de hoy."""
    date = service_date(moment)
    collection = _collection(db)
    if collection is None:
        return date, None
    return date, await day_menu(db, restaurant_id, date, published_only=published_only)
