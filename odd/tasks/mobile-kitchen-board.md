# Keep the kitchen task board visible on mobile

## Outcome and authority

The human requested that mobile Cocina retain a task board instead of its current single-lane tab view. Implement this responsive UI change locally. Remote upload, PR creation, merge, deployment, live kitchen transitions, order/payment/register operations, permission changes, and the separate missing-branch error/seed fixes are not authorized by this request.

## Problem and design

Current Cocina renders the four status lanes once, but hides three below the md breakpoint using selectedStage and a mobile tablist. On narrow screens, keep those same four lanes visible in a horizontally scrollable, snap-aligned board. Each lane must remain legible with a near-viewport width and an edge of the next lane as a swipe cue. Preserve the existing desktop two/four-column grid, headings/counts, chronological ordering, mixed-item order cards, newly added item markers, zone filtering, attention/branch labels, polling, and kitchen action handlers. Do not add dragging/reordering or change order states.

## Scope, route, and checks

- Sole checkout: C:/Users/adolf/.codex/worktrees/restaurant-ui-redesign/Restaurant.
- Feature branch: codex/mobile-kitchen-board; source boundary: ccc938f443aa3baea71685643411263112e687ea. The previous audit/recovery branch remains preserved separately.
- Authorized files: frontend/src/pages/Cocina.jsx, frontend/src/__tests__/Cocina.test.js, and this document.
- Route: delegated direct. A bounded exploration mapped the current page/tests; writer trigger fires because the responsive behavior and regression tests are two non-trivial files. One cohesive work unit.
- Artifact language: English documentation/code; extend existing neutral Spanish UI labels.
- Strict TDD: enabled by supplied AGENTS.md; exact runner: frontend/package.json npm test = craco test. Observe the new board expectations fail before production changes, then GREEN and REFACTOR. Mock-only tests; no actual API/database fixtures.
- Focused command from frontend: $env:CI='true'; npm.cmd test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/Cocina.test.js.
- Full checks from frontend: $env:CI='true'; npm.cmd test -- --watchAll=false --runInBand; npm.cmd run build. Parent focused spot-check and independent verification after a small-model writer. Whitespace check: git diff --check.
- Verify all four lanes are accessible without tab hiding; mobile overflow/snap and readable widths coexist with unchanged desktop layout. Preserve existing mixed-item, sorting, branch-label, and action tests. Do not pretend jsdom proves rendered responsive geometry.
- Live visual proof is currently unavailable: the original integrated browser is at login. Its temporary 390x844 override was reset; no login, credentials, or business action was performed. Local tests/build are not a deployed-device check.
- Backend/RBAC/data tests: N/A, no backend or domain behavior changes. A full browser action flow remains unexecuted; do not advance live orders just for proof.
- Delivery strategy: ask-on-risk; forecast 100-200 authored changed lines including tests/documentation. About 400 lines per task is an advisory planning heuristic, never a reason to omit tests or compress code. Push/PR/merge remain human decisions.
- Local Conventional Commit only, no AI attribution. Rollback boundary: mobile board classes/markup and corresponding responsive test expectations in the two frontend files.
- Engram mirror odd/mobile-kitchen-board/tasks pending: authoritative runtime identity is unavailable; no agent-attributed memory tools or substitute session. Preserve full local progress. Project registry absent; installed exact skill paths are cached and injected.

## Task

- [ ] M1: Implement and verify the four-lane mobile board while retaining desktop layout and existing kitchen behavior. Acceptance: visible mobile lanes, horizontal snap/overflow, readable cards, preserved statuses/actions/filtering, observed focused RED/GREEN, full frontend tests/build, independent verification, parent spot-check, and local work-unit commit.

## Progress

- CodeGraph mapped Cocina/KitchenCard; the page index flagged Cocina stale, so current named-file source was read directly. The page had one shared four-lane grid with three mobile-hidden lanes controlled by `selectedStage` tabs.
- Strict-TDD RED observed after changing board expectations and before production edits: focused Cocina suite failed because the new `data-testid="cocina-kanban"` board wrapper was absent (1 suite failed, 3 passed).
- M1 replaces the mobile-only tablist and hidden lanes with one horizontally scrollable, snap-aligned flex board. Each lane uses 90% width with a capped readable width and a next-lane glimpse; medium+ breakpoints restore the existing two/four-column grid, visible overflow, and auto lane width. Lane headings/counts, cards, grouping, sorting, zones, polling, and callbacks remain in the same data flow. No dragging or state changes added.
- Focused verification: `$env:CI='true'; npm.cmd test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/Cocina.test.js` — 1 suite passed, 4 tests passed.
- Full frontend Jest: `$env:CI='true'; npm.cmd test -- --watchAll=false --runInBand` — 25 suites passed, 1 skipped; 143 tests passed, 18 skipped. Existing Radix `DialogContent` description console warnings remain.
- Build: `npm.cmd run build` — compiled successfully; Node emitted an `fs.F_OK` deprecation warning.
- Tests assert the mobile overflow/snap/readable-width utilities and desktop overrides in server-rendered markup; this does not prove actual viewport geometry. Live visual proof remains pending because the authorized browser session is at login; no login, API, or kitchen action was performed.
- `git diff --check` passes. Authored delta is approximately 109 lines including the 45-line tracker (64 additions/deletions across Cocina and its tests); within the forecast. Parent verification/acceptance and local commit remain pending. Rollback is limited to this page’s board markup/classes and its Cocina tests. Engram mirror remains pending without runtime identity.

## Next step

Local implementation and functional acceptance are verified; create the work-unit commit, then record its identity. Actual mobile visual proof and remote delivery remain pending and require the appropriate human scope.

## Parent acceptance checkpoint

- Parent focused spot-check passed: npm.cmd test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/Cocina.test.js, 1 suite / 4 tests. No source changes followed the writer's verification.
- Independent verifier inspected the scoped diff and the generated ignored build CSS: 90% lane width, 24rem cap, snap/overflow and md desktop overrides all have the expected emitted declarations. The existing grouping, sorting, zones, polling and action handlers are unchanged. Its focused run passed 4/4; its full run passed 25 suites with 1 skipped, 143 tests with 18 skipped. Existing Radix warnings remain; writer build succeeded with the existing fs.F_OK deprecation warning.
- Read-only native risk assessment failed closed as high/unassessable because the new task document was untracked. This did not lower the verification tier: independent functional verification plus the parent spot-check were performed. RDD remains OFF (clone_local); no native STATUS/START, review lifecycle, receipt, or preference change occurred.
- The complete candidate has only the two authorized frontend files and this document. All applicable local functional checks passed, but no actual mobile geometry or live-action verification is claimed. No remote upload/deployment or business-record operation occurred.
- Parent accepts the local implementation. M1 remains unchecked only until its required local work-unit commit is observed. Engram mirror remains pending without runtime registration.
