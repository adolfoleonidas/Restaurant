# Frontend core consolidation (audit stage 3)

## Objective and problem

The 2026-10-12 audit (Engram `audit/full-2026-10`) found the frontend mixing data fetching, state, and markup in giant pages (`Salon.jsx` 2625 lines, `CobrarDialog.jsx` 1152, `Caja.jsx` 1140), about 214 inline `api.*` calls with no per-resource API layer, and status labels, date formatting, and role checks duplicated across files. This stage creates one home for each concern and splits the giant pages, without changing what the user sees or does. Usability changes are stage 4 and build on this structure.

## Scope and authority

- Worktree: `C:/Users/adolf/Downloads/07_Proyectos-Codigo/Restaurant-worktrees/frontend-core`, branch `refactor/frontend-core`. Current base: `fix/production-blockers` = `origin/main` (`ec3c303`) + stage 1 fixes (`42bfbb9`). Runs in parallel with stage 2 (`refactor/backend-core`, backend only); no shared files.
- User authorized stage 3 and the parallel worktree in chat on 2026-10-12.
- Frontend only (`frontend/src`) plus this document. No backend changes.
- Behavior-preserving: same rendered text, same `data-testid`s, same API requests and payloads, same navigation. Any existing mismatch found is documented for stage 4, not fixed here. The new `origin/main` behavior (waiter/Salón work of PRs #80, #82, #84 and the financial integrity work of #77) is authoritative.
- `frontend/node_modules` is a junction to the main checkout's install. Do not install or modify packages.
- No push, PR, merge, deploy, or remote operation without a separate user decision.

## Redo on origin/main (2026-10-12)

Stage 3 was first done on a stale base (`3ec5fe9`; kept in branch `backup/refactor/frontend-core`). Meanwhile `origin/main` received the independent new orders, per-person ordering, single fixed kitchen-send action, card editing and kitchen review (Salón grew from 1890 to 2625 lines) and the cash KPIs / presets. The branch was reset to the new base and FC-01..FC-06 were re-achieved on the new code. Baseline on the new base: **62 suites / 440 tests passed**.

How each task was redone:

| Task | Approach | Conflicts |
|------|----------|-----------|
| FC-01, FC-02 | cherry-pick of the old commits | import lines in `Salon.jsx` and `Caja.jsx` (new `fmtTime`, `elapsedMinutes`), merged by hand |
| FC-03 | cherry-pick of the old module layer, then migration of the call sites the new code added | `Salon.jsx` (resolved on the new code), `useRestaurantFeatures`; new call sites in `useReadyDishes` and `OrderComposer` needed one new wrapper (`setOrderNotes`); five new test files needed their fetcher sniffers updated |
| FC-04 | redone by hand on the new `Salon.jsx`; the old extraction was only a reference design | the sheet hook, selectors and the detail components were rewritten for the new behavior |
| FC-05 | cherry-pick of the old extraction, then the new preset and KPI code ported by hand | `CobrarDialog` (cash presets, taken from the extracted version and re-ported), `Caja` (KPIs, "Ver" link and elapsed minutes ported into `CajaWorkspace` and a new `CajaKpis`) |
| FC-06 | cherry-pick of the old permissions work | `AppShell` (ready badge prop), `Salon` (container now reads `can`) |
| hook-deps fix | cherry-pick of the old fix | none |

## Implementation and checking

- Route: delegated direct, one bounded writer in this worktree.
- TDD: **on**, source: global user configuration. New modules get direct unit tests first (RED, then GREEN). Pure extractions are proven by the existing suite staying green; a characterization test is added first where an extracted behavior has no coverage.
- Frontend runner (from `frontend/`): `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4`. Build check: `npx craco build`.
- RDD: **off** (`clone_local`).

## Tasks

- [x] **FC-01 Shared status constants.** One `constants/status.js` for labels, colors and step order. Commit: 1279835.
- [x] **FC-02 Complete date and money formatting helpers.** `fmtDateFull`, `fmtDateTimeShort`, `fmtDayLabel` in `lib/format.js`; bypasses replaced. Commit: cc05f47.
- [x] **FC-03 Per-resource API modules.** `lib/api/*` wrappers; every inline `api.*` call migrated. Commit: 6fc859e.
- [x] **FC-04 Split `Salon.jsx`.** Hooks, selectors and presentational components under `pages/salon/`. Commits: 9c20668 (selectors and hooks), e0e76da (components and container).
- [x] **FC-05 Shared payment form for `CobrarDialog` and `Caja`.** `usePaymentForm`, `usePaymentProof`, `useOrderProof`, pure rules in `lib/paymentForm`, `components/cobro/*`; the Caja screen split into `pages/caja/*`. Commits: 67e7c86 (payment form), 3b17233 (Caja).
- [x] **FC-06 Single role and permission source.** `lib/permissions.js` (`can`, route roles, nav items). Commit: a49764d. Hook-dependency fix: 237c947.

## Progress and evidence

- FC-01 (cherry-pick). Conflicts only in the import lines of `Salon.jsx` and `Caja.jsx`. Full suite: 63 suites / 448 tests passed (`status.test.js` carries the RED/GREEN cycle of the first pass: it failed with `constants/status` absent).
- FC-02 (cherry-pick). Conflict in the `Caja.jsx` import line. `format.test.js` carries the old RED/GREEN evidence (3 of 5 failing before the helpers). Full suite: 64 suites / 453 tests.
- FC-03. The old module layer (`request`, `orders`, `tables`, `zones`, `branches`, `payments`, `cash`, `products`, `categories`, `users`, `restaurant`, `reports`, `auth`, `public`) was cherry-picked. The new code added three inline calls that had no wrapper or were not migrated: `GET /orders?active_only` in `useReadyDishes` (now `listOrders`), `PATCH /orders/:id/notes` in `OrderComposer` (new `setOrderNotes`; RED: `apiModules.test.js` row failed with the wrapper absent, then green) and the new `Salon` calls (alias, remove item, update item, add items). No `api.*` call is left outside `lib/api` (the only `@/lib/api` imports outside the layer are `API` in `NotifyContext` and `usePublicStream`). Five test files added upstream sniffed `usePolling` fetchers by source text (`api.get('/tables')`): `SalonComposerProto`, `SalonDetailView`, `SalonSheetParity`, `SalonFloorParity`, `AppShellReadyBadge`; updated to the wrapper names, keeping the legacy-tables exclusion. Full suite: 65 suites / 558 tests.
- FC-04. `Salon.jsx` 2652 -> 302 lines (2625 in the audit). TDD: `salonSelectors.test.js` (49), `useFloorView.test.js` (5), `useTableSheet.test.js` (36), `salonSheetActions.test.js` (9) were written first and observed failing with the module absent; `useBranchScope`, `useSalonData`, `useTableSelection`, `useVisitTransfer` and `useFloorActions` were reused from the old extraction with their tests (identical logic, tests RED with the modules absent, then green). The sheet hook is a verbatim move of the new handlers (independent new orders, per-person drafts, card renames, send review, mini player) and the markup was moved by line range; a check of every non-empty source line of the old JSX region against the new files found only the intended structural differences. New under `pages/salon/`: `selectors.js`, hooks `useBranchScope`, `useSalonData`, `useFloorView`, `useTableSheet`, `useTableSelection`, `useVisitTransfer`, `useFloorActions`, `sheetActions.js` (the "more actions" menu builder), and components `SalonHeader`, `JoinBar`, `FloorFilters`, `SalonAlerts`, `FloorGrid`, `PickupSections`, `TableSheet` (with `SheetHeader`, `PersonStrip`, `AccountCard`, `TableGroupPanel`, `TableHistory`, `SheetSummaryPanel`, `TableSummaryDialog`), `MoveVisitDialog`, `MoveAccountDialog`, `SendReviewDialog`, `MiniOrderBar`. Existing Salón suites (SalonComposerProto, SalonDetailView, SalonSheetParity, SalonFloorParity, SalonActiveOrderBar, SalonTableGroups, SalonBranchScope, Mesas*, Servicio*, NuevoPedidoInline, SalesAreas) stayed green after the container swap on the first run. Full suite after the hooks commit: 74 suites / 686 tests. Commits: 9c20668, e0e76da.
- FC-05. The old extraction was cherry-picked; the only upstream change inside `CobrarDialog` was the dynamic cash presets (`quickCash`, `handlePreset` taking soles, `caja-preset-*` test ids). Existing `CobrarDialogPresets.test.js` failed against the extraction (RED, 4 tests), as did the new `quickCashAmounts` rows in `paymentForm.test.js` and the updated `handlePreset(50)` row in `usePaymentForm.test.js` (8 failing in total); GREEN after `quickCashAmounts` in `lib/paymentForm.js`, the hook and `CashPanel`. `CajaWorkspace` received the day KPIs (`pages/caja/CajaKpis`), the day payments polling, the "Ver" link and the elapsed minutes; `CajaDayKpis.test.js` stays green. Full suite: 80 suites / 748 tests. Commits: 67e7c86, 3b17233.
- FC-06. Cherry-pick; `Salon.jsx` conflict resolved by applying the `can(user, ACTIONS.*)` lines to the new container, `AppShell` conflict resolved by keeping the ready badge props. The permissions test (old nav and old inline expressions as oracle, 64 users) passes unchanged. Full suite: 81 suites / 759 tests. Commit: a49764d. The final build showed the same `react-hooks/exhaustive-deps` warning in `CobrarDialog` as before; the old fix was cherry-picked (237c947) and the build compiles without warnings.

## Stage 4 findings

Carried over from the first pass; each was re-verified on the new code. Existing inconsistencies are preserved as they were and pinned by a test where noted.

Navigation vs. route guards (pinned in `permissions.test.js`; still true):

1. `/cocina`: the guard admits `mozo`, but the menu lists Cocina only for `cocina` and `admin` (or anyone with the `preparacion` function).
2. `/combos` and `/categorias`: guarded for `admin` with no menu entry by design.
3. `/usuarios`: the menu hides it from every non-admin role even with the `administracion` function, while the guard lets any user with that function open it by URL.
4. `/dashboard`: no role guard; `Dashboard.jsx` redirects `mozo`, `cocina` and `cajero` to their home.
5. `canAccessRole` admits any user with the `administracion` function to every guarded route; the menu grants only the entries listed for their roles and functions.

Behavior quirks:

6. Table sheet: `activeOrders` is keyed by table id, but the sheet looks accounts up by order id (`activeOrders[o.id] || o`), so the lookup always falls back to the account itself. Still true (kept in `selectSheetModel`; its comment says so). Re-verified.
7. Resolved upstream: the first send now toasts "Enviado a cocina · Mesa N" (pinned in `useTableSheet.test.js`); later sends still count the drafts with the response status and the pre-send items.
8. Owner checks are now one rule, `can(user, ACTIONS.OWNER)`. Re-verified.
9. `CobrarDialog` ships placeholder copy in `components/cobro/TransferPanel.jsx` ("Banco de muestra", "Sabor Peruano S.A.C."), and receipts default to the name "Sabor Peruano". Still true.
10. Payment state wording exists in four places with different text: `PAYMENT_STATE_LABELS` (centralized), `PAYMENT_STATE_INFO` in `Checkout.jsx`, `PREPAY_STATE_LABELS` in `pages/caja/PrepayQueue.jsx`, `ORDER_PAYMENT_LABELS` (centralized). Still true.
11. `TableQrActions.statusLabels` was left out of `constants/status.js`. Still true.
12. Source-text sniffing of `usePolling` fetchers by tests now touches 20 test files (15 in the first pass, 5 added upstream). A `label` option on `usePolling` would remove the coupling.
13. The audit's line counts were stale: at the old base `Salon.jsx` was 1890 lines; at the new base it is 2652, `CobrarDialog.jsx` 1152 and `Caja.jsx` 1140.
14. Intermittent timeouts under load were not observed in this pass (the suite was always run with `--maxWorkers=4`).
15. CRA's ESLint only runs the react-hooks rules, so unused imports and undefined identifiers are not reported by `craco build`; this stage was checked with a throwaway ESLint config (`no-undef`, `no-unused-vars`, `react/jsx-no-undef`) that found no undefined identifier in `src`. Unused-variable noise remains in tests and contexts (`CobrarDialogPresets`, `OrdersCashUI`, `PedidoTrackingAttention`, `SalonSheetParity`, `NotifyContext`, `ThemeContext`, `use-toast`, `usePublicStream`, `Reportes`' `Legend` import).

New findings from the redo:

16. Salón shows the "Cocina (n)" button to every role, including `cajero`, whose guard for `/cocina` rejects them (same family as finding 1).
17. Two pollers read the same live orders: `AppShell` polls `/orders?active_only=true` every 25 s through `useReadyDishes` for the ready-dish badge, and Salón polls the same list every 8 s.
18. `CajaWorkspace` polls `/payments?period=day&limit=200` every 12 s only to feed the KPIs.
19. `itemPending` in the old `Salon.jsx` was dead code (the tally now counts drafts through `isDraft`); it was not carried over to `selectors.js`.
20. `handlePreset` changed meaning upstream: it takes soles (it took cents before). The old and new values differ only in the unit; callers were updated together.
21. Opening a table with an account that has no items counts as a draft account (`isComposingDraft` is true for an empty list), so the menu opens by itself and Escape leaves the composer instead of closing the sheet.

## Final verification (2026-10-12)

- `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4`: 81 suites / 759 tests passed (baseline 62 / 440; no previously passing test changed except the fetcher-source sniffers listed under FC-03 and the `handlePreset` unit row listed under FC-05).
- `npx craco build`: Compiled successfully, no warnings.
- `git diff --check fix/production-blockers...HEAD`: clean.
- Line counts, before -> after: `pages/Salon.jsx` 2652 -> 302, `components/CobrarDialog.jsx` 1152 -> 465, `pages/Caja.jsx` 1140 -> 110 (`pages/caja/CajaWorkspace.jsx` 311).
- Commits: 1279835 (FC-01), cc05f47 (FC-02), 6fc859e (FC-03), 9c20668 and e0e76da (FC-04), 67e7c86 and 3b17233 (FC-05), a49764d (FC-06), 237c947 (hook dependency fix).

## Next step

Review the branch. Push, pull requests (one slice per task under `feature-branch-chain`) and merge are separate user decisions. Stage 4 starts from the findings above.
