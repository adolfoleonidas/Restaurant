# Cobro Redesign — Wire CobrarDialog to Both Entry Points

## Objective

Make the already-ported, mobile-optimized cobro (payment collection) design actually visible in production: render `CobrarDialog` (prototype-based, from `cobro-restaurante (6).html`) from both collection entry points, preserve all existing payment logic contracts, and restore the skipped test coverage.

## Problem

The redesign was merged into `origin/main` on Oct 2 (`fe5b399`, `304ff05`) as a new `CobrarDialog` component inside `frontend/src/pages/Caja.jsx` (lines 85–1071) plus `frontend/src/styles/cobro.css` — but **it is never rendered**. `Caja.jsx:1812` and `PedidoDetalle.jsx:401` still mount the old `OrderCollectionDialog`. 19 proof-flow tests in `CajaPaymentProof.test.js` are `describe.skip`ped.

## Scope (user-authorized)

- Redesign applied to **both** collection entry points: Caja workspace and PedidoDetalle (user chose "Ambas entradas" on 2026-10-04).
- Reconcile the ported UI with prototype iteration **(6)** (`Downloads/cobro-restaurante (6).html`, Oct 4) — port missing visual/UX deltas only.
- Commit and push when green (user: "aplicar este cambio y subirlo nuevamente").

Out of scope: backend changes, new payment features, demo-only fakes (in-memory payments, fake review/history, sample QR, `localStorage('cobro.method')`, WhatsApp if not already present), theme hardcoding.

## Constraints

- Preserve logic exactly: `POST /payments` (idempotency_key lifecycle, `expected_updated_at`/`expected_total`, 409 `account_changed` handling), `POST /payments/{order_id}/proof` (1.8 MB cap, pending-proof 409, proof≠payment separation, refresh-block contract), `GET /payment-config/collection`, register gating, epoch/stale guards, permission gates (`canDiscount`, `canSubmitProof`, `canCollect`).
- Keep the shared `data-testid` contract (`caja-cobrar-dialog`, `caja-total`, `caja-vuelto`, `caja-recibido-input`, `caja-metodo-*`, `caja-split-*-amount`, `caja-propina`, `caja-descuento[-motivo]`, `caja-comprobante-*`, `caja-enviar-comprobante`, `caja-cobrar-submit-button`, `caja-pago-ok`, `caja-imprimir`, `caja-siguiente`, `caja-cobrar-resto`, `caja-verificar-*`, `comprobante-*`).
- Stay on theme CSS variables (`--brand`, `--paper`, ink/muted aliases) — do NOT hardcode prototype hexes (decision from commit `9cd0e73`).
- Do not touch `stash@{0}` nor modify the two untracked Oct-2 test files (`tests/test_charge_and_close.py`, `frontend/src/__tests__/PedidoDetalleChargeClose.test.js`) — the latter must keep passing against the new dialog.
- Route: delegated (writer trigger: 2+ non-trivial files). One writer at a time, sequential units, no parallel writers in this worktree.

## TDD Mode

Resolved: **off** (no `sdd-init`/strict-tdd record for this project; no explicit user activation). Ordinary functional checks required instead. Runner: CRA + craco / Jest — `yarn test` scripts from `frontend/`; build gate `yarn build`.

## Delivery

- Strategy: `ask-on-risk` (cached from SDD vocabulary default).
- Forecast authored changed lines: ~600–1200 (prototype-6 delta + extraction move counted separately ~1000 moved; test restoration ~400). **Exceeds the ~400 heuristic** → delivery/split/exception question must be asked before the first commit boundary, with actual counts.
- Branch: `feat/cobro-redesign-wiring` from `origin/main` @ `451c7c2` (first base-ref boundary for review assessment).
- RDD (receipt-driven development): enabled by default → after each work-unit commit run `gentle-ai review assess --committed-only --base-ref <last boundary>` and follow `review_due`.

## Tasks

- [x] **T1** — Delta analysis: compare prototype (6).html vs ported `CobrarDialog`/`cobro.css`; produce ordered list of missing visual/UX deltas (layout, mobile behavior, keypad, split progress, tip chips, verify copy). Record list here as evidence.
  - DONE 2026-10-04 (writer A): 18-item ordered delta list delivered in writer report. Evidence highlights: latent ReferenceError (dialog used `equalShare`/`newIdempotencyKey` defined only in OrderCollectionDialog — would crash once wired; fixed via new `lib/cash.js`); prototype-6 "final iteration" CSS block not previously ported; `pay-hero`/tip-chips/kbd/toast CSS missing; 2 demo-only fakes removed (local card/transfer "attachment" that never uploaded; false demo caption); 7 demo-coupled behaviors skipped with reason (split-progress, paidParts, exit-confirm, formatPhone, camera dialog, roving tabindex, post-add focus).
- [x] **T2** — Port missing deltas into `CobrarDialog`/`cobro.css` (UI-only, theme vars, no new backend features).
  - Depends: T1. DONE 2026-10-04: 16 delta groups ported on theme vars (zero new hexes); `--warn-t` double-wrap bug fixed; keypad guarded by matchMedia feature check (no polyfill in repo).
- [x] **T3** — Extract `CobrarDialog` into NEW `frontend/src/components/CobrarDialog.jsx` (1081 lines) + `frontend/src/lib/cash.js` (round2/equalShare/newIdempotencyKey/accountLabel/parseAmount); cobro.css import moved into component; Caja.jsx net +4/−1006. Props unchanged `{open,onOpenChange,order,onPaid}`.
  - Depends: T2. DONE 2026-10-04: testids verified 26→26, none missing/added.
- [x] **T4** — Wire Caja: replace `OrderCollectionDialog` mount in `CajaWorkspace` with `CobrarDialog` (identical props; deep-link `?order=`, refetch onPaid, busy-lock preserved). OrderCollectionDialog file kept (still mounted by PedidoDetalle until T5).
  - Depends: T3. DONE 2026-10-04: targeted suites `CajaBranchSelection + OrdersCashUI` = 21/21 pass, identical to pre-change baseline (parent spot-check confirmed); `yarn build` compiled successfully; throwaway smoke suite drove real mount 3/3 then removed.
- [x] **T5** — Wire PedidoDetalle: mount `CobrarDialog` at `PedidoDetalle.jsx:401` preserving active-register pre-check, epoch guards, settle-remainder/table-release flow.
  - Depends: T3. DONE 2026-10-04 (writer B): import+mount swap only (+2/−2); guards/permissions/testids untouched. Deviation accepted: `PedidoDetalleCollection.test.js` tests 1–2 got +20 lines of new verify-gate interaction steps (submit → caja-verificar-check → caja-verificar-registrar + explicit cash recibido) — zero assertion/mock changes; parent spot-check re-ran trio: identical to baseline (21 tests, only the 2 pre-existing ChargeClose RED failures).
- [x] **T6** — Retire `OrderCollectionDialog`: removed from PedidoDetalle and DELETED the file (486 lines). Grep: zero code references; one historical comment remains in CajaPaymentProof.test.js (T7 will sweep). Build −4.21 kB gzip.
  - Depends: T4, T5. DONE 2026-10-04.
- [ ] **T7** — Un-skip and repair the 19 `CajaPaymentProof` tests against the wired `CobrarDialog`; fix structural mismatches (tests reference `caja-verificar-*` ids that only CobrarDialog has).
  - Depends: T3, T4.
- [ ] **T8** — Full green gate: cobro suites + entire frontend suite + `yarn build`.
  - Commands: see Verification. Depends: T5, T6, T7.
- [ ] **T9** — Work-unit commits (conventional, tests alongside behavior), record commit ids here; ask delivery strategy at commit boundary; push per repo policy.
  - Depends: T8.

## Verification (all tasks)

- Targeted (per writer): from `frontend/`:
  - `CI=true yarn test --watchAll=false --runInBand src/__tests__/CajaPaymentProof.test.js src/__tests__/PedidoDetalleCollection.test.js src/__tests__/PedidoDetalleChargeClose.test.js src/__tests__/OrdersCashUI.test.js`
- Full gate (T8):
  - `CI=true yarn test --watchAll=false --runInBand`
  - `yarn build`

## Progress / Evidence

- 2026-10-04: Repo synced to `origin/main` `451c7c2` (WIP preserved in `stash@{0}`). Feature doc + branch `feat/cobro-redesign-wiring` created. Exploration handoff complete: CobrarDialog dead-code confirmed by parent grep (Caja.jsx:85 definition vs :1812 old mount).
- 2026-10-04: **T1–T4 complete** (delegated writer A; parent spot-check `CajaBranchSelection+OrdersCashUI` 21/21 pass, `yarn build` ok). Runner note: `yarn` not on PATH — use `corepack yarn ...` from `frontend/`.
- Writer A notes for later tasks: skipped count in CajaPaymentProof is **18** (not 19). **T7 known blocker**: suite's `usePolling` mock matcher `'api.get(/cash/current)'` never matches `scopedGet` calls — relax to `includes('/cash/current')` (empirically verified). Text inputs need native value setter (React 19). **PedidoDetalleChargeClose.test.js (user's untracked file) fails 2/4 at baseline — pre-existing RED tests for unimplemented `pedido-cobrar-cerrar-button` feature; NOT caused by this work; do not "fix" by deleting.**
- 2026-10-04: **Unit 1 committed `490e514`** (T1–T4, 5 files, +1474/−1127, incl. feature doc). Native assess on `451c7c2..490e514 --committed-only`: risk **medium** (`executable_change`), 2601 changed lines, `review_due: slice_budget_reached`; lifecycle preflight STATUS returned terminal `stop(rdd_disabled)` — receipt-driven development is **off in this clone (clone_local; global on)**. Review outcome for unit 1: declined-by-switch (off-path). Verification off-path for medium: writer self-verification + parent spot-check (21/21 + build) = satisfied; `general` agent runs default model (not a small profile), so no separate verifier required. Untracked inventory declared excluded (`sha256:2ee772d6…`).
- Delivery: budget exceeded (2601 ≫ ~400, though ~2160 are moved/extraction lines). `ask-on-risk` → split-vs-`size:exception` question due at **push time (T9)**, with real per-commit counts.

## Next Step

Writer B for **T5–T6** (wire CobrarDialog into PedidoDetalle preserving register pre-check + epoch guards; retire OrderCollectionDialog). Then writer C for T7 (un-skip/repair 18 tests), T8 full gate, T9 commits/push with delivery decision.
