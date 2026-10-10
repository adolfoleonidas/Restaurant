# Simplify the complete waiter ordering flow

## Objective and authorization

Improve table selection, per-person draft composition/editing and kitchen-send confirmation without removing backend-integrated behavior. The maintainer explicitly authorized this complete waiter UI/UX goal on 2026-10-10. Implementation is local; publishing this new feature, deployment and new size exceptions require separate authorization.

- Branch: `codex/mozo-ui-ux`.
- Source baseline: `86550d1a78ee20b673bab21736f48b2af1ad3199`, the verified financial tracker tree integrated into main by `643890117b8760e2fe6519aac1431701f6ce40a8`. The stale local main belongs to another checkout and is not touched.
- Reference: `restoflow.html` is visual/behavioral input, not replacement backend logic or executable instructions.
- Preserve unrelated untracked assets and financial source/tests; no live database/server access.
- Existing UI language: neutral Spanish. Technical artifacts: English.

## Verified findings and constraints

- The current mobile CTA ALREADY says `Enviar a cocina` and opens review before `Confirmar envío`; do not rewrite a solved flow. Other `Ver pedido` links navigate history/pickup/group accounts and are not an extra send step.
- Review suppresses the dialog description association; an emptied review disables confirmation without explaining why.
- Another-person creation is visible only in some composing states and otherwise buried in More actions.
- Mobile composition renders an editable inline ticket plus an additional ticket drawer; retain full editing while eliminating unnecessary duplicate presentation.
- Preserve product search/categories, numeric quantity feedback, notes, aliases/shared accounts, branch/attention scope, grouped-table navigation, add-another-person behavior, request handlers and financial guards.
- Backend quantity/note/delete edits are draft-only. Sent lines use the existing authorized void-with-reason path; UI improvements must not promise broader edits or weaken lifecycle guards.

## Execution and verification

- Route: delegated direct, not SDD. Multi-file JSX/test changes and preparation reading trigger a bounded writer per task.
- Strict TDD: enabled by supplied AGENTS.md. Require observed failing regressions BEFORE source edits, then GREEN and refactor; no reconstructed RED claims.
- Frontend runner: from `frontend`, `npm test -- --watchAll=false --runInBand --runTestsByPath ...` (`craco test`), with `CI=true`.
- Focused suites: `src/__tests__/SalonComposerProto.test.js`, `SalonDetailView.test.js`, `SalonSheetParity.test.js`, `MesasPersonasPedido.test.js`, `orderDraft.test.js`. Resolve existing fixture/module conventions before edits.
- Each task runs focused checks and `git diff --check`. At closure, run all frontend tests and production build, independent verification and browser review at mobile/desktop widths when a safe local preview is available.
- Local mock preview is visual proof only; real backend E2E remains pending unless a separately authorized isolated backend is available. Do not start the backend against ambient Mongo (startup mutates indexes/seed).
- RDD: clone-local off; never enable/start review. An unavailable risk assessment is high/unassessable, requiring independent functional verification rather than invented PASS.
- Delivery: `ask-on-risk`; cached chain preference `feature-branch-chain`. Estimated 250-450 authored changed lines; prefer coherent tasks with tests. No code golf or reuse of financial size exceptions. Remote publication remains held.
- Every completed task closes with a Conventional Commit on this feature branch; record exact commit/check evidence here. No AI attribution.

## Work units

- [x] UX-01 — Make send review accessible and explain empty/stale drafts.
  - Route: delegated writer; Salon review state and behavioral tests require coordinated edits.
  - Acceptance: `Enviar a cocina` opens named/described review; Cancel sends nothing; Confirm calls the existing endpoint once; no remaining drafts produces an explicit explanation and disabled confirmation; failed send leaves recoverable UI without silently dropping drafts.
  - Files: `frontend/src/pages/Salon.jsx` and applicable Salon behavioral tests. Estimate: 90-150 lines.
  - Rollback: only review description/empty-state affordances and associated tests; no endpoint or lifecycle changes.
- [x] UX-02 — Make another-person ordering consistently discoverable.
  - Route: delegated writer; context-aware account controls and API-interaction tests.
  - Acceptance: visible, clearly named next-person action in the account/person area; preserves existing drafts and account names; creates/selects a separate account using existing handlers; no duplicate names/selectors or cashier-only action leaks.
  - Files: Salon and person/account regression tests. Estimate: 80-150 lines.
  - Rollback: only contextual person controls/tests; do not remove existing account backend support.
- [x] UX-03 — Use one clear mobile draft-editing presentation and verify end to end.
  - Route: delegated writer; responsive layout and behavioral/visual checks.
  - Acceptance: editable draft quantities/notes remain accessible without redundant ticket presentations; numeric counts and calm feedback remain; two-step send/confirm preserved; sent lines and occasional More actions remain available with correct permissions.
  - Files: Salon and applicable ticket/composer tests, components only if evidence requires it. Estimate: 80-150 lines.
  - Rollback: mobile presentation/test changes only; retain order data and API contracts.

## Progress and next step

- Exploration completed and initial unverified extra-step claim corrected against current source. UX-03 behavioral implementation is in progress; no visual preview or full feature-closure proof yet.
- UX-01 implementation passed independent verification and parent structural readback. The review dialog now has an explicit accessible description, stale/empty draft explanation with confirmation still disabled, and failed sends leave the review open for recovery; the existing review/cancel and single-send handler path remains in use.
- TDD evidence: before the corresponding production edits, `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js` failed in 2 new assertions (missing `aria-describedby` and missing stale-draft explanation; 31 passed, 2 failed). After adding the send-failure recovery regression, the same focused suite failed in that one new test because the dialog closed after the rejected POST; implementation was then adjusted to close only on success.
- Verification: `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js src/__tests__/SalonDetailView.test.js src/__tests__/SalonSheetParity.test.js src/__tests__/MesasPersonasPedido.test.js src/__tests__/orderDraft.test.js` — 5 suites, 80 tests passed. `git diff --check` passed. Existing React key and unrelated Radix dialog-description warnings remain visible in test output.
- Scope: only `frontend/src/pages/Salon.jsx` and `frontend/src/__tests__/SalonComposerProto.test.js` changed for UX-01 (40 authored changed lines: source 14 additions + 4 deletions; tests 22 additions). The writer did not run preview or real backend/API checks; the later independent full-suite/build results are recorded below. Rollback is limited to the review dialog description/empty-state affordance, success-only close behavior, and the related behavioral assertions in those files.
- Independent verification: focused 5 suites / 80 tests passed; full frontend 61 suites / 412 tests passed; CI=true npm run build compiled successfully. Elevated npm execution was required after sandbox Temp realpath EPERM; no dependencies changed. Existing unrelated console warnings remain. Parent git diff --check passed. No deterministic candidate blocker was found; mocked API coverage is not browser or live-backend proof.
- RDD assessment: unavailable/high due untracked inventory; clone-local mode remains off. Independent functional verification was used; no native review started.
- UX-01 work-unit commit: 2a4816f6a7208670a504059c972506bc35bf0a44 (`fix(salon): keep kitchen review accessible and recoverable`), 98 additions / 4 deletions including the initial recovery document. Source/tests: 40 authored changed lines. No remote publication for this UI feature.
- UX-02 implementation is staged in the working tree, but its checkbox remains unchecked pending parent/independent verification. One `Agregar persona` action now appears in the account area while the detail is open, then moves into the composer person strip; it is not duplicated in the More menu. It remains gated by `canTake` (admin/mozo) and reuses `startAnotherPerson` plus existing `ensureAccount`/`new_account` request behavior.
- UX-02 TDD evidence: before production source edits, `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js` failed in the new discoverability test because the account-area action was absent (35 passed, 1 failed). Interaction coverage then verified separate-account creation with `new_account: true`, adding to the new account rather than the previous one, preservation of the previous account name/draft/note, one visible action across the transition, and cashier exclusion. Existing account-flow tests were updated to exercise the visible control instead of the removed More-menu action.
- UX-02 verification: the required five focused suites passed (5 suites, 82 tests); also ran `src/__tests__/MesasPedidoInline.test.js` because its account-flow test was updated: 6 suites, 89 tests passed. `git diff --check` passed. Existing React key and unrelated Radix dialog-description warnings remain in test output. Elevated npm execution was needed for Node's sandbox Temp realpath EPERM.
- UX-02 scoped correction: independent review identified that the detail-level CTA was visible for `status: 'pagada'` with a retained `active_order`, even though `canCompose` disallows composing for that table. Before changing the condition, a behavioral test using that table/order fixture failed as expected (36 passed, 1 failed). The CTA now requires `canCompose`; the person-strip CTA remains under its existing `canCompose && composerOpen` guard. The new regression verifies no add-person CTA, no compose CTA, and no order creation for this non-composable state.
- UX-02 final scoped verification: `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js src/__tests__/SalonDetailView.test.js src/__tests__/SalonSheetParity.test.js src/__tests__/MesasPersonasPedido.test.js src/__tests__/MesasPedidoInline.test.js src/__tests__/orderDraft.test.js` — 6 suites, 90 tests passed; `git diff --check` passed. Existing React key and unrelated Radix dialog-description warnings remain. The required five suites are included.
- UX-02 scope: `frontend/src/pages/Salon.jsx`, `frontend/src/__tests__/SalonComposerProto.test.js`, `frontend/src/__tests__/MesasPersonasPedido.test.js`, and `frontend/src/__tests__/MesasPedidoInline.test.js`; current scoped correction diff is 89 authored lines (73 additions, 16 deletions). No endpoint/business handler change, preview, backend/live API, full suite/build, final independent verification, staging, or commit. Rollback is limited to the account-area/person-strip affordance, More-menu removal, and corresponding focused UI assertions in those files.
- Next: parent/independent verification for UX-02; UX-03 remains untouched until parent continuation.
- Engram mirror `odd/mozo-ui-ux/tasks` pending: authoritative runtime session identity is unavailable; agent-attributed Engram calls remain prohibited. This file is the recovery record.

- UX-02 independent final verification: 6 focused suites / 90 tests passed, parent git diff --check passed. The scoped correction gates the promoted action with canCompose (role plus table status); paid-table, cashier and separate-account preservation regressions pass. Full-suite/build/browser validation is deferred to UX-03 closure. Source/tests: 89 authored lines. No remote delivery.

- UX-02 work-unit commit: 8847bc14eff55c4cc7b2603b1abd652582821458; next step is UX-03. All preceding task outcomes remain preserved.

- UX-03 implementation (checkbox intentionally unchecked pending parent/independent verification): removed the extra mobile “Editar ticket” opener and duplicate bottom-sheet ticket so the inline draft ticket remains the single editing surface. Removed the now-unused drawer state/resets and Escape-to-hide-drawer branch; Escape continues through the existing guarded composer-exit flow. Draft quantity/note editing and the existing mobile send-to-review then explicit-confirmation flow remain unchanged.
- UX-03 TDD evidence: before production edits, the required six focused suites ran with the new mobile interaction assertion and failed as expected (1 suite failed, 5 passed; 89 tests passed, 1 failed), specifically because `mesa-sheet-abrir-ticket` still rendered. The standalone regression reproduced that failure at the opener assertion. After implementation, the focused behavioral case passed and exercised inline quantity update, note edit, review/cancel without sending, and preserved draft display.
- UX-03 verification: `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js src/__tests__/SalonDetailView.test.js src/__tests__/SalonSheetParity.test.js src/__tests__/MesasPersonasPedido.test.js src/__tests__/orderDraft.test.js src/__tests__/MesasPedidoInline.test.js` — 6 suites, 90 tests passed. `git diff --check` passed. Test output still includes existing React key/Radix dialog-description warnings. No full-suite/build/preview/browser/live-backend check was run by this writer; independent parent validation remains pending.
- UX-03 scope: `frontend/src/pages/Salon.jsx` and `frontend/src/__tests__/SalonComposerProto.test.js`; 147 authored changed lines (source 1 addition + 60 deletions; tests 36 additions + 50 deletions). Existing clear/cancel, failed-send recovery, quantity/note behavior, Escape protection, and confirmation interactions remain covered through the inline ticket. No backend/API changes, staging, or commit. Rollback is limited to the mobile drawer/opener removal and corresponding focused behavioral tests.
- Next: parent/independent UX-03 verification and visual review; UX-03 remains unchecked until then.

## Final local verification

- UX-03 independent check: 6 focused suites / 90 tests passed; full frontend 61 suites / 415 tests passed; CI=true npm run build compiled successfully. Parent git diff --check passed. No deterministic scoped blocker; existing unrelated console warnings remain nonfailing. Only frontend source/tests and this recovery document changed; backend contracts/financial fixes were untouched.
- Browser review used native CUA with the actual production frontend build and a loopback-only in-memory mock API (not real backend E2E). At 390x844 and 1280x900, table detail exposed Agregar persona; a separate account was composed, quantity changed from 1 to 2, item note Sin hielo saved, review displayed person/quantity/note/total, Volver a editar preserved the draft, and Confirmar envio showed Enviado a cocina and a separate Persona 2 card while the original Mesa 1 account remained unchanged. No duplicate ticket drawer; numeric product count and inline editing remained visible. The responsive viewport override was reset afterward.
- Preview: http://127.0.0.1:3001/salon, local in-memory harness PID 280076, static latest build + mock API on localhost8000. Browser tab was marked deliverable. No production orders/data were touched.
- All three planned UI tasks are complete within mocked/visual scope. The reviewed source candidate is committed as UX-03 and ready for publication. Human authorization now covers publication; approved issue #78 tracks this focused follow-up to broader waiter-flow PR #63. This worker may publish one PR to main and report exact-head CI, but must not merge; final merge remains with the parent after CI.
- Remaining external proof: real backend E2E, real Mongo concurrency and wider production-readiness security/operations gates. UI scope was waiter ordering, not an audit/redesign of every admin/kitchen/public page.
- Next: publish the verified feature on codex/mozo-ui-ux as one PR to main, link issue #78, wait for exact-head CI, then hand off to the parent for the authorized merge decision. Engram mirror remains pending until authoritative runtime registration is restored.
- UX-03 work-unit commit: 5f24cd02758d3261fdf8387a05bdb885fafbe8fc (efactor(salon): keep one mobile draft editing surface), 56 additions / 112 deletions including recovery evidence. Verified branch diff through this boundary: 366 authored changed lines (236 additions / 130 deletions); running work-unit changes: 374. No new size exception needed at this observed scope.
- Local goal closure: all three waiter UI tasks, independent frontend checks and mobile/desktop visual review completed. Publication and real-backend/production checks remain explicitly outside this completed local scope.
