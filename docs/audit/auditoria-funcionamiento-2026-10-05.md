# Auditoría de funcionamiento del sistema

**Fecha:** 2026-10-05
**Alcance acordado:** (a) estado operativo verificable y (b) flujos de negocio del núcleo.
**Entregable:** informe de hallazgos priorizado. **No se modificó código de la aplicación.**

**Commit auditado (pinned):** `28e2681` — rama `fix/a11y-sheet-title`
**Tree:** `cea1fd8c70c667dd7dfaa87c78194a1c75465759`
**`origin/main` en el momento de la auditoría:** `980a870`

> **Advertencia de concurrencia.** El repositorio estaba siendo modificado por otra sesión
> **durante** esta auditoría: `HEAD` pasó de `feat/menu-mas-resumen` (`3ede230`) a
> `fix/a11y-sheet-title` (`28e2681`) a las 12:40:40–12:41:31, y `origin/main` ya contiene el
> merge del PR #53 (`feat/menu-mas-resumen`). Todos los hallazgos se refieren al commit
> `28e2681`. Si el árbol volvió a moverse, reverificar antes de actuar.

---

## 0. Cómo se obtuvo la evidencia

| Verificación | Comando | Resultado |
|---|---|---|
| Suite backend hermética | `pytest tests -m "not integration" --ignore=tests/test_charge_and_close.py` | **400 passed**, 49 deselected, 23.9 s |
| Suite backend completa (CI) | `pytest tests -m "not integration"` | **FALLA en recolección** (exit 1, 0 tests) |
| Tests frontend | `npx craco test --watchAll=false --runInBand --ci` | **2 failed, 242 passed** (40 suites: 1 failed) |
| Build de producción | `npx craco build` (CI=true) | **OK**, compilado, exit 0 |
| Arranque del backend | importar `server` con `MONGO_URL` dummy | **OK**, 104 rutas `/api` registradas |
| Guardia de config | `assert_runtime_config()` en `development` | **OK** |

**Entorno:** sin Docker, sin MongoDB, sin `python` en PATH (se usó `backend\.venv\Scripts\python.exe`, Python 3.13.6), Node v24.21.0. Por eso **no se levantó la aplicación ni se ejecutó tráfico real**; ver §4.

---

## 1. Estado operativo verificable

### 1.1 Lo que está sano

- La **suite backend hermética pasa 400/400** sin necesidad de un MongoDB real (los tests usan fakes en memoria). Coincide con el histórico del proyecto (`odd/tasks/unir-mesas.md:42` registraba 390).
- El **build de frontend pasa** con `CI=true` (sin warnings de ESLint convertidos en error).
- El **backend importa limpio**: los 19 routers se montan sin error (104 rutas).
- **El `.env` no está versionado** y `.gitignore` cubre `.env`, `.env.*` y `*.env`; no hay secretos commiteados.
- **No hay deuda marcada**: 0 coincidencias de `TODO/FIXME/HACK/XXX` en `backend/` y `frontend/src/`.

### 1.2 H-1 · Un archivo de test sin commitear rompe **toda** la suite backend — Crítica

`tests/test_charge_and_close.py:14` importa modelos que no existen:

```python
from models import AttentionCloseBody, AttentionCloseSettle
```

`backend/models.py` no define esas clases. El resultado no es un fallo de un test, sino un
**error de recolección que aborta la suite entera**:

```
ERROR collecting tests/test_charge_and_close.py
E   ImportError: cannot import name 'AttentionCloseBody' from 'models'
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
49 deselected, 1 error in 1.63s
```

**Impacto:** el comando exacto de CI (`deploy.yml`, job `test`: `python -m pytest tests -m "not integration" -q`) devuelve exit 1 y **bloquea el deploy**. Hoy el daño está contenido solo porque el archivo está sin commitear; en cuanto se commitee, `main` queda rojo.

### 1.3 H-2 · Dos tests de frontend sin commitear definen una función que no existe — Alta

`frontend/src/__tests__/PedidoDetalleChargeClose.test.js` (4 casos: 2 fallan, 2 pasan "en vacío") espera un botón `data-testid="pedido-cobrar-cerrar-button"` y un endpoint con body:

```js
expect(api.post).toHaveBeenCalledWith('/orders/order-1/attention/close', {
    settle: { amount: 25, idempotency_key: expect.any(String), ... },
});
```

Verificado: **ese `data-testid` no existe en ningún archivo de `frontend/src`** (solo aparece en el test), y `close_attention` no declara ningún parámetro de body (`backend/routes/orders.py:423-424`), así que FastAPI descartaría `{settle: ...}`. La capacidad **"cobrar y cerrar en un paso" no está implementada**.

Esto **no es trabajo arbitrario**: es la respuesta a un P1 ya documentado por el propio proyecto
(`frontend/e2e/UIUX-FINDINGS.md:16-25`: *"La mesa no se libera sola al pagar… la mesa queda
ocupada aunque ya cobró"*), y el tracker confirma que es una tarea aparte
(`odd/tasks/mvp-flow-validation.md:62` ordena dejar fuera ambos archivos). **Causa raíz verificada
en el backend** (`backend/routes/payments.py:530`):

```python
if order_set.get("status") == "pagado" and order.get("table_id") and not order.get("attention_id"):
```

La liberación automática de la mesa **excluye explícitamente los pedidos con visita** (`attention_id`),
que son todos los de salón. La única vía de liberación es Salón → "Finalizar mesa"
(`frontend/src/pages/Salon.jsx:630`).

### 1.4 H-3 · `main` local está 72 commits atrás de `origin/main` — Media (higiene operativa)

```
git rev-list --left-right --count main...origin/main  →  0   72
```

La rama local `main` (`5f77ae1`) no tiene nada que `origin/main` (`980a870`) no tenga. Existe además
un **segundo clon completo** del mismo repositorio en `C:\Users\adolf\Downloads\cobro-restaurante`
también en `main` = `5f77ae1`, y 8 worktrees registrados. Riesgo: auditar, medir o desplegar desde
un checkout equivocado y creer que se está mirando el código vigente.

---

## 2. Hallazgos priorizados (consolidado)

Leyenda de verificación: **[V]** verificado por mí leyendo el código citado · **[E]** verificado
ejecutando un comando · **[R]** reportado por un auditor especializado, con evidencia citada, no
reproducido en vivo.

### Críticos

| # | Hallazgo | Evidencia | Ver. |
|---|---|---|---|
| C1 | **La sesión de invitado (QR) no está atada a mesa, sucursal ni restaurante.** Los endpoints de seguimiento buscan el pedido **solo** por `tracking_code` (8 caracteres base36) y devuelven `customer_name`, `customer_phone`, `customer_address`; las mutaciones (agregar/cambiar/borrar ítems, subir comprobante) usan la misma consulta sin validar el token de mesa. El propio código documenta que el código **es** la credencial. | `backend/routes/public.py:614-619` (lectura), `:625-628`, `:658-661`, `:693-696`, `:798-800` (mutaciones), `:90-112` (PII); `:31-33` (8 chars); `backend/guest_access.py:56-60` (solo cuenta fallos, clave falsificable por `x-forwarded-for`) | [V] |
| C2 | **Un test sin commitear bloquea el pipeline completo** (ver §1.2). | `tests/test_charge_and_close.py:14`; `backend/models.py` | [E] |

**Impacto de C1:** con un QR de mesa cualquiera se pueden leer datos personales de clientes de
**cualquier mesa y cualquier sucursal** y modificar pedidos ajenos (afecta cocina y saldos). Viola
RF-06 de la especificación. El proyecto ya documenta que el QR no expira (TTL de 10 años,
`guest_access.py:10`) ni se invalida al cerrar la visita.

### Altos

| # | Hallazgo | Evidencia | Ver. |
|---|---|---|---|
| A2 | **El dueño/administrador no puede cerrar la caja de una sucursal ni registrar movimientos.** La UI manda `branch_id` al **abrir** pero no al **cerrar** ni al **mover**. El backend, sin `branch_id`, busca una caja `branch_id: None` (no la encuentra → 400 "No hay caja abierta") o exige selección explícita (400 "Seleccione una sucursal para esta operación"). | UI: `frontend/src/pages/Caja.jsx:445-448` (abre, sí manda) vs `:482` (cierra, no manda) y `:538` (movimiento, no manda). Backend: `backend/routes/cash.py:229-232`, `:279-281`, `_cash_branch` en `:84-96`, `_branch_query` en `:103-106` | [V] |
| A3 | **El comprobante Yape/Plin subido por staff deja la caja imposible de cerrar.** Subirlo escribe `payment_proof_status: "pendiente"`; registrarlo como cobro **no limpia** ese campo; el único endpoint que lo resuelve (`confirm-payment`) solo se invoca desde la UI en la lista de pedidos **web** (`source === 'public'`). El cierre de caja rechaza cualquier `payment_proof_status: "pendiente"`. | Escribe: `backend/routes/payments.py:155-166`. No limpia: `:421-438`. Resuelve: `backend/routes/orders.py:885-895`. UI solo para web: `frontend/src/pages/Caja.jsx:641-648` + `:652`. Bloquea cierre: `backend/routes/cash.py:238` | [V] |
| A4 | **Cobro que el backend registra distinto de lo que la UI muestra**: si la cuenta ya tiene propina guardada, el diálogo la ignora al mostrar el total, pero el backend la reutiliza y recalcula la factura. Además, tras un 409 "la cuenta cambió" el diálogo mantiene un snapshot congelado y no ofrece recargar (solo se sale cerrándolo). | `frontend/src/components/CobrarDialog.jsx:110,219-240`; `backend/routes/payments.py:351-359,394,399` | [R] |
| A5 | **Efectivo "cobrado" sin fila de pago.** El pedido se marca `pagado`/`amount_paid` **antes** de insertar el pago, y la reversión `_release_claim()` no comprueba si efectivamente revirtió. Si el insert falla, queda un pedido pagado sin pago: la caja no lo ve, y ya no se puede cobrar ni cancelar. | `backend/routes/payments.py:451-454` vs `:515`; `_release_claim` en `:497-512` | [V] |
| A6 | **Pago sin `idempotency_key` puede devolver 200 con el pago viejo.** El campo se guarda siempre (`None` incluido) bajo un índice `unique + sparse`; un índice sparse **sí** indexa `null`, así que solo puede existir un pago sin clave en toda la base; el `DuplicateKeyError` se captura y puede responder "replay" con un pago anterior del mismo pedido → dinero recibido sin registro. | `backend/routes/payments.py:494`, `:516-524`; `backend/database.py:63-68` | [V] |
| A7 | **Descuento sin tope por rol**: con `can_discount` se puede liquidar una cuenta de S/100 por S/0.01 y queda `pagado`. La especificación pide 10 % (mozo) / 15 % (caja) con escalado a aprobación; el flujo de aprobaciones no aplica descuentos. | `backend/routes/payments.py:339-346`; `backend/billing.py:14-16`; spec `docs/spec/especificacion-funcional-y-estados-v0.1.md:435-438` | [R] |
| A8 | **Fallo de carga = "Cargando pedido…" infinito** en el detalle de pedido (no se lee `error`; 404/403/backend caído son indistinguibles). | `frontend/src/pages/PedidoDetalle.jsx:31`, `:116` | [R] |

> La numeración de "Altos" empieza en A2 porque el ítem A1 se retiró: duplicaba C2/§1.2.

### Medios

| # | Hallazgo | Evidencia | Ver. |
|---|---|---|---|
| M1 | **Sobrecobro por líneas de pago duplicadas.** `line_total` acumula por línea sin deduplicar; el mismo ítem repetido cobra el doble y el ranking de productos lo reporta inflado. | `backend/routes/payments.py:372-381`; `backend/billing.py:130-148` | [V] |
| M2 | **Pago mixto descuadra el arqueo:** el vuelto solo se resta del efectivo y el residual negativo se recorta a 0, así que `by_method` puede sumar más que `total_sales` del mismo pago. | `backend/billing.py:63-71`; `backend/routes/payments.py:386-389` | [R] |
| M3 | **Carrera cierre-de-caja / cobro:** nada escribe en `cash_registers` al cobrar, así que un pago puede entrar después de que el cierre congeló `total_sales` y no aparecer en el arqueo. | `backend/routes/cash.py:249-260`; `backend/routes/payments.py:305-307,515` | [R] |
| M4 | **Devolución post-cierre no reintentable** en el camino sin visita (uuid aleatorio, sin idempotencia): si falla el egreso, el cobro queda anulado sin salida de caja y no se puede reintentar. El camino con visita sí es idempotente. | `backend/routes/payments.py:925-933` vs `:638-654` | [R] |
| M5 | **Se sobrescribe un comprobante pendiente** (el guard solo protege el campo heredado): se pierde la trazabilidad del original en revisión. | `backend/routes/payments.py:121-125` vs `:143-148` | [R] |
| M6 | **"Confirmar" un pedido web sin comprobante** marca el pago como confirmado sin que haya entrado dinero, y bloquea el cierre de caja. La propia UI lo admite mostrando "Sin comprobante". | `frontend/src/pages/Caja.jsx:53,66,641-658`; `backend/routes/orders.py:892`; `backend/routes/cash.py:237` | [R] |
| M7 | **Error de red presentado como "no hay caja abierta"** y como "no hay cuentas activas": invita a abrir una segunda caja y a creer que el salón está vacío. | `frontend/src/pages/Caja.jsx:593-600`, `:660-672`, `:766-769`; `frontend/src/hooks/usePolling.js:19-21` | [R] |
| M8 | **Salón con varias cuentas muestra/cobra una sola y subestima la deuda.** El frontend toma el primer match de una lista ordenada descendente (la cuenta **más nueva**) mientras la API de mesas define `active_order` como la **más antigua**: la tarjeta mezcla importe de una y antigüedad de otra. | `frontend/src/lib/attentionClose.js:4-11`; `frontend/src/pages/Salon.jsx:231-239`; `backend/routes/orders.py:217`; `backend/routes/tables.py:110-111` | [R] |
| M9 | **Errores de carga mostrados como "no hay datos"** en Pedidos y Comprobantes (este último oculta comprobantes sin verificar y muestra "0 pendientes"). | `frontend/src/pages/Pedidos.jsx:35-44,179-181`; `frontend/src/pages/Comprobantes.jsx:56-63,104-106,129-132` | [R] |
| M10 | **La UI muestra permisos obsoletos**: el frontend guarda el usuario en `localStorage` y nunca llama a `/auth/me`, así que un cambio de rol/funciones no se refleja en el menú hasta volver a iniciar sesión. El backend sí lo aplica al instante (responde 403), o sea que es divergencia de UI, no escalada. | `frontend/src/contexts/AuthContext.jsx:12-13`; `backend/auth.py:117-126`; `backend/routes/auth.py:43-45` | [V] |
| M11 | **"Agotado" no tiene dimensión de sucursal**: cocina de una sucursal apaga un plato para todo el negocio (web/QR y otras sucursales incluidas). La especificación pide disponibilidad por sucursal. | `backend/routes/products.py:224-234`; spec `:314,318` | [R] |
| M12 | **El rol mozo ve y pulsa los controles del pase de cocina** que el backend rechaza con 403. | `frontend/src/App.js:139`; `frontend/src/pages/Cocina.jsx:98-118`; `backend/routes/orders.py:774,807` | [R] |
| M13 | **Mesa con apertura a medias queda inutilizable desde la UI**: el backend expone la recuperación (`attention/open`, `resume-opening`) y la pide en el mensaje de error, pero no existe ninguna pantalla que las llame. | `backend/routes/orders.py:398,404`; `backend/routes/tables.py:266`; 0 coincidencias en `frontend/src` | [R] |
| M14 | **`usePolling` puede aplicar respuestas fuera de orden** (un ref `stopped` compartido; sin `AbortController`) y **cada evento SSE dispara refetch inmediato de todos los pollers** de la página (5 en Salón). | `frontend/src/hooks/usePolling.js:8,13-16,25-37`; `frontend/src/contexts/NotifyContext.jsx:47-48`; `frontend/src/pages/Salon.jsx:136-150` | [R] |
| M15 | **`administracion` es un pase universal** que alcanza los resets destructivos de datos/catálogo, reservados al propietario en la especificación. Mitigado por confirmación + contraseña y por `require_role_exact` en personal. | `backend/auth.py:143-153`; `backend/routes/data.py:50,99` | [R] |

### Bajos

`system/info` expone `DB_NAME`/`APP_ENV` (`backend/routes/system.py:89-92`) · JWT sin `iat`/audiencia
validados y HMAC del QR truncado a 128 bits · índice de idempotencia global en lugar de por
restaurante · "Anular pedido" se ofrece con cobros existentes · "Partes iguales" deja un céntimo
irrecuperable en esa modalidad · descuento escrito como "0" a mano muestra un total distinto del
que cobra el backend · el tope de movimientos de caja (S/200) no es visible en la UI · redondeo
*banker's* en backend vs `Math.round` en frontend · `/api/public/stream` es anónimo y publica
eventos de mesa de todo el restaurante.

### 2.1 Hallazgos reportados que resultaron **falsos** (verificados y descartados)

Se conservan aquí por trazabilidad: fueron reportados con severidad Alta/Media y **no** deben
incluirse en el backlog.

1. **"`POST /orders/{id}/status` autoriza con el rol del JWT, obsoleto hasta 7 días"** → **FALSO.**
   `get_current_user` recarga el usuario **desde la base** en cada request y devuelve ese documento
   (`backend/auth.py:117-126`), y `change_status` compara `role = user["role"]`, es decir el rol de
   la base (`backend/routes/orders.py:903,911-918`). El claim `role` del token **no se usa en ningún
   punto de autorización** (verificado por búsqueda en todo `backend/`). Además el endpoint sí
   aplica control de rol en línea para cada estado permitido; es incluso **más estricto** que
   `require_roles`, porque no honra el pase `administracion`. Lo único real que queda de este hilo
   es M10 (la UI, que sí cachea el usuario en `localStorage` y no llama a `/auth/me`).
2. **"El rate limit de login se evade variando mayúsculas del email"** → **FALSO.**
   `backend/routes/auth.py:28` construye la clave del limitador con `data.email.lower()`, igual que
   la búsqueda en `:31`. Comprobado ejecutando el endpoint con `mozo@resto.com`,
   `Mozo@Resto.com` y `MOZO@RESTO.COM`: los tres fallos caen en **una sola** clave
   (`{'1.2.3.4|mozo@resto.com': [...]}`, `distinct keys: 1`). La limitación real es otra y sí está
   en el informe: los contadores viven en memoria por proceso (§4.5).

Ninguno de los dos llegó al backlog. El resto de los hallazgos marcados **[R]** provienen de los
auditores especializados con evidencia citada y no fueron refutados; los marcados **[V]**/**[E]** los
comprobé yo mismo.

### 2.2 Flujo de pedido y ciclo de vida de la atención

Auditoría dedicada a `routes/orders.py`, `attention.py`, `attention_numbering.py`,
`attention_acceptance.py`, `order_flow.py` y `routes/table_groups.py`. **Los tres críticos los
verifiqué yo mismo en el código.**

#### Críticos

| # | Hallazgo | Evidencia | Ver. |
|---|---|---|---|
| P1 | **Fusionar cuentas bloquea la visita para siempre.** `merge` cancela la cuenta origen **sin vaciar sus ítems** ni limpiar su `attention_id`. Al cerrar la visita, esa cuenta sigue contando como hermana de la atención y `food_is_delivered` exige que **todos** sus ítems estén `cancelado`/`entregado` (siguen en `pendiente`/`listo`) → `"Todavía hay productos sin entregar"` **permanente**. La cuenta cancelada ya no admite modificaciones, así que no hay salida por API: la mesa queda `ocupada` con visita abierta indefinidamente. | `backend/routes/orders.py:487-491` (cancela sin tocar ítems); `backend/attention.py:22-26` (regla), `:38-39` (mensaje), `:267-272` y `:424-431` (evalúa a las hermanas) | [V] |
| P2 | **Mover la única cuenta de una mesa deja una atención huérfana `open` y la mesa devuelve 500.** Cuando la visita origen queda sin cuentas, el código vacía `order_ids`, libera la mesa y **no cierra ni borra** el documento de atención, que conserva `status: "opening"/"open"` y su `table_id`. El índice único parcial `uniq_open_attention_per_table` sigue ocupado por ese huérfano, así que la próxima apertura en esa mesa lanza `DuplicateKeyError`; el `except` intenta recargar la atención **nueva** (que no existe) y re-lanza → **500**, sin que `create_order` lo capture. La mesa queda inutilizable y el usuario ve un movimiento que respondió 200. | `backend/routes/orders.py:556-570`; `backend/database.py:92-96`; `backend/attention.py:203-208` | [V] |
| P3 | **`merge` no es atómico entre las dos cuentas:** escribe el destino y después el origen, cada uno con su propio CAS. Dos fusiones simultáneas cruzadas dejan **ambas cuentas abiertas y cada una con la unión de los ítems** → el mismo consumo se puede cobrar dos veces. | `backend/routes/orders.py:463-491`; `backend/order_flow.py:24-40` | [R] |

#### Altos

| # | Hallazgo | Evidencia | Ver. |
|---|---|---|---|
| P4 | **"Solicitar la cuenta" no cambia el estado: `pendiente_pago` es un estado muerto.** El `update` que lo fija se pisa con `ticket_fields`, que deriva el estado del campo de cumplimiento. Consecuencia operativa: el pedido sigue aceptando consumo por QR (el guard de `public.py` solo mira `pendiente_pago`) **después** de que el mozo mostró la cuenta, `reports.bill_requests` da siempre 0, y la auditoría registra `status:pendiente_pago` aunque el documento quedó en `listo`. | `backend/routes/orders.py:970-975`; `backend/order_flow.py:151-165`; `backend/routes/public.py:205`. Nota: el frontend sí consulta ese estado (`CartPanel.jsx`, `ProductCard.jsx`, `Checkout.jsx`), o sea que la regla existe en la UI y no en los datos | [R] |
| P5 | **Se pueden borrar ítems ya preparados o entregados**, sin motivo, sin auditoría y sin merma: `remove_item` hace borrado físico y no mira `item.status`; `update_item` permite bajar cantidades ya entregadas. `emit_order` es un publish en memoria, no persiste. Viola RF-16 (que exige registrar anulación/merma en vez de borrar). | `backend/routes/orders.py:663-681`, `:684-713`; `backend/notify.py:28-36` | [R] |
| P6 | **`split` recalcula totales por fuera de las reglas de dinero:** usa una función propia que ignora descuento, propina y `delivery_fee`, y **borra** `discount`/`tip` de la cuenta original → se puede cobrar de más o perder la propina. Además escribe el original antes de insertar las cuentas nuevas: si un insert falla, los ítems ya se perdieron y no hay rollback. | `backend/routes/orders.py:599-609`, `:620-631`; contraste con `backend/billing.py:14-36` | [R] |
| P7 | **Cocina puede marcar "Entregado"** (`serve` acepta `cocina`) y la entrega es todo-o-nada: no hay adjudicación exclusiva (`claimed_by`) ni entrega por producto, contra la matriz de capacidades y RF-11. | `backend/routes/orders.py:843-862`; `backend/order_flow.py:168-179` | [R] |
| P8 | **Una visita con cuenta sin consumos o de total 0 no se puede cerrar:** `food_is_delivered` devuelve `False` con la lista de ítems vacía y el pago de importe 0 está prohibido, así que `payment_status` nunca llega a `pagado`. La única salida es anular la cuenta, y eso exige rol `admin`/`cajero` (el mozo no puede). "Tomar mesa" crea exactamente ese pedido vacío, así que un toque accidental bloquea la mesa. La "atención gratuita" con motivo y autorizador es imposible de ejecutar. | `backend/attention.py:22-26`, `:36-37`; `backend/routes/payments.py:362-364`; `backend/order_flow.py:142-145`; `frontend/src/pages/Salon.jsx:458` | [R] |
| P9 | **Segunda numeración visible con reglas equivocadas:** `order_number` va por **restaurante** (no por sucursal), en día **UTC** (reinicia a las 19:00 de Lima, en medio del turno de cena), se consume **al crear** (incluidas provisionales y pedidos web) y no tiene índice único (el `upsert` del contador puede duplicar). Es el número que la UI muestra como identificador de la cuenta, en paralelo al `attention_number` correcto. | `backend/routes/orders.py:98-109`, `:339`; `backend/routes/public.py:230-239`; `frontend/src/lib/cash.js:19` | [R] |
| P10 | **`send_to_kitchen` usa la sucursal del usuario en vez de la del pedido**: un admin multi-sucursal que envía un "recojo" a cocina recibe 400 permanente (o 500 si tiene otra sucursal asignada), y el pedido queda atascado sin número de atención. La ruta pública sí deriva la sucursal del pedido, lo que confirma el defecto. | `backend/routes/orders.py:747-755`; `backend/attention_acceptance.py:64-65`; `backend/routes/public.py:518-528` | [R] |

#### Medios y bajos

**Medios.** Los "Para llevar" del mostrador (`order_type='llevar'`) no reciben atención ni número de
retiro, a diferencia de `recojo` (`orders.py:747`) · `merge`, `split` y `move` **no dejan auditoría**
pese a que RF-12 la exige de forma explícita (`orders.py:460-647`; los únicos `_audit` están en
`:399,766,860,881,893,995`) · **no existe la expiración de 15 minutos** de la atención provisional ni
liberación de la reserva de apertura: `release_table_opening` es código muerto y la UI no llama a
`/attention/open` ni `/resume-opening` (`attention.py:80-104,140-146`; 0 coincidencias en `frontend/src`) ·
cerrar la visita libera una mesa **que sigue unida a un grupo**, rompiendo el invariante del propio
módulo (`attention.py:331-337` vs `table_groups.py:236-252`) · `move` extrae una cuenta de una mesa
agrupada sin disolver el grupo, mientras el otro camino de "mover" sí valida ambas mesas
(`orders.py:517` vs `tables.py:468-472`).

**Bajos.** `_derive_kitchen_status` puede devolver un estado ajeno a cocina y `bump` lo copia a
`fulfillment_status` (`orders.py:175-185,797-798`) · `change_status` marca la mesa `esperando_pago`
**antes** de guardar el pedido y no revierte si el CAS falla con 409 (`orders.py:978-988`).

#### Precisión sobre el análisis de brecha existente

Se confirman, con evidencia adicional: una sola atención por mesa (`database.py:92-96`), Cuenta = Order
(multi-cuenta como varias órdenes con `attention_id`), ausencia de aprobación/rechazo de pedidos QR
(`acceptance_status` solo se escribe como `"aceptado"`; el filtro `acceptance_status == "pendiente"` de
`kitchen_orders` en `orders.py:239` es **código muerto**), y ausencia de merma/cortesía como conceptos.

---

## 3. Lectura de los flujos del núcleo

**Pedido → Cocina → Cobro → Caja.** El flujo funciona de punta a punta (hay harness Playwright
verde y 400 tests de backend herméticos). Lo que rompe el día a día:

1. **El ciclo de la mesa no se cierra al cobrar** (H-2): en salón, cobrar no libera la mesa porque
   `payments.py:530` excluye los pedidos con visita. El "cobrar y cerrar en un paso" está
   especificado por tests pero sin implementar.
2. **Dos operaciones de multi-cuenta dejan la mesa bloqueada de forma permanente** (P1, P2).
   Fusionar cuentas o mover la única cuenta de una mesa responde **200** y deja la mesa
   inutilizable o imposible de cerrar, sin salida por API. Son los hallazgos más graves de todo el
   informe junto con C1: **no hay forma de que el personal se recupere sin tocar la base**.
3. **La caja del dueño no se puede cerrar** (A2) y **la del cajero se puede quedar trabada** por un
   comprobante que la propia UI le pidió subir (A3). Ambos terminan en el mismo síntoma: el turno
   no cierra.
4. **El estado `pendiente_pago` es inalcanzable** (P4): "solicitar la cuenta" no cambia el estado,
   así que el cliente puede seguir agregando platos por QR a una cuenta ya impresa.

**Dinero.** Lo estructural está bien: un único camino de escritura de pagos, CAS por `updated_at`
contra el doble cobro concurrente, el importe nunca supera el total, no se cobra sin caja abierta,
no se abren dos cajas por sucursal, y la anulación exige motivo + permiso + auditoría. Los huecos
están en los **bordes**: idempotencia sin clave (A6), escritura no atómica pedido+pago (A5),
descuento sin tope (A7), líneas duplicadas (M1), mixto sobreofertado (M2) y el recálculo de `split`
por fuera de las reglas (P6).

**Aislamiento por sucursal.** En los endpoints de personal está bien implementado y **falla
cerrado** (`branch_access.py`, y `restaurant_id` en todas las lecturas autenticadas). La excepción
grave es la cara pública (C1), que no filtra ni por restaurante. Un defecto puntual del mismo eje:
`send_to_kitchen` usa la sucursal del **usuario** en vez de la del pedido y atasca los "recojo" de
un admin multi-sucursal (P10).

**Solapamiento con trabajo existente.** El repositorio ya tiene un
[análisis de brecha](../spec/analisis-de-brecha.md) (especificación vs implementación) que cubre
las capacidades ausentes (jornada, mermas, cortesías, pedidos programados, cola offline, precios
por sucursal). **Esta auditoría no lo duplica**: se centra en lo que el código *hace mal* hoy, no
en lo que falta construir.

---

## 4. Qué NO pude verificar

1. **Comportamiento en vivo.** Sin Docker ni MongoDB no levanté la app: nada de E2E, ni tráfico
   real, ni arqueos reales. Todo lo anterior es lectura de código más las ejecuciones de §0.
2. **Semántica del índice sparse sobre `null`** (A6): se apoya en el comportamiento documentado de
   MongoDB, no en una reproducción empírica.
3. **Carreras** (M3, A5): confirmadas por lectura; el fake de tests no modela intercalado entre
   documentos.
4. **Índices realmente presentes en la base desplegada**: A6 depende de que el índice exista tal
   como lo declara `database.py`.
5. **Configuración del proxy en el host**: si no fija `x-forwarded-for`, la clave de los
   limitadores es falsificable; y con más de un worker los limitadores en memoria se multiplican.
6. **Carreras que dependen del motor de almacenamiento.** P3 (fusión simultánea), M3, A5, P9 (doble
   inserción del contador) y B-2 están confirmadas por lectura y dependen del intercalado real; para
   forzarlas hace falta MongoDB o `mongomock` con dos corrutinas concurrentes, porque los fakes de
   `tests/` no reproducen índices únicos ni concurrencia.
7. **Índices sobre una base preexistente:** no pude comprobar qué pasa si la base ya tiene dos
   atenciones abiertas en la misma mesa cuando `ensure_indexes` intenta crear
   `uniq_open_attention_per_table`, ni la migración del índice `active_order_per_table`.
8. La validez de C1/A2/A5/P1/P2 con datos reales depende de MongoDB; los tests de intención del
   ámbito de roles (50) y la suite hermética (400) sí pasan.

---

## 5. Qué verifiqué y está correcto (con evidencia)

- **Suite backend hermética 400/400** y **build de frontend OK** (§0).
- **Backend arranca**: 104 rutas `/api`, `assert_runtime_config()` OK en `development`.
- **Aislamiento de sucursal fail-closed** en operaciones de personal: `branch_access.py:11-29`,
  aplicado en `orders.py:58-63,198,227-233,508,523`, `tables.py:64-69,220-224,249-253,369-374`,
  `payments.py:38-48,202,239`, `cash.py:151,166,187`, `reports.py:40-56`, `table_groups.py:72-78`.
- **`restaurant_id` en todas las lecturas autenticadas**; el único punto sin él es C1.
- **Secretos fail-closed en producción**: `security_config.py:46-55` rechaza `JWT_SECRET` débil y
  `CORS_ORIGINS` vacío o `*`, invocado en el arranque (`server.py:100`). `.env` no versionado.
- **Cobro**: único camino de escritura (`payments.py:515`), sin doble cobro concurrente
  (CAS `:442-455`), sin cobrar por encima del total (`min(...)` en `:387,394,399`), sin cobrar sin
  caja abierta (`:305-307`).
- **Caja**: no se abren dos cajas por sucursal (índice parcial único + `DuplicateKeyError → 409`,
  `cash.py:197-222`), cierre bloqueado correctamente por visitas abiertas y comprobantes
  pendientes (`:235-248`).
- **Anulación**: exige motivo ≥5 y `can_void`, conserva el registro, recalcula `amount_paid` y
  deja auditoría (`payments.py:801-804,858-867,950-956`).
- **Devolución post-cierre no reescribe la caja cerrada** (`billing.py:78-83`).
- **Frontend**: los endpoints que llama la UI existen (contraste de rutas); no hay `toast.success`
  de dinero antes del `await`; `usePolling` **sí** limpia el intervalo al desmontar
  (`usePolling.js:32-35`); Salón/Cocina/Reportes/Dashboard sí muestran errores de carga.
- **Higiene**: sin `TODO/FIXME` en el código; `.env` ignorado y no versionado.
- **Rol siempre fresco**: `get_current_user` recarga el usuario **desde la base** en cada request
  (`auth.py:117-126`), así que un cambio de rol/funciones se aplica al instante y el claim `role`
  del token **no se usa para autorizar en ningún punto** (ver §2.1).
- **Ciclo de la atención**: doble apertura y doble pedido activo en la misma mesa impedidos por CAS
  atómico + índice único (`attention.py:83-104`, `database.py:92-96`, `orders.py:311-317`); doble
  envío a cocina idempotente (`order_flow.py:24-40`, `orders.py:722-731`).
- **Numeración de atención correcta**: inmutable por `_id`, atómica, particionada por
  tenant+sucursal+día de negocio local con corte configurable, y **no se consume** con órdenes
  provisionales o web sin aceptar (`attention_numbering.py:78-87,124-131,133-160`). El defecto es el
  `order_number` paralelo (P9), no esta secuencia.
- **Cierre financiero ≠ liberación física** (`orders.py:155-157`); las reglas de cierre bloquean
  pago por verificar, comida sin entregar y descalce `amount_paid` vs. pagos `completed`, y el cierre
  recorre todas las cuentas de la visita de forma idempotente (`attention.py:29-58,352-445,424-431`).
- **Una visita cerrada no admite pedidos, ítems ni pagos** (`order_flow.py:30`,
  `payments.py:310-311,447`).
- **Snapshot histórico de precios por ítem** (`orders.py:124-141`).
- **Unir mesas no toca cuentas ni visitas**: `table_groups.py` nunca escribe en `db.orders` y
  revierte con CAS si el grupo cambió (`:236-272,290-303`).
- **La transferencia de visita entre mesas (`tables.py:453-553`) sí es correcta** (reserva destino,
  punto de no retorno, liberación solo si seguía siendo dueño, reintento reconciliable) — es
  exactamente el patrón que `orders.py:move` no sigue (P2).

---

## 6. Orden sugerido de acción

1. **Desbloquear el pipeline**: implementar o retirar `tests/test_charge_and_close.py` y
   `PedidoDetalleChargeClose.test.js` (C2 / §1.2). Es la única acción que hoy puede poner `main` en rojo.
2. **Reparar las dos vías que inutilizan una mesa** (P1, P2): al fusionar, cancelar los ítems de la
   cuenta origen (o limpiar su `attention_id`); al mover, cerrar la visita origen cuando queda sin
   cuentas. Son fallos silenciosos con pérdida de mesa en producción.
3. **Implementar la atomicidad de la fusión** (P3) para que dos fusiones simultáneas no dupliquen
   consumos.
4. **Cerrar el ciclo de mesa al cobrar**: implementar "cobrar y cerrar" reutilizando el contrato que
   ya definen los tests (H-2, §1.3).
5. **Arreglar la caja**: enviar `branch_id` en `/cash/close` y `/cash/movements` (A2) y ofrecer la
   verificación de comprobantes de staff, no solo de pedidos web (A3).
6. **C1**: atar la sesión de invitado a mesa + sucursal + restaurante y dejar de usar el
   `tracking_code` como credencial.
7. **Dinero**: índice parcial de idempotencia + no escribir la clave vacía (A6); atomicidad
   pedido+pago (A5); tope de descuento por rol (A7); deduplicar líneas (M1); pasar `split` por
   `guarded_totals` (P6).
8. **Integridad del pedido**: reparar `pendiente_pago` (P4), impedir el borrado de ítems ya
   preparados y auditarlo (P5), unificar la numeración visible con `attention_number` (P9),
   sucursal del pedido en `send_to_kitchen` (P10).
9. **Consistencia UI↔backend**: propina/descuento en el diálogo de cobro (A4), estados de error
   reales en lugar de "no hay datos" (A8, M7, M9), orden de cuentas en el salón (M8).

---

## Anexo — Reproducir la evidencia

```powershell
# Suite backend hermética (necesita MONGO_URL en el entorno; no requiere un Mongo real)
$env:MONGO_URL='mongodb://127.0.0.1:27017'; $env:DB_NAME='restaurant_audit'
$env:APP_ENV='development'; $env:JWT_SECRET='test-only-jwt-secret-for-the-hermetic-suite'
backend\.venv\Scripts\python.exe -m pytest tests -m "not integration" -q --ignore=tests/test_charge_and_close.py
# -> 400 passed, 49 deselected

# El mismo comando SIN el --ignore reproduce el bloqueo de CI (C2 / §1.2)
backend\.venv\Scripts\python.exe -m pytest tests -m "not integration" -q
# -> ERROR collecting tests/test_charge_and_close.py  (exit 1)

# Frontend
cd frontend
npx craco test --watchAll=false --runInBand --ci   # -> 2 failed, 242 passed
$env:CI='true'; npx craco build                    # -> Compiled successfully
```

> Documento de auditoría, sin commitear. No debe mezclarse con el trabajo en curso de otra sesión.
