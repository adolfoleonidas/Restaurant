# Restore login and public navigation

Fix the five defects reproduced in the deployed UI without changing restaurant operations or the original dirty checkout.

## Scope and authority
- Authorized: local fixes and regression checks for login crash, mobile staff entry, accent-tolerant search, empty search recovery, accessible cart.
- Excluded: authentication policy, credential changes, orders/payments/table changes, production writes, push/PR/merge/deploy until separately authorized.
- Branch: codex/fix-login-navigation; base dd4e5ac8cb5d06c5e9f15efb509d7af0aa1bc418.
- Existing Spanish UI copy remains neutral Spanish; code, tests and documentation English.

## Tasks
- [ ] T01 Fix the five confirmed navigation defects with component-level regression tests.
  - Route: delegated writer; preparation and 2+ non-trivial source files trigger delegation.
  - Acceptance: login renders; mobile staff link remains visible; cart has accessible name; accent-free query finds accented product; zero matches explain recovery with clear-search action.
  - Checks: RED observed before fixes (4 tests failed: login threw `ReferenceError: useEffect is not defined`; mobile staff link remained `hidden`; accent-free search returned zero; zero-result recovery copy/action were absent). Focused regression GREEN: 1 suite, 4 tests passed. Full frontend suite: 4 suites, 14 tests passed. Production build passed independently with approved filesystem access; the first EPERM was sandbox-only.
  - Rollback: only Login, Landing, PublicLayout and their regression tests.
  - Commit: pending parent confirmation; no commit created.
- [ ] T02 Verify the corrected browser entry and record remaining internal-audit limitations.
  - Route: parent browser checks and delegated execution for preview server if needed.
  - Acceptance: corrected local login opens without the prior ReferenceError; safe public flows work; authenticated screens are not claimed verified without authorized usable session.
  - Checks: local browser smoke; no business-data writes.
  - Commit evidence: T01 work-unit commit plus documentation-only evidence if needed.

## Verification
- Strict TDD: enabled by user-provided AGENTS.md/session configuration.
- Runner: frontend npm test -- --watchAll=false --runInBand.
- Build: frontend npm run build.
- Native review: on, global; new candidate consent separate from earlier UI decline.
- Delivery strategy: ask-on-risk; forecast approximately 250 authored changed lines, single coherent bugfix slice, no remote delivery authorized yet.
- Engram mirror: pending; host runtime session identity is unconfirmed and prohibits attributed memory writes.

## Evidence
- Live /login: blank page, ReferenceError useEffect is not defined.
- Login calls useEffect without importing it.
- Live chicharron: 0 results; chicharrón: 1.
- Mobile public header: no staff-login entry; cart button lacks name.
- Search with no match: only results count 0, no recovery message.
- Full internal audit blocked by login; this is not an authentication-backend verdict.

## T01 implementation evidence
- Changed `frontend/src/pages/Login.jsx`, `frontend/src/pages/Landing.jsx`, `frontend/src/components/PublicLayout.jsx`, and added `frontend/src/__tests__/LoginNavigation.test.js`.
- Accent-insensitive matching normalizes query and searchable fields with Unicode NFD and removes combining marks; empty search now provides Spanish recovery copy and a clear action.
- Focused test command: `npm test -- --watchAll=false --runInBand src/__tests__/LoginNavigation.test.js` — 4/4 passed.
- Full test command: `npm test -- --watchAll=false --runInBand` — 4 suites, 14/14 passed.
- Build command: `npm run build` — initial sandbox EPERM; independent approved-access rerun exit 0, compiled successfully.
- Runtime harness: N/A; no browser/auth runtime boundary exercised by T01.
- Rollback boundary: the four paths above only.
- Native review, browser follow-up T02, and commit remain pending parent ownership.

## Next step
Complete the production build check and parent-owned commit for T01; then perform the browser smoke check for T02.

## Independent verification and browser evidence
- Independent full suite: 4 suites, 14/14 tests, exit 0; production build: exit 0; git diff --check: exit 0. Only deprecation/line-ending notices.
- Parent spot check: focused regression suite 4/4, exit 0.
- Local preview http://localhost:3000/login: form rendered, previous ReferenceError absent, console empty at first login check.
- Narrow local public header exposes Salon link and named Abrir pedido button.
- Local menu data requests returned HTTP 404 because preview backend endpoints are unavailable; live public-menu end-to-end verification remains pending. This is not claimed as a new production regression or a successful full-menu smoke.
- No credentials entered, no authenticated screens tested, no orders/payments or remote writes.
- Screenshot: local login-fixed.jpg in the calling chat visualization directory.
- Runtime harness: actual local browser form render passed; local data-backed menu smoke partial (404); authenticated-role audit pending.
- Engram mirror still pending because runtime registration is unavailable.