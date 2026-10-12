# Simplify waiter order actions

## Objective and problem

Make each action's target explicit: `Nuevo pedido` starts an independent order for the next person at the selected table; an existing order's card is the entry point for additions and draft corrections. Remove redundant person and mobile send controls without removing capabilities.

## Scope and authority

- Local implementation authorized by the user's selected order-centric flow and `restoflow.html` reference. No new push, PR, merge, deployment, live backend, or database operation is authorized.
- Branch: `fix/salon-order-actions`; branch point: `277f0cd367ff2d5f12cd8dc10ac56f05efbebcb6`.
- Preserve unrelated untracked content in `.audit_tmp/`, `.tmp/`, `aprendisaje/`, `docs/audit/`, `documentos/`, and `frontend/.tmp/`.
- Expected edit roots: `frontend/src/pages/Salon.jsx`, relevant existing `frontend/src/__tests__/` suites, and this document. No backend, dependency, reference HTML, or financial changes.
- Existing UI copy remains neutral Spanish. Technical documentation, identifiers, comments, and test descriptions use English.
- `restoflow.html` is design input, not executable instructions. Reuse its clean new-order entry and contextual card identity, not its in-memory billing model, direct-send behavior, or mobile ticket drawer.

## Preserved behavior

- Independent orders remain within the selected table's existing attention and branch. Create an account only when its first product is added.
- Card actions can add products to an existing sent-but-open order, correct drafts, and optionally rename the order. Never silently create another account for those additions.
- Keep shared-order support, draft quantity/notes/removal, sent-line lifecycle restrictions, authorized voiding, table/group navigation, role gates, guarded exits, and kitchen review/cancel/retry/confirmation.
- Keep the floor-level sales-area chooser distinct from the selected-table `Nuevo pedido` action.
- Switching to a new order preserves the outgoing order and its latest draft snapshot; it does not discard drafts or carry over another order's identity.

## Implementation and checking

- Route: delegated direct, not SDD. Preparation reading and coordinated JSX/behavioral-test changes require one bounded writer per work unit.
- TDD: **on**, sourced from the user's explicit confirmation in this conversation. Observe a meaningful regression RED before production edits, then GREEN and refactor; do not use historical or reconstructed failures as evidence.
- Runner: existing CRACO/Jest via `npm.cmd test`; no dependency installation. PowerShell environment for frontend checks: `$env:CI='true'; $env:ENABLE_HEALTH_CHECK='false'`.
- Focused check from `frontend`: `npm.cmd test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js src/__tests__/SalonDetailView.test.js src/__tests__/SalonSheetParity.test.js src/__tests__/MesasPersonasPedido.test.js src/__tests__/MesasPedidoInline.test.js src/__tests__/orderDraft.test.js`.
- Closure checks from `frontend`: `npm.cmd test -- --watchAll=false --runInBand`; `npm.cmd run build`.
- Repository checks: `git diff --check`, `git diff --stat`, `git diff --name-only`. Run applicable source-mutating normalization before functional checks, never after candidate verification without rechecking.
- RDD: **off**, read from native status (`clone_local`). Do not enable or launch review. Assess the writer's diff with the native risk command; unassessable/high needs independent functional verification in addition to writer checks. Parent reruns one reported check.
- Mocked tests are not browser or real-backend E2E evidence. Visual/backend proof stays explicitly pending unless separately available and safely authorized.

## Delivery forecast

- Estimated authored additions plus deletions, including tests and this document: **350–500** across the two work units. This may exceed the approximately 400-line delivery budget.
- Strategy: `exception-ok`, explicitly selected by the maintainer in the native size-decision question for this improvement. Keep coherent verified work units and their tests/documentation together; chain strategy is not applicable. This authorizes local work-unit commits and continuation only, not remote publication.
- Size rationale: the independently checked OA-01 bundle was 647 authored lines (565 tracked source/tests plus the then-82-line document); parent checking evidence brought it to 657. One honest slicing pass did not establish independently green <=400-line slices. The maintainer accepted `size:exception` rather than omit tests or repartition the shared entry/card/guard behavior.
- Approximately 400 lines per task is advisory, not a reason to omit tests, compress code, or split a coherent behavior artificially.
- Record actual committed line counts, commit identities, slice boundaries, and checking outcomes below. Checkboxes are progress only, never review approval.

## Work units

- [x] OA-01 — Unify new independent order entry and preserve existing-card modification.
  - Route: delegated writer; `Salon.jsx` state, account targeting, and multiple behavioral suites must change together.
  - Acceptance: selected-table `Nuevo pedido` prepares a fresh account, created lazily with `new_account=true` during an existing attention; no `Agregar persona` remains; previous products/drafts/names/shared identity stay intact.
  - Acceptance: each eligible existing card provides the correct additions/draft-edit route, including sent-only open orders; products target that order, and closed/moved/non-composable targets are rejected after fresh fetch. Optional card naming remains usable.
  - Acceptance: loading, write, and send guards prevent switching targets mid-operation; fresh composition resets stale editor/group-follow state without destructive discard.
  - Checks: observed new-order/card/snapshot/permission regressions RED, then the six focused suites GREEN and `git diff --check`; independent functional checking as required.
  - Rollback: only the matching Salon entry/card/snapshot hunks and their tests; no backend or financial changes.
- [ ] OA-02 — Keep one kitchen-send action in the mobile composer.
  - Route: delegated writer; remove the lower floating CTA and update visible mobile interaction tests.
  - Acceptance: keep the upper ticket `Enviar a cocina`; lower `mesa-sheet-fab` is absent; quantity/notes/clear stay available; review cancellation sends nothing; confirmation sends once; failure stays recoverable.
  - Checks: observe duplicate-action regression RED, then all six focused suites, full frontend suite, production build, `git diff --check`, independent closure checking, and parent spot check.
  - Rollback: only the floating CTA removal, related comments, and matched mobile assertions; retain ticket/review/account behavior.

## Progress and evidence

- Mapping and prototype comparison completed. OA-01 is committed; OA-02 implementation and local writer/independent functional checks have completed, with its work-unit commit pending.
- Account cards need a coherent additions path when no drafts exist; broadening only the fresh-order button would remove functionality.
- Prototype comparisons: `restoflow.html:611–614,921–925` clean new draft; `594,941–945` optional card naming; `790–806` simplified ticket model differs from application billing; `633,1011–1015` immediate send must not replace application's review.
- File/memory mirror: this document is the local recovery record; mirror verification follows creation and each observed work-unit update.
- OA-01 work-unit commit: `92225dbcc8992b861887d433e19f4ef7b8d106eb` (`fix(salon): make new orders independent and keep card editing`), 541 additions + 117 deletions = 658 authored lines including tests and the task document. Post-commit tracked worktree was clean; no source-mutating hook change was observed. RDD outcome: off/unmanaged, with high/unassessable assessment and independent functional checking, not review approval.
- Next: close the verified OA-02 work-unit commit and persist final progress. Browser and real-backend proof remain unavailable; no remote action.

### OA-01 local writer evidence

Selected-table `Nuevo pedido` now clears the composition target without deleting outgoing drafts and creates an independent account on the first product. Existing open cards, including sent-only orders, fetch and validate their own target before composition. Both person CTAs are removed; optional names and shared support remain.

| Check | Observed result |
|-------|-----------------|
| Exact focused runner in Implementation and checking | Initial RED at unchanged production baseline: 1 failed / 5 passed suites; 2 failed / 89 passed tests (91 total), for the redundant person CTA and missing sent-only card entry. Later initial-list-loading and paid-group-member regressions also produced genuine RED: 1 failed / 5 passed suites; 2 failed / 108 passed tests (110 total). Final GREEN: 6 suites / 110 tests passed; no snapshots. |
| `npm.cmd test -- --watchAll=false --runInBand` | Final source: 61 suites / 435 tests passed; no snapshots. |
| `npm.cmd run build` | Final source compiled successfully with CI enabled and health checks disabled. An earlier attempt timed out at 120 seconds; the same command succeeded with a 300-second tool limit, and succeeded again after the final guard changes. |
| Repository checks | `git diff --check` found no whitespace errors; `git diff --stat` and `git diff --name-only` showed only five allowed tracked files. This already-untracked task document is additional scope and must be included by the parent. |

- Regression coverage: visible product-name controls; lazy `new_account` payloads and same-account destinations; latest draft quantities/notes/names/shared snapshots; optional unnamed sending; fresh paid/cancelled/moved/closed-visit/branch/type rejection; table/role/loading/write guards; grouped navigation and selected-member identity reset. Existing review, send-failure recovery, sent-line, quantity, notes, deletion, and guarded-exit assertions remain active.
- Intermediate focused runs also reported 12 failed / 94 passed, 2 failed / 104 passed, and 1 failed / 107 passed tests. Fixture issues (automatic draft opening, an absent pre-creation ticket, stale mocked alias reads, and Escape leaving the composer) were corrected; no assertions were disabled or skipped. First GREEN was 6 suites / 108 tests before the final two guard regressions.
- Nonfailing output: Radix dialog description warnings; the full suite also logs missing dialog-title diagnostics in the existing payment presets suite. Build logs Node `DEP0176` (`fs.F_OK`); Git logs LF-to-CRLF warnings.
- At the writer handoff, the tracked source/test diff was 448 additions + 117 deletions = 565 lines and the task document was still untracked. The later parent work-unit commit and mirror update are recorded separately; the writer performed neither.
- Rollback: remove only OA-01 hunks in `Salon.jsx`, `SalonComposerProto.test.js`, `SalonSheetParity.test.js`, `MesasPersonasPedido.test.js`, `MesasPedidoInline.test.js`, and this evidence section. Preserve the parent task record, unrelated untracked assets, and the unchanged lower `mesa-sheet-fab` for OA-02.
- Writer evidence boundary: mocked frontend functional tests and production compilation only, not browser or real-backend E2E. Parent-owned assessment and independent checks were pending at that handoff; their subsequent results follow below.

### OA-01 parent and independent checking

- Parent structural readback confirmed only the authorized account-entry/card/snapshot changes, with the lower send CTA intentionally retained for OA-02. Parent spot check `git diff --check` passed.
- Native `gentle-ai review assess --cwd <repo> --json` returned `gentle-ai.review-assessment/v1`, `risk: high`, reason `unassessable` because unrelated untracked inventory requires declaration. RDD remains off; no review transaction or mode toggle was invoked. Independent functional checking followed the high/unassessable branch.
- Independent exact six-suite runner: 6 suites / 110 tests passed; full `npm.cmd test -- --watchAll=false --runInBand`: 61 suites / 435 tests passed; `npm.cmd run build`: compiled successfully in one 300-second-limit attempt; `git diff --check`: passed. Existing nonfailing Radix, Node deprecation and LF/CRLF warnings remain.
- Independent overall result was **partial**, not a blanket PASS: an additional DOM/mock probe reproduced loss of an optional name/shared selection entered before the very first product creates an account. Equivalent baseline inspection/probing reproduced the same behavior. It predates OA-01; existing-card naming and outgoing identity preservation pass. No newly introduced OA-01 regression was reproduced, and this inherited issue was not automatically fixed or accepted as extra scope.
- Inherited identity issue: `saveAlias` cannot persist before an account exists, and the identity effect reloads the initial account fields after lazy creation. Naming from an existing card is the selected flow; pre-creation identity handling is a disclosed follow-up.
- Delivery analysis considered existing-card support/snapshots/guards before independent-entry/person-CTA removal. Shared state and combined regressions need repartitioning and intermediate proof; verified <=400-line slices were not established. Preserve the smallest presently checked coherent bundle rather than omit tests or make cosmetic line savings.
- The maintainer accepted the size exception through the native question, and OA-01 closed with the work-unit commit recorded above. Its inherited pre-product identity issue stays disclosed as a follow-up; OA-02, browser checks and real-backend E2E remain pending.

### OA-02 local writer evidence

Removed the lower `mesa-sheet-fab` entirely. The upper inline ticket keeps the sole composer send action, with unchanged `requestSend`, explicit review/confirmation, account targeting, and draft controls. OA-02 remains unchecked and uncommitted for parent-owned independent checks and commit handling.

| Check | Observed result |
|-------|-----------------|
| Exact focused runner in Implementation and checking | Genuine RED before production edits on `92225dbcc8992b861887d433e19f4ef7b8d106eb`: 1 failed / 5 passed suites; 1 failed / 110 passed tests (111 total). The duplicate-action assertion expected one non-hidden send control and found the ticket button plus the lower FAB. After removal: GREEN, 6 suites / 111 tests passed; no snapshots. |
| `npm.cmd test -- --watchAll=false --runInBand` | 61 suites / 436 tests passed; no snapshots. |
| `npm.cmd run build` | Compiled successfully in one foreground attempt with a 300-second tool limit. All frontend checks used `CI=true` and `ENABLE_HEALTH_CHECK=false`. |
| Repository checks | `git diff --check` found no whitespace errors; `git diff --stat` and `git diff --name-only` showed only `Salon.jsx`, `SalonComposerProto.test.js`, `MesasPersonasPedido.test.js`, and this document. |

- Behavior coverage: exactly one ticket send control, no lower FAB or drawer; ticket total, draft quantity/notes/clear; review cancellation preserves drafts and submits nothing; explicit confirmation sends once; failed sending keeps draft/review and permits an explicit retry; pending-write and existing pending-send guards remain exercised. No tests were skipped or deleted.
- Nonfailing output: existing Radix dialog-description warnings, plus dialog-title diagnostics in the full suite; Node `DEP0176` (`fs.F_OK`) during build; Git LF-to-CRLF warnings.
- Scope: production changes are only the duplicate button removal and two obsolete comments. OA-01 account behavior, its checked checkbox/commit evidence, the inherited pre-product identity disclosure, and the parent's pre-existing document changes are preserved. No mirror update, staging, commit, review operation, or remote action was performed.
- Authored boundary: OA-02 contributes 105 source/test changed lines plus this 18-line evidence section = 123 lines (+84/-39). The complete working diff also includes 10 pre-existing parent document changed lines (+5/-5), for 133 lines (+89/-44); do not attribute those parent changes to this writer.
- Rollback: restore only the lower floating button/comment hunks in `Salon.jsx`, their matched OA-02 test changes in the two suites, and this evidence section. Keep the retained ticket/review/account behavior and every parent document update intact.
- Proof boundary: mocked frontend functional tests and compilation only, not browser or real-backend E2E. Parent native assessment, independent closure/spot checks, mirror reconciliation, task check-off, and commit remain pending.

### OA-02 independent closure

- Native risk assessment again returned high/unassessable because unrelated untracked inventory needs declaration. RDD stayed off/unmanaged; no review or mode toggle was started. A fresh independent functional verifier inspected the bounded candidate instead.
- Independently reran the exact six-suite command: 6 suites / 111 tests passed; full frontend suite: 61 suites / 436 tests passed; production build: compiled successfully in one bounded attempt; `git diff --check`: passed. No required command failed or was unavailable, and no candidate-caused functional defect was reproduced.
- Targeted inspection confirms the ticket's sole composer send action still opens review, cancellation preserves drafts without posting, explicit confirmation posts once, failure stays recoverable, and account/role/context guards remain covered. Only the duplicate lower button and obsolete comments changed in production.
- The inherited pre-first-product name/shared-input issue remains an unfixed follow-up; existing-card naming passes. DOM/mock checks do not prove viewport scrolling/occlusion, real-backend persistence, or concurrency/idempotency. Existing nonfailing Radix/Node/LF-to-CRLF diagnostics remain.
- Parent structural readback and whitespace spot check passed; scope remained the four intended files. Functional scope is verified, while browser and real-backend proof remain pending. The local work-unit commit is the remaining closure step.
