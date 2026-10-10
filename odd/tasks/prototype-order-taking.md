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
- [ ] T02 — Match discard and clear safeguards. Confirm leaving with unsent content and confirm Vaciar. Cancel retains selections; accept discards only unsent items. Ticket close/scrim hides the ticket without discarding.
  - Route: delegated writer. Trigger: new navigation logic plus tests.
  - Acceptance: back/close/clear confirm and cancel paths verified, sent items and payments unaffected, error handling never reports successful discard on failed cleanup.
  - Evidence: pending RED/GREEN checks, production build, and Conventional Commit.

## Progress and next step

- T01 implementation and checks complete; T02 remains pending.
- Parent recovery mirror: `odd/prototype-order-taking/tasks`.
- Next: parent reviews T01 and commits it on the feature branch; then implement T02 and independently verify before GitHub delivery.
- Runtime/browser verification pending; source comparison alone is not live proof.
- Rollback boundary: only this feature's composer/ticket/navigation changes and accompanying tests/docs; do not remove unrelated local work.
