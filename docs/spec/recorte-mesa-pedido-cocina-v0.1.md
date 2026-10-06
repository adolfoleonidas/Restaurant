# Recorte: Mesa → Pedido → Cocina — 0.1

**Estado:** Borrador
**Qué define:** la rebanada más pequeña del sistema que ya entrega valor, especificada de punta a punta para poder programarla: elegir una mesa, tomar el pedido, y que cocina lo procese hasta que esté listo.
**Qué NO define:** entrega al cliente, cuenta, pago, cierre de atención, QR, mesas unidas, comensal obligatorio. Cada uno es su propio recorte.

---

## 1. Por qué un recorte

El sistema entero abruma y hace imposible decidir nada. El método es siempre el mismo: **cortar el camino que más se usa, dejarlo perfecto, y recién después sumar la siguiente rebanada.**

Del flujo completo —`Mesa → Pedido → Cocina → Entrega → Cuenta → Pago → Cerrar atención`— este documento cubre **las tres primeras piezas**.

> **Frontera elegida:** el recorte termina cuando cocina marca el pedido **LISTO**. Ahí la cocina terminó su parte y el pedido queda esperando a que el mozo lo retire. La entrega es el recorte siguiente, y tiene sus propias reglas (quién puede entregar, qué pasa si el plato se enfría, cómo se avisa al mozo).

---

## 2. Alcance

| Entra | No entra (su propio recorte) |
|---|---|
| Ver el salón y elegir una mesa | Entregar el pedido al cliente |
| Tomar un pedido y enviarlo a cocina | Cuenta, pago, división y cierre |
| Cocina recibe, inicia y marca listo | Pedidos por QR |
| Pedidos adicionales sobre la misma visita | Unir mesas y transferir visitas |
| Estado del pedido visible para el mozo | Comensal obligatorio |

---

## 3. Actores

| Actor | Qué necesita en este recorte |
|---|---|
| **Mozo** | Ver mesas, entrar a la mesa, tomar el pedido, enviarlo y ver en qué anda |
| **Cocina** | Recibir el pedido, saber de qué mesa viene, iniciar y marcar listo |
| **Sistema** | Crear la visita si no existe, validar, numerar, avisar y guardar |
| Cliente | No toca el sistema |

---

## 4. La operación más frecuente

> ¿Qué hará el mozo decenas o cientos de veces? **Tomar un pedido.**

```text
Mesa 08 → + Pedido → Productos → Observaciones → Enviar a cocina → fin
```

No debe obligarlo a: crear una cuenta, crear un comensal, poner un nombre, elegir cómo pagarán, dividir, ni configurar la mesa.

---

## 5. Flujo del usuario (mozo)

```text
1. Abre el Salón.
2. Ve qué mesa necesita atención.
3. Toca la mesa.
4. Pulsa "+ Pedido".
5. Elige productos.
6. Ajusta cantidades.
7. Agrega observaciones si hacen falta.
8. Pulsa "Enviar a cocina".
9. Recibe confirmación y la pantalla queda lista para el siguiente.
```

---

## 6. Flujo del sistema

```text
1.  Detecta la mesa elegida.

2.  Comprueba si esa mesa tiene una visita activa.
3.  Si no tiene: crea la visita y la liga a la mesa.
4.  Si tiene: se suma a la visita existente.
5.  Si la mesa pertenece a una visita abierta en otra mesa unida: usa esa visita.

6.  Mantiene el pedido en borrador con productos, cantidades y observaciones.

7.  Al pulsar "Enviar a cocina", valida:
      - hay al menos un producto;
      - la visita sigue abierta;
      - los productos siguen disponibles en la carta;
      - la mesa sigue siendo de esa visita.

8.  Crea el pedido con su número propio.

9.  Lo asocia a la visita y a la mesa.

10. Estado del pedido = RECIBIDO.

11. Registra: origen = MOZO y quién lo cargó.

12. Lo publica en el tablero de cocina (carril "Llegaron").

13. Confirma al mozo: "Pedido enviado".
```

Y del lado de cocina:

```text
14. Cocina abre el pase y ve el pedido en "Llegaron", con mesa, número,
    productos, cantidades y observaciones.
15. Pulsa "Iniciar preparación" → estado EN_PREPARACION, carril "En preparación".
16. Pulsa "Marcar listo"       → estado LISTO, carril "Listos".
17. El mozo ve el pedido como listo en el Salón (la mesa pide atención).
```

---

## 7. Interacción Usuario–Sistema

| # | Mozo | Sistema |
|---|---|---|
| 1 | Toca Mesa 08 | Busca la visita activa de la mesa |
| 2 | — | No hay visita: la crea |
| 3 | Pulsa `+ Pedido` | Abre el compositor |
| 4 | Agrega Lomo saltado | Suma el producto al borrador |
| 5 | Agrega Chicha morada | Suma el producto |
| 6 | Escribe "sin cebolla" | Guarda la observación del producto |
| 7 | Pulsa `Enviar a cocina` | Valida el pedido |
| 8 | — | Crea el Pedido #1052 |
| 9 | — | Estado = `RECIBIDO`, origen = `MOZO` |
| 10 | — | Lo publica en Cocina → Llegaron |
| 11 | Ve la confirmación | La mesa pasa a "preparando" |

| # | Cocina | Sistema |
|---|---|---|
| 1 | Ve el ticket de Mesa 08 · #1052 | Lo muestra en "Llegaron" con su tiempo |
| 2 | Pulsa `Iniciar preparación` | Estado = `EN_PREPARACION`, lo mueve de carril |
| 3 | Pulsa `Marcar listo` | Estado = `LISTO`, lo mueve a "Listos" |
| 4 | — | Avisa al salón que hay algo para retirar |

---

## 8. Nombres del recorte

| Concepto | Qué es | Ejemplo |
|---|---|---|
| **Mesa** | Ubicación física | Mesa 08 |
| **Visita** (atención) | El grupo que está siendo atendido; dura hasta el cierre | Visita A105 |
| **Pedido** | Una confirmación enviada a cocina | Pedido #1052 |
| **Producto del pedido** | Una línea: producto, cantidad, precio, observación | 1× Lomo saltado |
| **Pedido de** | Para quién es; si no hay alias, es la mesa | "Mesa 08" o "Juan" |
| **Registrado por** | Quién lo cargó en el sistema | Carlos · Mozo |
| **Origen** | Canal por el que entró | `MOZO` (en este recorte, el único) |

---

## 9. Estados que toca el recorte

### Pedido

```text
RECIBIDO → EN_PREPARACION → LISTO        (aquí termina este recorte)
   └─────────────┴────────→ CANCELADO
```

| Estado actual | Acción | Nuevo estado | Actor |
|---|---|---|---|
| — | Enviar a cocina | `RECIBIDO` | Mozo |
| `RECIBIDO` | Iniciar preparación | `EN_PREPARACION` | Cocina |
| `EN_PREPARACION` | Marcar listo | `LISTO` | Cocina |
| `RECIBIDO` | Cancelar (el cliente se arrepiente) | `CANCELADO` | Mozo / Encargado |
| `EN_PREPARACION` | Cancelar | `CANCELADO` | solo con autorización |

### Mesa (lo mínimo que este recorte mueve)

```text
LIBRE → OCUPADA → (sigue el recorte de cuenta y cierre)
```

---

## 10. Reglas del recorte

```text
R-MP-01. Una mesa libre crea su visita con el primer pedido: el mozo no la crea a mano.
R-MP-02. Una mesa no puede pertenecer a dos visitas activas a la vez.
R-MP-03. Un pedido necesita al menos un producto.
R-MP-04. Cada confirmación crea un pedido nuevo e independiente.
R-MP-05. Un pedido ya enviado no se modifica en silencio.
R-MP-06. Un pedido adicional crea otro pedido, en la misma visita.
R-MP-07. Los pedidos de una misma visita no se fusionan en cocina: cada uno es un ticket.
R-MP-08. Todo pedido registra su origen y quién lo cargó.
R-MP-09. Cocina recibe únicamente pedidos válidos y confirmados.
R-MP-10. Los productos fuera de la carta no entran al pedido.
R-MP-11. El precio del producto se copia al confirmar el pedido y no cambia después.
R-MP-12. El alias del comensal es opcional; sin alias, "Pedido de" usa la mesa.
R-MP-13. La vista avanzada de Cocina está apagada por defecto.
```

---

## 11. Casos excepcionales

| # | Caso | Respuesta del sistema |
|---|---|---|
| A | El mozo pulsa `Enviar` dos veces | Un solo pedido. El segundo intento no duplica |
| B | Se corta la conexión al enviar | Al reintentar no duplica: o el pedido está creado y lo muestra, o no existe y lo crea |
| C | Un producto se agotó mientras el mozo armaba el pedido | Al validar, avisa cuál y no envía nada hasta sacarlo |
| D | Otro mozo tomó la misma mesa antes | Avisa y muestra la visita que ya existe, en vez de crear otra |
| E | La mesa se unió a otra mientras se armaba el pedido | El pedido entra a la visita de las mesas unidas |
| F | Cocina marca listo y nadie lo retira | El pedido queda en "Listos" con su tiempo a la vista |
| G | Se cancela un pedido ya en preparación | Requiere autorización; queda registrado con motivo |
| H | El mozo cierra el compositor sin enviar | No queda nada: el borrador no crea pedido ni visita |

---

## 12. Especificación UX por pantalla

### PANTALLA: Salón

```text
OBJETIVO:      Ver de un vistazo qué mesa necesita atención y entrar.
PRINCIPAL:     Tocar la tarjeta de la mesa
SECUNDARIAS:   Nuevo pedido (sin mesa: llevar, recojo, delivery)
TERCIARIAS:    ⋯ Más → Unir mesas · Ir a Cocina
ELEMENTOS:     Número y zona · estado del piso · tiempo · platos por
               entregar · saldo si corresponde · filtros de estado y zona
INTERACCIONES: tarjeta → detalle de mesa · filtros → filtran la grilla ·
               ⋯ Más → menú contextual
REGLAS UX:     El piso no cobra (eso es Caja).
               La urgencia se comunica con color, no reordenando la grilla.
```

### PANTALLA: Detalle de mesa

```text
OBJETIVO:      Tomar pedidos rápido, sin distraerse con lo poco frecuente.
PRINCIPAL:     + Pedido
SECUNDARIAS:   Cuenta
TERCIARIAS:    ⋯ Más
ELEMENTOS:     Mesa y zona · estado · pedidos de la visita con su estado ·
               platos listos · total · acciones de cada pedido en su fila
INTERACCIONES: + Pedido → abre el compositor
               Cuenta   → cierre económico (fuera de este recorte)
               ⋯ Más    → menú contextual
REGLAS UX:     El modal de pedido no muestra cobro, unión, ni transferencias.
               No se obliga a crear comensal ni a poner nombre.
               Máximo tres acciones visibles: + Pedido · Cuenta · ⋯ Más.
```

Disposición:

```text
Mesa 08 · Salón
Ocupada · 2 pedidos · S/ 47.00

[ + Pedido ]   [ Cuenta ]   [ ⋯ Más ]

--------------------------------

#1052 · hace 12 min          Preparando
  1× Lomo saltado
  1× Chicha morada
  📝 sin cebolla

#1060 · hace 3 min           Llegaron
  1× Postre
```

### MODAL: Nuevo pedido

```text
OBJETIVO:      Registrar lo pedido y mandarlo a cocina sin salir de la mesa.
PRINCIPAL:     Enviar a cocina
SECUNDARIAS:   (ninguna: es un flujo de un solo final)
TERCIARIAS:    ⋯ Más → Comensal / alias · Compartida
ELEMENTOS:     Carta por categorías con buscador · cantidades elegidas ·
               observación por producto · resumen
INTERACCIONES: producto → suma 1 · + / − → ajusta (el − no baja lo ya
               enviado) · Enviar → valida, crea el pedido y limpia la pantalla
REGLAS UX:     No debe mostrar: cobrar, unir mesas, cerrar atención,
               transferir, dividir.
               No debe pedir nombre, forma de pago ni configuración de mesa.
               Al enviar, la pantalla queda lista para la siguiente persona.
```

### PANTALLA: Cocina

```text
OBJETIVO:      Saber qué preparar ahora y avanzarlo sin pensar.
PRINCIPAL:     Iniciar preparación → Marcar listo
SECUNDARIAS:   (ninguna: el avance es el flujo)
TERCIARIAS:    ⋯ Más → Vista avanzada · correcciones
ELEMENTOS:     Carriles Llegaron · En preparación · Listos · mesa y número ·
               productos, cantidades y observaciones · tiempo en el carril
INTERACCIONES: Iniciar preparación → mueve el ticket al carril siguiente
               Marcar listo → lo deja disponible para retirar
               ⋯ Más → vista avanzada (pedido de, registrado por, origen,
               pago, total, cambio manual de estado)
REGLAS UX:     Vista avanzada OFF por defecto: la cocina no necesita precios.
               Un pedido no se fusiona con otro de la misma mesa.
               Los estados también en texto: el color solo no comunica.
```

---

## 13. Comportamiento por botón

```text
Botón: + Pedido
Prioridad:       Principal
Ubicación:       Cabecera del detalle de mesa (o barra inferior fija en móvil)
Comportamiento:  abre el compositor sobre la visita
No debe mostrar: cobrar · unir mesas · cerrar atención · transferir · dividir
Objetivo:        reducir distracciones durante la toma del pedido
```

```text
Botón: Enviar a cocina
Prioridad:       Principal del modal (única)
Ubicación:       Pie del modal
Comportamiento:  valida, crea el pedido, publica en cocina y limpia la pantalla
No debe ofrecer: guardar como borrador ambiguo, programar, ni repetir el envío
Objetivo:        que el envío sea un acto único e irreversible pero reintentable
```

```text
Botón: Iniciar preparación
Prioridad:       Principal de Cocina
Ubicación:       En la tarjeta del ticket
Comportamiento:  mueve el ticket de "Llegaron" a "En preparación"
No debe mostrar: precios ni datos de pago (salvo vista avanzada)
Objetivo:        avanzar sin abrir nada
```

```text
Botón: Marcar listo
Prioridad:       Principal de Cocina
Ubicación:       En la tarjeta del ticket
Comportamiento:  mueve el ticket a "Listos" y avisa al salón
No debe mostrar: cobro ni cierre de visita
Objetivo:        que el mozo se entere sin que nadie le avise
```

---

## 14. Datos y eventos del recorte

```text
Mesa            id, número, capacidad, estado, sucursal
Visita          id, estado, inicio, fin, mesa(s)
Pedido          id, visita_id, número, estado, origen, registrado_por, fecha
ProductoPedido  id, pedido_id, producto_id, nombre, precio, cantidad,
                observación, estado
```

```text
pedido.creado        → lo publica en Cocina
pedido.recibido      → cocina lo tiene en "Llegaron"
pedido.en_preparacion
pedido.listo         → el salón se entera de que hay algo para retirar
pedido.cancelado
```

---

## 15. Gherkin

```text
ESCENARIO: pedido rápido
DADO que la Mesa 08 está libre
CUANDO el mozo la selecciona y pulsa "+ Pedido"
Y agrega 1 Lomo saltado y 1 Chicha morada
Y pulsa "Enviar a cocina"
ENTONCES el sistema crea la visita de la Mesa 08
Y crea el Pedido #1052 con estado RECIBIDO
Y registra Origen = MOZO y quién lo cargó
Y lo muestra en Cocina → Llegaron.
```

```text
ESCENARIO: pedido adicional
DADO que el Pedido #1052 ya fue enviado
CUANDO el cliente pide un postre y el mozo confirma el nuevo pedido
ENTONCES el sistema NO modifica #1052
Y crea el Pedido #1060 en la misma visita.
```

```text
ESCENARIO: cocina procesa
DADO que el Pedido #1052 está RECIBIDO en "Llegaron"
CUANDO cocina pulsa "Iniciar preparación"
ENTONCES el estado pasa a EN_PREPARACION y el ticket cambia de carril
CUANDO cocina pulsa "Marcar listo"
ENTONCES el estado pasa a LISTO
Y el salón ve la mesa como "por entregar".
```

```text
ESCENARIO: doble envío
DADO que el mozo armó un pedido y pulsó "Enviar a cocina"
CUANDO pulsa "Enviar a cocina" otra vez
ENTONCES el sistema no crea un segundo pedido
Y responde con el pedido que ya existe.
```

---

## 16. Criterios de aceptación

- [ ] Una mesa libre crea su visita con el primer pedido, sin pasos extra.
- [ ] Tomar un pedido no exige comensal, nombre, forma de pago ni cuenta.
- [ ] Cada confirmación crea un pedido nuevo, con su propio número.
- [ ] Un pedido enviado no se modifica; los adicionales son pedidos nuevos.
- [ ] Cocina ve cada pedido como un ticket independiente, aunque sea la misma mesa.
- [ ] Cocina no ve precios ni datos de pago con la vista avanzada apagada.
- [ ] El doble toque en "Enviar" no duplica pedidos.
- [ ] Un producto agotado bloquea el envío y dice cuál.
- [ ] El salón muestra el pedido como listo cuando cocina lo marca.
- [ ] Los pedidos de la misma mesa no se fusionan en cocina.

---

## 17. Estado en la app

Lo que este recorte **ya cumple**, verificado en esta sesión contra el stack local: el Salón con sus estados y filtros; el detalle de mesa con el compositor; la creación de la visita con el primer pedido; el número propio por pedido; los pedidos adicionales como pedidos nuevos; el pase de cocina con carriles y el avance de estado.

Brechas conocidas dentro de este recorte:

| Brecha | Detalle | Estado |
|---|---|---|
| El detalle de mesa abre en una cuenta muerta | Un pedido cancelado con estado de visita obsoleto seguía siendo "la cuenta viva" de la mesa, así que la hoja mostraba platos anulados en vez de los que están en curso | Corregido (`c80ae54`) |
| La tarjeta podía actuar sobre una cuenta cerrada | "Entregar" apuntaba a un pedido ya pagado y respondía "el pedido ya está cerrado" | Corregido (`935d7d6`) |
| El pie del detalle de mesa tiene 8 controles planos | Cinco son terciarios y compiten con `+ Pedido` | Pendiente: sección 12 de la [especificación UI/UX](especificacion-ui-ux-pantallas-v0.1.md) |

---

## 18. Próximos recortes

| Recorte | Qué agrega | Depende de |
|---|---|---|
| **Entrega** | Quién puede entregar, aviso al mozo, plato listo vs. entregado | Este |
| **Cuenta y pago** | Cuenta automática, cobro parcial y mixto, división por persona | Entrega |
| **Cierre** | Cerrar visita y liberar mesas, con sus dos condiciones | Cuenta y pago |
| **QR** | Otra entrada al mismo sistema: `Origen = QR` | Este (usa la misma visita) |
| **Mesas unidas** | Una visita con varias mesas | Este |

---

## Documentos relacionados

- [Especificación funcional y de estados](especificacion-funcional-y-estados-v0.1.md)
- [Especificación UI/UX por pantalla](especificacion-ui-ux-pantallas-v0.1.md)
- [Modelo de dominio](modelo-de-dominio-restaurante-saas-v0.1.md)
- [Análisis de brecha](analisis-de-brecha.md)
