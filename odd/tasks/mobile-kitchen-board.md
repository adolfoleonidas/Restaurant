# Keep the kitchen task board visible on mobile

## Outcome and authority

The human requested that mobile Cocina retain a task board instead of its current single-lane tab view. After verified local implementation, the human explicitly answered si to upload to adolfoleonidas/Restaurant, integration into main, and deployment to 93.127.214.26:8081 through GitHub Actions with the configured repository GitHub credential. This does not authorize live kitchen transitions, order/payment/register operations, permission changes, or the separate missing-branch error/seed fixes.

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

- [x] M1: Implement and verify the four-lane mobile board while retaining desktop layout and existing kitchen behavior. Acceptance: visible mobile lanes, horizontal snap/overflow, readable cards, preserved statuses/actions/filtering, observed focused RED/GREEN, full frontend tests/build, independent verification, parent spot-check, and local work-unit commit.

- [x] M2: Publish this three-file mobile board change to adolfoleonidas/Restaurant with an approved issue and attached PR, exactly one type label, applicable checks, and history-preserving main integration.
- [x] M3: Observe the exact-main deployment, run one read-only preflight if needed for server identity, and verify the mobile four-lane board/desktop layout through the original authorized browser. Reset temporary viewport changes and do not alter live orders.

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

The mobile board is published, integrated, deployed and checked in the authorized browser at mobile/desktop widths. The human can test it on their own phone. Physical touch-device behavior was not tested; the missing-branch error/seed and legacy-reconciliation work remain separate. Do not redeploy merely to save recovery documentation.

## Parent acceptance checkpoint

- Parent focused spot-check passed: npm.cmd test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/Cocina.test.js, 1 suite / 4 tests. No source changes followed the writer's verification.
- Independent verifier inspected the scoped diff and the generated ignored build CSS: 90% lane width, 24rem cap, snap/overflow and md desktop overrides all have the expected emitted declarations. The existing grouping, sorting, zones, polling and action handlers are unchanged. Its focused run passed 4/4; its full run passed 25 suites with 1 skipped, 143 tests with 18 skipped. Existing Radix warnings remain; writer build succeeded with the existing fs.F_OK deprecation warning.
- Read-only native risk assessment failed closed as high/unassessable because the new task document was untracked. This did not lower the verification tier: independent functional verification plus the parent spot-check were performed. RDD remains OFF (clone_local); no native STATUS/START, review lifecycle, receipt, or preference change occurred.
- The complete candidate has only the two authorized frontend files and this document. All applicable local functional checks passed, but no actual mobile geometry or live-action verification is claimed. No remote upload/deployment or business-record operation occurred.
- Parent accepts the local implementation. M1 remains unchecked only until its required local work-unit commit is observed. Engram mirror remains pending without runtime registration.

## Local closure

- M1 closed with observed work-unit commit 5b5a6105da0ac43ecc0dc9ab45ef56710f0e113e (feat(kitchen): keep mobile task board visible), 75 additions / 42 deletions across the exact three authorized files. The commit tree matches the prepared index and checkout was clean after commit. Source/test bytes are exactly those verified above.
- Running authored count is 117 at the work-unit boundary, within the 100-200 forecast and below the delivery planning threshold. This closing passive documentation checkpoint adds no new behavior and requires no repeated source tests.
- Mobile board implementation is local only, not uploaded, merged or deployed. Actual device geometry, swipe interaction and post-deploy checks remain pending. Missing-branch silent-error/seed fixes and the legacy reconciliation remain separate unfinished work; they were not included in this feature.
- No authoritative runtime memory identity is registered; local full recovery record remains available and its Engram mirror is pending.

## Delivery authority checkpoint

- Explicit human confirmation covers adolfoleonidas/Restaurant upload/integration and 93.127.214.26:8081 deployment via existing GitHub Actions using the configured repository credential. Keep credential material only in process memory; no connector identity or ambient SSH/session reuse.
- Scope remains Cocina.jsx, Cocina.test.js, and this feature recovery document. The previous payment-audit feature and its post-merge recovery branch are preserved separately; they are not additional changes in this delivery.
- Local functional proof remains unchanged. RDD stays OFF/disabled-unmanaged, memory mirror pending runtime registration. Physical mobile/deployed proof remains pending. Do not assume main stayed unchanged until the authorized remote readback.

## Verified delivery and responsive-browser closure

- M2 completed: issue https://github.com/adolfoleonidas/Restaurant/issues/24 was created and approved with enhancement/status:approved, based on explicit maintainer authorization. Attached PR https://github.com/adolfoleonidas/Restaurant/pull/25 carried exactly type:feature and the exact three-file diff (+91/-42). Its head was 45430720619d753ffe5ae841745cfbf71d75b50a. No size exception was required.
- PR #25 was OPEN/MERGEABLE/CLEAN before integration. Check runs and status contexts both totaled zero; combined-status pending with total zero was not treated as a running check or CI pass. GitHub confirmed MERGED at 2026-10-04T16:52:23Z using merge_method=merge, yielding main 451c7c290caaf8023f987a25cb60c03133983091 with parents ccc938f443aa3baea71685643411263112e687ea and the approved head. No bypass, rewrite, force push, or RDD preference change.
- Exact-main automatic deployment https://github.com/adolfoleonidas/Restaurant/actions/runs/37218368945 completed successfully. No duplicate deploy dispatch was issued. Exactly one operation=preflight dispatch ran successfully at https://github.com/adolfoleonidas/Restaurant/actions/runs/37218541516.
- Actual structured preflight confirms status=ok, server.main=true, commit=451c7c290caaf8023f987a25cb60c03133983091, clean_tracked=true, backend_running=true, index_readiness=branch_ready. Cash aggregates remain open=1, missing_branch_open=1, explicit_null_branch_open=0, duplicate group counts=0. Aggregate counters do not prove individual records unchanged. No migration, cash close, payment/proof, assignment, or kitchen transition was performed.
- First post-merge Git fetch failed with a transient GitHub port-443 connection error. Read-only API checks confirmed the merge and completed deployment, and a later bounded fetch succeeded. Parent and independent verifier confirmed local origin/main, merge parents, feature ancestry and equality of executable frontend/backend/workflow/Compose bytes. The initial log extractor matched echoed script markers; a corrected JSON-only parser isolated exactly one actual server report with a concrete commit. No dispatch or mutation was retried.
- Original authorized browser was authenticated as Pedro Cocinero / Cocina. After reload, a 390x844 requested viewport showed all four lanes without tabs. DOM measurements: viewport/page width=390, board client width=333, scroll width=1234, each lane=300px/display:block/snap-start, overflow-x:auto and scroll-snap-type:x mandatory. Native horizontal scroll moved scrollLeft from 0 to 623.2; the ready lane began at x=29. This is a resized-browser check, not a physical touch-phone test.
- Desktop check at requested 1280x800 yielded actual document width=1270 (vertical scrollbar), equal page width, display:grid, four columns approximately 258/258/172/193px, overflow visible and snap none. The existing desktop grid is preserved. Temporary viewport overrides were reset successfully and the same tab was retained for human handoff.
- Saved and visually inspected local proof: kitchen-mobile-board.jpg (initial mobile board with next-lane edge) and kitchen-desktop-board.jpg under C:/Users/adolf/.codex/visualizations/2026/10/02/01a0fa09-117d-7212-ab8d-ba8293258612/. Screenshots taken during scroll animation were not used as stable card-position proof. An offscreen heading click failed the browser tool after automatic scrolling; state was inspected and native scroll used instead. No business button was clicked. Screenshots are local only, not included in Git.
- Writer/independent/parent local checks recorded above remain the source verification; no source bytes changed during delivery. Existing 18 skipped tests and Radix/Node warnings remain. M3 is complete for deployment/server identity and resized-browser responsive checks; physical touch and real-phone coverage remain unexecuted rather than falsely passed.
- This post-merge recovery checkpoint is documentation only. Upload it to the existing feature branch if needed, not another main merge/redeployment. RDD remains OFF/disabled-unmanaged; Engram mirror remains pending without authoritative runtime registration.
