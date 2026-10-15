# Auditoría del flujo por roles con Playwright — 2026-10-05

Verificación funcional de los cuatro roles (admin, mozo, cocina, cajero) contra
un stack local real, con evidencia de consola, red, accesibilidad y DOM. Incluye
la búsqueda dirigida de **opciones repetidas o duplicadas en la interfaz**.

Rama auditada: `feat/compositor-unificado` @ `fdc3b58` (working tree con los
arreglos de esta sesión). Producción/`main` comparte los dos defectos P0: la
migración a Radix del diálogo de cobro (`8d883ab`) es ancestro de `main`.

---

## Resumen ejecutivo

| Qué | Resultado |
|---|---|
| Flujo E2E completo (mozo → cocina → cuenta → caja → cobro) | **3/3 specs en verde** tras los arreglos (antes: 2/3 en rojo) |
| Defectos bloqueantes (P0) encontrados | **2**, ambos con causa raíz identificada y corregida |
| Duplicaciones reales de UI | **2** (`data-testid` repetido en Pedidos y en Caja) + 1 decisión ofrecida en dos componentes distintos |
| Errores de JavaScript en 131 visitas | **0** |
| Violaciones axe-core (WCAG A/AA + buenas prácticas) | **319**, en 5 reglas y 2 causas dominantes (contraste y `aria-label` en `<span>`) |
| Suite backend | **400 passed / 0 failed** |
| Suite frontend | **245 passed / 2 failed** (función "cobrar y cerrar" sin implementar) |

Los dos P0 hacían **inutilizables** dos pantallas clave: el cobro en caja (todo
clic dentro del diálogo lo cerraba) y el salón en móvil (los toques caían en el
elemento equivocado). Ninguno de los dos aparecía en las suites automáticas,
porque los dos specs E2E que recorren el flujo estaban en rojo desde el commit
del compositor unificado: nadie llegaba hasta ahí.

---

## 1. Flujo completo por rol (Playwright)

Ejecutado contra un stack aislado y determinista:

| Componente | Valor |
|---|---|
| Frontend | `http://localhost:3001` (dev server de este worktree) |
| Backend | `http://localhost:8001` (uvicorn, `DB_NAME=restaurant_ui_audit`, `SEED_DEMO=true`) |
| Base de datos | `restaurant_e2e-mongo` (Docker, `127.0.0.1:27017`) |
| Datos | seed demo completo (14 productos, 5 categorías, 3 zonas) + `e2e/fixtures/seed-roles.js` |

Resultado final:

```
ok 1 [desktop] flow-desktop.spec.ts  mozo → cocina → cuenta → caja: efectivo exacto hasta pagado (27.1s)
ok 2 [desktop] smoke.spec.ts         login + shell admin, Local, Configuración, temas, marca, comprobantes (40.8s)
ok 3 [mobile]  flow.mobile.spec.ts   mozo → cocina → caja con CobrarDialog táctil (18.3s)
3 passed (1.6m)
```

El recorrido verificado de punta a punta es: el mozo abre la mesa, carga el
primer plato desde el compositor del sheet, cocina avanza `llegan → fuego →
listo`, el mozo solicita la cuenta, el cajero abre caja, cobra en efectivo
exacto con verificación y el pago aparece en el historial.

Los dos specs usaban el flujo anterior al compositor unificado (esperaban el
diálogo `areas-venta` después de `mesa-sheet-tomar`, que ya no existe). Se
actualizaron al flujo real: el compositor vive **dentro** del sheet de la mesa
y el backend manda la orden a cocina al agregar el primer ítem.

---

## 2. P0-1 — El diálogo de cobro no aceptaba ni un clic (y se cerraba solo)

**Impacto:** caja no podía cobrar. Cualquier clic o toque dentro del diálogo lo
interceptaba el overlay y, como el overlay cierra el diálogo cuando el clic cae
en él, **el diálogo se cerraba en vez de registrar el pago**.

**Causa raíz.** El commit `8d883ab` («CobrarDialog migrado a los primitivos de
Radix», 2026-10-05 06:42) cambió solo `CobrarDialog.jsx`: el overlay y el
contenido pasaron de estar **anidados** (`div.cobro-overlay > contenido`) a ser
**hermanos** dentro del portal de Radix. `cobro.css` quedó con los supuestos
viejos:

- `frontend/src/styles/cobro.css:23` — `.cobro-overlay { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center }`
- `frontend/src/styles/cobro.css:40` — `.cobro-checkout { position: relative; z-index: auto }`

Con el overlay en `z-index: 80` y el contenido en `auto`, el overlay se pinta
encima. El contenido seguía viéndose (el fondo del overlay es translúcido), pero
no recibía ningún evento de puntero.

**Evidencia.**
- Playwright, en ambos specs: `<div data-state="open" class="cobro-overlay"> intercepts pointer events` al hacer clic en «Exacto».
- Sonda de apilamiento en el centro del botón «Exacto» (`document.elementsFromPoint`): primer elemento `.cobro-overlay` (`z-index: 80`, `position: fixed`), recién después el botón. El contenido además quedaba **en el flujo del documento** (medido en `y=1027` con viewport de 900), fuera de la vista.
- Capturas: `frontend/test-results/flow-desktop-.../test-failed-1.png`, `flow.mobile-.../test-failed-1.png`.

**Arreglo aplicado** (`frontend/src/styles/cobro.css`): el contenido se posiciona
y se apila por encima de su propio overlay, como el resto de los diálogos del
proyecto (`ui/dialog.jsx` usa `z-50` en ambos):

```css
.cobro-overlay { position: fixed; inset: 0; z-index: 80; background: hsl(var(--foreground) / 0.35); }
.cobro-checkout { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
                  z-index: 81; width: min(1100px, calc(100vw - 32px)); max-height: calc(100dvh - 56px); }
```

**Verificación:** sonda de apilamiento → el primer elemento en el centro de
«Exacto» ya es el botón (`cobro-checkout` con `z-index: 81`, centrado en
170,28). Los tres specs E2E pasan.

---

## 3. P0-2 — Salón en móvil: el viewport se ensanchaba y los toques caían en otro elemento

**Impacto:** en un teléfono, el salón se renderizaba con un viewport de layout de
**628 px** sobre una pantalla de 393 px (Chrome aleja la página para que entre lo
que desborda). Consecuencia: todo se ve más chico y los toques aterrizan en otro
elemento — el spec móvil no podía ni abrir una mesa (`mesas-area-todas` y la
tarjeta vecina interceptan el toque).

**Causa raíz.** La fila de acciones del encabezado del salón no envolvía:

- `frontend/src/pages/Salon.jsx:713` — `div.flex.gap-2.items-center` con buscador (`w-44`) + «Cocina (n)» + «Unir mesas» + «Nuevo pedido», todos con `whitespace-nowrap`. Ancho mínimo real ≈ 612 px contra 361 px disponibles.

**Evidencia.**
- `window.innerWidth = 628`, `visualViewport.width = 393`, `scrollWidth = 628`, con `salon-root` (clientW 361 / scrollW 612) como desborde raíz.
- Playwright: `<button data-testid="mesas-area-todas"> ... intercepts pointer events` al hacer clic en la tarjeta de mesa.
- El propio barrido lo había registrado sin que se notara: en las visitas móviles de `salon` y `dashboard`, `metrics.viewport` era **510×1104** en vez de 390×844.

**Arreglo aplicado** (`frontend/src/pages/Salon.jsx:713`): `flex flex-wrap gap-2 items-center`.

**Verificación:** `innerWidth = 393`, `scrollWidth = 393`, sin elementos que
desborden fuera de un contenedor con scroll propio; el spec móvil pasa.

> Nota de método: la métrica de desborde del arnés comparaba contra
> `window.innerWidth`, que es justamente el valor que el navegador ensancha. Se
> corrigió (`e2e/audit/lib.mjs`) para medir contra `window.visualViewport.width`,
> así el desborde móvil no vuelve a esconderse.

---

## 4. Opciones repetidas o duplicadas en la UI

Escaneo dirigido sobre **86 superficies** (4 roles × 2 viewports × pantallas y
paneles abiertos: sheet de mesa, compositor nuevo pedido, unir mesas, áreas de
venta, diálogo de cobro), comparando etiquetas, `data-testid`, `id`, destinos del
menú y conjuntos de opciones. Script: `frontend/e2e/audit/duplicates.mjs`
(resultado crudo en `e2e/audit/out/duplicates.json`).

### 4.1 Duplicación real: `data-testid` repetido en cada tarjeta de Pedidos

- **7×** `order-estado-badge` y **7×** `order-estado-dot` en `/pedidos` (una por pedido).
- Origen: `frontend/src/components/StateBadge.jsx:41,44` arma el id como `` `${type}-estado-badge` `` y `` `${type}-estado-dot` ``, sin sufijo único. `Pedidos.jsx:115` lo instancia dentro del `map` de pedidos.
- Efecto: cualquier consulta por ese testid es ambigua (rompe el modo estricto de Playwright y dificulta tests/analítica). El componente ya acepta `testId`, así que el arreglo es pasar uno único desde el llamador (`testId={`pedido-${o.order_number}-estado`}`).

### 4.2 La misma decisión en dos componentes distintos: «área de venta»

| Superficie | Opciones | Dónde |
|---|---|---|
| `NewOrderSheet` (pestañas) | Mesa · Llevar · Recojo · Delivery | `/salon` → «Nuevo pedido», compone en el sheet |
| `SalesAreasDialog` («Áreas de venta») | Mesa · Llevar · Recojo · Delivery **+ descripción** | `/pedidos` → «Nuevo pedido», navega a `/pedidos/nuevo` |

Son las mismas cuatro opciones implementadas dos veces, con distinto texto
(una muestra el `hint`, la otra no) y dos experiencias diferentes (componer
inline vs. navegar a una página). Es la duplicación de UI más costosa de
mantener: cada cambio de áreas de venta hay que hacerlo en los dos lugares.

### 4.3 Lo que **no** se encontró (evidencia negativa)

- **0** destinos duplicados y **0** etiquetas repetidas en el menú de navegación para los 4 roles (la deduplicación de `AppShell.jsx:69-82` funciona).
- **0** `id` de DOM duplicados.
- **0** opciones repetidas **dentro del mismo bloque o panel**: las 13 etiquetas que se repiten en la app son acciones por fila/tarjeta («Tomar pedido» en cada una de las 14 mesas del piso, «Pasar a fuego» en cada ticket de cocina, «Cobrar» por cuenta, o la misma palabra en el menú y en el cuerpo de la página). En ningún caso comparten contenedor ni `data-testid`, que es la firma de una duplicación real.
- **0** `<select>` con opciones o valores repetidos.
- Las 6 formas de pago (`efectivo, yape, plin, tarjeta, transferencia, mixto`) aparecen **una sola vez** en la barra de métodos del cobro; también una sola vez en el checkout público.
- Los «no se pudo abrir» del escaneo corresponden a permisos por rol (cajero no tiene «Nuevo pedido»/«Unir mesas», correcto) o a que el botón vive en una pestaña que hay que activar antes (`Local → Mesas`), no a defectos.

### 4.4 `data-testid` repetido en Caja: el número de pedido se reinicia

Detectado al validar el merge con `main` (que agregó el cobro de «Otras cuentas»):
`order_number` **se reinicia** (en el entorno de auditoría había dos pedidos #1 y
dos #2 activos en la misma sucursal), así que la misma cuenta puede aparecer con
el mismo número —y el mismo `data-testid="caja-cobrar-<n>"`— en «Cuentas
solicitadas» y en «Otras cuentas». Playwright lo delató con *strict mode
violation: resolved to 2 elements*.

No es un defecto visual (la etiqueta que ve el cajero incluye la mesa: "Mesa
97236 · #4" y desambigua), pero sí rompía la automatización. Arreglado:
`Caja.jsx` expone `caja-solicitadas` / `caja-otras` y los dos specs localizan el
botón por la fila de **su** mesa, igual que lo hace una persona.

### 4.5 Dos valores para el mismo tipo de venta

`ORDER_TYPE_LABELS` (`frontend/src/lib/format.js:73`) tiene `mesa: 'Mesa'` y
`local: 'En local'`, y el backend acepta ambos para consumo en el local
(`backend/models.py:383`): los pedidos del personal nacen `mesa` y los de la
carta web `local`. En Pedidos/Cocina/Caja el mismo tipo de venta se muestra con
dos etiquetas distintas según el origen, y `Cocina.jsx:56` cae a «Para llevar»
cuando no reconoce el valor. Conviene unificar el valor o mapear ambos a la
misma etiqueta.

---

## 5. Código muerto e incoherencias detectadas

1. **«Enviar a cocina» es inalcanzable en los dos compositores.** El botón se
   muestra solo si `order.status === 'nuevo'`, pero `add_items` pasa la orden a
   `enviado_cocina` en la misma llamada que agrega el primer ítem
   (`backend/routes/orders.py:175-185`, `:450`). Verificado por API: orden creada
   `nuevo` → tras `POST /orders/{id}/items` queda `enviado_cocina`. Es decir: el
   mozo no puede revisar el pedido antes de que entre a cocina y el botón nunca
   aparece (`Salon.jsx:933,1042`; `NewOrderSheet.jsx:208`).
2. **Botón sin efecto visible.** Con el sheet de una mesa libre abierto, «Tomar
   mesa y pedir» (`Salon.jsx:1240`) vuelve a llamar `takeOrderInline` → reabre el
   mismo sheet que ya está abierto.
3. **Dos entradas al mismo formulario de carta.** `/combos` renderiza
   `Productos section="combos"` (`Combos.jsx`) y `/productos` ya tiene la pestaña
   «Combos». El menú dejó de ofrecer ambos caminos, pero las rutas siguen.
4. **Tests sin commitear de una función que no existe.** `tests/test_charge_and_close.py` y `frontend/src/__tests__/PedidoDetalleChargeClose.test.js` describen un «cobrar y cerrar» en un paso (`AttentionCloseBody`/`AttentionCloseSettle`, `pedido-cobrar-cerrar-button`) que no está implementado: el primero **rompe la colección de pytest** (`ImportError`) y los dos tests de frontend fallan. Quedaron fuera del commit de sincronización a propósito.

---

## 6. UI/UX y accesibilidad (barrido de 131 visitas)

Barrido de rutas por rol y viewport (`e2e/audit/capture.mjs`, 3 viewports × 6
rutas públicas + todas las rutas de cada rol), ya con pedidos reales en la base.
Informe completo: `e2e/audit/out/summary.md`.

- **0 errores de JavaScript** (`pageerror`) en las 131 visitas; ningún log de consola salvo 404 esperados.
- **0 visitas con desborde horizontal** y **0 con viewport inesperado** (la métrica corregida confirma que el P0-2 no reaparece).
- **319 violaciones axe-core**, concentradas en dos causas reales:

| Regla | Impacto | Nodos | Dónde | Qué es |
|---|---|---|---|---|
| `color-contrast` | serious | 245 | salón (200), dashboard (45) | contador del filtro «Todas» 4.02:1 y los importes de las tarjetas de mesa 4.4:1 (mínimo 4.5:1) |
| `aria-prohibited-attr` | serious | 60 | salón, dashboard | `aria-label` en un `<span>` sin rol: el texto se ignora |
| `button-name` | critical | 10 | configuración (tablet y móvil) | 5 interruptores sin nombre accesible |
| `heading-order` | moderate | 3 | categoría de la carta | `h3` sin `h2` previo |
| `page-has-heading-one` | moderate | 1 | detalle de pedido (móvil) | la pantalla no tiene `h1` |

  Detalle accionable:
  - `frontend/src/components/MesaCard.jsx:212,215` — los importes llevan `opacity-80`, que baja el contraste a 4.4:1 sobre el fondo ámbar de la tarjeta.
  - `frontend/src/components/MesaCard.jsx:171` y `GroupCard.jsx:65` — la campana de «Requiere atención» usa `aria-label` en un `<span>` genérico (prohibido); necesita `role="img"` o texto oculto.
  - `frontend/src/pages/Configuracion.jsx:319-323` — al quitar el `<label>` que duplicaba el clic (arreglo de una regresión anterior) los interruptores quedaron sin nombre accesible; se arregla con `aria-label={def.label}`, que no reenvía el clic. Igual caso en `:129`.

- **Objetivos táctiles**: 142 controles por debajo de 24×24 px (de 2413 por debajo de 44 px), casi todos botones de icono de 36×20 px en las tablas de administración (productos 14, usuarios 7, configuración 6, pagos 5) y enlaces del pie público.
- **59 visitas** con algún control sin nombre accesible (`local` y `login` a la cabeza); **0 campos sin etiqueta**.
- **51 visitas** con texto por debajo de 12 px y **102** con texto que la heurística marca como recortado (en su mayoría resúmenes largos en una línea).
- Peticiones fallidas: 404 esperados de `/public/orders/ZZZZZZZZ` y `/public/stream?tracking=…` (código de seguimiento inválido) y `net::ERR_ABORTED` del stream SSE (`/notifications/stream`) al navegar entre pantallas. Ninguno es un defecto de la app.
- Los controles de rol funcionan: mozo → `/reportes`, cajero → `/productos` y cocina → `/caja` terminan en `/unauthorized`.

> Falsos positivos de la heurística, verificados a mano: el contador de
> notificaciones «9+» del encabezado aparece como texto recortado porque la
> insignia se sale del botón con `-right-1.5` (nada la recorta de verdad); y los
> botones de icono de las tablas se cuentan como «sin nombre» aunque tengan
> `title`, porque la heurística no lo considera nombre accesible.

---

## 7. Suites automatizadas

| Suite | Comando | Resultado |
|---|---|---|
| Backend | `pytest tests -m "not integration" --ignore=tests/test_charge_and_close.py` | **400 passed**, 0 failed (20.8 s) |
| Frontend | `craco test --watchAll=false --runInBand --ci` | 41 suites: **40 passed / 1 failed**; 247 tests: **245 passed / 2 failed** (63.7 s) |
| E2E | `npx playwright test` (contra el stack aislado) | **3 passed** |

Los 2 fallos de frontend son de `PedidoDetalleChargeClose.test.js` (función sin
implementar, ver §5.4). El backend no puede recolectar `tests/test_charge_and_close.py`
mientras ese archivo siga en el árbol de trabajo.

---

## 8. Sincronización con GitHub y merge a `main`

- `fdc3b58` `docs(spec): add the product specification set and its ODD task` **subido** a `origin/feat/compositor-unificado` (docs/spec + la tarea ODD).
- `f30dc4c` `fix(cobro,salon): make the charge dialog clickable and stop the mobile viewport widening` **subido**: los dos P0, los dos specs E2E, la configurabilidad de URLs del stack, la métrica de desborde del arnés, el escáner de duplicaciones y las cuatro sondas de diagnóstico (12 archivos).
- `5d9f0a9` merge de `origin/main` en la rama (15 commits del trabajo mobile/PWA) y `baeeac4` `test(caja): scope the charge locators by section and table` (§4.4).
- **`main` avanzó de `dae18ec` a `baeeac4`** por fast-forward, y el workflow `Deploy to VPS` (`37395606587`) terminó **en verde**: Backend tests ✓, Frontend tests ✓, Frontend build ✓, Deploy via SSH ✓ (4m22s). Los dos P0 ya no están en producción.
- Se dejaron fuera, a propósito: `.audit_tmp/` (instantáneas de comparación), `docs/audit/` (este informe) y los dos tests de §5.4 (rompen CI: `pytest` no colecta y 2 tests de jest fallan).
- `feat/compositor-unificado` y `main` (local y remoto) quedaron en `baeeac4`. Hay otras ramas locales con commits sin publicar (`audit/ui-ux` +45, `feat/charge-and-close` +135, `feat/mvp-flow-validation` +90, `rescue/harden-public-payments` +190, `chore/remove-stray-ci-log` +47).

---

## 9. Cambios aplicados en esta sesión (commit `f30dc4c`, ya en `origin`)

| Archivo | Cambio | Motivo |
|---|---|---|
| `frontend/src/styles/cobro.css` | contenido del cobro `fixed` + `z-index: 81`; overlay sin grid centrador | P0-1 (§2) |
| `frontend/src/pages/Salon.jsx` | `flex-wrap` en la fila de acciones del encabezado | P0-2 (§3) |
| `frontend/e2e/flow-desktop.spec.ts` | flujo real: compositor dentro del sheet, sin `areas-venta` | spec desactualizado |
| `frontend/e2e/flow.mobile.spec.ts` | idem | spec desactualizado |
| `frontend/playwright.config.ts` | `baseURL` configurable (`PW_BASE_URL`, default intacto) | poder auditar un stack aislado |
| `frontend/e2e/global-setup.ts` | `PW_API_BASE` configurable (default intacto) | idem |
| `frontend/e2e/audit/lib.mjs` | el desborde se mide contra `visualViewport.width` | el viewport expandido escondía el P0-2 |
| `frontend/e2e/audit/duplicates.mjs` | **nuevo**: escaneo de duplicaciones de opciones | pedido de la auditoría |
| `frontend/e2e/audit/probe-*.mjs` | **nuevos**: sondas de diagnóstico (viewport, toque móvil, desborde, apilamiento del cobro) | evidencia de causa raíz |

Pendiente de decisión del dueño (no aplicado): todo lo de §10.

---

## 10. Recomendaciones (por orden de impacto)

1. **Unificar el valor del tipo de venta** (`mesa` vs `local`) o mapear ambos a la misma etiqueta; hoy la misma venta se lee distinto según el origen (§4.4).
2. **Un solo componente de áreas de venta**: que `/pedidos` use `NewOrderSheet` (o que el salón use el diálogo), y borrar el otro (§4.2).
3. **Decidir el envío a cocina**: si el pedido debe revisarse antes, el backend no debería autoenviar el primer ítem y el botón «Enviar a cocina» debería ser alcanzable; si el autoenvío es lo deseado, eliminar el botón muerto (§5.1).
4. **`testId` único en `StateBadge`** desde los llamadores (§4.1).
5. **Arreglar el contraste de las tarjetas de mesa** (quitar `opacity-80` de los importes, `MesaCard.jsx:212,215`) y del contador del filtro «Todas»; y dar nombre accesible a los 5 interruptores de `/configuracion` (`aria-label={def.label}`).
6. **`role="img"` en la campana de «Requiere atención»** (`MesaCard.jsx:171`, `GroupCard.jsx:65`): hoy el `aria-label` se ignora. Después, etiquetar los campos sin `label` y corregir el `aria-controls` del calendario cuando reaparezcan.
7. **Objetivos táctiles ≥44 px en las tablas de administración en móvil** (hoy 142 controles por debajo de 24 px).
8. **Correr el E2E en CI**: los dos P0 de esta auditoría vivieron sin detección porque los specs que recorren el flujo no se ejecutan en el pipeline.

---

## Anexo — Reproducir

```powershell
# Stack aislado (no toca el entorno en marcha)
$env:MONGO_URL='mongodb://127.0.0.1:27017'; $env:DB_NAME='restaurant_ui_audit'
$env:APP_ENV='development'; $env:SEED_DEMO='true'; $env:CORS_ORIGINS='http://localhost:3001'
$env:JWT_SECRET='ui-audit-local-secret-value-32-chars-min'
backend\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8001

# Frontend en 3001 apuntando al backend aislado
cd frontend
$env:PORT='3001'; $env:REACT_APP_BACKEND_URL='http://localhost:8001'; npm start
$env:API_BASE='http://localhost:8001/api'; node e2e/fixtures/seed-roles.js

# Flujo E2E de los 4 roles
$env:PW_BASE_URL='http://localhost:3001'; $env:PW_API_BASE='http://localhost:8001/api'
npx playwright test

# Barrido de rutas + duplicaciones (Chromium por CDP)
$env:AUDIT_BASE='http://localhost:3001'; $env:AUDIT_API='http://localhost:8001/api'
powershell -NoProfile -ExecutionPolicy Bypass -File .\e2e\audit\run-audit.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\e2e\audit\run-audit.ps1 -Script e2e/audit/duplicates.mjs
node e2e/audit/analyze.mjs
```

Evidencia cruda: `frontend/e2e/audit/out/report.json`, `summary.md`,
`duplicates.json`, capturas en `frontend/e2e/audit/out/shots/` y
`frontend/test-results/`.
