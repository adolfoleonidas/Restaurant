# Especificación UI/UX por pantalla — 0.1

**Estado:** Borrador
**Qué define:** cómo se comporta cada pantalla en lenguaje humano —objetivo del usuario, elementos visibles, jerarquía de acciones y qué pasa al tocar cada cosa— para que el diseño y la implementación no improvisen botón por botón.
**Qué NO define:** wireframes, HTML, CSS ni componentes. Eso viene después, y sale de acá.

---

## 1. Propósito

Este documento es el **contrato de diseño** entre quien pide, quien diseña y quien programa. Cada pantalla se escribe con las mismas cuatro preguntas, y la jerarquía de acciones queda decidida antes de dibujar nada.

El problema que evita: pantallas que crecen acumulando botones porque cada pedido nuevo se resuelve agregando uno más, sin decidir nunca qué lugar le corresponde.

---

## 2. Ruta rápida de lectura

1. **Sección 3** — la técnica y la plantilla.
2. **Sección 4** — la regla de jerarquía (aplica a todas las pantallas).
3. **Secciones 6 a 10** — cada pantalla.
4. **Sección 12** — qué cambiar en la app de hoy.

---

## 3. La técnica: cuatro preguntas por pantalla

Para cada pantalla se responde, en este orden:

1. **Qué quiere lograr el usuario** (en sus palabras, no en las del sistema).
2. **Qué elementos debe ver** para lograrlo.
3. **Qué acción es principal** y cuáles son secundarias.
4. **Qué pasa al tocar cada elemento.**

### Plantilla

```text
PANTALLA:
<nombre>

OBJETIVO:
<qué quiere lograr el usuario>

ACCIÓN PRINCIPAL:
<la que hace todo el tiempo>

ACCIONES SECUNDARIAS:
<importantes, pero de otro momento del flujo>

ACCIONES TERCIARIAS:
⋯ Más

ELEMENTOS VISIBLES:
- <dato>
- <dato>

INTERACCIONES:
<elemento> → <qué pasa>

REGLAS UX:
- <lo que esta pantalla nunca debe hacer>
```

---

## 4. Jerarquía de acciones (regla transversal)

**La frecuencia no alcanza para decidir.** Si solo contáramos cuántas veces se usa cada acción, "Cobrar" perdería contra "+ Pedido" y terminaría escondido, obligando a buscar un paso que **siempre** hay que dar.

Una acción entra en la jerarquía por **su papel en el flujo**:

| Tipo | Papel | Dónde vive |
|---|---|---|
| **Primaria** | Es el camino normal, se repite toda la jornada | Botón destacado, siempre visible |
| **Secundaria** | Cierra el flujo o lo completa; se da siempre, pero al final | Visible, con menos peso que la primaria |
| **Terciaria** | Excepción, corrección o administración | Dentro de **⋯ Más** |
| **De otro momento** | No pertenece a esta pantalla | Al módulo que corresponde (Cocina, Caja, Catálogo) |

**Cada botón visible representa un tipo de acción distinto.** Si dos botones hacen lo mismo en momentos distintos, sobra uno: se cambia la etiqueta del que ya está.

**Las acciones de un objeto viven en la fila de ese objeto.** Anular un plato pertenece al plato; entregar una cuenta pertenece a la cuenta. Por eso la barra de la pantalla puede quedarse con dos o tres botones aunque la mesa tenga diez platos.

---

## 5. Reglas UX transversales

```text
U01. Máximo tres acciones visibles en la barra de una pantalla.
U02. La acción de cierre (Cuenta / Cobrar) nunca se esconde en ⋯ Más.
U03. Las acciones avanzadas no aparecen dentro del flujo de tomar pedido.
U04. Tomar un pedido no obliga a crear una cuenta, un comensal ni un nombre.
U05. El estado de la mesa está siempre visible, incluso con un modal abierto.
U06. Ninguna acción destructiva se ejecuta sin confirmación y motivo.
U07. Un dato que el usuario necesita para decidir no se esconde en ⋯ Más
     (tiempo de espera, platos listos, saldo).
U08. Si una acción se repite por objeto (entregar, anular), vive en la fila
     del objeto, no en la barra de la pantalla.
```

---

## 6. PANTALLA: Salón

```text
PANTALLA:
Salón (el piso)

OBJETIVO:
Ver de un vistazo qué mesa necesita atención y entrar a resolverla.

ACCIÓN PRINCIPAL:
Tocar la tarjeta de una mesa

ACCIONES SECUNDARIAS:
Nuevo pedido (para llevar, recojo o delivery sin mesa)
Sucursal (solo dueño/administración)

ACCIONES TERCIARIAS:
⋯ Más → Unir mesas · Ir a Cocina · Vista avanzada

ELEMENTOS VISIBLES:
- Número de mesa y zona
- Estado del piso (libre, ocupada, preparando, listo, cuenta, pagada)
- Tiempo transcurrido
- Platos listos por entregar
- Saldo, si corresponde
- Filtros por estado y por zona
- Aviso de mesas sin sucursal (solo dueño)

INTERACCIONES:
Tocar tarjeta      → abre el detalle de la mesa
Filtro de estado   → filtra las tarjetas
Chip de zona       → filtra por zona
Nuevo pedido       → abre el compositor de áreas de venta
⋯ Más              → menú contextual

REGLAS UX:
- El piso no cobra: cobrar es de Caja, no de la tarjeta.
- La urgencia se comunica con color, no reordenando la grilla (el piso no
  debe saltar bajo el dedo del mozo).
- Una mesa sin sucursal no se oculta: se avisa.
```

---

## 7. PANTALLA: Detalle de mesa

La pantalla que más se usa. Todo lo demás se ordena alrededor de esto.

```text
PANTALLA:
Detalle de mesa

OBJETIVO:
Tomar pedidos rápidamente y gestionar la atención sin distraerse con
funciones poco frecuentes.

ACCIÓN PRINCIPAL:
+ Pedido

ACCIÓN SECUNDARIA:
Cuenta

ACCIÓN TERCIARIA:
⋯ Más

ELEMENTOS VISIBLES:
- Mesa y zona
- Estado de la atención
- Cuentas de la visita (una por persona, con su alias si lo tiene)
- Platos de la cuenta elegida, con su estado
- Total de la mesa y saldo de la cuenta elegida
- Acciones de la cuenta elegida (Entregar)

INTERACCIONES:
+ Pedido   → abre el compositor sobre la cuenta elegida (o una nueva)
Cuenta     → abre el cierre económico de la visita
⋯ Más      → menú contextual
Cuenta de la visita → cambia la cuenta que se está viendo
Plato      → anular, corregir cantidad, agregar observación

REGLAS UX:
- El modal de pedido no muestra cobro, ni unión de mesas, ni transferencias.
- No se obliga a crear comensal ni a poner nombre.
- Las acciones de cada plato viven en su fila.
- Máximo tres acciones en la barra: + Pedido · Cuenta · ⋯ Más.
```

### Disposición

```text
Mesa 08 · Salón
Ocupada · 3 cuentas · S/ 183.00

[ + Pedido ]   [ Cuenta ]   [ ⋯ Más ]

--------------------------------

Cuenta de: Juan            [ Entregar ]
  1× Lomo saltado        Listo
  1× Chicha morada       Entregado

Cuenta de: María
  1× Postre              Preparando
```

---

## 8. MODAL: Nuevo pedido

```text
MODAL:
Nuevo pedido

OBJETIVO:
Registrar lo que el cliente pidió y mandarlo a cocina, sin salir de la mesa.

ACCIÓN PRINCIPAL:
Enviar a cocina

ACCIONES SECUNDARIAS:
(ninguna: es un flujo de un solo final)

OPCIONES PLEGADAS:
Organizar pedido → Comensal / alias · Compartida · Pedido de otra persona

ELEMENTOS VISIBLES:
- Carta por categorías, con buscador
- Cantidades de lo ya elegido
- Observaciones por producto
- Resumen de la cuenta

INTERACCIONES:
Producto        → suma 1 a la cuenta
+ / −           → ajusta cantidad (el − no baja lo que ya salió a cocina)
Observación     → se guarda por producto
Enviar a cocina → valida, crea el pedido y limpia la pantalla para el siguiente
Organizar pedido → muestra alias y "compartida" solo cuando se necesita

REGLAS UX:
- No debe mostrar: cobrar, unir mesas, cerrar atención, transferir, dividir.
- No debe pedir nombre, forma de pago ni configuración de la mesa.
- Nombre y teléfono quedan en "Datos del cliente (opcional)"; en delivery, la
  dirección obligatoria permanece visible.
- Al enviar, la pantalla queda lista para la siguiente persona.
```

---

## 9. PANTALLA: Cocina

```text
PANTALLA:
Cocina (el pase)

OBJETIVO:
Saber qué hay que preparar ahora y avanzarlo sin pensar.

ACCIÓN PRINCIPAL:
Avanzar el ticket (Iniciar preparación → Marcar listo)

ACCIONES SECUNDARIAS:
(ninguna: el avance es el flujo)

ACCIONES TERCIARIAS:
⋯ Más → Vista avanzada · Pasar a fuego · Correcciones

ELEMENTOS VISIBLES:
- Carriles por estado (Llegaron · En preparación · Listos)
- Mesa o área y número de pedido
- Productos, cantidades y observaciones
- Tiempo en el carril

INTERACCIONES:
Iniciar preparación → mueve el ticket al carril siguiente
Marcar listo        → lo deja disponible para entregar
⋯ Más               → vista avanzada (pedido de, registrado por, origen, pago, total)

REGLAS UX:
- Vista avanzada apagada por defecto: la cocina no necesita precios ni quién pidió.
- Un pedido no se fusiona con otro de la misma mesa: cada confirmación es un ticket.
- Los estados se muestran también en texto: el color solo no comunica.
```

---

## 10. PANTALLA: Cuenta y cobro

```text
PANTALLA:
Cuenta y cobro

OBJETIVO:
Cerrar la visita: cobrar lo consumido y liberar la mesa.

ACCIÓN PRINCIPAL:
Confirmar el cobro

ACCIONES SECUNDARIAS:
Solicitar cuenta · Cobro parcial · Pago mixto

ACCIONES TERCIARIAS:
⋯ Más → Descuento · Anular cobro · Nota de crédito

ELEMENTOS VISIBLES:
- Detalle por cuenta y por persona
- Total, pagado y pendiente
- Medio de pago
- Estado de la visita (abierta, por cobrar, cerrada)

INTERACCIONES:
Solicitar cuenta   → marca la visita como "pidió la cuenta"
Confirmar cobro    → registra el pago y actualiza el saldo
Cobro parcial      → deja saldo pendiente y la visita sigue abierta
Cerrar atención    → habilitado solo con saldo 0 y sin platos por entregar

REGLAS UX:
- El botón de cierre explica por qué está bloqueado, no queda mudo.
- Cobrar dos veces no es posible: el segundo intento informa que ya estaba cerrado.
- El historial de la visita queda consultable después de cerrar.
```

---

## 11. Comportamiento por botón

```text
Botón: + Pedido
Prioridad:    Primaria
Ubicación:    Cabecera del detalle de mesa (o barra inferior fija en móvil)
Comportamiento: abre el compositor sobre la cuenta elegida
No debe mostrar: cobrar · unir mesas · cerrar atención · transferir · dividir
Objetivo:     reducir distracciones durante la toma del pedido
```

```text
Botón: Cuenta
Prioridad:    Secundaria importante
Ubicación:    Junto a + Pedido
Comportamiento: abre el cierre económico de la visita
Etiqueta:     cambia con el momento — "Solicitar cuenta" → "Cuenta solicitada"
              → "Finalizar mesa"
No debe mostrar: productos ni edición (eso es + Pedido)
Objetivo:     que el cierre económico nunca se busque
```

```text
Botón: ⋯ Más
Prioridad:    Terciaria
Ubicación:    Junto a Cuenta
Comportamiento: abre menú contextual
Opciones:     unir mesa · cambiar mesa · agregar comensal · organizar comensales
              · transferir atención · ver historial
Objetivo:     que las excepciones no ocupen el camino principal
```

---

## 12. Brecha con la app actual

El detalle de mesa de hoy tiene **ocho controles planos** en el pie, cinco de ellos terciarios, todos con el mismo peso visual:

| Hoy | Tipo real | Debería ir a |
|---|---|---|
| Entregar | Operar (cuenta) | Acción de la cuenta elegida |
| Finalizar mesa | Cerrar | Barra: **Cuenta** (etiqueta según el momento) |
| Solicitar cuenta / Cuenta solicitada | Cerrar | Barra: **Cuenta** |
| Ver / Abrir pedido | Terciaria | ⋯ Más |
| Dividir ÷2 ÷3 ÷4 | Terciaria | ⋯ Más |
| Mover pedido a otra mesa | Terciaria | ⋯ Más |
| Mover esta cuenta a otra mesa | Terciaria | ⋯ Más |
| Fusionar cuentas | Terciaria | ⋯ Más |

Resultado esperado en la barra: `+ Pedido` · `Cuenta` · `⋯ Más`.

**Costo del cambio:** las pruebas de recorrido (`frontend/e2e/*.spec.ts`) tocan hoy `mesa-sheet-ver-pedido` directamente; al entrar en ⋯ Más necesitan un paso previo. Es un cambio de prueba, no de comportamiento.

---

## 13. Validación para aprobar la versión 0.1

- [ ] Cada pantalla responde las cuatro preguntas.
- [ ] Ninguna barra muestra más de tres acciones.
- [ ] El cierre económico (Cuenta / Cobrar) es visible en todas las pantallas donde termina el flujo.
- [ ] Ninguna acción terciaria comparte barra con la primaria.
- [ ] Cada acción de objeto vive en la fila de su objeto.
- [ ] Cada modal declara qué **no** debe mostrar.
- [ ] Las reglas UX transversales (U01–U08) no se contradicen en ninguna pantalla.

---

## Documentos relacionados

- [PRD](PRD-restaurante-saas-v1.0.md) — problema, alcance y decisiones de producto.
- [Modelo de dominio](modelo-de-dominio-restaurante-saas-v0.1.md) — conceptos y ciclos de vida.
- [Especificación funcional y de estados](especificacion-funcional-y-estados-v0.1.md) — flujos, estados y criterios de aceptación.
- [Análisis de brecha](analisis-de-brecha.md) — qué está cubierto y qué falta.
