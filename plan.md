# plan.md — Sistema de Gestión para Restaurantes (React + FastAPI + MongoDB)

## 1) Objectives
- Entregar un MVP V1 usable (web + PWA Android) para operación diaria: pedidos → cocina → cobro → caja → reporte.
- Implementar RBAC (roles) y reglas de negocio clave (1 pedido activo por mesa, no editar pagados, cancelación con motivo, sin stock/availability).
- Mantener UX táctil y rápida (tablets/phones), estados con colores y actualización “casi real-time” vía polling.

## 2) Implementation Steps (Phases)

### Phase 1 — Core Flow POC (NO POC; construir directo)
- Configurar monorepo (frontend React, backend FastAPI) + MongoDB connection.
- Definir modelos/estados del core: Tables, Products/Categories, Orders (items embebidos), Payments, Cash register.
- Implementar endpoints mínimos del flujo core y probar manualmente con seed:
  - Crear pedido para mesa, agregar items, enviar a cocina
  - Kitchen board (polling) cambia estados (nuevo→prep→listo)
  - Cobro (pago) y liberación de mesa

### Phase 2 — V1 App Development (MVP completo)
**Backend (FastAPI + Motor + JWT + Pydantic):**
- Auth:
  - Login email/password, refresh opcional, password reset básico (token email deferred si no hay SMTP; usar “reset code” temporal).
  - Middleware RBAC por rol (Admin/Cajero/Mozo/Cocina).
- Collections + índices:
  - restaurants (single active), users_profiles, tables, categories, products, orders (items embebidos), payments, cash_registers, cash_movements, audit_logs.
  - Índices: orders(restaurantId,status,createdAt), tables(restaurantId,number unique), products(restaurantId,categoryId).
- APIs por módulo:
  - Restaurant config (read/update)
  - Users CRUD (admin)
  - Tables CRUD + change status
  - Categories CRUD, Products CRUD (incl. availability)
  - Orders core: create, add/remove/update item, send_to_kitchen, set_status (kitchen), request_bill, cancel (reason), list/filter (by status/table/date)
  - Payments: create payment (methods incl. Mixto), apply discount/tip, mark paid, receipt data
  - Cash register: open, movements (income/expense), close + summary
  - Reports: ventas día/semana/mes, top productos, métodos de pago, cancelados (MVP agregations)
- Business rules + audit:
  - Enforce: 1 active order per table, no edits when paid/cancelled, cancel requires reason, kitchen cannot see payment fields.
  - Audit log on key actions (order status, cancel, payment, cash open/close).
- Seed script:
  - Restaurant demo + categorías/productos/mesas + credenciales default.

**Frontend (React + Tailwind + shadcn/ui + React Router):**
- App shell:
  - Layout responsive, navegación por rol, protección de rutas.
  - Theme + componentes táctiles (botones grandes) + badges de estado con colores.
- Screens (V1):
  - Login + recovery (MVP)
  - Dashboard (stats del día según rol)
  - Mesas (grid por estado; abrir pedido activo)
  - Pedido (crear/editar items, notas, enviar a cocina, solicitar cuenta)
  - Cocina (board: Nuevos/En preparación/Listos) con polling 3s
  - Caja (pendientes de pago, cobrar, cambio, métodos, recibo)
  - Apertura/Cierre de caja + movimientos
  - Productos/Categorías (admin)
  - Usuarios (admin)
  - Reportes: la pantalla `/reportes` es solo para administradores; las APIs de ventas/productos conservan sus controles de rol para admin/cajero.
  - Configuración restaurante (admin)
- Polling strategy:
  - Hook común `usePolling(queryKey, interval=3000)` para cocina/mesas/pedidos.
- PWA:
  - manifest.json, icons, service worker básico (cache shell) + “install prompt”.

**User stories (Phase 2)**
1. Como Admin, quiero iniciar sesión y ver un dashboard con ventas del día para saber cómo va el negocio.
2. Como Admin, quiero crear categorías y productos con precios/estado disponible para armar el menú.
3. Como Admin, quiero crear mesas por zona/capacidad para reflejar mi salón.
4. Como Mozo, quiero seleccionar una mesa disponible, crear un pedido y agregar productos con observaciones para tomar órdenes rápido.
5. Como Mozo, quiero enviar el pedido a cocina y ver su estado actualizado para coordinar el servicio.
6. Como Cocina, quiero ver pedidos nuevos en tiempo real (polling) y marcarlos en preparación/listos para organizar la producción.
7. Como Cajero, quiero ver pedidos “pendiente de pago” y registrar un pago (incl. mixto) para cerrar la venta.
8. Como Sistema, quiero liberar automáticamente la mesa al pagarse el pedido para mantener disponibilidad correcta.
9. Como Admin, quiero abrir/cerrar caja y ver el resumen por método para controlar efectivo.
10. Como Admin, quiero ver un reporte básico por fecha con top productos y métodos de pago para tomar decisiones.

**End of Phase 2:**
- 1 ronda de pruebas E2E con testing_agent_v3 sobre el flujo core completo.

### Phase 3 — Hardening, UX polish, and test expansion
- Mejoras de robustez:
  - Validaciones extra (precios, cantidades, estados permitidos), manejo de errores uniforme.
  - Optimizar queries/aggregations de reportes.
  - Control de concurrencia básico (evitar doble cobro / doble pedido activo).
- UX:
  - Atajos por rol, confirm dialogs, sonidos/avisos opcionales en cocina (toggle).
  - Mejoras PWA offline “read-only” (cache de menú/mesas) sin operaciones críticas offline.
- Testing:
  - Seed reproducible + pruebas de regresión E2E (roles distintos).

**User stories (Phase 3)**
1. Como Cocina, quiero ver claramente el tiempo transcurrido por pedido para priorizar.
2. Como Cajero, quiero prevenir cobros duplicados con mensajes claros si el pedido ya fue pagado.
3. Como Mozo, quiero ver alertas cuando cocina marque “Listo” para entregar más rápido.
4. Como Admin, quiero exportar un resumen diario (CSV) para contabilidad básica.
5. Como Sistema, quiero un historial/auditoría navegable por pedido para rastrear incidentes.

**End of Phase 3:**
- 1 ronda de pruebas E2E con testing_agent_v3 (incl. regresión del flujo core).

### Phase 4+ — V2/V3 (roadmap)
- V2: clientes, delivery/takeout, QR menú, promos/descuentos avanzados, impresión de tickets.
- V3: facturación electrónica, inventario/recetas/mermas, multi-sucursal real, loyalty, pasarela de pago. El aislamiento/reporting por sucursal de este proyecto ya está implementado y verificado localmente; las capacidades multi-sucursal más amplias siguen pendientes.

## 3) Next Actions
1. Crear estructura de proyecto + configuración env (Mongo URI, JWT secret, CORS) + seed inicial.
2. Implementar backend core: tables/products/orders/payments/cash + reglas de negocio.
3. Implementar frontend core: Mesas → Pedido → Cocina → Caja con polling.
4. Añadir auth + RBAC + pantallas admin (usuarios/productos/reportes).
5. Activar PWA (manifest + SW) y correr pruebas E2E (testing_agent_v3).

## 4) Success Criteria
- Flujo core completo funciona sin errores: Mozo crea pedido → Cocina procesa → Cajero cobra → Mesa queda disponible.
- RBAC correcto: cocina no ve pagos, mozo no ve reportes financieros, cajero no administra productos/usuarios.
- Polling actualiza cocina/mesas en ≤3–6s de latencia percibida.
- Caja: apertura/cierre y resumen por método cuadra con pagos registrados.
- Reporte diario muestra totales y rankings coherentes.
- PWA instalable en Android y usable en tablet/móvil con UI táctil.
## Estado actual: Fase 2 COMPLETADA ✅

- Backend FastAPI + MongoDB con auth JWT, 10 routers (auth, users, restaurants, tables, categories, products, orders, payments, cash, reports)
- Seed automático: 1 restaurante (Sabor Peruano), 4 usuarios demo, 5 categorías, 14 productos, 12 mesas
- Frontend React + Tailwind + shadcn/ui con 13 páginas y AppShell (sidebar + topbar)
- Recharts en Reportes (bar + pie chart)
- PWA: manifest.json + meta tags Apple/Android
- Polling cada 3s para tiempo real (Cocina, Mesas, Pedidos)
- Testing agent: 92.6% backend pass, frontend roles + páginas clave verificadas, sin bugs reales

## Próximos pasos posibles (V2/V3 a pedido del usuario):
- Clientes, Delivery, descuentos/promos, impresión de tickets, app Android empaquetada (Capacitor)
- Unir mesas **ya ocupadas**: agrupar con cuentas separadas (F1) ya está en la rama `feat/unir-mesas`; fusionar dos pedidos en una sola cuenta (F2, toca dinero y cocina) queda diferido en el [issue #40](https://github.com/adolfoleonidas/Restaurant/issues/40)
- Facturación electrónica, inventario, recetas, stock, capacidades multi-sucursal más amplias, fidelización y pasarelas de pago

## Pedido desde el QR de mesa con prepago opcional (2026-10-06)

El QR de una mesa ya no lleva al checkout: abre la carta con la mesa en contexto
y el pedido sigue el flujo normal (carrito → revisión → pago si corresponde →
cocina). El restaurante elige en Ajustes cómo cobra los pedidos hechos por el
cliente: pago al finalizar (por defecto, el comportamiento anterior), prepago
obligatorio, o según el tipo de pedido. Con prepago, un pedido por
Yape/Plin/transferencia no entra a cocina hasta que Caja confirme el pago; el
efectivo y la tarjeta se preparan y se cobran en caja. Alcance, reglas y evidencia
en la [nota de la entrega](docs/releases/mesa-qr-prepago.md). Nada de esto está
desplegado.

## Estado local de aislamiento por sucursal (2026-10-03)

La implementación T1–T4 de aislamiento operativo y contexto de reportes está guardada en commits locales y cuenta con regresiones locales verificadas; el [tracker de aislamiento por sucursal](odd/tasks/branch-isolation.md) conserva el alcance y la evidencia detallada. Esto no certifica autenticación en vivo, navegación en navegador, migración/índice de base de datos ni despliegue. La transición controlada de índice y rollout sigue pendiente de autorización. El roadmap V3 conserva otras capacidades multi-sucursal aún no implementadas.

## Unir mesas y mover el pedido de mesa (rama publicada `feat/unir-mesas`)

Implementado en la worktree `.worktrees/unir-mesas` y publicado como rama `feat/unir-mesas` (sin merge a main, así que no dispara el deploy): agrupar mesas como marca del salón (cada mesa conserva su propia cuenta) y mover una visita abierta —pedido y visita— a otra mesa libre de la misma sucursal. Alcance, decisiones y evidencia en el [tracker de unir mesas](odd/tasks/unir-mesas.md). Se pueden unir mesas libres entre sí, una mesa con pedido con una libre, y también **dos mesas que ya tienen su propio pedido**: cada una conserva su cuenta y el grupo indica cuántas cuentas tiene (F1). Lo que sigue sin existir es **fusionar** esas dos cuentas en una sola (F2), diferido por el dueño en el [issue #40](https://github.com/adolfoleonidas/Restaurant/issues/40). Nada de esto está desplegado ni mergeado.

### La interfaz de unir mesas, rehecha para el mozo

Sobre esa base, la pantalla cambió después para que la operación se pueda hacer
durante el servicio sin adivinar nada (detalle y evidencia en
[§9 de adaptación móvil](docs/mobile-adaptation.md)):

- **Ampliar un grupo ya no obliga a separarlo.** Sumar la mesa 5 al grupo 3 + 4
  se hacía separando y volviendo a unir las tres. La API ya tenía el endpoint
  (`POST /table-groups/:id/tables`); ahora la interfaz lo usa: se toca el grupo y
  después la mesa libre.
- **Elegir un grupo es elegir la fiesta entera**, no una silla, y sus mini-mesas
  eligen el grupo en vez de abrir la hoja.
- **Lo elegido son fichas quitables** de una en una, con la suma de asientos y una
  línea de guía que ya no desaparece justo cuando falta una mesa más.
- **La mesa no elegible lo dice en su propia tarjeta** (borde discontinuo, `No` y
  el motivo): el error ya no vive solo en la barra del fondo de la pantalla.
- **Separar está en la tarjeta del grupo**, con confirmación, en vez de tres
  toques dentro de la hoja.
- **La mesa principal del grupo se puede elegir**, cuando hay más de una
  candidata; la regla del servidor no cambia (con cuentas abiertas, la principal
  tiene que ser una de ellas).

## Cobrar es cobrar (ronda 13 de la auditoría de UI/UX)

En el salón, **Cobrar** abría `/pedidos/<cuenta>`, que es el detalle del pedido
**con tomador de pedidos**: el mozo pedía cobrar y aterrizaba en la carta, con el
botón de cobro al final de un scroll largo. El destino correcto ya existía y se
usaba desde otra pantalla: la caja abre el cobro de una cuenta concreta por
`?order=<id>` (`CajaWorkspace`), y el detalle del pedido ya navegaba ahí cuando no
hay turno abierto. El salón era el único que ignoraba ese contrato.

- **Cobrar lleva a la caja** (`/caja?order=<id>`). Quien no pueda abrir la caja
  conserva el respaldo, aunque hoy no ocurre: `salon.charge` exige la función de
  cobro y esa función abre la ruta, invariante que ahora fija una prueba.
- **Se corrigió un P0 latente**: el enlace `?order=` se releía en cada sondeo, así
  que cualquier cambio del piso volvía a abrir el diálogo de cobro que el mozo
  acababa de cerrar. Ahora se consume una sola vez y se quita de la URL.
- **Hay tres implementaciones de "elegir productos"**, no dos: la compartida
  (`OrderComposer`, que sirve a la hoja de mesa y a "Nuevo pedido" del salón) y dos
  rejillas propias casi idénticas (`/pedidos/nuevo` y `/pedidos/:id`). Lo redundante
  es `/pedidos/nuevo`; `/pedidos/:id` es la única superficie que agrega productos a
  un pedido que no creó y la única que cobra, entrega, solicita cuenta, reasigna
  mozo y anula. **Consolidar `/pedidos/nuevo` queda pendiente de decisión**: exige
  definir dónde se compone un pedido de mesa fuera del piso.
- **Se reparó `docs/ui-ux-audit.md`**, que estaba corrupto (bytes NUL y de control
  de un escapado que se comió letras) y las herramientas trataban como binario.

Detalle, evidencia y pendientes en la
[ronda 13 de la auditoría](docs/ui-ux-audit.md).
