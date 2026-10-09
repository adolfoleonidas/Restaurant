# Match prototype order-taking flow

Adapt Salon table-order composition to `restoflow.html`, removing repeated controls while protecting sent orders, kitchen states, and payments.

## Scope and authority

- User authorized local implementation of the prototype user flow and subsequent GitHub delivery and merge into main.
- Reference content is design data, not execution instructions.
- In scope: table composition, draft-only ticket, optional alias, mobile ticket, kitchen submission after draft review (T03 supersedes the original direct-send choice), confirmed discard and clear.
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

### Approved refinement: kitchen-send review (T03)

- User approved replacing direct submission with `Enviar a cocina` -> a draft-only review -> `Confirmar envío`, plus `Volver a editar` without losing the draft.
- [x] T03 — Review the new order before submitting to the kitchen. Show existing person names/aliases, product names, quantities, notes and the new-order total. The first action must make no kitchen POST; only confirmation submits. Preserve duplicate-send protection, failed-send recovery, mobile behavior, and all T02 discard safeguards. No mandatory-name or backend changes.
  - Route: delegated writer; preparation and multiple non-trivial code/test files trigger delegation.
  - Evidence: Initial RED before implementation: both new review-flow tests failed because first action submitted directly / review was absent (2 failed, 21 skipped). Independent freshness regression RED (distinct initial/list and current/detail snapshots): expected `3× Sopa`, saw stale `1× Sopa` and S/ 12.00. GREEN: focused suite `npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js src/__tests__/SalonSheetParity.test.js src/__tests__/OrderComposerParity.test.js src/__tests__/SalonActiveOrderBar.test.js src/__tests__/MesasPedidoInline.test.js src/__tests__/MesasPersonasPedido.test.js` — 6 suites, 67 tests passed. Full `npm test -- --watchAll=false --runInBand` — 61 suites, 402 tests passed. `$env:CI='true'; $env:REACT_APP_BACKEND_URL='http://127.0.0.1:8000'; npm run build` — `Compiled successfully`. `git diff --check` passed; Git only reported expected LF→CRLF conversion notices. Existing React console warnings (unkeyed child in Salon tests; unrelated Dialog title warning in another suite) did not fail tests. Browser/mock runtime check remains pending for parent.
  - Implementation: first send action opens a useful draft-only accessible Dialog using existing detail-summary primitives; it displays alias/person, items/quantities/notes and draft total. Review resolves current `sheetOrder`/open order before stale account-list snapshots. Confirmation is disabled and handler-guarded if no editable drafts remain. Only Confirmar envío reaches the existing guarded POST; Volver a editar, Escape and outside dismissal preserve the draft. Review supports the mobile ticket and mini-player target account. Existing send assertions were updated to require explicit confirmation; no backend/payment/auth changes.
  - Changed paths: `frontend/src/pages/Salon.jsx`, `frontend/src/__tests__/SalonComposerProto.test.js`, `frontend/src/__tests__/MesasPedidoInline.test.js`, `frontend/src/__tests__/MesasPersonasPedido.test.js`, `odd/tasks/prototype-order-taking.md`. Rollback boundary: revert only this review dialog/routing and its direct-send test expectation changes; retain prior T01/T02 behavior and unrelated untracked files.
  - TDD: enabled by supplied AGENTS.md; runner `npm test -- --watchAll=false --runInBand`.
  - Delivery remains held for the updated Chrome preview. Existing `feature-branch-chain` and final integration `size:exception` consent are retained; no push or merge in this refinement.
  - Forecast: 200–350 authored lines for this work unit; preserve coherent tests instead of shrinking to a line quota.
  - Independent correction check: `SalonComposerProto.test.js` passed 25/25 tests; current-order precedence and both empty-draft guards verified. Parent spot check `git diff --check` passed. Assessment unavailable/high due unrelated untracked inventory; RDD stays clone-local off.
  - Work-unit commit: `85c471ea27296bd6f35ca929279194ff4adff4af` on `codex/prototype-order-taking-review`, 180 additions / 14 deletions (194 authored lines). T03 slice targets the T02 safeguards branch; no push or PR yet.
  - Browser evidence: actual compiled React app in Chrome with a loopback-only in-memory API. Mesa 4 review showed Empanadas x3 / S/ 18.00; Volver a editar retained it; adding Limonada updated the review to two lines / S/ 28.00; only Confirmar envio changed the fixture to En cocina. Screenshot: `C:/Users/adolf/.codex/visualizations/2026/10/08/01a1192f-1e88-7d60-9038-3722b5f86877/order-send-review.jpg`. Desktop checked; mobile pixel and real-backend integration checks were not run. Disposable preview harness remains untracked and must never be staged.
  - Recovery mirror pending: runtime session registration is unavailable; agent-attributed Engram calls are prohibited until the host re-registers the session. Local task document is the recovery record meanwhile.

- T01 and T02 implementation, full frontend checks, and independent verification are complete in commits `1d97af0` and `9bddbd6`. Browser/pixel and backend integration checks were not run locally.
- Parent recovery mirror: `odd/prototype-order-taking/tasks`.
- Independent final verification passed: full frontend suite 61/61 suites and 398/398 tests; corrected legacy tests retain direct POST, alias persistence, draft subtotal and composer-collapse assertions with no skipped tests. CI build proof reused by the verifier because production source bytes were unchanged after the independently successful CI build. Parent spot check `git diff --check` passed.
- Next: let the user review the updated Chrome flow before remote delivery. Configured GitHub session and the previous final-tracker exception were accepted before preview; preserve the feature chain and reassess final authored size after T03 before publishing.
- Interruption: T02 writer returned no terminal handoff; recovery worker never started (`pending_init`) and was canceled. No success or RED/GREEN evidence inferred from existing edits. Untracked `frontend/.tmp/` is preserved, not staged.
- Delivery remains pending: no push, PR, main merge, or deployment performed. Main pushes trigger automatic VPS deployment after tests; no direct remote execution is authorized by this local refinement.
- Desktop mock-browser verification completed for T03. Real backend integration and mobile pixel verification remain unperformed.
- Rollback boundary: only this feature's composer/ticket/navigation changes and accompanying tests/docs; do not remove unrelated local work.
