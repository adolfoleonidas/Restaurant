# Usability fixes (audit stage 4)

## Objective and problem

The browser UX/UI audit of 2026-10-12 (ux-ui-audit protocol, isolated stack at `localhost:8082`, branch `feat/usability`) found 2 critical, 10 major, 8 accessibility, and 4 note findings. Two critical defects block or mislead users: any 422 validation error crashes the screen (66 call sites render `detail` raw, and stage 2 added more 422 paths), and the public checkout claims "Pago confirmado" for unpaid orders. This stage fixes them in impact-per-effort order while extending, not restyling, the existing design system (`docs/design-system.md`, tokens in `frontend/src/index.css`).

## Scope and authority

- Branch: `feat/usability` = `refactor/backend-core` merged with `refactor/frontend-core` (merge `4484600`). Chain: production-blockers → backend-core → frontend-core → usability.
- User authorized stage 4 and the UX/UI skills (`ux-ui-audit`, `frontend-design`) in chat on 2026-10-12.
- Frontend `frontend/src` plus `backend/seed.py` (and its tests) for UX-06 only.
- UI copy is Spanish. **Decision (user, 2026-10-12): the register is tuteo (Peru).** Voseo ("Abrí", "querés") and usted ("Inténtelo", "Seleccione") are converted to tuteo (UX-07).
- Design rules (frontend-design): one action keeps one name through the flow (button "Cobrar" → toast "Cobrado"); errors say what happened and how to fix it, never vague; empty states offer the next action; sentence case; no new decoration; extend existing tokens.
- Test stack: `docker compose -p restaurant-stage4` with env in the session scratchpad, port 8082. Disposable data.
- No push, PR, merge, deploy, or remote operation without a separate user decision.

## Implementation and checking

- Route: delegated direct, one bounded writer (many files).
- TDD: **on**, source: global user configuration. RED before each behavior change.
- Frontend (`frontend/`): `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false` (baseline 69 suites / 589 tests) and `npx craco build`.
- Backend (repo root): `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q` (baseline 511 passed).
- Integration (`API_BASE=http://localhost:8082/api`, `-m integration`): baseline 42 failures, identical on `main`; UX-06 is expected to reduce them.
- Browser re-check of each critical/major finding on the rebuilt stack after the writer finishes.
- RDD: **off** (`clone_local`).

## Tasks (audit finding numbers in brackets)

- [x] **UX-01 Never crash on API errors [01].** One `apiErrorMessage(error, fallback)` helper in `lib/` that turns a string `detail`, a FastAPI 422 `detail` array (field + message, Spanish), or a network error into one readable sentence. Replace all 66 `toast.error(e.response?.data?.detail …)` call sites. User create form: `minLength={8}` plus a visible hint "Mínimo 8 caracteres". Test: a 422 array renders a sentence, never an object.
- [x] **UX-02 Honest checkout [02, 10].** `pages/Checkout.jsx:362` heading follows `payment_status`, not `wentToKitchen` (paid → "Pago confirmado", pending pay-at-end → "Pedido enviado a cocina"). The review shows the table selected in the picker, not "Sin definir".
- [x] **UX-03 Charge dialog closes and adds up [03].** "Finalizar" closes `CobrarDialog` after a registered payment; the receipt "Total pagado" equals the paid amount; the method picker is disabled once paid.
- [x] **UX-04 Salón numbers tell the truth [05, 06].** `pages/salon/selectors.js` excludes `borrador` items from "En cocina" and "Por cobrar"; header and chips count the same unit and say which. `MesaCard` "Debe" sums all open orders of the table. The table sheet status follows live data.
- [x] **UX-05 Remove placeholder copy [09].** `TransferPanel` bank data and the receipt restaurant name come from restaurant settings; the transfer panel is hidden until bank data is configured; no hardcoded "Sabor Peruano". Seed product names must not contain "test".
- [x] **UX-06 First run works for staff [04].** The seed creates a default branch and assigns seeded tables and non-admin users to it. When a staff call returns 403 with a `detail`, Salón shows that detail; the notification stream stops retrying on 403.
- [x] **UX-07 One voice, one glossary [07, 08, 11].** Register decided (tuteo, Peru). One glossary in `constants/` (serve, kitchen, cancel, shift, menu, team), accents fixed, plural-aware counts, no raw English labels in Configuración, one date format via `lib/format.js`.
- [x] **UX-08 Labelled controls [13, 14, 16, 19].** `htmlFor`/`id` on every visible label-input pair; Reportes branch select labelled by `label[for]`; Equipo switches named "Activo: <nombre>"; a skip link to `main`; distinct names for the two Pedidos "Ver" links.
- [x] **UX-09 Focus, size, contrast, danger [12, 15, 17, 18, 20].** One focus ring token for buttons, links, and card buttons (≥3:1). Touch targets ≥44 px for steppers, quick-note chips, filter chips, and "Cobrar" on touch layouts. Dark-theme tokens for muted text, destructive red, and success meet 4.5:1. "Anular pedido" uses the destructive style. Quick-note chips filtered by product category.
- [x] **UX-10 No silent failures, no native dialogs [lead 1, 20].** Caja shows its polling error with "Reintentar"; `window.confirm` in `PrepayQueue.jsx` and `TableQrActions.jsx` becomes the shared AlertDialog.
- [x] **UX-12 Empty table: action where the eye is (user request, 2026-10-12).** "Nuevo pedido" lives inside the "Mesa libre" card (hint "Aún no hay pedidos en esta mesa."); the bottom bar is not rendered while the table has no orders; the duplicated plus ("+ + Nuevo pedido") is gone. Commit `f89478d`.
- [x] **UX-13 Quantity steppers on product cards (user request).** Composer cards show an inline [−] qty [+] stepper (replacing the badge) when the product is in the account; tap on the card still adds one; the stepper row always reserves its height (invisible at 0). Commit `37b7440`.

## Deferred / separate

- Integration suite refresh (42 stale failures that also fail on `main`).
- Notes N1–N4 from the audit (request fan-out, expected cash shown before counting, "SALÓN" link on public header, `reports/sales` open to mozo).

## Delivery forecast

About 800 to 1200 authored changed lines (UX-01 alone touches ~25 files mechanically). Strategy: `feature-branch-chain`; slice into PRs by task group.

## Progress and evidence

- Commits (feat/usability): UX-01 `596c7af`, UX-02 `024119a`, UX-03 `40de216`, UX-04 `f928b26`, UX-06 `92125cc`, UX-05 `79892b2`, UX-10 `78d2f2b`, UX-08 `a04680a`, UX-09 `d278a1a`; UX-07 `bbd729b`.
- 2026-10-12: stack built from `feat/usability`; backup and restore validated (40 documents restored, counts equal); integration failures shown identical to `main`; browser audit completed; critical findings 01 and 02 spot-checked in code by the parent.

- UX-01 (writer): RED `craco test src/__tests__/apiError.test.js`: suite failed (module `@/lib/apiError` not found); new `UsuariosValidation.test.js` password test RED (`minlength` null). GREEN: apiError 9/9; full suite 71 suites / 600 tests passed. 79 call sites now use `apiErrorMessage(error, fallback)` (`rg "response\?\.data\?\.detail"` leaves only the `account_changed` 409 check in CobrarDialog). Network errors (no response) read "Sin conexión con el servidor. Reintentar."; password field has `minLength={8}` and the hint "Mínimo 8 caracteres". Commit: see log (`feat(ux): ...apiErrorMessage`).
- UX-02 (writer): RED `CheckoutReviewTable.test.js` (review showed "Sin definir") and `CheckoutTableQr.test.js` (heading was "Pago confirmado" for an unpaid pay-at-end order). GREEN: Checkout* suites 14/14. Two older assertions that encoded the wrong heading were corrected. Heading now follows payment (paid -> "Pago confirmado", else kitchen -> "Pedido enviado a cocina").
- UX-03 (writer): RED `CobrarDialogFinish.test.js` 3/3 failed (Finalizar did not call onOpenChange(false); hero read S/ 0.00; method buttons enabled). GREEN 3/3; PedidoDetalleCollection + CajaPaymentProof suites still pass (30 tests). `paidAmount` captured at submit; `MethodRail` gets `locked`; number-key shortcut ignored once paid.
- UX-04 (writer): RED salonSelectors (4 new tests) + SalonHeaderSummary header test failed before the change; the chip `title` test was written together with its change (RED not observed separately). GREEN: full suite 74 suites / 610 tests. Header now reads "En cocina: N platos · Listos: N platos · Por cobrar: N mesas" (mesas taken from the same count as the filter chip); drafts excluded; MesaCard `due` sums all open orders of the visit; sheet model resolves the live table; `countOf` plural helper added to `lib/format.js`.
- UX-06 (writer): RED `tests/test_seed_branch.py` 3/3 failed (no branch seeded), `SalonAlertsDetail` (403 detail not shown) and `NotifyStream403` (6 fetch calls instead of 1) failed. GREEN: backend `-m "not integration"` 514 passed (baseline 511 + 3); frontend 76 suites / 614 tests. Demo seed (`SEED_DEMO`) now creates "Sucursal principal" and assigns zones, tables and non-admin users to it; blank seed unchanged (admin only, tenant-wide). Salón banner shows the server `detail` for responses; `NotifyContext` stops reconnecting on 403 (503 still retries). Integration suite not run (needs the stack).
- UX-05 (writer): RED `PlaceholderCopy.test.js` 4/10 failed and the CobrarDialog receipt-name test failed; GREEN full suite 77 suites / 621 tests. `TransferPanel` renders only configured bank fields and nothing otherwise; receipt name comes from `/restaurants/current` via new `useRestaurantName(open)`; no `Sabor Peruano`/`Barranco` fallbacks left in `frontend/src` (neutral "Restaurante"). The seed already has no product named "test" (guard test added, passed on first run: the audit's "test" products come from integration tests). **Limitation:** `GET /payment-config/collection` (cajero) does not return bank data and backend routes were out of scope, so the transfer panel stays hidden until that endpoint exposes a `transfer` object (the panel already reads `collectionConfig.transfer`). Follow-up: expose `{bank_name, bank_account, bank_cci, bank_holder}` there. `public/index.html` and `public/manifest.json` still carry the static name "Sabor Peruano" (not touched).
- UX-10 (writer): RED: PrepayRejectConfirm 2/2, CajaLoadError 1/1, ConfiguracionTableQr rotate/revoke 2 failed (window.confirm path). GREEN: full suite 79 suites / 624 tests. New shared `components/ConfirmDialog.jsx` (AlertDialog, destructive action) replaces all three `window.confirm`; Caja shows `caja-error` banner with Reintentar (and no longer offers "open register" when the register could not be read).
- UX-08 (writer): RED `LabelAssociation.test.js` (source guard, 48 unassociated labels), Reportes label test, Pedidos "Ver" test, Usuarios switch test, SkipLink test. GREEN: full suite 81 suites / 629 tests. Every `<Label>`/text-only `<label>` now has `htmlFor`+`id` (Radix Select triggers got ids; the two Configuracion triggers lost their redundant `aria-label` in favour of the visible label; Pagos holder id was duplicated across Yape/Plin and is now per method); Reportes select uses `label[for]`; Equipo switch has `aria-label` "Activo: <nombre>"; skip link "Saltar al contenido" + `main#contenido` in AppShell and PublicLayout; Pedidos link `aria-label` "Ver pedido #N".
- UX-09 (writer): RED `ThemeContrast.test.js` 8 failed (dark destructive 2.86-4.0:1 in all five themes, restaurante dark muted 4.41:1 on muted, no shared focus rule), `TouchTargets.test.js` 8 failed, PedidoDetalle destructive-style test failed. GREEN: full suite 83 suites / 669 tests (the build result is recorded below).
  Contrast (WCAG ratio, before -> after), dark mode, destructive used as text on page / card: fresco and index.css 3.19 / 2.86 -> 5.67 / 5.09; caja 3.57 / 3.22 -> 6.48 / 5.85; calido 4.00 / 3.54 -> 5.56 / 4.92; elegante 3.40 / 3.03 -> 6.17 / 5.50; restaurante 3.52 / 2.91 -> 5.67 / 4.70. Text on the destructive fill (destructive-foreground): fresco 4.61 -> 5.67, caja 4.76 -> 6.48, calido 4.38 -> 5.83, elegante 4.34 -> 6.48, restaurante 5.09 -> 5.89. Tokens: destructive `0 72% 66%` (`8 72% 66%` in the warm themes), destructive-foreground a dark ink per theme. Muted text: already 5.12-8.44 in dark everywhere except restaurante on `muted` 4.41 -> 5.15 (`--muted-foreground` 215 20% 65% -> 70%). Success (`--green`) dark: 9.77 on page, 8.78 on card, 5.92 on green-soft (index.css), no change needed. Focus ring: fresco dark 4.35 page / 3.91 card, light 6.20 / 6.51, all themes >= 3.0 (unchanged); a shared `:focus-visible` outline on `hsl(var(--ring))` now covers links, card buttons and inputs, with Tailwind utilities still winning where a component sets its own.
  Touch: new `.touch-target-coarse` (44 px under `@media (pointer: coarse)`, mouse layouts stay compact) on item steppers (OrderSummary, OrderComposer), quick-note chips, Salón filter chips and every MesaCard action (Cobrar included); customer ProductCard steppers 40 -> 44 px. Class contracts are tested, not rendered pixels (jsdom has no layout): needs the browser re-check. "Anular pedido" is an outlined destructive button (`border-destructive/40 text-destructive`), matching "Anular producto". Quick notes now come from `quickNotesFor(item, products, categories)`: drinks get Sin hielo / Poco azúcar, desserts none, chicken the chicken set, mains the main set, unknown category keeps the full list.

- UX-07 (writer): RED before the change: with the old test assertions in place the new copy failed 6 frontend tests (5 suites) and 5 backend tests; `CopyConsistency.test.js` could not even import `@/constants/glossary`, and the two `format.test.js` date tests failed. GREEN: frontend 84 suites / 681 tests; backend `-m "not integration"` 515 passed. Changes: (1) tuteo: ~245 replacements in `frontend/src` (voseo and usted, imperatives and clitics: Abre, Haz, Cámbialas, Pídele, Acércate, Puedes, quieres, tienes...) and the same voseo in user-facing backend `detail` strings (`attention.py`, `billing.py`, `order_flow.py`, `routes/*`), with the tests that asserted them updated; guarded by a source scan in `CopyConsistency.test.js`. (2) glossary `constants/glossary.js`: Entregar/Entregado (was Servir/Servido), Cocina, Cancelar only dismisses a dialog while orders and money are Anular/Anulado (was Cancelado), Turno, Carta, Equipo; plus `ENVIRONMENT_LABELS` and `RECORD_LABELS` so Configuración no longer shows raw `production` / `orders` keys. (3) accents restored in the charge dialog and panels (Método, Descripción, operación, conexión, Número, Teclado...) and the `aria-label` "Requiere atención" (tests updated). (4) plural agreement through `countOf` (1 ítem / 2 ítems, 1 cuenta, recojo listo, plato creado...), no more "(s)". (5) one date format: `fmtDateFull` and `fmtDateTimeShort` now delegate to `fmtDateTime` (dd/mm/yyyy hh:mm).
  Follow-ups not done (left on purpose): backend usted strings in `detail` (about 6: branch_access.py "Seleccione una sucursal...", "No tiene acceso a esa sucursal", "Debe indicar una sucursal válida", routes/branches.py, cash.py/reports.py "Use ..." docstring-style messages, models.py validators) because they are asserted by many backend tests and some are shared with the API contract; `docs/` runbook prose untouched as instructed; `public/index.html` and `public/manifest.json` titles.

## Replay onto origin/main (2026-10-12)

The first implementation (commits listed under Progress, now on `backup/feat/usability`) was replayed onto `feat/usability` = `refactor/backend-core` + `refactor/frontend-core` (both based on origin/main `ec3c303`). Baseline on that merge before the replay: frontend 81 suites / 759 tests (plus one stale, git-ignored `CopyConsistency.test.js` left in the working tree by the old checkout; moved out), backend 543 passed.

| Task | Old | New | Outcome |
|------|-----|-----|---------|
| UX-01 | 596c7af | d8966d7 | Resolved. Conflicts in `CajaWorkspace.jsx` and `salon/useTableSheet.js` (the sheet was rewritten upstream): took the new files and re-applied `apiErrorMessage` to every `response?.data?.detail` call site, including `useTableSheet` (13) and the new `OrderComposer` note call that the old commit never saw. The `account_changed` 409 check in `CobrarDialog` stays. `rg "response\?\.data\?\.detail"` finds no toast call site left. |
| UX-02 | 024119a | 162eb39 | Applied clean. |
| UX-03 | 40de216 | 8a76245 | Applied clean (CobrarDialog/PaymentPanel split did not collide). |
| UX-04 | f928b26 | 43fca36 | Re-implemented by hand with TDD (4 files conflicted: `Salon.jsx` is now a container, summary lives in `salon/useFloorView`, `accountDue`/`floorDue`/sort were added upstream). RED: 7 failing tests (floorSummaryText units, drafts excluded from kitchen/bill counts, visit due sums all open orders, sheet follows the live table, header units, chip titles, `useFloorView` summary). GREEN after `countOf`, `billableDue`, `decorateTables` visit sum, live table in `selectSheetModel`, `toPay` taken from the "Por cobrar" chip count in `useFloorView`. The `useFloorView` expectation changed from `toPay: 2` (orders) to `0` (tables in the chip; the fixture table is "listo"). |
| UX-06 | 92125cc | 6f1d0ef | Resolved. `SalonAlerts.jsx` kept the new signature (`floorSummary`) and gained the server-reason logic; `usability.md` conflict resolved by keeping both evidence lines. Seed and `NotifyContext` merged clean. |
| UX-05 | 79892b2 | 527786f | Applied clean. |
| UX-10 | 78d2f2b | ea7b932 | Applied clean. New upstream `window.confirm` calls in `salon/useTableSheet.js` (discard drafts, 2 sites) are not covered by the original finding and were left as they are. |
| UX-08 | a04680a | df8b349 | Applied clean. |
| UX-09 | d278a1a | 54cb16f, c4046a5 | Resolved. Conflicts: `OrderSummary.jsx` and `orderDraft.js` (upstream removed the per-item quick-note chips and `QUICK_NOTES`), `FloorFilters.jsx`, `PedidoDetalleCollection.test.js` (kept both tests), `TableSheetContent.jsx` (deleted upstream). Skipped as moot: category quick notes (`quickNotesFor`) because the feature no longer exists; its tests were removed from `TouchTargets.test.js`. Re-applied `touch-target-coarse` to the new stepper buttons and the filter chips. New upstream theme `theme-restoflow.css` failed the new contrast test (dark destructive 3.85:1); fixed with the same tokens as the other themes (`0 72% 66%` / foreground `0 0% 8%`). `SkipLink.test.js` (UX-08) could not load axios once `AppShell` polled ready dishes; mocked `@/lib/api` and `usePolling` in a separate fix commit (c4046a5). |
| UX-07 | bbd729b | 5d40827 | Resolved with `-X ours` (new behavior wins on conflict hunks), then audited: every line added by the old commit was checked against the result and the lost pieces were re-applied (`countOf` import and use in `OrderSummary`/`CajaWorkspace`, "Entregar" in `MiniOrderBar`). Voseo/usted added upstream was converted: `backend/routes/orders.py`, `payments.py`, `branch_access.py` (reintentá, revisá, volvé, usá, elegí, anulalos, Seleccione); the frontend had none left. The source-scan test was never committed in the first pass: `CopyConsistency.test.js` matches the `*pyc*` rule in `.gitignore`. It is now `CopyRegister.test.js` (word list extended with mirá, usá, marcá) plus a backend scan `tests/test_copy_register.py`. `test_branch_scope_helpers.py` asserted the usted string and was updated. |
| docs | 2458a03, 2d796fc | ed90c4a, cd8e184 | Applied clean (the "Parent verification" section above describes the first base and was not re-run). |
| #16 (new) | n/a | 6ef8535 | New work, TDD. RED: `SalonKitchenLink.test.js` (the "Cocina (n)" button showed to a role without access). GREEN: `SalonHeader` takes `canGoKitchen`, `Salon.jsx` passes `canAccessRoute(user, '/cocina')` (ROUTE_ROLES: admin, mozo, cocina; the cajero no longer sees it). Findings #1-#5 (menu vs guard) are unchanged. |

Verification after the replay:

- Frontend `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4`: 97 suites / 855 tests passed.
- `npx craco build`: Compiled successfully.
- Backend `-m "not integration"`: 548 passed (baseline 543; the new tests are test_seed_branch and test_copy_register).
- `git diff --check origin/main...HEAD`: clean.
- Not re-run: the integration suite and the browser checks of the Parent verification section.

## Next step

All ten tasks are implemented. Next: rebuild the stack from this branch and re-check the critical and major findings in the browser (touch targets, focus ring and dark contrast need real rendering, not jsdom); then decide on delivery slicing (`feature-branch-chain`).

## Parent verification (2026-10-12, rebuilt stack with fresh volume)

- Backend hermetic suite re-run by the parent: 515 passed, 49 deselected.
- Integration suite against `localhost:8082`: 22 failed, 6 errors, 20 passed, 1 skipped (was 41 failed, 1 error, 7 passed). The remaining failures are the pre-existing stale suite, not regressions; refresh is a separate task.
- Browser: production login shows no demo accounts (PB-01 confirmed on the real bundle); Equipo create with a 6-character password (client `minlength` removed to force the server 422) shows the toast "Contraseña: debe tener al menos 8 caracteres." and the screen does not crash (finding 01 fixed).
- API: mozo, cajero, and cocina log in on the fresh seed and list 12 tables each (finding 04 fixed).
- Checkout heading keyed on `isPaid` (finding 02) confirmed in `pages/Checkout.jsx:367`; covered by frontend tests, not re-walked in the browser.
- No voseo/usted forms left in non-test frontend sources (grep).

## UX-12 / UX-13 evidence (writer, 2026-10-12)

- UX-12 RED: `SalonDetailView.test.js` empty-state test failed (old hint, button outside the card, bar present). GREEN after new `pages/salon/NewOrderButton.jsx` (icon + "Nuevo pedido", `h-12 touch-target-coarse`, same testid and `aria-expanded`), card button in `TableSheet`, `SheetSummaryPanel` renders the bar only with orders or a charge. `SalonComposerProto` T04 test updated: the control now remounts from the card to the bar when the account list loads.
- UX-13 RED: `OrderComposerParity.test.js` 2 of 5 new tests failed (badge still present, hidden stepper). GREEN: the old hidden stepper is now visible when qty > 0 (`invisible` otherwise, keeps height), buttons 32px (44px under coarse pointers), `stopPropagation` on both, same `onAddProduct`/`onRemoveProduct` callbacks (no new draft path); "−" stays disabled when only sent lines exist; "+" disabled when unavailable or saving. The qty shown is the account total as before; badge removed.
- Verification: focused suites green; full `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4`: 98 suites / 859 tests passed; `npx craco build`: Compiled successfully; `git diff --check` clean. Not checked in a real browser (touch sizes, layout stability).
