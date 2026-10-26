# Estados y flujo — referencia del sistema

Levantamiento de **todos** los estados del sistema y de los ejes que corren en
paralelo sobre un mismo pedido, con la evidencia en código de cada afirmación.
El esquema visual (línea de tiempo + matriz de visibilidad) está en
[`mapa-estados.html`](mapa-estados.html).

> Es un levantamiento, no una propuesta aplicada: describe lo que hay. Las
> inconsistencias están listadas al final y **no se han corregido**.

Fuentes: `backend/order_flow.py`, `backend/attention.py`, `backend/payment_policy.py`,
`backend/routes/{orders,tables,payments,public,table_groups}.py`,
`frontend/src/lib/floorStyle.js`, `frontend/src/pages/salon/{selectors,sheetActions}.js`.

---

## 1. El eje visible: `order.status` → estado del piso

`_ORDER_NEXT` (`order_flow.py:84-93`), validado por `assert_order_transition()`
(`order_flow.py:132-138`).

> **Aviso: `_ORDER_NEXT` no es la máquina de estados del sistema, es la de un solo
> endpoint.** `assert_order_transition` se llama **únicamente** en `orders.py:1453`
> (`POST /orders/{id}/status`). Los otros doce escritores de `order.status` la
> esquivan, y entre ellos está el flujo principal: `nuevo → enviado_cocina`
> (`send-to-kitchen`, `orders.py:1254-1256`) **no es una arista del mapa**
> (`_ORDER_NEXT["nuevo"] = {"cancelado"}`). Léelo como documentación de intención,
> no como invariante.

| `order.status` | Transiciones legales | Estado del piso | Etiqueta | ¿Se escribe? |
|---|---|---|---|---|
| `nuevo` | cancelado | `preparando` | Preparando | sí |
| `enviado_cocina` | en_preparacion, cancelado | `preparando` | Preparando | sí |
| `en_preparacion` | listo, cancelado | `preparando` | Preparando | sí |
| `listo` | entregado, pendiente_pago, cancelado | `listo` | Listo | sí |
| `entregado` | pendiente_pago, cancelado | `entregado` | Entregado | sí |
| `pendiente_pago` | cancelado | `cuenta` | Cuenta | **NO — estado muerto** |
| `pagado` | — (terminal) | `pagada` | Cuenta pagada | sí |
| `cancelado` | — (terminal) | `atencion` | Atención abierta | sí |
| `cerrado_sin_cobro` | — (terminal; pasa a `pagado` cuando se registra el cobro después) | — (la mesa ya se liberó) | Cerrada sin cobro | solo con **Exigir cobro antes de liberar la mesa** apagado; ver [modo-solo-pedidos.md](modo-solo-pedidos.md) |

### `pendiente_pago` no se guarda nunca

Es un valor declarado en `OrderStatus` (`models.py:386`) que **ningún camino
almacena**. El endpoint que lo pide se pisa a sí mismo
(`orders.py:1467` pone `update["status"] = "pendiente_pago"` y `:1503-1505` lo
sobrescribe con `ticket_fields(...)["status"]`, que devuelve el estado de
**comida**, no el pedido). Lo fija el propio test del repositorio:

```python
# tests/test_money_integrity.py:1528,1541
requested = await change_status("order-1", _flow("pendiente_pago"), _mozo())
...
assert stored["status"] == "listo"      # ← sigue en «listo», no en «pendiente_pago»
assert requested["payment_requested"] is True
```

Lo que sí queda escrito al pedir la cuenta es:

| Campo | Valor | Dónde |
|---|---|---|
| `order.payment_requested` | `true` | `orders.py:1506` |
| `table.status` | `esperando_pago` | `orders.py:1511-1519` (solo si hay mesa y el pago no está saldado) |

Y el piso igual muestra «Cuenta» porque `floorState` comprueba
`t.status === 'esperando_pago'` **antes** que `o.status === 'listo'`
(`selectors.js:118-119`). El resultado es correcto; el mecanismo es otro.

**Consumidores que quedan muertos** por apoyarse en `pendiente_pago`:
`reports.py:239` (el contador `bill_requests` es siempre 0), `public.py:234` (la
guarda de «ya pidió la cuenta» nunca dispara, así que un cliente por QR puede seguir
añadiendo platos a una cuenta ya impresa), la rama `pendiente_pago` de
`assert_can_serve` (`order_flow.py:207`), los preservadores de `orders.py:625, 808,
1167`, el filtro del índice en `database.py:196`, y en el frontend
`Pedidos.jsx:94` y `selectors.js:571`.

**Consecuencia de producto**: un pedido **sin mesa** (llevar, recojo, delivery) no
tiene ningún estado visible de «cuenta pedida», porque los dos únicos efectos que sí
se escriben son `payment_requested` (que el piso no pinta por sí solo) y el estado de
la mesa (que no existe).

Gates adicionales del endpoint (`orders.py:1456-1465`): pasar a `listo` exige que no
quede ningún ítem `pendiente`; pasar a `entregado` exige `assert_can_serve`.

## 2. Los ejes paralelos

| Eje | Valores | Quién lo escribe |
|---|---|---|
| `fulfillment_status` | nuevo, enviado_cocina, en_preparacion, listo, entregado, cancelado | `ticket_fields()` `order_flow.py:184-197` |
| `payment_status` | pendiente, parcial, pagado, comprobante_subido, confirmado | `order_flow.py:166-198` |
| `payment_state` (visible al cliente) | no_requerido, pendiente, reportado, confirmado, rechazado | `payment_policy.py:92-131`, `prepay.py` |
| `acceptance_status` (puerta de cocina) | pendiente, aceptado | `payment_policy.py:143-145` es el único gate que cocina respeta |
| `attention_state` | opening, open, mutating, closing, closed | `attention.py:261,356,395`; `order_flow.py:66` |
| `item.status` | borrador, pendiente, en_preparacion, listo, entregado, cancelado | `order_flow.py:95-101` |
| `table.status` | disponible, ocupada, esperando_pago, reservada, inactiva, pagada | ver §3 |
| `payment_requested` (bool) | true/false | `orders.py:1506` |

`mutating`, `closing` y `closed` **congelan** el pedido (`claim_order`,
`order_flow.py:35`); `opening` explícitamente no.

### El dinero tiene cuatro vocabularios

`payment_status` (interno), `payment_state` (cliente), `payment_label()`
(`payment_policy.py:148-156`: `pagado`, `cobra_en_caja`, `sin_confirmar`,
`al_final`) y el booleano `payment_requested` que lee el piso.

## 3. `table.status`: quién escribe cada valor

| Valor | Escritor | ¿Alcanzable? |
|---|---|---|
| `disponible` | cierre de visita (`attention.py:350`), liberar (`tables.py:469`), traslado (`tables.py:433-434`) | sí |
| `ocupada` | apertura de visita (`tables.py:463`), unir mesas (`table_groups.py:259`) | sí |
| `esperando_pago` | «Solicitar cuenta» (`orders.py:1511-1519`) | sí |
| `pagada` | `_release_paid_table` (`orders.py:190-200`, `payments.py:156-168`) | **no** |
| `reservada` | editor de Local (`Local.jsx:535`) | sí |
| `inactiva` | editor de Local; `tables.py:367` protege mesas unidas | sí |

**Por qué `pagada` no es alcanzable**: sus dos escritores exigen
`not order.get("attention_id")` — pedidos con mesa y **sin visita**. Pero toda orden
de mesa recibe visita: el personal en `orders.py:533-538` y el QR del cliente en
`public.py:745-747`, que genera un `attention_id` nuevo si la mesa estaba libre. El
editor de Local tampoco ofrece `pagada` (`Local.jsx:535`).

Consecuencia: el estado del piso `pagada` («Cuenta pagada») sí se ve, pero lo produce
el **pedido** (`order.status = pagado` con la visita abierta, `selectors.js:116`),
nunca la mesa. Y `auto_release_table` («Liberar mesa automáticamente al cobrar»,
`Configuracion.jsx:135`) está detrás del mismo guard, así que no tiene efecto en el
flujo de mesa.

## 4. La línea de tiempo que sí funciona

```
Libre ──▶ Preparando ──▶ Listo ──▶ Entregado ──▶ Cuenta ──▶ Cuenta pagada ──▶ Libre
        (order nuevo/           (listo)  (entregado) (pendiente_  (pagado, visita
         enviado_cocina/                                pago)       aún abierta)
         en_preparacion)
```

Acciones que aparecen en la **tarjeta del piso** por estado
(`MesaCard.jsx:100-143`; el pie no se dibuja si no hay ninguna acción):

| Estado | Acciones en la tarjeta |
|---|---|
| Libre | Tomar pedido (con `+`) |
| Ocupada (`sentados`) | Tomar pedido |
| Preparando | **—**, salvo que ya haya una línea `listo` → Entregar |
| Listo | Entregar |
| Cuenta | Cobrar — y también Entregar si quedan líneas `listo` sin servir |
| Entregado | **—** (el paso siguiente, «Solicitar cuenta», solo vive en la hoja: `sheetActions.js:50-57`) |
| Cuenta pagada | Finalizar mesa |
| Atención abierta (pedido anulado) | **—**, salvo que sea cerrable → Finalizar mesa |
| Reservada / Inactiva | **—** |

Seis de los diez estados pueden quedarse sin ningún botón, y una tarjeta de **grupo**
no ofrece «Finalizar mesa» ni «Tomar pedido» en ningún caso
(`GroupCard.jsx:48-53`): cobrar un grupo unido obliga a abrir la hoja de un miembro
para poder cerrar la visita.

Los pares canónicos `t.status` + `active_order.status` → estado del piso están fijados
por `__tests__/salonSelectors.test.js:55-71`.

## 5. Matriz de visibilidad

`FLOOR_STYLE` tiene 10 entradas (`floorStyle.js:8-19`), `LEGEND` declara 8
(`selectors.js:18`) y `STATE_FILTER_FLOORS` cubre 7 (`selectors.js:29-34`).

| Estado del piso | Leyenda | Filtro que lo aísla |
|---|---|---|
| Libre | sí | Libres |
| Ocupada | sí | Ocupadas |
| Preparando | sí | Ocupadas |
| Listo | sí | Por entregar |
| Cuenta | sí | Por cobrar |
| Entregado | **no** | Ocupadas |
| Cuenta pagada | sí | **ninguno** |
| Atención abierta | sí | Ocupadas |
| Reservada | sí | **ninguno** |
| Inactiva | **no** | **ninguno** |

Un estado ausente de `STATE_FILTER_FLOORS` no se atenúa al filtrar: **desaparece de
la pantalla** (`filterUnits`, `selectors.js:398-411`).

## 6. Inconsistencias detectadas

### Graves

> **Estado de las correcciones.** Esta sección es el levantamiento original. La
> primera ronda de normalización ya cerró los siguientes puntos; los números se
> conservan para poder seguirlos.
>
> | # | Hallazgo | Estado |
> |---|---|---|
> | 0 | `pendiente_pago` muerto y su guarda | **parcial** — los consumidores ya leen `payment_requested`; el valor sigue declarado en el `Literal` |
> | 1 | El filtro esconde mesas | **cerrado** — leyenda y filtros derivados de `FLOOR_STYLE`, con `FloorStateCoverage.test.js` |
> | 2 | Cuenta anulada sin salida | **cerrado** — `close_block_reason` y `canCloseAttention` aceptan una cuenta sin nada que cobrar |
> | 3 | «Finalizar mesa» que falla | **cerrado** — el cliente mira todas las cuentas de la visita |
> | 4 | «Entregado» sin salida en el piso | **cerrado** — «Solicitar cuenta» en la tarjeta, con la regla compartida |
> | 7 | Servir marcaba borradores como entregados | **cerrado** — `serve_order` solo mueve `listo → entregado` |
> | 21 | `cancelado` se pintaba «Atención abierta» | **cerrado** — ahora dice «Cuenta anulada» |
> | 22 | El chip «Ocupadas» se tragaba las anuladas | **cerrado** — «En curso» ya no las incluye y tienen su propio chip |
> | 8-20, 23-25 | el resto | pendientes |
>
> El detalle de cada arreglo está en la [ronda 14 de la auditoría](ui-ux-audit.md).

0. **`pendiente_pago` es un estado muerto, y con él toda una función.** El valor está
   declarado y ningún camino lo guarda (§1). El contador de cuentas pedidas del
   informe es siempre 0, y **un cliente por QR puede seguir añadiendo platos a una
   cuenta ya impresa** porque la guarda que debía impedirlo prueba ese estado
   (`public.py:234`). Los pedidos sin mesa no tienen ningún estado visible de «cuenta
   pedida».
1. **El filtro esconde mesas.** Con cualquier filtro distinto de «Todas»,
   *Cuenta pagada*, *Reservada* e *Inactiva* se vuelven invisibles.
   `selectors.js:29-34`. `inactiva` es además el único estado que **no está ni en la
   leyenda ni en ningún filtro**.
2. **Una cuenta totalmente anulada no se puede cerrar, y su mesa no se puede
   liberar.** Anular todos los platos recalcula el total y `ticket_fields` devuelve
   `payment_status = 'pendiente'` (corto-circuito cuando `paid <= 0.009`,
   `order_flow.py:177-178`), así que `close_block_reason` responde «El estado del pago
   no confirma una liquidación completa» (`attention.py:36-37`) y
   `canCloseAttention` esconde «Finalizar mesa» (`attentionClose.js:36`). La única
   salida es anular el pedido entero. **Esta es la respuesta a «¿finalizar aparece solo
   a veces?»: hay un estado del que no se sale.**
3. **«Finalizar mesa» puede ofrecerse y fallar.** `canCloseAttention` mira una sola
   cuenta (`attentionClose.js:24-37`); el servidor exige que **todas** las de la
   visita estén liquidadas y si no responde `La cuenta #N no está lista`
   (`attention.py:444-451`).
4. **«Entregado» no tiene salida en el piso.** La tarjeta queda sin ninguna acción.
   `MesaCard.jsx:94-143`, `sheetActions.js:50-57`.
5. **La tarjeta de un grupo no puede cerrar la visita.** `GroupCard` solo ofrece
   Entregar, Cobrar y Separar (`GroupCard.jsx:48-53`): no tiene «Finalizar mesa» ni
   «Tomar pedido». Cobrar un grupo unido obliga a abrir la hoja de un miembro para
   poder finalizar. Y para un rol sin `canTake` (cajero, cocina), un grupo sin
   exactamente una cuenta por cobrar o un pedido listo se queda **sin ningún botón**.
6. **Estados que se imprimen como enum crudo al personal.** `PrepayQueue` define
   etiquetas para 3 de los 7 valores de `payment_state`
   (`PrepayQueue.jsx:12-16`) y cae a `row.payment_state` en el resto, así que
   `confirmado`, `expirado`, `reembolsado` y `no_requerido` se muestran tal cual.
   `StateBadge` hace lo mismo con cualquier estado sin etiqueta
   (`StateBadge.jsx:17`).
7. **Servir marca como entregados platos que nunca se cocinaron.** `serve_order`
   pasa a `entregado` **todo** ítem no anulado (`orders.py:1375-1377`) y
   `assert_can_serve` tolera los borradores a propósito (`order_flow.py:153-157`), así
   que una línea en borrador salta `borrador → entregado` sin pasar por cocina.
   `_ITEM_NEXT` ni siquiera tiene entrada para `borrador`.

### Medias

8. **Dos verbos para liberar una mesa**, con efectos distintos, y el segundo
   inalcanzable: «Finalizar mesa» cierra la visita y audita
   (`attention.py:343-363`); «Liberar mesa» (`sheetActions.js:95-103`) exige
   `t.status === 'pagada'`, que ningún flujo escribe, y queda sombreado por
   `hasAccount`.
9. **El cierre puede dejar la mesa ocupada sin decirlo.** La liberación de la mesa en
   `attention.py:347-351` está condicionada a `active_attention_id == attention.id` y
   **descarta el resultado** —es la única escritura con guarda de ese archivo cuyo
   `UpdateResult` no se comprueba—. Si la condición no se cumple, todas las cuentas de
   la visita quedan `closed` pero la mesa conserva su estado, y el piso la pinta
   «Ocupada» sin ninguna cuenta y con el menú ⋯ vacío. **Alcanzabilidad sin carrera:
   no confirmada** (todos los escritores de `active_attention_id` usan la misma
   guarda), pero la ausencia de verificación es segura.
10. **«Preparando» miente en un caso.** Una cuenta con todo en borrador se pinta
    igual que una que cocina ya trabaja (`selectors.js:121`). La cabecera puede decir
    «En cocina: 0 platos» mientras la tarjeta dice «Preparando» (`selectors.js:259`).
11. **Un ajuste que promete algo que no hace**: `auto_release_table`.
12. **Cuatro vocabularios para el dinero** (§2).
13. **`pendiente_pago` tiene siete nombres distintos** según la pantalla: «Cuenta»
    (piso), «Por cobrar» (filtro y cabecera), «Cuenta solicitada» (insignia y hojas),
    «Pendiente de pago» (lista de pedidos y caja), «Pendiente pago» (filtro de
    pedidos), «Solicitar cuenta» (la acción que lo produce) y «Cobrar» (el botón).
    `floorStyle.js:13`, `selectors.js:25`, `MesaCard.jsx:261`, `constants/status.js:14`,
    `Pedidos.jsx:23`, `sheetActions.js:53`, `MesaCard.jsx:142`.
14. **Un prepago rechazado se queda en la cola de caja y bloquea la mesa.**
    `prepay.py:212-215` solo escribe `payment_state = 'rechazado'`: no cambia el estado
    del pedido ni libera la mesa, y `prepay.py:130-152` lo sigue devolviendo. Como
    `reserve_table_opening` nunca escribió un estado (`attention.py:98-101`), la mesa
    queda `disponible` **con** `opening_order_id`, lo que hace fallar sentar o liberar
    esa mesa (`tables.py:248, 275`) y da 409 a un segundo cliente por QR
    (`public.py:676-681`). `is_awaiting_prepayment` rechaza `rechazado`, así que
    confirmarlo es 400 para siempre.
15. **`fulfillment_status` puede quedar desincronizado.** `merge` (`orders.py:816`) y
    `move_item` (`orders.py:1157`) escriben `status = 'cancelado'` **sin tocar** el
    campo de comida, así que persiste `status='cancelado'` +
    `fulfillment_status='listo'|'entregado'`, un par que ningún `ticket_fields`
    produce. Además `merge` fuerza `enviado_cocina` en un destino ya entregado
    (`orders.py:807-809`) mientras `move_item` conserva el estado del destino
    (`orders.py:1166-1168`): el mismo caso resuelto de dos maneras.
16. **`payment_status = 'comprobante_subido'` no tiene camino de salida en el
    pedido.** Se escribe en `payments.py:268` y `public.py:1058`; `ticket_fields` lo
    preserva mientras no haya dinero (`order_flow.py:175-176`); no existe endpoint
    para rechazar el comprobante, y bloquea cerrar la caja (`cash.py:212`) y cerrar la
    visita (`attention.py:31-32`).

### Menores

17. **`fulfillment_status` no se dibuja en ninguna parte.** El campo se escribe y se
    lee en el backend pero el frontend no lo menciona: cero lecturas
    (la única aparición es un comentario en `PedidoDetalle.jsx:88`).
18. **`payment_status === 'pendiente'` no tiene palabra.** Solo existe como insignia
    ausente: ninguna pantalla dice «sin pagar» (`Pedidos.jsx:122`,
    `CajaWorkspace.jsx:277`).
19. **Las seis palabras de estado de ítem son código muerto.**
    `itemState().label` (`orderDraft.js:87-95`) no lo lee ningún componente: los seis
    estados se colapsan en cinco etiquetas agregadas (`orderStateTag`) y cuatro
    columnas de cocina (`Cocina.jsx:16-22`).
20. `borrador` no está ni en el `Literal` de `OrderItemStatus` (`models.py:390`) ni en
    `_ITEM_NEXT` (`order_flow.py:95-101`), así que el endpoint de estado de ítem lo
    rechaza (`orders.py:1344`). Su único camino es «enviar a cocina».
21. `cancelado` en el piso se pinta «Atención abierta» (morado), no «Anulada».
    `selectors.js:115`, `floorStyle.js:16`.
22. El chip «Ocupadas» (`activas`) también se traga `entregado` y `atencion`, así que
    una mesa con el pedido **anulado** se cuenta y se muestra como «ocupada»
    (`selectors.js:31`).
23. El selector de estado de mesa de Local muestra los valores crudos
    (`esperando_pago`) en vez de las etiquetas del resto de la app.
    `Local.jsx:532-536` vs `Local.jsx:435`. Y `TABLE_STATUS_LABELS.pagada` («Pagada»)
    no se dibuja nunca.
24. Ninguna mesa en `esperando_pago`, `pagada`, `reservada` o `inactiva` admite tomar
    pedido: `canCompose` exige `['disponible','ocupada']` (`selectors.js:229`).
    Pedir la cuenta, por tanto, cierra la puerta a añadir un plato.
25. La hoja de una mesa vacía dice **«Mesa libre»** para `inactiva` y `pagada` también:
    solo distingue `reservada` (`TableSheet.jsx:139`). Una mesa fuera de servicio se
    anuncia como libre.

## 7. Propuesta de normalización

Por orden de riesgo descendente y dependencia.

1. **Decidir qué hacer con `pendiente_pago`** (§6.0). Es la corrección de mayor
   alcance: o se guarda de verdad (y entonces los consumidores muertos vuelven a la
   vida, incluida la guarda que impide añadir platos a una cuenta impresa), o se
   retira del `Literal` y se sustituye por `payment_requested` en todas partes. Hoy
   hay un estado declarado que nadie escribe y consumidores que dependen de él.
2. **Dar salida al estado atascado** (§6.2): una cuenta totalmente anulada no se
   puede cerrar. O el cierre acepta un total de cero con todo anulado, o el flujo
   guía al mozo a anular el pedido.
3. **Una sola lista de estados.** Que leyenda, filtros y tarjeta se deriven de
   `FLOOR_STYLE`, con un test que exija que toda clave esté en la leyenda y en algún
   filtro. Cierra §6.1 y §6.23 de una vez.
4. **Filtros completos o explícitamente parciales** (§6.1): añadir *Por cerrar*,
   *Reservadas* e *Inactivas*, o dejar escrito por qué no están.
5. **Un solo verbo para terminar la estancia** (§6.8). Con «Finalizar mesa» como
   única salida y «Liberar mesa» como su caso degenerado, desaparece el estado de
   mesa `pagada` y `auto_release_table` pasa a significar algo (§6.11).
6. **Alinear el gate del cierre con el del servidor** (§6.3): que el cliente vea todas
   las cuentas de la visita, o que el servidor cierre solo las que estén listas. Y
   comprobar el resultado de la liberación de la mesa (§6.9).
7. **Nombrar los estados intermedios** (§6.10): separar «Con borradores» de
   «Preparando», y dar salida a «Entregado».
8. **Un vocabulario de dinero** (§6.12): `payment_status` como fuente y
   `payment_state`/`payment_label` derivados en un solo módulo.
9. **Una sola puerta para el estado del pedido.** Hoy `assert_order_transition` se
   llama en un endpoint y doce escritores la esquivan (§1), incluido el flujo
   principal. Llevar la validación al escritor —o reconocer por escrito que el mapa
   es documentación— evita que el próximo cambio tome por invariante algo que no lo
   es.
10. **Declarar los ejes que no tienen `Literal`.** Nueve de los doce ejes de estado
    son cadenas libres sin validación (§0): no hay nada que impida escribir un valor
    fuera del conjunto.

## 8. Otros ejes del sistema

Ejes de estado que no son del pedido pero comparten el mismo patrón.

| Eje | Valores | Escritores |
|---|---|---|
| `attention.status` | `opening`, `open`, `closing`, `closed` | `attention.py:226,233,294,406,426,456-457` |
| `payment.status` | `open`, `completed`, `voided`, `refunded` | `payments.py:245,602,777,891,1031`; finales verificados en `attention.py:43` |
| `cash register.status` | `open`, `closed` | `cash.py:191,236` |
| `table_group.status` | `active`, `dissolved` | `table_groups.py:84,303` |
| `approval.status` | `pending`, `approved`, `rejected` | `approvals.py:43,83` |
| `order.payment_operation` | objeto transitorio durante una mutación de dinero | `payments.py:796,819` |

**`attention.status` y `order.attention_state` son el mismo estado escrito dos
veces**, en dos documentos, con el mismo vocabulario. `_finish_closed` los escribe
juntos (`attention.py:350-357`) y `close_table_attention` los reconcilia por
separado (`attention.py:454-462`), lo que indica que pueden divergir y que hay
código dedicado a detectarlo.

### El vocabulario de tipo de pedido no coincide entre personal e invitado

`OrderType` (`models.py:391`) declara cinco valores: `mesa`, `local`, `llevar`,
`recojo`, `delivery`. Pero:

- El personal solo puede elegir **cuatro**: `ORDER_AREAS` (`format.js:92-97`) ofrece
  `mesa`, `llevar`, `recojo`, `delivery`. **`local` no está en el selector.**
- El invitado/web crea **`local`**, `recojo` o `delivery` (`models.py:509`).

Así que `llevar` (personal) y `local` (invitado) son dos nombres para el mismo
concepto según quién creó el pedido, y `local` no se puede crear desde el personal
aunque su etiqueta sí se muestre en las listas (`ORDER_TYPE_LABELS.local`,
`format.js:81`).

## 9. Límites de este levantamiento

- Es **análisis estático** del código: no se ejecutó la aplicación ni se recorrió el
  flujo en un navegador con datos reales. Lo que se afirma como «el test lo fija» sí
  se leyó en la suite del repositorio.
- **Una alcanzabilidad queda sin confirmar**: si la liberación de la mesa en el
  cierre puede fallar su condición sin una carrera (§6.9). La ausencia de
  comprobación del resultado es segura; el camino que la provoca, no.
- La primera versión de este documento daba por bueno que pedir la cuenta guarda
  `pendiente_pago`. **Era falso** y está corregido en §1; conviene desconfiar de
  cualquier otra afirmación que no lleve archivo y línea.
- Solo 3 de los 12 ejes de estado tienen `Literal` (`models.py:140,384-387,390`). Los
  otros nueve son cadenas libres: lo que aquí se llama «valores» son los que el
  código escribe hoy, no un conjunto validado.
