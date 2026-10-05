# Análisis de brecha — Especificación vs Implementación

**Fecha:** 2026-10-05 (relevamiento)
**Fuentes contrastadas:**
- [`PRD-restaurante-saas-v1.0.md`](PRD-restaurante-saas-v1.0.md)
- [`modelo-de-dominio-restaurante-saas-v0.1.md`](modelo-de-dominio-restaurante-saas-v0.1.md)
- [`especificacion-funcional-y-estados-v0.1.md`](especificacion-funcional-y-estados-v0.1.md)
- Código: `backend/` (FastAPI + MongoDB + Motor + PyJWT) y `frontend/src/` (React)

**Método:** contraste directo de cada capacidad de la especificación contra modelos, routers, rutas y componentes reales del código.

---

## Resumen ejecutivo

El código implementa **una parte sustancial del MVP**, pero sigue un modelo de datos que está
**parcialmente alineado** con el dominio más elaborado de la especificación. Puntos clave:

1. **Atención y Mesa** sí existen como conceptos reales y separados (`db.attentions`,
   `active_attention_id` en mesa, numeración idempotente por sucursal y día de negocio). Pero:
   - **Cuenta no es un agregado de primer orden**: se modela reutilizando `Order` (cada
     "cuenta" es una orden dentro de la visita). No hay colección `accounts`.
   - **Una mesa admite una sola atención activa a la vez** (`active_attention_id` singular +
     índice único), mientras la spec exige **varias atenciones independientes por mesa**.

2. **AUSENTES confirmados:** Jornada y lotes de producción, sobrantes, mermas, cortesías,
   constancia de consumo (como entidad backend), cola local offline del mozo, los 3 modos de
   aprobación QR, precios por sucursal, export de catálogo, pedidos programados (fecha/hora)
   y bandeja de aceptar/rechazar pedidos web.

3. **PARCIALES:** división de cuenta (solo pago parcial por ítem; no por comensal/monto),
   KDS (sin adjudicación exclusiva de entrega), reportes (faltan atenciones/descuentos/
   anulaciones/producción/sobrantes/mermas), estados de admisión del pedido (solo cocina +
   `acceptance_status`), pago (sin estado "fallido"), caja (sin toggle controlada/simple),
   importación (solo JSON, no Excel/CSV), multi-negocio (solo sucursal; un restaurante por deploy).

4. Lo que **sí** está bien cubierto: QR de mesa con ciclo de vida completo, numeración de
   atención idempotente, pago digital "Ya pagué" con verificación, caja, aislamiento por
   sucursal con concurrencia cuidada, unión de mesas, menú compuesto y web pública de retiro
   inmediato.

---

## Estado por capacidad

Leyenda: ✅ Implementado · 🟡 Parcial · ❌ Ausente

| # | Capacidad de la especificación | Estado | Evidencia (código) |
|---|---|---|---|
| 1 | Aislamiento multi-negocio / multi-sucursal | 🟡 | Sucursal ✅ (`branch_access.py`, `branch_id` transversal, índices por sucursal); multi-negocio ❌ (un solo `restaurant_id`, `routes/public.py` resuelve `find_one({})`) |
| 2 | Atención (visita numerada) distinta de mesa | ✅ | `attention.py`, `attention_numbering.py`, colección `attentions`; lifecycle `opening/open/closing/closed` |
| 3 | Cuenta financiera separada del pedido + división | 🟡 | Multi-cuenta = varias órdenes con `attention_id` (`order_ids`); **sin** colección `accounts`. UI de cobro expone "Toda la cuenta / Por ítems / Partes iguales"; división **por comensal** ❌ |
| 4 | Mesa con QR (generar/descargar/cancelar/reemplazar) | 🟡 | Backend completo: `guest-link`/`qr/rotate`/`qr/revoke` + `guest_access.py` (HMAC + nonce). Frontend gestiona el enlace (`TableQrActions`) pero **no renderiza imagen QR** para imprimir |
| 5 | Pedido con origen y estados de admisión | 🟡 | Origen `source` + `order_type` ✅; estados de cocina ✅; ciclo borrador/pendiente-aprobación/aprobado/rechazado ❌ (solo `acceptance_status`, órdenes públicas auto-aceptadas) |
| 6 | KDS con preparación por producto y entrega exclusiva | 🟡 | Estados de ítem + bump/serve ✅ (`routes/orders.py`); adjudicación exclusiva de entrega ❌ (sin `claimed_by`) |
| 7 | Pago con estados y verificación digital | ✅ | `routes/payments.py`, `StaffPaymentProof`, "por verificar"→confirmado; estado `fallido` ❌ |
| 8 | Caja (apertura/cierre/conciliación) | 🟡 | `routes/cash.py` con conciliación ✅; toggle controlada/simple ❌ |
| 9 | Jornada + disponibilidad + lotes + sobrantes/mermas | ❌ | Sin entidad jornada/lote/sobrante/merma; solo `is_available`/agotado por producto |
| 10 | Solicitud externa / web pública (inmediato y programado) | 🟡 | Retiro inmediato ✅ (`routes/public.py`, `pickup_enabled`); existe botón "Aceptar y enviar a cocina" (`PedidoDetalle`) cuando `acceptance_status=pendiente`; **programado (fecha/hora) ❌** y rechazo con motivo ❌ |
| 11 | Catálogo + precios por sucursal + menú compuesto + import/export | 🟡 | Catálogo y menú compuesto ✅; precios por sucursal ❌ (un solo `price`); import solo JSON ❌ Excel/CSV; export ❌ |
| 12 | Descuentos, cortesías, anulaciones, mermas, devoluciones | 🟡 | Descuento/anulación/devolución ✅ (`routes/approvals.py`, `PaymentVoid`); cortesía ❌; merma ❌ |
| 13 | Constancia interna de consumo | 🟡 | Frontend `Comprobantes.jsx` + `printReceipt.js`; **sin entidad/endpoint backend** |
| 14 | Reportes | 🟡 | `routes/reports.py` (ventas, top productos, ticket promedio, por medio) ✅; faltan atenciones/descuentos/anulaciones/cortesías/producción/sobrantes/mermas |
| 15 | Cola local offline del mozo | ❌ | Sin guardado local ni sincronización (solo idempotencia de pagos/órdenes) |
| 16 | Modos de aprobación QR (3 modos) | ❌ | Solo `require_table_qr` y `prep_mode`; sin 3 modos ni límites (20u/3 envíos) |
| 17 | Roles por capacidad (propietario/admin/mozo/cocina/caja/repartidor) | 🟡 | 4 roles (`admin|cajero|mozo|cocina`) + `functions`/`can_discount`/`can_void`; faltan propietario y repartidor |

---

## Brechas arquitectónicas clave (diferencias de modelado)

### 1. Una mesa = una atención activa (vs. varias atenciones por mesa)

- **Spec:** "Una mesa puede alojar más de una atención independiente al mismo tiempo" (PRD §7; modelo §5.5; RF-02).
- **Código:** la mesa guarda un único `active_attention_id`, y abrir una visita exige que
  **no exista** `active_attention_id` (`attention.py` L80-104), reforzado por el índice único
  `uniq_open_attention_per_table` (`database.py` L92-96).
- **Impacto:** no se puede representar a dos grupos sin relación en la misma mesa con
  atenciones separadas (CA-AT-2, CA-QR-2, excepción 11.2). La "unión de mesas" agrupa mesas
  distintas, no crea una segunda atención sobre la misma mesa.

### 2. "Cuenta" se implementa como "Order"

- **Spec:** Cuenta es una unidad financiera independiente del pedido; una atención tiene
  varias cuentas y varios pedidos que se asignan a una cuenta.
- **Código:** cada cuenta **es** una orden (`new_account` en `OrderCreate`, `models.py` L398-399);
  la atención referencia `order_id` (cuenta canónica) y `order_ids` (las demás cuentas)
  (`attention.py` L61-77, L267-272). No existe colección `accounts`.
- **Impacto:** la división "por comensal/producto/monto" (RF-12) es limitada: existe reparto
  de *pagos* (`PaymentSplit`, `PaymentLine`, `paid_qty`) pero la cuenta no es un agregado
  autónomo con consumos asignados, saldo y cierre propios.

### 3. Jornada y producción no existen

- **Spec:** Jornada (borrador/activa/cerrada), disponibilidad por jornada, lotes de producción
  y cierre con vendidos/sobrantes/mermas (PRD §10; modelo §5.13; RF-09).
- **Código:** solo `is_available` por producto y `Disponibilidad` para marcar agotado. No hay
  entidad jornada ni registro de producción.
- **Impacto:** los reportes de producción/sobrantes/mermas (PRD §15, RF-19) no pueden cumplirse.

### 4. Cortesía y merma no son conceptos de primer nivel

- **Spec:** cortesía = precio cero + motivo + autorizador; merma = producto preparado que se
  pierde; ambos auditables (modelo §5.9, §5.12; RF-16).
- **Código:** hay descuentos (con `discount_reason` y aprobación) y anulación, pero no una
  categoría explícita "cortesía" ni "merma".

### 5. Pedido programado (para llevar con fecha/hora) ausente

- **Spec:** solicitud externa programada con anticipación mínima (30 min) y ventana de retiro
  (15 min) (§7.5; CA-WEB).
- **Código:** `routes/public.py` soporta retiro inmediato (`recojo`) y `pickup_enabled`, pero
  no hay fecha/hora programada ni ventana; las órdenes web se auto-aceptan sin bandeja de rechazo.

### 6. Cola local offline ausente

- **Spec:** cola local del mozo hasta 8 h / 500 operaciones, sincronización idempotente
  (PRD §17; RF-17; CA-CON).
- **Código:** no hay guardado local ni cola de sincronización.

### 7. Roles y capacidades incompletos

- **Spec:** propietario, administrador, mozo, cocina, caja, repartidor + permisos por capacidad
  (Registrar efectivo, Verificar Yape/Plin, Cerrar atención, Cerrar caja, etc.).
- **Código:** `Role = admin|cajero|mozo|cocina` (`models.py` L30) + `functions`, `can_discount`,
  `can_void`, `can_mark_sold_out`. Faltan repartidor y propietario diferenciado, y la matriz
  fina de capacidades (se aproxima).

### 8. Precios e importación limitados

- **Spec:** catálogo maestro + precio/habilitación/disponibilidad por sucursal; importación
  Excel `.xlsx` (CSV alternativo) con vista previa, y exportación (PRD §9; RF-07/RF-08).
- **Código:** un solo `price` por producto (sin precios por sucursal); import solo JSON
  (`POST /products/import`, `routes/products.py` L132-197); **sin** endpoint de export.

---

## Lo que sí está bien cubierto (para no reimplementar)

- **QR de mesa completo:** token HMAC firmado no predecible (`sign_table` + `qr_nonce`),
  `guest-link` (generar), reimprimir (mismo nonce), **cancelar** (`/qr/revoke`) y **reemplazar**
  (`/qr/rotate`) (`routes/tables.py` L156-209; `guest_access.py`). Cumple RF-03 y CA-QR-4.
- **Numeración de atención idempotente:** secuencia por negocio + sucursal + día de negocio
  local con corte configurable (`business_day_cutoff`), asignada una sola vez al confirmar el
  primer pedido válido (`attention_numbering.py` L54-203). Cumple la enmienda del PRD y
  CA-AT-7/8/9/10/11.
- **Pago digital "Ya pagué" → Por verificar → Confirmado:** prueba de pago (`StaffPaymentProof`,
  `PublicProofUpload`), verificación autorizada, sin reducción de saldo hasta confirmar
  (`routes/payments.py`, `attention.py` L29-58). Cumple RF-13 y CA-PAG-2/3.
- **Cierre de atención con reglas de liquidación:** bloquea si hay comida sin entregar, pagos
  por verificar o cuentas sin cuadrar, y cierra todas las cuentas de la visita
  (`attention.py` L29-58, L424-431). Cumple RF-14 y CA-CIE.
- **Aislamiento por sucursal con concurrencia cuidada:** `branch_access.py`, CAS por
  `updated_at`, fences `attention_state`/`attention_mutation_token`, idempotencia por
  `event_id`/`idempotency_key`/`request_id`, auditoría por `audit_logs`.
- **Caja con conciliación, unión de mesas (`table_groups`), menú compuesto, categorías, zonas.**

---

## Recomendaciones (orden sugerido)

1. **Decidir el modelo Atención/Cuenta/Mesa.** Es la decisión estructural más costosa:
   - (a) adoptar el modelo completo de la spec (varias atenciones por mesa, cuenta como
     agregado independiente), o
   - (b) documentar explícitamente una simplificación (1 atención por mesa, cuenta = orden)
     y actualizar la spec para reflejar la realidad.
2. **Implementar Jornada + disponibilidad por jornada + lotes + sobrantes/mermas**, ya que
   desbloquea los reportes de producción (RF-09, RF-19).
3. **Añadir cortesía y merma como motivos auditables** en el flujo de productos/pagos.
4. **Precios por sucursal + importación Excel/CSV con vista previa + exportación** (RF-07/RF-08).
5. **Pedido programado** (fecha/hora + ventana de retiro) y **bandeja aceptar/rechazar** sobre
   `routes/public.py`.
6. **Cola local offline del mozo** (RF-17) o descartarla explícitamente del MVP.
7. **Completar roles/capacidades** (repartidor, propietario, matriz fina) si el piloto lo requiere.
8. **Constancia de consumo** como entidad/endpoint backend (hoy solo es impresión en el frontend).
