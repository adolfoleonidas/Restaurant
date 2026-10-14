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
Por eso el interruptor vive en la pestaña «Catálogo».

## Piezas

| Dónde | Qué |
|---|---|
| `backend/menu_day.py` | La decisión: qué se ofrece y a qué precio. Una sola fuente para las dos puertas |
| `backend/routes/menu.py` | `GET`/`PUT /menu/day`, `POST /menu/day/sold-out`, `POST /menu/day/copy-from` |
| `backend/business_time.py` | La zona del negocio, para que «hoy» no lo decida un dispositivo con la hora mal puesta |
| `frontend/src/pages/menu/` | La pantalla: `GestionarMenu` (pestañas), `MenuDayView` (tarjetas y lista), `useMenuDay` (estado) |

La ruta es **`/menu`** («Menú de hoy» en el menú lateral), solo dueño y encargado.

## Pantallas

- **Hoy**: tarjetas o lista, ofrecer y quitar de una en una o **en bloque**, agotar
  al instante, **precio editable en la fila**, copiar de otro día, guardar borrador
  y **publicar**. Preparar no es publicar: el borrador no cambia la carta.
- **Semana**: los próximos siete días con su estado real (publicado, borrador o sin
  menú) y poder abrir cualquiera. Abrir otro día se avisa en pantalla, porque
  publicar en la fecha equivocada no se deshace de un vistazo.
- **Catálogo**: el interruptor de carta fija.

## Lo que falta

**Plantillas y repetición explícita de la semana** (por ejemplo «almuerzo
habitual», o repetir la semana). Con dos reglas ya decididas:

- **programar esta semana no es repetir todas las semanas**: la repetición se activa
  expresamente, nunca por defecto;
- una plantilla guarda **los platos, no los precios**: un precio viejo arrastrado es
  cobrar mal sin que nadie lo note.

El resto está hecho y con tests (59 nuevos entre backend y frontend).
