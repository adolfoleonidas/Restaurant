# Pedido desde el QR de mesa, con prepago opcional

## Qué cambia para el cliente

El QR de una mesa ya no lleva al checkout: abre la carta con la mesa en contexto.

**Escanear QR → Menú → Productos → Carrito → Revisar pedido → Pago si corresponde → Confirmación → Cocina**

- La mesa llega preseleccionada y se muestra como «Del QR». El cliente puede
  cambiar de modalidad (recojo, delivery) o elegir otra mesa, que es la misma
  carta para todos los casos: el QR da contexto, no encierra.
- Antes de cobrar hay una pantalla de revisión con los productos, las
  observaciones, la modalidad, la mesa y el total.
- El seguimiento muestra la mesa completa: cada pedido con su estado de pago, el
  total pagado, lo pendiente y el botón **+ Pedir algo más**.

## Qué cambia para el restaurante

Ajustes → «Cobro de pedidos hechos por el cliente»:

| Modalidad | Qué hace |
| --- | --- |
| Pago al finalizar *(por defecto)* | Se cocina y se cobra al terminar. Es el comportamiento que ya existía. |
| Prepago obligatorio | Nada se cocina sin pago confirmado. |
| Según el tipo | Mesa prepago, mostrador al final. |

Con prepago activo:

- **Yape, Plin y transferencia** quedan como intención de pedido: no llegan a
  cocina. Caja los ve en «Prepagos por verificar», comprueba el ingreso en su
  propia app y al confirmar se registra el cobro, se abre la visita y el pedido
  entra a cocina. Un comprobante subido por el cliente es solo un aviso
  (`reportado`), nunca un pago confirmado.
- **Efectivo y tarjeta** se preparan y se cobran en caja: el ticket sale con el
  aviso «cobra en caja».
- La modalidad se puede activar por separado para recojo y delivery.

## Reglas que sostiene el sistema

1. `acceptance_status = "pendiente"` es la única puerta que mantiene un pedido
   fuera de cocina. Un pedido sin pago confirmado no la cruza.
2. Confirmar un prepago es idempotente por pedido: reintentar no duplica el cobro
   ni el pedido.
3. El cobro se registra antes de aceptar el pedido. Si falla (por ejemplo, sin
   caja abierta), el pedido sigue esperando en vez de quedar aceptado sin cobro.
4. Cada envío es un pedido independiente con su propio importe y su propio pago.
   Un pedido ya pagado no se modifica.
5. Una mesa con visita abierta acepta pedidos de otros celulares como cuentas
   adicionales de la misma visita; el ticket lo marca como adicional.
6. Escanear el QR no crea nada: no hay pedido, ni visita, ni mesa ocupada hasta
   que el cliente confirma.

## QR generado desde el panel

«Generar QR y enlace» de cada mesa devuelve el código dibujado, la URL y las
acciones de descargar (SVG), imprimir (con la URL al pie) y copiar el enlace.
Regenerar invalida el cartel anterior; hay que reimprimirlo.

El codificador QR es propio (`frontend/src/lib/qr.js`), sin dependencias nuevas:
modo byte, nivel de corrección M, versiones 1–10.

## Verificación

- Backend: 440 pruebas herméticas en verde, con 20 nuevas en
  `tests/test_table_qr_prepay_flow.py` (contexto del QR, prepago, aceptación de
  cocina, cobro idempotente, cuentas adicionales, apertura de mesa).
- Frontend: 288 pruebas en verde, con 6 nuevas en
  `frontend/src/__tests__/CheckoutTableQr.test.js` y 5 en `qr.test.js`.
- El codificador QR se comparó módulo a módulo contra una implementación
  independiente (qrcodejs) y su tabla de formato contra la norma ISO/IEC 18004.
- `npm run build` compila.

Fallos previos a este cambio, ajenos a este trabajo: `CajaPaymentProof.test.js`
(2) y `PedidoDetalleChargeClose.test.js` (2) ya fallaban en la rama antes de
tocar nada, y `tests/test_charge_and_close.py` no recolecta porque importa
modelos que no existen en `backend/models.py`.

## Alcance no incluido

- Pasarela de pago real (Mercado Pago u otra): hoy la confirmación la hace una
  persona desde Caja. El estado `payment_state` ya distingue `reportado` de
  `confirmado`, que es el punto donde entraría la confirmación técnica.
- Variantes y complementos por producto: el modelo de productos no los tiene.
- Reembolso automático al cancelar un pedido prepagado: la anulación y
  devolución ya existen en Caja, pero no están encadenadas al prepago.
- División de cuenta por persona dentro de una mesa.
