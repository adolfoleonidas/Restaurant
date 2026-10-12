# Usability fixes (audit stage 4)

## Objective and problem

The browser UX/UI audit of 2026-10-12 (ux-ui-audit protocol, isolated stack at `localhost:8082`, branch `feat/usability`) found 2 critical, 10 major, 8 accessibility, and 4 note findings. Two critical defects block or mislead users: any 422 validation error crashes the screen (66 call sites render `detail` raw, and stage 2 added more 422 paths), and the public checkout claims "Pago confirmado" for unpaid orders. This stage fixes them in impact-per-effort order while extending, not restyling, the existing design system (`docs/design-system.md`, tokens in `frontend/src/index.css`).

## Scope and authority

- Branch: `feat/usability` = `refactor/backend-core` merged with `refactor/frontend-core` (merge `4484600`). Chain: production-blockers → backend-core → frontend-core → usability.
- User authorized stage 4 and the UX/UI skills (`ux-ui-audit`, `frontend-design`) in chat on 2026-10-12.
- Frontend `frontend/src` plus `backend/seed.py` (and its tests) for UX-06 only.
- UI copy is Spanish. The register (tuteo, voseo, or usted) is a pending product decision; UX-07 waits for it.
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
- [ ] **UX-07 One voice, one glossary [07, 08, 11].** Blocked on the register decision. One glossary in `constants/` (serve, kitchen, cancel, shift, menu, team), accents fixed, plural-aware counts, no raw English labels in Configuración, one date format via `lib/format.js`.
- [x] **UX-08 Labelled controls [13, 14, 16, 19].** `htmlFor`/`id` on every visible label-input pair; Reportes branch select labelled by `label[for]`; Equipo switches named "Activo: <nombre>"; a skip link to `main`; distinct names for the two Pedidos "Ver" links.
- [ ] **UX-09 Focus, size, contrast, danger [12, 15, 17, 18, 20].** One focus ring token for buttons, links, and card buttons (≥3:1). Touch targets ≥44 px for steppers, quick-note chips, filter chips, and "Cobrar" on touch layouts. Dark-theme tokens for muted text, destructive red, and success meet 4.5:1. "Anular pedido" uses the destructive style. Quick-note chips filtered by product category.
- [x] **UX-10 No silent failures, no native dialogs [lead 1, 20].** Caja shows its polling error with "Reintentar"; `window.confirm` in `PrepayQueue.jsx` and `TableQrActions.jsx` becomes the shared AlertDialog.

## Deferred / separate

- Integration suite refresh (42 stale failures that also fail on `main`).
- Notes N1–N4 from the audit (request fan-out, expected cash shown before counting, "SALÓN" link on public header, `reports/sales` open to mozo).

## Delivery forecast

About 800 to 1200 authored changed lines (UX-01 alone touches ~25 files mechanically). Strategy: `feature-branch-chain`; slice into PRs by task group.

## Progress and evidence

- 2026-10-12: stack built from `feat/usability`; backup and restore validated (40 documents restored, counts equal); integration failures shown identical to `main`; browser audit completed; critical findings 01 and 02 spot-checked in code by the parent.

- UX-01 (writer): RED `craco test src/__tests__/apiError.test.js`: suite failed (module `@/lib/apiError` not found); new `UsuariosValidation.test.js` password test RED (`minlength` null). GREEN: apiError 9/9; full suite 71 suites / 600 tests passed. 79 call sites now use `apiErrorMessage(error, fallback)` (`rg "response\?\.data\?\.detail"` leaves only the `account_changed` 409 check in CobrarDialog). Network errors (no response) read "Sin conexión con el servidor. Reintentar."; password field has `minLength={8}` and the hint "Mínimo 8 caracteres". Commit: see log (`feat(ux): ...apiErrorMessage`).
- UX-02 (writer): RED `CheckoutReviewTable.test.js` (review showed "Sin definir") and `CheckoutTableQr.test.js` (heading was "Pago confirmado" for an unpaid pay-at-end order). GREEN: Checkout* suites 14/14. Two older assertions that encoded the wrong heading were corrected. Heading now follows payment (paid -> "Pago confirmado", else kitchen -> "Pedido enviado a cocina").
- UX-03 (writer): RED `CobrarDialogFinish.test.js` 3/3 failed (Finalizar did not call onOpenChange(false); hero read S/ 0.00; method buttons enabled). GREEN 3/3; PedidoDetalleCollection + CajaPaymentProof suites still pass (30 tests). `paidAmount` captured at submit; `MethodRail` gets `locked`; number-key shortcut ignored once paid.
- UX-04 (writer): RED salonSelectors (4 new tests) + SalonHeaderSummary header test failed before the change; the chip `title` test was written together with its change (RED not observed separately). GREEN: full suite 74 suites / 610 tests. Header now reads "En cocina: N platos · Listos: N platos · Por cobrar: N mesas" (mesas taken from the same count as the filter chip); drafts excluded; MesaCard `due` sums all open orders of the visit; sheet model resolves the live table; `countOf` plural helper added to `lib/format.js`.
- UX-06 (writer): RED `tests/test_seed_branch.py` 3/3 failed (no branch seeded), `SalonAlertsDetail` (403 detail not shown) and `NotifyStream403` (6 fetch calls instead of 1) failed. GREEN: backend `-m "not integration"` 514 passed (baseline 511 + 3); frontend 76 suites / 614 tests. Demo seed (`SEED_DEMO`) now creates "Sucursal principal" and assigns zones, tables and non-admin users to it; blank seed unchanged (admin only, tenant-wide). Salón banner shows the server `detail` for responses; `NotifyContext` stops reconnecting on 403 (503 still retries). Integration suite not run (needs the stack).
- UX-05 (writer): RED `PlaceholderCopy.test.js` 4/10 failed and the CobrarDialog receipt-name test failed; GREEN full suite 77 suites / 621 tests. `TransferPanel` renders only configured bank fields and nothing otherwise; receipt name comes from `/restaurants/current` via new `useRestaurantName(open)`; no `Sabor Peruano`/`Barranco` fallbacks left in `frontend/src` (neutral "Restaurante"). The seed already has no product named "test" (guard test added, passed on first run: the audit's "test" products come from integration tests). **Limitation:** `GET /payment-config/collection` (cajero) does not return bank data and backend routes were out of scope, so the transfer panel stays hidden until that endpoint exposes a `transfer` object (the panel already reads `collectionConfig.transfer`). Follow-up: expose `{bank_name, bank_account, bank_cci, bank_holder}` there. `public/index.html` and `public/manifest.json` still carry the static name "Sabor Peruano" (not touched).
- UX-10 (writer): RED: PrepayRejectConfirm 2/2, CajaLoadError 1/1, ConfiguracionTableQr rotate/revoke 2 failed (window.confirm path). GREEN: full suite 79 suites / 624 tests. New shared `components/ConfirmDialog.jsx` (AlertDialog, destructive action) replaces all three `window.confirm`; Caja shows `caja-error` banner with Reintentar (and no longer offers "open register" when the register could not be read).
- UX-08 (writer): RED `LabelAssociation.test.js` (source guard, 48 unassociated labels), Reportes label test, Pedidos "Ver" test, Usuarios switch test, SkipLink test. GREEN: full suite 81 suites / 629 tests. Every `<Label>`/text-only `<label>` now has `htmlFor`+`id` (Radix Select triggers got ids; the two Configuracion triggers lost their redundant `aria-label` in favour of the visible label; Pagos holder id was duplicated across Yape/Plin and is now per method); Reportes select uses `label[for]`; Equipo switch has `aria-label` "Activo: <nombre>"; skip link "Saltar al contenido" + `main#contenido` in AppShell and PublicLayout; Pedidos link `aria-label` "Ver pedido #N".

## Next step

Writer implements UX-01 to UX-06 and UX-08 to UX-10; UX-07 after the register decision.
