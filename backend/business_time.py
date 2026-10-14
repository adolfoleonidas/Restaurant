"""La zona horaria del negocio, en un sitio neutral.

Estaba copiada literal en `routes/cash.py` y `routes/reports.py`. Vive aquí
aparte porque `menu_day` la necesita y **no puede** importarla de un router: eso
arrastra el paquete `routes` completo, que importa `orders`, que importa
`menu_day` — un ciclo que revienta al arrancar.

El día del servicio se calcula con esta zona y no con UTC: a las 02:00 UTC ya es
el día siguiente en Lima, y el menú del día cambiaría cinco horas antes de tiempo.
"""

from zoneinfo import ZoneInfo

BUSINESS_TIMEZONE = ZoneInfo("America/Lima")
