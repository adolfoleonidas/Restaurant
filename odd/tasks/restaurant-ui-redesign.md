# Restaurant UI Redesign

Status: Active
Branch: codex/restaurant-ui-redesign
Base commit: fab35a8
Delivery strategy: ask-on-risk (ask-on-risk threshold not reached for T01)
Chain strategy: stacked-to-main (user selected)
Forecast: more than 400 authored changed lines across the full feature

## Objective
Implement the approved modern Restaurant UI and logo across customer, staff, and admin surfaces without changing business rules.

## Problem and Why
The approved visual proposal is only a mockup. Production still uses a generic rotated-square mark, fragmented branding, horizontal kitchen stages on mobile, and inconsistent operational hierarchy. Staff need fast, legible status and next actions; customers need a clearer menu and cart.

## Authorized Scope
Frontend visual and interaction work in the isolated worktree. Reuse existing routes, APIs, permissions, item-wave kitchen behavior, payment rules, and restaurant configuration. Do not modify the unrelated dirty source checkout or push, merge, or create a PR without a separate user request.

## Constraints
- Preserve Spanish UI copy in the project's neutral style.
- Preserve configurable restaurant name and logo URL; provide a resilient fallback mark.
- Keep Kitchen item-level waves, AGREGADO, per-item readiness, Esperando retiro, and Retirado semantics.
- Preserve keyboard, touch, contrast, and responsive usability.
- Strict TDD is enabled by the supplied project instructions: observe RED, then GREEN, then REFACTOR for behavior changes.
- Frontend runner: npm test -- --watchAll=false (from frontend/). Build: npm run build.
- Offline frontend/node_modules junction is available in this worktree; do not install packages or use network.
- Each completed task needs focused test evidence, runtime check or explicit N/A, a rollback boundary, and one Conventional Commit.
- Around 400 authored changed lines per task is an advisory review heuristic, not a code-golf constraint.

## Tasks
- [x] T01 Brand foundation: replace the generic mark with the approved steam-and-plate visual identity, support configured logo URL with fallback, and align shared visual tokens/shells. Route: delegated direct; multiple non-trivial frontend files plus tests.
  Acceptance: customer and staff branding is consistent, the configured logo displays safely, fallback works, and responsive/accessible checks pass.
  Checks: focused frontend tests; npm run build; browser inspection at desktop and mobile.
  Evidence: RED observed in Jest (2 failures: `getSafeLogoUrl` absent; exit 1), then GREEN: `npm test -- --watchAll=false --runInBand src/__tests__/BrandMark.test.js` passed 1 suite / 4 tests (exit 0). `npm run build` compiled successfully (exit 0). Dev server compiled successfully after final edits. Desktop/mobile visual inspection unavailable: CUA exposed no browser surfaces; Codex browser tab open was queued. Runtime scenario: local dev server served the UI and webpack recompiled successfully after final edits; manual responsive spot-check N/A because no browser surface was available. Rollback boundary: revert this work-unit commit's T01-only frontend files plus this task-document update; no API/business behavior changes. Authored changed-line count in the T01 work-unit commit: 200 total (175 insertions + 25 deletions, including 60 task-document lines). REOPENED: independent review found `getSafeLogoUrl('/\\evil.example/logo.png')` accepts a backslash path that WHATWG URL parsing can resolve off-origin. Preserve prior passing evidence. Regression RED: `npm test -- --watchAll=false --runInBand src/__tests__/BrandMark.test.js` failed only the new backslash-origin case (1 failed, 4 passed, exit 1). Fixed by parsing root-relative paths against a fixed origin; GREEN: 1 suite / 5 tests passed (exit 0). `npm run build` compiled successfully (exit 0). Fix commit: 5834584bf4e0a5199fa03ab50640c04adde5f35d (`fix(brand): reject off-origin logo paths`), 13 changed lines (11 insertions + 2 deletions). Independent post-fix spot-check: 1 suite / 5 tests passed (exit 0). Native RDD assessment over `fab35a8..HEAD`: medium risk (`frontend/package.json` configuration change), 209 authored changed lines, `review_due=false` (`under_budget`); no review was started.
- [ ] T02 Kitchen: implement the approved responsive priority board without changing item-wave or status semantics. Route: delegated direct; `frontend/src/pages/Cocina.jsx`, `frontend/src/__tests__/Cocina.test.js`, and Jest alias mapping in `frontend/package.json`.
  Acceptance: desktop/tablet and mobile are legible; elapsed time, modifiers, AGREGADO, per-item Listo, pickup, and Retirado remain correct.
  Checks: focused frontend tests; full frontend tests; `npm run build`; local React runtime scenario with mocked kitchen role/API; live authenticated browser scenario and desktop/mobile visual inspection remain pending.
  Evidence: Strict TDD RED for the original board test: `npm test -- --watchAll=false --runInBand src/__tests__/Cocina.test.js` failed on missing `tablist` (1 failed, exit 1). Existing queue-order coverage initially assumed oldest-first; the current product comparator (`byAgeDesc`) actually sorts Llegan/Al fuego newest-first. Multi-ticket fixture now has order #22 with a newer pending Causa added to older preparing/ready items, and order #23 with two older pending products; the test asserts newest ticket #22 precedes #23 and both old items stay grouped under Llegan. Adding the accurate `Más recientes primero` copy assertion produced a focused RED (1 failed, 2 passed, exit 1) because the UI said `Más antiguas primero`; the visible label was corrected without changing sort logic, item stages, or API behavior. GREEN: focused Kitchen suite passed 1 suite / 3 tests (exit 0); full frontend tests passed 2 suites / 8 tests (exit 0); `npm run build` compiled successfully (exit 0). A local React/jsdom scenario with mocked `cocina` context/API clicked `Pasar a fuego`, verified `POST /orders/order-22/bump` with `{ from_status: 'pendiente' }`, selected `Al fuego`, clicked per-item `Listo` and verified `POST /orders/order-22/items/item-fire/status` with `{ status: 'listo' }`. It also exercises ArrowRight stage navigation and responsive breakpoint classes. These mock-backed checks do not prove live backend authentication or visual layout. Live authenticated browser validation and desktop/mobile visual inspection remain unavailable: CUA in the sub-agent cannot make its IAB visible; loopback requests timed out. T02 stays unchecked pending that evidence. Work-unit commit: `6a18f3b` (`feat(kitchen): add responsive priority board`); authored changed lines in the T02 work-unit commit: 130; interaction-verification commit: `f109f4c` (`test(kitchen): exercise stage and item actions`); ordering coverage and label correction: `ddfdda4` (`fix(kitchen): clarify newest-first queue order`); final slice-2 branch diff: 169 authored lines. Rollback boundary: revert the Kitchen page, Kitchen test, Jest alias mapping, and T02 evidence; no API/backend/status-flow changes were made.
- [ ] T03 Customer menu: improve category position, product-card hierarchy, and persistent mobile cart. Route: delegated direct; multiple page/component files plus tests.
  Acceptance: browsing and checkout entry remain functional and accessible across widths.
  Checks: focused frontend tests; npm run build; menu runtime scenario.
  Evidence: pending.
- [ ] T04 Floor and service: improve table priority, state labels, and primary actions while preserving existing order flows. Route: delegated direct; multiple screens/components plus tests.
  Acceptance: waiter can locate attention-needed tables and reach the correct order action without losing existing functionality.
  Checks: focused frontend tests; npm run build; table runtime scenario.
  Evidence: pending.
- [ ] T05 Orders and cash: clarify lists, pending actions, and payment-state hierarchy without changing financial rules. Route: delegated direct; multiple screens/components plus tests.
  Acceptance: order and cash actions remain permission-correct and operationally legible.
  Checks: focused frontend tests; npm run build; payment runtime scenario.
  Evidence: pending.
- [ ] T06 Administration and integration: align remaining admin/report/settings views and perform cross-role responsive/accessibility regression checks. Route: delegated direct; multiple screens/components plus tests.
  Acceptance: shared visual system is consistent across roles, all applicable tests and build pass, and failed/skipped checks are recorded.
  Checks: full frontend tests; npm run build; representative browser scenarios.
  Evidence: pending.

## Progress
T01 has been re-completed after an independent spot-check found that a backslash-containing root path could normalize off-origin. A new regression reproduced WHATWG resolution from `/\evil.example/logo.png` to `https://evil.example`; the fixed-origin parse now rejects the escape while preserving ordinary local paths and HTTPS URLs. RED/GREEN and production build passed. The prior brand implementation remains intact; browser QA remains unavailable. The guard/test fix is committed as `5834584bf4e0a5199fa03ab50640c04adde5f35d`; its rollback boundary is limited to the URL helper and regression test.

## Next Step
T02 implementation (`6a18f3b`), initial evidence (`efd2b6c`), and runtime interaction coverage (`f109f4c`) are committed. Ordering-coverage/copy fix `ddfdda4` is committed; live authenticated backend validation and desktop/mobile visual inspection remain pending.

T01 commits: `fb34ffc96f339d57795dd5cdb5658588b12500db` (`feat(brand): add configured restaurant identity`), `d0a0543d8fc861eee619afc1904142d45b2a933a` (task evidence), and `5834584bf4e0a5199fa03ab50640c04adde5f35d` (`fix(brand): reject off-origin logo paths`). Stacked-to-main order: PR slice 1 contains all T01 commits, based on `fab35a8` → main; PR slice 2 starts with T02 Kitchen atop slice 1. Local PR slice 1 branch: `codex/restaurant-ui-brand` at T01 boundary. Next: proceed to T02 Kitchen.
