# Prototype UI parity (final RestoFlow prototype → real frontend)

Status: Complete (2026-10-06) — Slices 1–5 + S3-3 endpoint + S1-5 badge + S4-2 Link + S6 theme option + S7 table-detail presentation + S8 composer presentation. No open items.
Branch: feat/salon-opciones-plegadas
Base commit: b808dc3
Reference: `restoflow.html` (repo root) — approved final prototype (mobile-first; desktop ≥820px).
Delivery strategy: ask-on-risk; single-screen slices with work-unit commits.
Forecast: more than 400 authored changed lines across the full feature (sliced per screen).

## Objective
Bring the approved final prototype's UI/UX details into the real React frontend, screen by screen, without changing business rules, APIs, or what the system already does better (kitchen kanban, real QR links, item/equal-split payments, roles, e2e contracts).

## Problem and Why
The system already implements the full salon → order → kitchen → caja flow and more. A read-only gap analysis (2026-10-06, two exploration passes over `restoflow.html` vs `frontend/src`) found the remaining prototype deltas are UI/UX details the user wants ported "tal cual": floor grouped by zone with counts, capacity on cards, floor consumption total, optional number/priority sorting, richer mesa summary, direct Cobrar in the sheet, composer affordances, caja KPIs, kitchen alert colors.

## Authorized Scope
User asked to "implementarlo en nuestro sistema tal cual" and confirmed starting with the Salón. Work happens in `frontend/` on this branch. Not authorized / not done: changing the global theme (fonts/palette), replacing the kitchen kanban with a flat grid, backend changes, editing e2e specs, pushing or opening a PR.

## Constraints
- Preserve every existing `data-testid` (e2e `flow-desktop.spec.ts` / `flow.mobile.spec.ts` must keep passing).
- Tailwind + existing tokens; no new dependencies; Spanish UI copy (neutral).
- Test-first for behavior changes (repo culture): frontend runner `npm test -- --watchAll=false --runInBand` from `frontend/`; build `$env:CI='true'; npm run build`.
- Each task lands as one work-unit commit; around 400 authored changed lines is an advisory heuristic, not a cap.

## Tasks — Slice 1 (Salón)
- [x] S1-1: Floor grouped by zone: sections `salon-zona-{zona}` with heading and "N mesas" count; only zones with visible tables; zone filter and search keep working. All existing floor testids verified preserved (git-diff check; `salon-filtros`/`salon-filtro-*` re-added wrapped with the same contract).
- [x] S1-2: Capacity line "N asientos" on `MesaCard` (`mesa-card-asientos-{n}`, `t.capacity` with `seats` fallback); `GroupCard` sums member capacity (`mesa-grupo-asientos`) only when every member reports it.
- [x] S1-3: "S/ X en mesas" in `salon-resumen` (`salon-total-en-mesas`): pending balance across floor units (groups sum their bills, no double counting), `fmtMoney`, independent from filters.
- [x] S1-4: "Orden: Número/Prioridad" toggle (`salon-orden`): default Número (unchanged behavior); priority listo > por cobrar > ocupada > reservada + elapsed minutes, tiebreak by anchor number; persisted per user (`salon-orden:<userId>`, `salon-branch-scope` convention).
- [x] S1-5 (closed 2026-10-06): ready-dishes badge on the nav. New `useReadyDishes` hook + AppShell wiring (`GET /orders?active_only=true` via `usePolling`, 25s, mounted once, disabled for roles without Salón in nav). Metric: item quantities with `status === 'listo'` (mirrors Salon's `summary.toReady`). Badges `nav-ready-badge` (sidebar) and `bottom-nav-ready-badge` (bottom nav), hidden at 0.

## Tasks — Slice 2 (Detalle de mesa)
- [x] S2-1: Consumido/Pagado/Pendiente rows (`AccountTotals` exported from `OrderSummary.jsx`): inside `TableSummary` (2+ accounts) and standalone for a single account (`mesa-sheet-consumido/-pagado/-pendiente`), placed before the people strip. Source: per-account `total − amount_paid` (same as `MesaCard` "Debe S/ X"), reused via `accountDue(order)` in `Salon.jsx`.
- [x] S2-2: Direct "Cobrar S/ X" in the sheet (`mesa-sheet-cobrar`) with the active account balance. Decision: navigation (`openCharge`), not inline `CobrarDialog` — `POST /payments` requires an open cash shift, and replicating the Caja/PedidoDetalle gate in Salón would duplicate payment logic.
- [x] S2-3: ✎ rename per person/account (`mesa-sheet-renombrar-{key}` + inline `mesa-sheet-renombrar-input-{key}`), same `PATCH /orders/:id/alias` path with optimistic update; the "Organizar pedido" input keeps working.

## Tasks — Slice 3 (Composer)
- [x] S3-1: Quantity badge on product cards (`{prefix}-producto-badge-{id}`, top-right, only when qty > 0; `pointer-events-none` + `aria-hidden` so taps fall through to the card button and SR announces once). Stepper and every existing testid kept — the badge is a deliberate one-digit glance indicator (the stepper's center number stays the test contract).
- [x] S3-2: Amount inside the send button: `sendAction` returns `amount` and labels `✈ Enviar a cocina · S/ X` / `✈ Enviar adicionales (N) · S/ X`, reusing `itemsTotal` (first send = full billable order; extras = editable drafts). `OrderComposer` falls back to the computed label, so the NewOrderSheet composer shows the amount too without touching that file.
- [x] S3-3 (authorized 2026-10-06, backend endpoint included): general kitchen note. Backend: `PATCH /orders/{id}/notes` (body `{notes}`, max 500, empty clears to null; `admin`/`mozo`; branch scope and closed-order guard mirror `PATCH /alias`; no audit/push — alias has none either). Frontend: `{prefix}-nota-general` textarea in the composer (prefill, blur/Enter save, optimistic with revert), inherited by Salón and Nuevo pedido without touching those files.

## Tasks — Slice 4 (Caja / Cobro)
- [x] S4-1: Day KPIs row (`caja-kpi-ventas/-cobros/-promedio/-por-cobrar`) rendered always (open or closed shift, prototype parity): sales = sum of completed payments (same criteria as the method totals), payments count, average, and "Por cobrar" from the page's already-listed open accounts. Reuses the `/payments?period=day` source PaymentHistory already polls.
- [x] S4-2: Open accounts show elapsed minutes (`elapsedMinutes`) and a "Ver" action (`caja-ver-{n}`) opening `/pedidos/:id` as a real anchor. Active/ready counts per row were not in the row data — reported, not implemented.
- [x] S4-3: Cash presets now dynamic: unique values of `[pendiente, ceil to 10, ceil to 50, 100, 200]` filtered `>= pendiente`, max 4; "Exacto" kept (mobile e2e depends on it); new `caja-preset-{i}` testids (none existed); validation/change/register logic untouched.

## Tasks — Slice 5 (Cocina)
- [x] S5-1: Red alert at ≥15 min: `timerClass` three levels — ≥15 `text-destructive font-bold` (theme token with dark variant), ≥10 unchanged (`text-primary`), <10 muted.
- [x] S5-2: Origin tag: non-public orders show `#{n} · 👤 Mozo`; `source === 'public'` keeps `· carta web`. Field: `order.source` (staff orders don't persist it; the `source === 'public'` convention was already used in Cocina/Salón — no backend change).

## Follow-ups (completed)
- [x] S6 (2026-10-06): Prototype look as a theme option. New palette `restoflow` ("RestoFlow — Verde menta del prototipo · Sora + Manrope") added to the existing theme mechanism: `ThemeContext` themes list, selector in Configuración (4 options), new `public/themes/theme-restoflow.css` with light/dark HSL tokens, state colors, radius, shadows and `--font`/`--display` hooks; Google Fonts link now loads Manrope + Sora; `body`/`.font-display`/headings consume the pre-existing `--font`/`--display` vars (other three palettes unchanged); preview card added to `theme-preview.html`.

- [x] S7 (2026-10-06): Table-selected experience rebuilt to the prototype presentation (user: "el modal es aburrido… debe ser como el html del prototipo"). The narrow right Sheet (`max-w-md`) is gone: selecting a table swaps the salón grid for the detail view — back control (`mesa-sheet-volver`, Escape also returns), desktop ≥820px two columns `minmax(0,1.4fr) minmax(280px,.65fr)` (orders left, sticky "Resumen" right), mobile single column with the action bar fixed above the bottom nav. Prototype-style order card per account (person + ✎, `#id · hora`, status tag, items with per-item notes, total, "✓ Entregado" `mesa-sheet-entregar-{n}` when ready), "Resumen" panel (Pedidos/Consumido/Pagado/Pendiente), "Más opciones" keeping every existing action, "+ Nuevo pedido" / "Cobrar S/ X" bar. Composer untouched; every e2e `data-testid` preserved (automated diff: 0 removed).

- [x] S8 (2026-10-06): Order-taking (composer) aligned to the prototype's `posView()`: person strip "Para {nombre} · nombre opcional" + inline ✎ rename (`mesa-sheet-persona`), and on mobile a FAB "Ver pedido · N nuevo(s) · S/ X" (`mesa-sheet-fab`, <820px) opening a bottom sheet (`mesa-sheet-ticket-sheet`, scrim, reusing `PersonOrderSummary`/`OrderNote` with `mesa-sheet-ticket-*` testids + `mesa-sheet-ticket-enviar`). Inline content stays visible (e2e contract) — the sheet is an additional surface. Desktop keeps the draft in the active account card + sticky footer; the send button is now `h-12` with the amount. E2E inventory checked: `mesa-sheet-nuevo-pedido`, `mesa-sheet-producto-*`, `mesa-sheet-items` preserved in both specs.

## Backlog (next slices)
- Empty — all planned work delivered.

## Notes / deviations
- S8: on mobile the draft exists twice by design (inline for the e2e contract + bottom sheet for thumbs); both reuse the same components/handlers with different prefixes.
- S8: `OrderNote` was extracted as an export of `OrderComposer` to reuse the general note between the catalog and the sheet (internal refactor only).
- S7: only the active account's items are editable in the detail (same mechanism as the person chips); the other account cards are read-only glances.
- S7: per-card "✓ Entregado" (`mesa-sheet-entregar-{n}`) coexists with the bar's `mesa-sheet-entregar`; the `TableSummary` (2+ accounts) vs `AccountTotals` (1 account) split is preserved.
- S5-2: all staff orders show "👤 Mozo" (llevar/recojo/delivery included); distinguishing QR-from-mostrador on staff orders needs a backend field (deferred).
- S5-1: the red uses `text-destructive` including its dark-theme variant.
- S6: dark `--destructive` keeps the system's `#dc2626` (button-fill contrast) instead of the prototype's `#f87171`; split a `--red` token later if the exact badge color is wanted.
- S6: floor-state colors in `floorStyle.js` are hardcoded hex and don't follow themes (pre-existing behavior); the prototype's `--nav`/`--ocupada` have no system token equivalent.
- S4-2 (closed 2026-10-06): "Ver" migrated to SPA `Link`; router mocks updated in `AccountPaymentAudit.test.jsx` and `CajaPaymentProof.test.js`.
- S1-5: badge counts plates (units) like Salon's `toReady` (the prototype counted orders). The shell now has two lightweight polls of the same endpoint (`RoleInbox` 20s + badge 25s) — unify later if desired.
- S1-5: badge refreshes by poll (≤25s); instant SSE updates would need moving the call inside `NotifyProvider` (small refactor, not done).
- S4-1: KPIs render with or without an open shift (prototype parity).
- S3-1: badge coexists with the stepper (deliberate redundancy; the stepper's center number remains the interaction/test contract).
- S3-2: the send label now carries the amount in both composers (sheet + new order).
- S3-3: note saves via PATCH without realtime push (alias has none either; Cocina picks it up via polling). Max length 500 chosen (no prior limit existed).
- S2-2: cobro from the sheet navigates to the order's collection screen (PedidoDetalle → CobrarDialog); the cash-shift gate stays where it already lives. Inline checkout in the Salón was rejected to avoid duplicating payment rules.
- S2-1: the three rows show for every table with at least one account; the full `TableSummary` (dishes/receipt/people) still renders only with 2+ accounts (previous rule untouched).
- S2-1: `Pagado` always renders (S/ 0.00 with no payments) for deterministic labels/testids, unlike the prototype which hides it at zero.
- S2-3: rename is offered on chips without a preview; same update path as "Organizar pedido".
- `GroupCard` omits the capacity line entirely when any member lacks capacity (no partial sums).
- Sort preference persists per user (`salon-orden:<userId>`); the prototype used a single device-global key.
- "N mesas" counts floor units (a joined group counts as 1), same criterion as the prototype.
- A group whose tables span zones lists under the anchor's zone; with a zone filter active it lists under the filtered zone.

## Verification / Evidence
- Slice 1 work-unit (commit `3cc682d`): `frontend/src/pages/Salon.jsx` (+242/−58), `frontend/src/components/MesaCard.jsx` (+8), `frontend/src/components/GroupCard.jsx` (+11); new `frontend/src/__tests__/SalonFloorParity.test.js`, extended `frontend/src/__tests__/MesasFloorPriority.test.js`.
- Test-first: 9 new assertions observed failing before the implementation, then green.
- Focused: `npm test -- --watchAll=false --runInBand --testPathPattern="SalonFloorParity|MesasFloorPriority"` -> **2 suites / 17 tests passed** (orchestrator re-ran it as a spot check: same result).
- Full suite: `npm test -- --watchAll=false --runInBand` -> **52 suites / 330 tests passed**.
- Build: `$env:CI='true'; npm run build` -> compiled successfully, no CRA warnings.
- Slice 2 work-unit (this commit): `frontend/src/pages/Salon.jsx` (+81), `frontend/src/components/PersonChips.jsx` (+105/−25), `frontend/src/components/OrderSummary.jsx` (+44); new `frontend/src/__tests__/SalonSheetParity.test.js`.
- Slice 2 test-first: 4 of 5 new assertions failed before the first implementation; the single-account fix-up went RED (1 failed) then GREEN (6/6). Orchestrator re-ran the parity suite as a spot check: **6/6 passed**.
- Slice 2 focused (parity + sheet/floor suites): -> **7 suites / 61 tests passed**.
- Slice 2 full suite: **53 suites / 336 tests passed**; Build: `$env:CI='true'; npm run build` -> compiled successfully, no warnings.
- `PersonChips` testids preserved: `-cuenta-{key}` and `-cuenta-pendientes-{number ?? id}` re-added with identical rendered values.
- Slice 3 work-unit (this commit): `frontend/src/components/OrderComposer.jsx` (+23/−4), `frontend/src/lib/orderDraft.js` (+15/−6); new `frontend/src/__tests__/OrderComposerParity.test.js`; `orderDraft.test.js` labels updated (same test count).
- Slice 3 test-first: 5 failures observed before the implementation.
- Slice 3 focused (composer + consumers + sheets): **10 suites / 81 tests passed**; orchestrator re-ran `OrderComposerParity|orderDraft` as a spot check: **2 suites / 17 tests passed**.
- Slice 3 full suite: **54 suites / 340 tests passed**; Build: `$env:CI='true'; npm run build` -> compiled successfully.
- Slice 4 work-unit (this commit): `frontend/src/pages/Caja.jsx` (+68), `frontend/src/components/CobrarDialog.jsx` (+22); new `frontend/src/__tests__/CajaDayKpis.test.js`, `frontend/src/__tests__/CobrarDialogPresets.test.js`.
- Slice 4 test-first: 10 assertions failed before implementation.
- Slice 4 focused: **7 suites / 66 tests passed**; orchestrator re-ran `Caja|Cobrar|AccountPaymentAudit` as a spot check: **5 suites / 49 tests passed**.
- Slice 4 full suite: **56 suites / 346 tests passed**; Build: `$env:CI='true'; npm run build` -> compiled successfully.
- Slice 5 work-unit (this commit): `frontend/src/pages/Cocina.jsx` (+11/−4), `frontend/src/__tests__/Cocina.test.js` (+59); 2 new tests.
- Slice 5 test-first: 2 failures observed before implementation.
- Slice 5 focused: **1 suite / 6 tests passed**; orchestrator re-ran `Cocina` as a spot check: **6/6 passed**.
- Slice 5 full suite: **56 suites / 348 tests passed**; Build: `$env:CI='true'; npm run build` -> compiled successfully.
- Parity effort complete: five slices green, build clean, every floor/sheet/composer/caja/kitchen `data-testid` contract preserved.
- S3-3 work-unit (this commit): `backend/models.py` (+10), `backend/routes/orders.py` (+18), new `tests/test_order_notes.py` (6 tests); `frontend/src/components/OrderComposer.jsx` (+49), `frontend/src/__tests__/OrderComposerParity.test.js` (+4 tests).
- S3-3 test-first: backend 6 and frontend 4 assertions observed failing first.
- S3-3 verification: backend focused `tests/test_order_notes.py` -> **6 passed** (orchestrator re-ran: 6 passed); backend hermetic `pytest tests -m "not integration" -q` -> **466 passed, 49 deselected**. Frontend composer consumers **10 suites / 73 tests**; full frontend **56 suites / 352 tests**; Build `$env:CI='true'; npm run build` -> compiled successfully; orchestrator re-ran `OrderComposerParity`: **8/8**.
- S1-5 + S4-2 follow-up work-unit (this commit): new `frontend/src/hooks/useReadyDishes.js`; `frontend/src/components/AppShell.jsx` (+55), `frontend/src/pages/Caja.jsx`, `frontend/src/components/AccountPaymentAudit.test.jsx`, `frontend/src/__tests__/CajaPaymentProof.test.js`; new `frontend/src/__tests__/AppShellReadyBadge.test.js` (3 tests).
- Follow-up test-first: badge RED (1 failing) then green **3/3**. Focused: **8 suites / 69 tests**; full frontend **57 suites / 355 tests**; Build compiled successfully; orchestrator re-ran `AppShellReadyBadge|AccountPaymentAudit`: **2 suites / 15 tests passed**.
- S6 work-unit (this commit): new `frontend/public/themes/theme-restoflow.css`, new `frontend/src/__tests__/RestoflowTheme.test.js`; `frontend/src/contexts/ThemeContext.jsx`, `frontend/src/pages/Configuracion.jsx`, `frontend/src/index.css`, `frontend/public/index.html`, `frontend/public/theme-preview.html`, `frontend/src/__tests__/ThemeDarkMode.test.js`.
- S6 test-first: 3 failures observed; focused `ThemeDarkMode|RestoflowTheme` -> **2 suites / 9 tests** (orchestrator re-ran: same); full frontend **58 suites / 358 tests**; Build compiled successfully (theme css copied and fonts link included).
- S7 work-unit (this commit): `frontend/src/pages/Salon.jsx`; new `frontend/src/__tests__/SalonDetailView.test.js` (7 tests); presentation adjustments documented in `SalonSheetParity.test.js` and `SalonActiveOrderBar.test.js`.
- S7 test-first: 5 failures observed before implementation; focused salón/sheet **14 suites / 91 tests**; full frontend **59 suites / 365 tests**; Build compiled (breakpoints verified in the compiled CSS); orchestrator re-ran `SalonDetailView|SalonSheetParity|SalonActiveOrderBar`: **3 suites / 16 tests passed**; testid diff 0 removed.
- S8 work-unit (this commit): `frontend/src/pages/Salon.jsx` (+128), `frontend/src/components/OrderComposer.jsx` (internal refactor); new `frontend/src/__tests__/SalonComposerProto.test.js` (4 tests).
- S8 test-first: 3 failures observed; focused salón/compositor **11 suites / 78 tests**; full frontend **60 suites / 369 tests**; Build compiled; orchestrator re-ran `SalonComposerProto|SalonDetailView`: **2 suites / 11 tests passed**; testid diff 0 removed.

## Rollback
Revert the Slice 1 work-unit commit (frontend files + this doc update). No API or business-rule changes involved.
