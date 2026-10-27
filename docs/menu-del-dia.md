# Menú del día

Separa **el catálogo** (lo que el restaurante tiene registrado) de **lo que se vende
hoy**. Sin esta capa, vender 6 de 40 platos obligaba a apagar 34 a mano y a volver a
encenderlos al día siguiente, que es el problema que esto resuelve.

## Las tres garantías

1. **Sin menú publicado para hoy, nada cambia.** Si no hay documento para la fecha,
   la disponibilidad es la de siempre (`is_available`). Es lo que permite desplegar
   esto sin tocarle la carta a nadie que no lo use.
2. **El menú vence solo.** Va guardado por fecha: mañana no hay documento y la
   selección de ayer no se arrastra. Sin barredores ni tareas programadas.
3. **El precio se copia a la línea del pedido.** Un cambio de precio —o el precio
   del día— no altera nada ya confirmado.

Y una cuarta que protege al cliente: **lo agotado corta en las dos puertas** (carta
QR y mozo), pero **lo que hoy no está en el menú solo corta al cliente**. Al mozo se
le deja pedirlo: parar a alguien a media atención es peor que la excepción.

## Carta fija y platos del día

- **Carta fija** (`is_fixed`): bebidas y clásicos. Se ofrecen siempre.
- **Del día** (por defecto): solo se ofrecen si están en el menú publicado de hoy.

Sin marcar la carta fija, **publicar un menú esconde todo lo que no esté en él**.
Por eso el interruptor vive en la pestaña «Carta fija».

## Piezas

| Dónde | Qué |
|---|---|
| `backend/menu_day.py` | La decisión: qué se ofrece y a qué precio. Una sola fuente para las dos puertas |
| `backend/routes/menu.py` | `GET`/`PUT /menu/day`, `POST /menu/day/sold-out`, `POST /menu/day/copy-from` |
| `backend/business_time.py` | La zona del negocio, para que «hoy» no lo decida un dispositivo con la hora mal puesta |
| `frontend/src/pages/menu/` | La pantalla: `GestionarMenu` (pestañas), `MenuDayView` (tarjetas y lista), `useMenuDay` (estado) |

La pantalla de gestión es **`/gestion/menu`** («Menú de hoy» en el menú lateral),
solo dueño y encargado. **`/menu`** es la carta pública.

## Cómo se lee la pantalla

- **Estado arriba, junto al título**: `Sin menú`, `Sin guardar` (hay platos
  elegidos en pantalla), `Borrador` (guardado, la carta todavía no cambia) o
  `Publicado`. Si hay cambios locales sobre un menú guardado, aparece además
  `Cambios sin guardar`.
- **Platos agrupados por categoría**, con buscador y filtros `Todos`, `En menú`,
  `Fuera` y `Agotados`. El resumen cuenta los que se ofrecen hoy.
- **Cada plato dice su estado** (`En el menú`, `Fuera hoy`, `Agotado`) y tiene un
  interruptor **Ofrecer hoy**. La casilla de la izquierda es para el trabajo en
  bloque; al marcar varias aparece la barra para aplicar el cambio.
- **El precio solo se edita cuando el plato se ofrece y es del día**. Vacío significa
  «usa el precio de carta», que se muestra al lado. Un plato de carta fija no tiene
  precio de hoy: se ofrece siempre.
- **`Marcar agotado` es inmediato** y no espera a publicar; los pedidos ya tomados
  siguen. `Habilitar` lo devuelve a la carta.
- **Con cero platos ofrecidos no se puede publicar** y se propone copiar el menú de
  ayer. Guardar borrador sí se permite.
- **En el teléfono**, la lista compacta es la vista por defecto y `Guardar` /
  `Publicar` quedan fijos encima de la navegación, con el conteo y el aviso de
  cambios.

## Pantallas

- **Hoy**: tarjetas o lista, ofrecer y quitar de una en una o **en bloque**, agotar
  al instante, **precio editable en la fila cuando corresponde**, copiar de otro día,
  guardar borrador y **publicar**. Preparar no es publicar: el borrador no cambia la
  carta.
- **Semana**: los próximos siete días con su estado real (publicado, borrador o sin
  menú), fechas legibles y poder abrir cualquiera. Abrir otro día se avisa en
  pantalla, porque publicar en la fecha equivocada no se deshace de un vistazo.
- **Carta fija**: el interruptor «Siempre / Solo del día» de cada plato.

## Plantillas y repetición

Las plantillas se guardan desde **Semana**: guardan **los platos, no los precios**
(un precio viejo arrastrado es cobrar mal sin que nadie lo note). Repetir es
explícito: hay que elegir los días; **programar esta semana no repite todas las
semanas**.
