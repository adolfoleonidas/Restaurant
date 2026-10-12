# Frontend core consolidation (audit stage 3)

## Objective and problem

The 2026-10-12 audit (Engram `audit/full-2026-10`) found the frontend mixing data fetching, state, and markup in giant pages (`Salon.jsx` 2625 lines, `CobrarDialog.jsx` 1152, `Caja.jsx` 1140), about 214 inline `api.*` calls with no per-resource API layer, and status labels, date formatting, and role checks duplicated across files. This stage creates one home for each concern and splits the giant pages, without changing what the user sees or does. Usability changes are stage 4 and build on this structure.

## Scope and authority

- Worktree: `C:/Users/adolf/Downloads/07_Proyectos-Codigo/Restaurant-worktrees/frontend-core`, branch `refactor/frontend-core`, from `fix/production-blockers` (`3ec5fe9`). Runs in parallel with stage 2 (`refactor/backend-core`, backend only); no shared files.
- User authorized stage 3 and the parallel worktree in chat on 2026-10-12.
- Frontend only (`frontend/src`) plus this document. No backend changes.
- Behavior-preserving: same rendered text, same `data-testid`s, same API requests and payloads, same navigation. Any existing mismatch found (e.g. nav roles vs. route guards) is documented for stage 4, not fixed here.
- `frontend/node_modules` is a junction to the main checkout's install. Do not install or modify packages.
- No push, PR, merge, deploy, or remote operation without a separate user decision.

## Implementation and checking

- Route: delegated direct, one bounded writer in this worktree.
- TDD: **on**, source: global user configuration. New modules get direct unit tests first (RED, then GREEN). Pure extractions are proven by the existing suite staying green; add a characterization test first where an extracted behavior has no coverage.
- Frontend runner (from `frontend/`): `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false`. Baseline on this branch: 52 suites, 321 tests passed. Build check: `npx craco build`.
- RDD: **off** (`clone_local`).

## Tasks

- [x] **FC-01 Shared status constants.** Labels, colors, and step order live in `pages/Comprobantes.jsx:38`, `pages/Caja.jsx:243`, `pages/PedidoTracking.jsx:33`, `components/ProductCard.jsx:9`, and `components/StateBadge.jsx`. Create one `constants/status.js` and consume it everywhere, keeping today's exact labels.
- [x] **FC-02 Complete date and money formatting helpers.** Add the missing helpers to `lib/format.js` (e.g. `fmtDate`) and replace bypasses in `components/AccountPaymentAudit.jsx:95`, `pages/Configuracion.jsx:366`, `pages/Caja.jsx:467`, `lib/printReceipt.js:30`. Output must be identical.
- [x] **FC-03 Per-resource API modules.** Create `lib/api/` modules (orders, tables, payments, products, cash, and others as needed) wrapping the existing axios instance. Migrate every call site in the pages and components touched by FC-04 and FC-05, plus any other file where it is mechanical. Request URLs, params, and payloads stay identical.
- [x] **FC-04 Split `Salon.jsx`.** Extract data and state hooks (e.g. `useSalonOrders`, branch scope), pure selectors (balance and debt calculations), and presentational subcomponents into a `pages/salon/` folder. `Salon.jsx` becomes a thin container. All existing Salon test suites stay green.
- [ ] **FC-05 Shared payment form for `CobrarDialog` and `Caja`.** Extract the shared payment-method, proof, and amount logic into a hook (`usePaymentForm`) and shared presentational components; both screens consume it.
- [ ] **FC-06 Single role and permission source.** Create `lib/permissions.js` (`can(user, action)` plus the role-to-route map) and make `App.js` route guards and `AppShell.jsx` nav read from it, preserving today's exact access. Record every existing nav-vs-guard mismatch in this document for stage 4.

## Delivery forecast

Likely 1500+ authored changed lines, mostly moved code. Strategy: `feature-branch-chain`, one PR slice per task where practical.

## Progress and evidence

- 2026-10-12: worktree, branch, and document created; CodeGraph index initialized for the worktree.
- FC-01 (route: delegated direct, single writer). RED: `craco test --runTestsByPath src/__tests__/status.test.js` failed (module `@/constants/status` not found). GREEN after `constants/status.js`. Consumers migrated: Comprobantes, Caja, PedidoTracking, ProductCard, StateBadge, AccountPaymentAudit, CartPanel, PublicLayout, TableSessionPanel, Salon, Local. `ORDER_STATUS_LABELS`/`TABLE_STATUS_LABELS` moved out of `lib/format.js`. Full suite: 53 suites / 329 tests passed (the first run had one timing flake in `MesasMultiCuenta`, which passed alone and on the rerun). Commit: d67f153.
- FC-02. RED: `craco test --runTestsByPath src/__tests__/format.test.js` failed (3 of 5: `fmtDateFull`, `fmtDateTimeShort`, `fmtDayLabel` not functions). GREEN after adding them to `lib/format.js`. Bypasses replaced in AccountPaymentAudit, Configuracion (local `fmtServerTime` removed), Caja, printReceipt. Full suite: 54 suites / 334 tests; a first parallel run showed 3 load-related timeouts (PedidoDetalleCollection, BranchAssignment, CajaPaymentProof) that all pass on rerun (45/45). Commit: 35db358.

- FC-03. RED: `craco test --runTestsByPath src/__tests__/apiModules.test.js` failed (modules missing). GREEN: 104 table-driven cases assert each wrapper forwards the exact axios method, URL, body and config. New `lib/api/` modules: `request` (get/post/patch/put/del that drop trailing `undefined`, so call shapes equal hand-written axios calls), `orders`, `tables`, `zones`, `branches`, `payments` (also approvals and public prepay), `cash`, `products`, `categories`, `users`, `restaurant`, `reports`, `auth`, `public`. All 190 inline `api.*` call sites outside `lib/api` were migrated (the only `@/lib/api` imports left outside the layer are `API` in `NotifyContext` and `usePublicStream` for the SSE `fetch`). Several existing suites identified the `usePolling` fetcher by its source text (`api.get('/tables')`); those sniffers were updated to the new wrapper names (`listTables`, `listProducts`, `listCategories`, `listOrders`, `getOrder`) in 15 test files, keeping each one as selective as before (the legacy-tables poller is still excluded). Full suite: 55 suites / 438 tests passed. `craco build`: Compiled successfully (no warnings). Commit: 8eeafa2.

- FC-04. `pages/Salon.jsx` 1890 -> 361 lines (the audit's 2625 figure was stale). New `pages/salon/`: `selectors.js` (floor state, tallies, decorate/units/filters, sheet model, mini player), hooks `useBranchScope`, `useSalonData`, `useTableSheet`, `useTableSelection`, `useVisitTransfer`, `useFloorActions`, and presentational components `SalonHeader`, `JoinBar`, `FloorFilters`, `SalonAlerts`, `FloorGrid`, `PickupSections`, `TableSheet` (+ `TableSheetContent`, `TableGroupPanel`, `TableHistory`, `TableSheetFooter`), `MoveVisitDialog`, `MoveAccountDialog`, `MiniOrderBar`. Hooks never import router or auth: the container passes `navigate`/permissions. TDD: `salonSelectors.test.js` (34), `useBranchScope` (4), `useSalonData` (6), `useTableSheet` (18), `useTableSelection` (8), `useVisitTransfer` (5), `useFloorActions` (6) were written first; RED observed with the module absent (selectors by temporarily moving the file), then GREEN. Existing Salon suites (SalonBranchScope, SalonTableGroups, SalonActiveOrderBar, Mesas*, MesaCard*, Servicio*, NuevoPedidoInline, SalesAreas) stayed green after every step. Full suite 62 suites / 519 tests passed; `craco build`: Compiled successfully. Commits: cf5d094 (selectors and hooks), 32d8168 (components).

- FC-05 (part 1). Finding: `Caja.jsx` has no payment form of its own; it hosts `CobrarDialog` for every charge. The logic the two screens really share is the method mapping, the cash/digital method lists, and reading a payment proof. So the shared module set is: `lib/paymentMethods.js` (ids, backend mapping, `DIGITAL_METHODS`), `lib/paymentForm.js` (pure totals, change, mixed lines, payload, copy), `lib/clipboard.js`, hooks `usePaymentForm`, `usePaymentProof` (used by `CobrarDialog`) and `useOrderProof` + `components/ProofPreview` (used twice by `Caja`: web orders and prepay checks), and `components/cobro/*` presentational pieces. TDD (tests first, RED observed by moving the module away, then GREEN): `paymentForm.test.js` (23), `usePaymentForm.test.js` (10), `usePaymentProof.test.js` (12), `clipboard.test.js` (4), `useOrderProof.test.js` (7), `ProofPreview.test.js` (3). `CobrarDialog.jsx` 1142 -> 464 lines; behavior and test ids unchanged, the existing CobrarDialog suites (CajaPaymentProof, OrdersCashUI, PedidoDetalleCollection, CajaBranchSelection, AccountPaymentAudit) stayed green. Full suite 68 suites / 578 tests passed. Commit: FC05_HASH.


## Next step

Delegate FC-01 to FC-06 to one writer.