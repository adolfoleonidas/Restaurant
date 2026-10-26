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
| Caja / ventas | Sin cambios | Esa cuenta no suma venta ni aparece como cobrable |

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
- `frontend/src/lib/servicePolicy.js` y `useRequirePayment` — política en pantalla.
- `frontend/src/pages/salon/sheetActions.js`, `MesaCard.jsx` — «Liberar mesa».

Pruebas: `tests/test_sales_only_mode.py` (backend) y
`frontend/src/__tests__/MesaCardRelease.test.js`,
`attentionClose.test.js`, `salonSheetActions.test.js`.
