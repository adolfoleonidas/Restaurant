# Modo «solo pedidos» (control de pagos apagado)

Ajuste por restaurante, en **Configuración → Exigir cobro antes de liberar la
mesa**. Arranca **encendido**: un local que nunca lo toca trabaja exactamente
como antes.

## Qué cambia

| | Encendido (por defecto) | Apagado |
|---|---|---|
| Finalizar la mesa | Exige cuenta liquidada y comida entregada | No valida ninguna de las dos |
| Liberar la mesa | Solo si no hay pedido ni visita abierta (o si la mesa está `pagada`) | Libera aunque haya una cuenta abierta |
| Cuenta que queda abierta | No se puede cerrar | Se archiva como `cerrado_sin_cobro` |
| Dinero | Sin cambios | `payment_status` y `amount_paid` se conservan; **no se inventa un cobro** |
| Caja / ventas | Sin cambios | Esa cuenta no suma venta hasta que se regularice |
| Salón | Sin distintivo | Badge **«Modo comandas · el pago se cobra fuera del sistema»** |

Con el ajuste apagado, la tarjeta de la mesa y el menú ⋯ de la hoja ofrecen
**«Liberar mesa»** en lugar de «Finalizar mesa». La acción llama a
`POST /tables/{id}/release`, que:

1. cierra la visita (o la cuenta suelta, si no había visita) sin mirar pago ni
   comida;
2. marca las cuentas abiertas como `cerrado_sin_cobro` con
   `closed_without_payment: true` y el operador que lo hizo;
3. deja la mesa `disponible` y excluye esas cuentas de toda consulta de pedidos
   activos.

Una cuenta que ya estaba `pagado` o `cancelado` no se degrada: conserva su
estado.

## Regularizar después: pasar la cuenta a venta

La cuenta archivada no se pierde. El dueño o el cajero puede registrarla cuando
quiera:

1. **Caja → Cuentas cerradas sin cobro**: aparecen las cuentas que se liberaron
   sin pago, con su mesa, fecha y saldo.
2. **Registrar cobro** abre el mismo cobro de Caja (efectivo, Yape, Plin,
   tarjeta, transferencia o mixto).
3. Si el cobro cubre el total, la cuenta pasa a **`pagado`** y suma al turno y a
   los reportes. Si es parcial, sigue **`cerrado_sin_cobro`** con su saldo y se
   puede completar después.
4. Si se registró por error, el cobro se puede **anular o devolver** desde el
   historial de Caja; la cuenta vuelve a «cerrada sin cobro».

La fecha del cobro es la del momento en que se registra (el turno abierto), no
la del servicio original: un cobro regularizado hoy aparece en las ventas de hoy.
El registro del pago conserva `original_order_created_at` para la trazabilidad.

La misma acción está en el detalle del pedido (`/pedidos/:id`) como
**«Registrar cobro»** para quien tenga permiso de cobro.

## Qué no cambia

- El prepago del QR (`table_prepay_mode`) sigue igual: si el local lo activó,
  el pedido del cliente sigue esperando confirmación en Caja. Este ajuste es
  sobre **liberar la mesa desde el piso**, no sobre cómo cobra el cliente.
- Cobrar, Caja y los reportes siguen disponibles: el modo solo deja de
  **exigir** el pago. Quien quiera cobrar, cobra.
- Con el ajuste encendido no hay ninguna diferencia de comportamiento, ni
  siquiera en los mensajes de error.

## Cuándo conviene y cuándo no

- **Conviene** si el local usa la app solo como comanda: el mozo toma el pedido,
  el cobro ocurre fuera del sistema y la mesa se libera cuando se van los
  clientes.
- **No conviene** si se usan Caja o reportes de ventas: liberar sin cobrar deja
  esas cuentas fuera de la venta registrada. El historial lo dice («Cerrada sin
  cobro»), pero el dinero no aparece en ningún medio de pago.
- Volver a encender el ajuste no reescribe el historial: las cuentas ya
  archivadas sin cobro siguen así.

## Dónde vive en el código

- `backend/service_policy.py` — lectura del ajuste, apagado por defecto.
- `backend/order_states.py` — `cerrado_sin_cobro` y los estados terminales.
- `backend/attention.py` — `close_table_attention(..., enforce_settlement=False)`.
- `backend/routes/tables.py` — `POST /tables/{id}/release` en modo sin cobro.
- `backend/routes/payments.py` — `create_payment` regulariza una cuenta
  `cerrado_sin_cobro`; `_apply_regularization_void` permite anular ese cobro.
- `frontend/src/lib/servicePolicy.js` y `useRequirePayment` — política en pantalla.
- `frontend/src/pages/salon/sheetActions.js`, `MesaCard.jsx` — «Liberar mesa».
- `frontend/src/pages/salon/SalonHeader.jsx` — badge «Modo comandas».
- `frontend/src/pages/caja/CajaWorkspace.jsx` — lista y cobro de las cerradas sin cobro.
- `frontend/src/pages/PedidoDetalle.jsx` — «Registrar cobro» en el detalle.

Pruebas: `tests/test_sales_only_mode.py` y
`tests/test_regularize_closed_without_payment.py` (backend);
`frontend/src/__tests__/MesaCardRelease.test.js`,
`attentionClose.test.js`, `salonSheetActions.test.js`,
`SalonHeaderSummary.test.js`, `PedidoDetalleActionFeedback.test.js` y
`CajaDayKpis.test.js`.
