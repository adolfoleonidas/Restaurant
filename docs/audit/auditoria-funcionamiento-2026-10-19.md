# Auditoría de funcionamiento — 2026-10-19

Rama auditada: `hardening/fase-1` (Fase 0 mergeada en main, Fase 1 en PR #124).
Método: suites completas ejecutadas en esta sesión + dos agentes de auditoría de código
(backend y frontend) con re-verificación manual de todos los hallazgos ALTOS.
Los hallazgos de severidad ALTA fueron confirmados línea por línea por el orquestador.

## Veredicto

- **Funcional: SÍ.** Backend hermético `816 passed, 49 deselected`; frontend
  `151 suites / 1464 tests passed`. Ambas suites corridas hoy.
- **Sin hallazgos CRÍTICOS nuevos.** La saga de pagos/anulaciones (Fase 1) fue revisada
  a fondo y no se encontró pérdida de dinero ni carrera que corrompa montos.
- **Bloqueantes de SaaS multi-tenant: sin cambios** (Fase 2 pendiente): `_get_restaurant()`
  mono-tenant, tracking codes globales, sin alta de tenants, Lima/PEN hardcodeado.

## Hallazgos nuevos (confirmados)

| # | Sev | Hallazgo | Evidencia | Escenario de fallo | Fix |
|---|---|---|---|---|---|
| 1 | ALTA | SSE público sin tope de conexiones | `backend/routes/public.py:1030` (sin contador ni 429; ping lo mantiene vivo; nginx `proxy_read_timeout 3600s`) | Una IP sostiene miles de streams; cada `publish()` itera todos en el único event loop → salón/cocina/caja degradados | Tope por `client_host` (~5) y global (~200) con 429; validar `restaurant_id`; cerrar streams a los ~10 min; `limit_conn` en nginx |
| 2 | ALTA (condicional) | `--forwarded-allow-ips=*` fijo en la imagen | `backend/Dockerfile:23`; lockout keyed en `request.client.host` (`routes/auth.py:53`) que toma el PRIMER XFF; `client_host()` toma el ÚLTIMO | Seguro solo detrás de nuestro nginx (reemplaza XFF, sin puertos publicados). En un PaaS directo (p. ej. Seenode) el lockout de login se bypassea con XFF falsos | Quitar `*` del CMD; `FORWARDED_ALLOW_IPS` por compose; unificar en `client_host()` también para login |
| 3 | ALTA (regresión de T4) | La CSP bloquea toda imagen externa | `frontend/nginx.conf:50` `img-src 'self' data: blob:`; Pexels en `Login.jsx:89`, `seed.py:274-297`, `image_url` libre en `models.py:98` | Fotos de platos, portada y héroe de login desaparecen en producción, sin error visible | `img-src 'self' data: blob: https:` (o hospedar imágenes propias) |
| 4 | ALTA (regresión de T2) | Timeout global de 20 s corta la subida de comprobantes | `frontend/src/lib/api.js:10`; `uploadPublicOrderProof` sin override (`lib/api/public.js:16`); base64 de hasta ~2.4 MB | En datos móviles lentos el comprobante Yape/Plin nunca sube; el prepago no se confirma | `timeout: 120000` (o 0) en uploads de comprobante/import/reset; comprimir imagen antes |
| 5 | ALTA | `isPublicPath('/pedido')` matchea `/pedidos*` (staff) | `frontend/src/lib/authSession.js:4` | Con JWT vencido en Pedidos: sin logout, SSE se apaga, outbox reintenta por siempre; el mozo ve "No hay pedidos" | Match por segmento exacto (`=== '/pedido' || startsWith('/pedido/')`); tests con `/pedidos`, `/gestion/menu` |
| 6 | ALTA | Checkout queda mudo si falla el fetch de config | `frontend/src/pages/Checkout.jsx:116-122` sin `.catch`; botón deshabilitado sin explicación | Un timeout o 429 deja la ruta de ingresos inutilizable sin mensaje ni retry | Estado de error con retry como `Landing.jsx:82` |

Medios nuevos destacables (evidencia en los informes de agentes, no re-verificados uno a uno):
carrito editable tras reportar pago (`public.py:255`, confirm cobra el total nuevo);
`prepay.reject` sin scope de sucursal (`prepay.py:217`); sin manejo de 429 en el frontend
(límite público compartido se agota con ~13 clientes tras un mismo Wi-Fi); un poll fallido
borra el pedido vivo del cliente (`LiveOrderContext.jsx:37`); `quantity` sin tope máximo
(`models.py:400`); comprobantes base64 viajando en cada poll de caja (`orders.py:47`);
índice faltante `(restaurant_id, attention_id)`; contador de pedidos sin índice único;
doble-submit en Productos/Categorías; Esc/foco en sub-diálogos de cobro; SW recarga en
medio del checkout público; `reset-sw.html` probablemente roto por la CSP; páginas admin
restantes que enmascaran errores (Productos, Categorías, Usuarios, Pagos, Local, Pedidos,
Disponibilidad, Comprobantes, PedidoDetalle, PedidoNuevo).

## Estado de hallazgos previos

- FIXED (verificado): `/gestion/menu`, índice parcial de idempotencia, contador por día de
  negocio (persiste carrera sin índice único), filtro SSE fail-closed, event_id determinista,
  bcrypt fuera del loop, watchdog SSE, timeout axios (con regresión #4), headers (con
  regresión #3), saga de void unificada, páginas de caja con estados honestos.
- PARTIAL: scope de prepay (list/confirm sí; `reject` no), limitador de tracking (no cubre
  mutaciones ni proof ni stream).
- STILL OPEN: todo el bloque multi-tenant (Fase 2), JWT 7 días sin revocación, QR HMAC con
  `JWT_SECRET`, truncado de reportes + agregación en el loop, dinero en float, audit_logs
  borrable y sin lectura, god hooks, ~8 dependencias muertas + ~29 componentes UI sin uso,
  telemetría (T6, pospuesta por decisión del dueño).

## Plan de corrección propuesto

1. **Fase 1.1 — regresiones y ALTOS (antes de desplegar):** #3 CSP img-src, #4 timeout de
   uploads, #5 isPublicPath, #6 catch de Checkout, #1 tope de SSE, #2 forwarded-allow-ips.
   Más los dos de plata chica: reject con scope y carrito congelado tras reportar pago.
   ~1-2 días con tests.
2. **Fase 1.2 — medios:** 429 handling + mensajes, LiveOrder resiliente, tope de quantity,
   proyección sin proof en listas, índices (`attention_id`, counters único), doble-submit,
   estados de error en páginas admin restantes, SW/checkout, sub-diálogos de cobro.
   ~3-4 días.
3. **Fase 2 — multi-tenant** (sin cambios respecto del plan anterior).

## No verificado

- Los dos `nginx.conf` siguen sin lintear (sin nginx ni Docker en la máquina de desarrollo).
- M5/M9/M11 del frontend (Esc en sub-diálogos, `reset-sw.html`, chunk recovery con
  React.lazy) razonados desde código, no observados en navegador.
- Los 49 tests de integración no se corrieron (requieren server vivo con seed demo).
- Auditoría UX en vivo (contrastes reales, tap targets medidos) pendiente: requiere app
  corriendo; ver skill `ux-ui-audit`.
