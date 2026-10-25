# Recorrido de 5 minutos

Objetivo: ver el ciclo completo (**mesa → pedido → cocina → entrega → cobro → comprobante**) y el canal del cliente, usando solo los datos de demostración. No hay que configurar nada.

## Antes de empezar

```bash
cp env.example .env
docker compose up --build
```

Abre **http://localhost:8081**. El seed crea el restaurante *Sabor Peruano*, 12 mesas en 3 zonas (Salón, Terraza, Segundo piso), 14 productos y las cuatro cuentas de [env.example](../env.example).

Usa una ventana normal y una de incógnito: el recorrido cambia de rol y las sesiones no se comparten.

## El recorrido

| # | Quién | Qué hacer | Qué demuestra |
|---|---|---|---|
| 1 | Mozo | Entra como `mozo@resto.com` / `mozo123`. En **Salón**, elige una mesa libre y pulsa **Tomar pedido**. | El salón es el punto de partida de la operación: estados por mesa, zonas y barra de acciones. |
| 2 | Mozo | Agrega un *Ceviche Clásico* (S/ 38) y una *Chicha Morada* (S/ 8) y envía el pedido a cocina. | La comanda se arma sobre la carta real, con precios y cantidades; el pedido nace con número y mesa. |
| 3 | Cocina | En la ventana de incógnito entra como `cocina@resto.com` / `cocina123` y abre **Cocina**. | El pase muestra el pedido en la columna de los que llegan, con mesa, número y tiempo transcurrido. |
| 4 | Cocina | Mueve el plato a preparación y luego a listo. | Cada transición es explícita: no hay un estado "en curso" ambiguo. |
| 5 | Mozo | Vuelve al salón: la mesa cambió de estado sin recargar. Pulsa **Entregar** y después **Solicitar cuenta**. | Tiempo real por SSE, y la mesa pasa a "cuenta" cuando el cliente está listo para pagar. |
| 6 | Cajero | Entra como `cajero@resto.com` / `cajero123` en **Caja**, cobra en efectivo con S/ 50 recibidos y confirma. | El cobro calcula el vuelto (S/ 4), cierra la cuenta y deja el movimiento en el turno de caja. |
| 7 | Cajero | Revisa **Comprobantes**. | Queda el registro del cobro asociado al pedido: es lo que después suma en reportes. |
| 8 | Cliente | Cierra sesión y abre **http://localhost:8081/menu**. Agrega productos, elige recojo o delivery y termina el pedido. | La carta pública usa el mismo catálogo que el salón, sin duplicar pedidos. |
| 9 | Cliente | Abre el enlace de seguimiento del pedido (`/pedido/<código>`). | El cliente ve el avance sin cuenta ni app. |

## Lo que conviene mirar con atención

- **Permisos por rol.** El mozo no ve Caja ni Reportes; cocina no ve precios de venta. La fuente única es [`frontend/src/lib/permissions.js`](../frontend/src/lib/permissions.js).
- **Una sola verdad por pantalla.** El salón del mozo y el pase de cocina leen el mismo pedido: si cocina marca listo, el salón lo ve al instante.
- **Cuenta por persona.** Abre una mesa con dos personas y usa **Pedido de otra persona**: cada una tiene su cuenta y se pueden fusionar, mover o dividir.
- **QR de mesa.** En **Configuración → mesas** hay un enlace firmado por mesa. Al abrirlo en el móvil, la mesa llega preseleccionada en la carta.

## Si algo no cuadra

- Mesa que no aparece o pedido que no avanza: revisa el orden de los pasos en [estados-y-flujo.md](estados-y-flujo.md); una transición fuera de orden se rechaza a propósito.
- ¿Empezar de cero? `docker compose down -v` borra la base y el siguiente arranque vuelve a sembrar los datos demo.
