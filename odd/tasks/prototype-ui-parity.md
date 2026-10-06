# Prototype UI parity (final RestoFlow prototype → real frontend)

Status: Active
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
- [ ] S1-5 (deferred): ready-dishes badge on the nav — needs a shell-level data source decision.

## Tasks — Slice 2 (Detalle de mesa)
- [x] S2-1: Consumido/Pagado/Pendiente rows (`AccountTotals` exported from `OrderSummary.jsx`): inside `TableSummary` (2+ accounts) and standalone for a single account (`mesa-sheet-consumido/-pagado/-pendiente`), placed before the people strip. Source: per-account `total − amount_paid` (same as `MesaCard` "Debe S/ X"), reused via `accountDue(order)` in `Salon.jsx`.
- [x] S2-2: Direct "Cobrar S/ X" in the sheet (`mesa-sheet-cobrar`) with the active account balance. Decision: navigation (`openCharge`), not inline `CobrarDialog` — `POST /payments` requires an open cash shift, and replicating the Caja/PedidoDetalle gate in Salón would duplicate payment logic.
- [x] S2-3: ✎ rename per person/account (`mesa-sheet-renombrar-{key}` + inline `mesa-sheet-renombrar-input-{key}`), same `PATCH /orders/:id/alias` path with optimistic update; the "Organizar pedido" input keeps working.

## Tasks — Slice 3 (Composer)
- [x] S3-1: Quantity badge on product cards (`{prefix}-producto-badge-{id}`, top-right, only when qty > 0; `pointer-events-none` + `aria-hidden` so taps fall through to the card button and SR announces once). Stepper and every existing testid kept — the badge is a deliberate one-digit glance indicator (the stepper's center number stays the test contract).
- [x] S3-2: Amount inside the send button: `sendAction` returns `amount` and labels `✈ Enviar a cocina · S/ X` / `✈ Enviar adicionales (N) · S/ X`, reusing `itemsTotal` (first send = full billable order; extras = editable drafts). `OrderComposer` falls back to the computed label, so the NewOrderSheet composer shows the amount too without touching that file.
- [ ] S3-3 (deferred): general order note. The field exists (`orders.notes`, accepted by `POST /orders`, rendered by Cocina) but there is no update path: no `PATCH /orders/{id}`, `PATCH /orders/{id}/status` only takes status/reason, and `send-to-kitchen` accepts no body. Wiring the composer textarea needs a new backend endpoint (out of authorized scope).

## Tasks — Slice 4 (Caja / Cobro)
- [x] S4-1: Day KPIs row (`caja-kpi-ventas/-cobros/-promedio/-por-cobrar`) rendered always (open or closed shift, prototype parity): sales = sum of completed payments (same criteria as the method totals), payments count, average, and "Por cobrar" from the page's already-listed open accounts. Reuses the `/payments?period=day` source PaymentHistory already polls.
- [x] S4-2: Open accounts show elapsed minutes (`elapsedMinutes`) and a "Ver" action (`caja-ver-{n}`) opening `/pedidos/:id` as a real anchor. Active/ready counts per row were not in the row data — reported, not implemented.
- [x] S4-3: Cash presets now dynamic: unique values of `[pendiente, ceil to 10, ceil to 50, 100, 200]` filtered `>= pendiente`, max 4; "Exacto" kept (mobile e2e depends on it); new `caja-preset-{i}` testids (none existed); validation/change/register logic untouched.

## Backlog (next slices)
- S5 Cocina: red ≥15 min alert; "Mozo" tag on tickets.

## Notes / deviations
- S4-2: "Ver" is a real anchor (full page load) so the out-of-scope `AccountPaymentAudit.test.jsx` mock stays untouched; it can migrate to SPA `Link` when that mock is extended.
- S4-1: KPIs render with or without an open shift (prototype parity).
- S3-1: badge coexists with the stepper (deliberate redundancy; the stepper's center number remains the interaction/test contract).
- S3-2: the send label now carries the amount in both composers (sheet + new order).
- S3-3: deferred until a supported note-update path exists; requires a backend endpoint.
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

## Rollback
Revert the Slice 1 work-unit commit (frontend files + this doc update). No API or business-rule changes involved.
