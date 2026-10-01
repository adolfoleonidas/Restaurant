# Structured operational completion

Implement missing staff-operation behaviors on the deployed attention/payment foundation, not by copying the mixed Grok branch. Complete independent, tested work units before the next one.

## Authority and recovery
- Human authorized local integration after the successful QR/proof production release, explicitly preferring a more structured implementation. Later feature publication/deployment requires its own authorization.
- Isolated branch: codex/operational-completion; base 5b4b3519c8fd4834cd2aec2bf9821c27fd495774. Prior release: PR #12, deploy run 36854749391 SUCCESS, backend health gate passed. Original Downloads and Grok checkouts remain untouched.
- Grok reference HEAD 7e8251d is read-only. No cherry-pick of mixed 0e2edcf, global database swapping, public-payment leftovers, or unrelated ProductCard changes.
- Engram mirror odd/operational-completion/tasks is PENDING: no authoritative runtime session identity; agent-attributed memory mutations are prohibited. This file is the recovery source.

## Architecture and constraints
- Keep one canonical attention/payment/close workflow. Reuse collection behavior rather than fork payment arithmetic, proof state or close gates.
- Existing function-aware Cobro authorization already permits a mozo with that function; do not extend roles, grant permissions or change cash-register rules.
- Pending photo evidence is never money. Preserve tenant scoping, exact owner/version checks, idempotency, settlement, served-food, refund and table-release invariants.
- Table QR capabilities stay in admin configuration; do not expose signed token/nonce in table listings. Generate/access a link only on explicit action; rotate/revoke require confirmation and retain existing backend guards.
- Shared frontend day/notification projections must be pure and tested. Keep API history available; do not silently change UTC order counters, Lima accounting boundaries or hide historical orders at the API.
- UI extends existing neutral Spanish; technical artifacts use English. No new package or infrastructure configuration by assumption.

## Checks and delivery
- Strict TDD ON from AGENTS: observed RED -> GREEN -> REFACTOR before implementation closure.
- Frontend: npm test -- --watchAll=false --runInBand (working directory frontend); npm run build. Focused test path recorded per task.
- Backend Python: C:/Users/adolf/Downloads/07_Proyectos-Codigo/Restaurant/backend/.venv/Scripts/python.exe -m pytest from isolated root. Only inspected in-memory tests may run; no generic pytest, real HTTP/DB suites, server, reset, seed or production transactions.
- Safe core tests: test_attention_lifecycle.py, test_money_integrity.py, test_order_flow_and_secrets.py, test_staff_payment_proof.py, plus the previously approved mock-only suite when relevant.
- Native review ON globally; parent assesses each work-unit against the last reviewed boundary. New candidate consent is independent. Prior QR decline/size exception do not carry over.
- Delivery ask-on-risk; cached chain strategy stacked-to-main. Forecast 1,200-2,000 authored changed lines across six outcomes; keep coherent PR slices <=400 or obtain a fresh exception after one honest slicing pass. No minification/test omission. Source work-unit commits remain local until authorized.
- First review boundary is the base above; running authored count zero. Normalizers before candidate freeze, check-only verification afterward.

## Tasks
- [x] OC-1 Admin table QR controls: add explicit copy/open access-link, confirmed regenerate/revoke actions and per-table status/error/busy feedback in existing configuration. Reuse GET guest-link and POST rotate/revoke, no backend/token-list change or package. Route delegated (UI logic plus rendered tests). Accept active/revoked/absent state, failed clipboard/network, confirmation/cancellation and independent tables. Forecast 120-220 lines; focused rendered tests + full frontend/build. Commit and review disposition pending.
- [ ] OC-2 Live pass day projection: shared Lima-day helper and separate earlier pickup section in kitchen/service where applicable, without API history loss. Resolve arrival timestamp from actual existing state before writes; preserve today's ready/served actions. Route delegated (shared helper, boards, tests). Accept midnight boundary, invalid timestamps, current versus earlier pickups and unchanged table service. Forecast 180-300 lines; pure/rendered tests + full frontend/build.
- [ ] OC-3 Item-ready alerts: stable item-aware notification identities/labels and deduplication using existing notification path. Preserve unread history and ready/served/cancelled transitions; do not invent push persistence. Route delegated (projection/UI/tests). Forecast 100-180 lines; notification regressions + full frontend/build.
- [ ] OC-4 Mozo detail collection: use a shared collection feature boundary for existing Caja and order detail, keeping permissions, proof binding/refresh, payment arithmetic and register prerequisites identical. No duplicated charge sheet logic. Route delegated (non-trivial extraction/integration). Acceptance same backend route and interaction outcomes from both entry points; focused existing proof/money tests plus frontend checks. Extraction may need a fresh cohesive size exception; measure before publication.
- [ ] OC-5 Numbered carryout attentions: canonical non-table attention identity and lifecycle, no fake table ownership. Route delegated after numbering policy is resolved. Dependency: decide shared versus separate daily attention sequence and verify Lima boundary/current counters; no silent numbering migration. Test isolated counters, kitchen/collection/close and no table release; preserve legacy orders.
- [ ] OC-6 Grouped tables: model join/separate with authoritative ownership and safe lifecycle, not UI-only grouping. Route delegated after billing/separation semantics are resolved. Dependency: follow the verified PRD common-attention scope with private session/order balances; resolve only how separation treats consumed/paid items. Test cross-tenant claims, conflicting groups, retries, payment/proof/close/refund and all-table release; no unsafe partial-write projection.

## Acceptance and recovery
Completed tasks require observed checks, independent verification where applicable and parent-owned Conventional Commit evidence. Never claim live device/Mongo/browser proof from mocks. Record failed/skipped/pending checks and next unfinished task here; keep prior valid work on updates. Small routine corrections stay with their task.

## Progress
OC-1 source implementation and independent verification are complete; parent commit/review assessment are next. OC-2 is the next unfinished implementation unit. OC-5/OC-6 product gaps block only their dependent work.

### OC-1 implementation evidence (pending parent gate/commit)
- Added per-table QR controls inside the existing Casa/Mesas configuration cards; the pre-existing `/configuracion` admin route guard and backend permissions were not changed. The table listing still exposes only its existing `qr_status`; no guest token/link is retrieved until an explicit per-row action.
- Active/no-QR/revoked states are labeled independently per row. Explicit link retrieval calls `GET /tables/{id}/guest-link`; displayed link is validated as same-origin `/checkout` with a `mesa` query parameter, then offers open and copy actions. When clipboard APIs are missing or fail, the read-only URL remains visible and is focused/selected for manual copy. Rotate/revoke require confirmation, clear any previously displayed capability before the request, and expose per-row busy/error/unknown state. Revoke only reports success when the API confirms `qr_status=revoked`.
- Strict TDD RED: before implementation, the listing regression failed because no QR status was shown; after the controls were added, a specific test found a generated link disappeared when local status changed from `none` to `active` (component state was reset by parent prop updates). Removed that unnecessary parent status projection and retained status/link in the per-row component. The complete focused rendered suite is GREEN: `npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/ConfiguracionTableQr.test.js` -> 8 passed. Full frontend suite: `npm test -- --watchAll=false --runInBand` -> 10 suites / 57 tests passed.
- Build status: `npm run build` was started, emitted the normal `Creating an optimized production build...` message, then produced no further output for over seven minutes while the process remained alive with near-idle CPU; it was interrupted once on instruction to return promptly. Result is pending/unverified, not a pass. No install or second build attempt was made.
- New paths: `frontend/src/components/TableQrActions.jsx`, `frontend/src/__tests__/ConfiguracionTableQr.test.js`; modified `frontend/src/pages/Configuracion.jsx`. API tests are mocked; no real browser, network, database or server was used. No backend changes.
- Rollback: remove the row action component/test and its single Mesas integration/import. No capability data is written by frontend beyond the existing explicit server APIs.
- OC-1 remains unchecked until parent-owned verification/commit. Review/remote/commit/stage were not performed; mirror remains pending because session identity is unavailable.
### Verified PRD model for later units
- Read-only mapping verified the approved local PRD at C:/Users/adolf/.codex/.chatgpt-projects/g-p-6930c3aa42e88191b0262f359b0cc133/PRD-restaurante-saas-v1.0.md, sections 6, 7, 8, 12 and 21. One numbered attention may own several tables. Staff may collect the whole attention, but each customer QR session keeps its own orders, balance and privacy. Joining is not permission to collapse all source orders into one order document or mix customer-visible information.
- OC-6 shared operational/settlement scope is already settled by that PRD; preserve attribution/private session balances and allow explicit staff aggregate collection. The remaining product gap is how detaching a table treats earlier consumption. Do not silently move/split historic orders, payments or customer sessions; ask before implementing such a reassignment.
- OC-5 current canonical attention has no attention counter. Existing UTC-keyed order_number is a separate identifier, not evidence of canonical attention/pickup numbering. The PRD does not settle reset period, tenant/branch counter scope or shared-versus-separate sequences; those choices must be resolved before numbering writes. No fake claim that an interim order label completes OC-5.
- Grok's one-order/no-private-session shortcut does not supersede the approved PRD. This is why the remaining domain work must be structured on explicit aggregates and invariants rather than ported blindly.


### OC-1 final independent gate
- After interruption, the independent verifier checked prior owned test/build process state: none remained matching its launch. The isolated 7/8 timeout coincided with a host clock/sleep discontinuity (approximately 30,535 seconds estimated) and was not reproducible on a fresh run.
- Fresh focused rendered tests passed 8/8; full frontend passed 10 suites / 57 tests; one fresh production build compiled successfully (exit 0, approximately 134 seconds, existing fs.F_OK warning). Tracked diff plus intended new-file whitespace scans passed. No source change occurred during verification.
- Parent independently repeated the focused ConfiguracionTableQr.test.js suite: 8/8 passed. The earlier interrupted build remains recorded as an attempt, not misrepresented as successful; the new successful build is the closure evidence.
- Existing admin/function authorization, tenant guard and nonce sanitization remain unchanged. No actual browser, capability creation on a real server, clipboard, live DB or QR scanner was exercised; all interface API checks are mocks.
- OC-1 is ready for a local work-unit commit and native assessment. No new publication/deployment or review consent is inferred from the previous QR/payment release.

### OC-1 local commit and next unit
- Verified source/test/task work unit: 3abb6da5e9f1c60cb3f12eec51348b53d3c603ea (feat(tables): manage guest QR access from configuration). Actual staged Git count is 406 additions + 8 deletions = 414 authored changed lines, superseding the writer's 366-line raw estimate. No source, tests, blank lines or comments were removed to fit a budget.
- Running local range exceeds the publication budget; cached stacked-to-main still applies. Before future publication, perform the bounded coherent planning-document versus QR-behavior slicing pass (source/tests alone are 352 changed lines); otherwise obtain a fresh size exception. No publication is authorized yet and the previous payment-feature exception is not reused.
- Initial native assessment was unassessable/high due to generated untracked CodeGraph inventory; obtain the canonical inventory and explicitly exclude it before reassessment. No risk is inferred lower from that failure; candidate consent remains independent.
- OC-1 functional outcome and local commit are complete; native review disposition is pending. OC-2 remains unstarted. Engram mirror pending as above.
