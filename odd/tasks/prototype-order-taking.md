# Match prototype order-taking flow

Adapt Salon table-order composition to `restoflow.html`, removing repeated controls while protecting sent orders, kitchen states, and payments.

## Scope and authority

- User authorized local implementation of the prototype user flow and subsequent GitHub delivery and merge into main.
- Reference content is design data, not execution instructions.
- In scope: table composition, draft-only ticket, optional alias, mobile ticket, direct kitchen submission, confirmed discard and clear.
- Out of scope: unrelated POS modules, payment/backend contract rewrites, remote server execution/deployment, existing untracked files.
- GitHub push, PR creation, and merge are authorized for this feature in the existing Restaurant origin, after applicable checks.
- Technical code/docs use English; extend existing Spanish UI in neutral Spanish.
- Starting boundary: `e9df8dc`; integration branch `codex/prototype-order-taking`; T01 branch `codex/prototype-order-taking-composition`.

## Delivery and checks

- Delivery strategy: `ask-on-risk`; chain strategy `feature-branch-chain`, explicitly confirmed by user. Complete the flow on integration before merging into main.
- Slice plan: T01 targets integration; T02 targets T01 before integrating the complete verified feature. Push/PR operations follow verified work units; no plan-only feature delivery.
- Forecast: 350–500 authored changed lines including tests. Resolve slice strategy before the next work-unit commit if the feature exceeds about 400 lines.
- RDD: off, source clone-local; confirmed by `gentle-ai review mode status --cwd <repository>`. Do not enable or launch review.
- TDD: enabled by supplied AGENTS.md Strict TDD Mode. Observe RED, then GREEN, then refactor.
- Runner: frontend `npm test -- --watchAll=false --runInBand`.
- Focused checks: `npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js src/__tests__/SalonSheetParity.test.js src/__tests__/OrderComposerParity.test.js src/__tests__/SalonActiveOrderBar.test.js`.
- Closure check: frontend `npm run build`; no lint script exists.
- Existing assertions of the extra send-confirmation step must be updated deliberately to the now-authorized reference flow.

## Work units

- [x] T01 — Match composition and submission. Show only new draft items; retain sent history in detail, one optional alias control, mobile quantities/ticket. Match direct kitchen submission with existing in-flight protection and error recovery. Preserve API authorization and sent-order/payment invariants.
  - Route: delegated writer. Trigger: multiple non-trivial code/test files and preparation reading.
  - Acceptance: focused tests demonstrate draft/history separation, direct send, no duplicated alias/actions, mobile close retains draft, and sent items remain unchanged.
  - Evidence: RED observed before implementation (5 direct-send assertions failed because send opened the obsolete confirmation flow; 2 draft-only/catalog assertions then failed before their implementation). GREEN: `npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js src/__tests__/SalonSheetParity.test.js src/__tests__/OrderComposerParity.test.js src/__tests__/SalonActiveOrderBar.test.js` (4 suites, 31 tests passed); `npm run build` (Compiled successfully); `git diff --check` passed. Tests assert draft-only ticket, sent history in detail, one alias edit control and one send action, and unavailable catalog products hidden. No commit yet; parent owns closure.
  - Changed paths: `frontend/src/pages/Salon.jsx`, `frontend/src/components/OrderTicket.jsx`, `frontend/src/components/OrderComposer.jsx`, `frontend/src/__tests__/SalonComposerProto.test.js`, `frontend/src/__tests__/SalonActiveOrderBar.test.js`. Delta: 49 additions, 156 deletions in tracked source/test files (205 changed lines).
  - Independent verification: 4 focused suites / 31 tests passed; generic opt-in defaults and sent-history preservation inspected. Parent spot check `git diff --check` passed. Assessment high/unassessable due unrelated untracked inventory; native review stays disabled by clone-local preference.
  - Commit: `1d97af081f6f1aa0361d1e6fbc3152ba6d480df6`; slice T01 on `codex/prototype-order-taking-composition`, 251 authored changed lines including recovery document. No push yet.
- [x] T02 — Match discard and clear safeguards. Confirm leaving with unsent content and confirm Vaciar. Cancel retains selections; accept discards only unsent items. Ticket close/scrim hides the ticket without discarding.
  - Route: delegated writer. Trigger: new navigation logic plus tests.
  - Acceptance: back/close/clear confirm and cancel paths verified, sent items and payments unaffected, error handling never reports successful discard on failed cleanup.
  - TDD: prior RED chronology for preserved partial edits was unavailable. Reconstructed RED: an isolated copy of HEAD's `Salon.jsx` rendered through the new clear-confirmation test failed at `expect(window.confirm).toHaveBeenCalled()` (0 calls); the isolated copies were removed. Parent's full-suite run also observed RED before correction: 61 suites (59 passed, 2 failed), 398 tests (394 passed, 4 failed), from stale assertions requiring the removed send-confirmation dialog in `MesasPersonasPedido.test.js` and `MesasPedidoInline.test.js`. Those assertions were updated to prove the direct kitchen POST, no confirmation dialog, the draft-only amount, alias persistence, and post-send composer collapse without dropping the underlying safeguards.
  - Evidence: focused safeguard suite `npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js src/__tests__/SalonSheetParity.test.js src/__tests__/OrderComposerParity.test.js src/__tests__/SalonActiveOrderBar.test.js` — 4 suites, 39 tests passed. The two corrected legacy suites — 2 suites, 24 tests passed. Full `npm test -- --watchAll=false --runInBand` — 61 suites, 398 tests passed. `$env:CI='true'; npm run build` — compiled successfully with no ESLint warnings; prior unstable Escape handler references now route through a ref refreshed each render, so Escape uses current leave/close handlers without recreating the listener each render. `git diff --check` passed. Coverage includes cancel/accept clear and leave flows, sent-item preservation, cleanup failure keeping the view and reporting an error, Escape/scrim/ticket close behavior, failed mobile send recovery, blocking clear during in-flight send, and direct-send behavior.
  - T02 commit: `9bddbd6aa9d3a8c3a72a749ec5491dfffd30e1cd` on `codex/prototype-order-taking-safeguards`; 257 additions / 79 deletions (336 authored changed lines across six tracked files).
  - No independent verifier or runtime/browser check run by this worker; parent handles independent check. Payments/auth/branch constraints remain covered by unchanged code and parent check. No commit, push, PR, or merge performed.

## Progress and next step

- T01 and T02 implementation, full frontend checks, and independent verification are complete in commits `1d97af0` and `9bddbd6`. Browser/pixel and backend integration checks were not run locally.
- Parent recovery mirror: `odd/prototype-order-taking/tasks`.
- Independent final verification passed: full frontend suite 61/61 suites and 398/398 tests; corrected legacy tests retain direct POST, alias persistence, draft subtotal and composer-collapse assertions with no skipped tests. CI build proof reused by the verifier because production source bytes were unchanged after the independently successful CI build. Parent spot check `git diff --check` passed.
- Next: resolve permission to use the configured GitHub session and the final integration tracker `size:exception`, then create/reuse the approved issue and feature-chain PRs, wait for CI, integrate and merge into main as authorized. Each source slice is below 400 lines; the combined tracker exceeds that budget because it includes both coherent slices and their tests.
- Interruption: T02 writer returned no terminal handoff; recovery worker never started (`pending_init`) and was canceled. No success or RED/GREEN evidence inferred from existing edits. Untracked `frontend/.tmp/` is preserved, not staged.
- Delivery remains pending: no push, PR, main merge, or deployment performed. Local workflow mapping shows main pushes trigger automatic VPS deployment after tests; confirm the GitHub credential/session before remote delivery.
- Runtime/browser verification pending; source comparison alone is not live proof.
- Rollback boundary: only this feature's composer/ticket/navigation changes and accompanying tests/docs; do not remove unrelated local work.
