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
- [ ] UX-02 — Make another-person ordering consistently discoverable.
  - Route: delegated writer; context-aware account controls and API-interaction tests.
  - Acceptance: visible, clearly named next-person action in the account/person area; preserves existing drafts and account names; creates/selects a separate account using existing handlers; no duplicate names/selectors or cashier-only action leaks.
  - Files: Salon and person/account regression tests. Estimate: 80-150 lines.
  - Rollback: only contextual person controls/tests; do not remove existing account backend support.
- [ ] UX-03 — Use one clear mobile draft-editing presentation and verify end to end.
  - Route: delegated writer; responsive layout and behavioral/visual checks.
  - Acceptance: editable draft quantities/notes remain accessible without redundant ticket presentations; numeric counts and calm feedback remain; two-step send/confirm preserved; sent lines and occasional More actions remain available with correct permissions.
  - Files: Salon and applicable ticket/composer tests, components only if evidence requires it. Estimate: 80-150 lines.
  - Rollback: mobile presentation/test changes only; retain order data and API contracts.

## Progress and next step

- Exploration completed and initial unverified extra-step claim corrected against current source. No visual preview or UX implementation proof yet.
- UX-01 implementation passed independent verification and parent structural readback. The review dialog now has an explicit accessible description, stale/empty draft explanation with confirmation still disabled, and failed sends leave the review open for recovery; the existing review/cancel and single-send handler path remains in use.
- TDD evidence: before the corresponding production edits, `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js` failed in 2 new assertions (missing `aria-describedby` and missing stale-draft explanation; 31 passed, 2 failed). After adding the send-failure recovery regression, the same focused suite failed in that one new test because the dialog closed after the rejected POST; implementation was then adjusted to close only on success.
- Verification: `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/SalonComposerProto.test.js src/__tests__/SalonDetailView.test.js src/__tests__/SalonSheetParity.test.js src/__tests__/MesasPersonasPedido.test.js src/__tests__/orderDraft.test.js` — 5 suites, 80 tests passed. `git diff --check` passed. Existing React key and unrelated Radix dialog-description warnings remain visible in test output.
- Scope: only `frontend/src/pages/Salon.jsx` and `frontend/src/__tests__/SalonComposerProto.test.js` changed for UX-01 (40 authored changed lines: source 14 additions + 4 deletions; tests 22 additions). No preview, real backend/API, full frontend suite/build, or independent verification was run; no commit/stage performed. Rollback is limited to the review dialog description/empty-state affordance, success-only close behavior, and the related behavioral assertions in those files.
- Independent verification: focused 5 suites / 80 tests passed; full frontend 61 suites / 412 tests passed; CI=true npm run build compiled successfully. Elevated npm execution was required after sandbox Temp realpath EPERM; no dependencies changed. Existing unrelated console warnings remain. Parent git diff --check passed. No deterministic candidate blocker was found; mocked API coverage is not browser or live-backend proof.
- RDD assessment: unavailable/high due untracked inventory; clone-local mode remains off. Independent functional verification was used; no native review started.
- Next: commit UX-01, then implement UX-02 with failing behavioral tests first. UX-02/UX-03 remain untouched.
- Engram mirror `odd/mozo-ui-ux/tasks` pending: authoritative runtime session identity is unavailable; agent-attributed Engram calls remain prohibited. This file is the recovery record.
