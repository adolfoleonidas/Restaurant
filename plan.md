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
- Clientes, Delivery, QR menu, descuentos/promos, impresión de tickets, app Android empaquetada (Capacitor)
- Facturación electrónica, inventario, recetas, stock, capacidades multi-sucursal más amplias, fidelización y pasarelas de pago

## Estado local de aislamiento por sucursal (2026-10-03)

La implementación T1–T4 de aislamiento operativo y contexto de reportes está guardada en commits locales y cuenta con regresiones locales verificadas; el [tracker de aislamiento por sucursal](odd/tasks/branch-isolation.md) conserva el alcance y la evidencia detallada. Esto no certifica autenticación en vivo, navegación en navegador, migración/índice de base de datos ni despliegue. La transición controlada de índice y rollout sigue pendiente de autorización. El roadmap V3 conserva otras capacidades multi-sucursal aún no implementadas.
