# Isolate restaurant operations by branch

Implement operational branch isolation across orders, kitchen/table flows, checkout, cash registers, and reporting while preserving tenant-level ownership and consolidated owner visibility. The human authorized independent per-branch registers, a consolidated owner view, and inclusion of the existing delivery flow; this document tracks that bounded feature. T1 delivery routing is in progress; T2–T4 remain unstarted.

## Outcome and constraints

- **Problem:** the system has tenant identity and branch assignment, but operational records and workflows must not let one branch inspect or mutate another branch's work or cash.
- **Outcome:** staff and cash operations are constrained to their current assigned branch; owners retain explicit tenant-wide consolidated visibility and can select a branch for operations. Delivery orders are bound to an explicitly selected tenant branch.
- **Source root:** `C:\Users\adolf\.codex\worktrees\restaurant-ui-redesign\Restaurant`.
- **Planning base:** `1862c7aa06b4acb56b8d3240437bffb838491aaa` on `codex/backend-test-stability`; planning checkpoint `53e7f7768ec66cb16cc4f8a76435e701589873d9`. Tracker branch `codex/branch-isolation` exists. T1 runs on child `codex/branch-isolation-delivery` from `53e7f7768ec66cb16cc4f8a76435e701589873d9`.
- **Authorization:** local branch-isolation implementation, tests, documentation, and conventional work-unit commits. No remote work, push, PR, merge, deployment, or live data operation is authorized.
- **Forecast:** approximately 1,720–2,550 authored changed lines across the four work units below; generated files excluded. This is an estimate, not proof or a cap. The roughly 400-line PR budget requires one honest slicing pass; never omit tests or reduce behavior to fit.
- **Delivery:** `ask-on-risk`, with human-approved `feature-branch-chain`: review work units separately and integrate the complete feature into the tracker before any eventual main delivery. Child 1 targets the tracker; later children target their immediate parent. No push, PR, merge, or deployment was authorized by this strategy choice. Keep each future PR within 400 authored changed lines or obtain a specific exception after one honest slicing pass.
- **Memory:** Engram mirror `odd/branch-isolation/tasks` is pending because the authoritative runtime session identity is not registered. This local document is the authoritative recovery copy; do not write memory with an invented, stale, or omitted identity.

## Invariants and non-goals

| Area | Required invariant |
|---|---|
| Identity and access | Tenant ownership is not branch membership. Preserve existing function/role authorization. Staff branch scope comes from a fresh database user record, never a request payload. Owners keep explicit tenant-wide view and explicit branch selection for branch operations. |
| Missing or legacy branch | Missing, foreign, or operationally disabled branch fails closed for staff operations. Preserve branchless legacy records for authorized admin read, payment, close, and reconciliation; never backfill or infer historic ownership. Do not expose them to an arbitrary staff branch. |
| Delivery and pickup | Existing pickup keeps explicit selected-branch behavior. Delivery joins the same branch-bound order lifecycle, requires an explicit selection, and does not reuse `pickup_enabled` as delivery eligibility. Bind branch identity into request fingerprint/idempotency before writes; exact retries preserve the original branch, changed-branch retries conflict. No automatic single-branch default. |
| Operational records | Orders, kitchen transitions, table/zone operations, guest links, resume/close, payments, proofs, voids, history, and event streams cannot cross branch scope. Preserve immutable attention-number branch/date snapshots. |
| Cash | Each branch has an independent open register and branch-scoped cashier operations. Owners can view consolidated registers across their tenant and select a branch for operations. New payment/movement records snapshot order/register branch identity. Preserve existing financial formulas and idempotency. |
| Explicit exclusions | No new staff-delivery composer, courier capability, per-branch prices, public branch approval workflow, branchless-record backfill, independent account/occupancy model, outbox/exactly-once redesign, or live index migration. Do not change unrelated money behavior. |

## Work units

All four tasks are **delegated direct**: each includes multi-file behavior and tests, and reading that prepares implementation belongs with its writer. Strict TDD is enabled by the human's project instructions. Each task must observe its own RED before source changes, then GREEN and refactor verification. Each task closes only after functional proof and its conventional work-unit commit on the feature branch; parent owns commit/native review and records actual commit IDs here after they exist.

### T1 — Bind delivery orders to an explicit branch (220–350 lines)

- [x] Require an explicit, tenant-owned branch for delivery creation, reject missing/foreign selections before order or counter writes; reject disabled branches only where an existing explicit eligibility field supports that rule, and include branch identity in idempotency/fingerprint behavior.
- [x] Reuse the existing branch selector pattern in checkout without treating `pickup_enabled` as delivery eligibility or defaulting to a sole branch. Keep pickup and dine-in behavior unchanged.
- [x] Preserve the accepted branch snapshot on the order and exact retries; reject changed-branch reuse of the same request key.
- **Likely files:** `backend/routes/public.py`, `frontend/src/pages/Checkout.jsx`; `backend/models.py` only if inspection proves the optional field insufficient.
- **Tests:** `tests/test_delivery_branch_routing.py` and `frontend/src/__tests__/CheckoutBranchSelection.test.js`; retain relevant pickup selector tests. Both new test paths now exist.
- **Dependencies:** none. T2 will later enforce operational branch scope on this branch-bound order.
- **Rollback boundary:** remove the delivery branch requirement, fingerprint binding, and selector changes with their tests; leave existing pickup and table selection intact.
- **Verification:** RED/GREEN exact named Python tests with the safe fake-only runner below; targeted frontend command below. No live public endpoint or database test.

### T2 — Enforce branch scope for staff, tables, and kitchen work (550–800 lines)

- [ ] Add/reuse a small backend branch-access policy based on current database user data, retaining tenant and function-role checks.
- [ ] Scope list, detail, ID-based mutations, kitchen transitions, table/zone operations, guest links, resume/open/close flows, and relevant SSE/event fanout. A foreign-branch identifier must preserve not-found behavior and disclose no data.
- [ ] Keep owner tenant-wide visibility explicit; require an explicit selected branch for owner branch operations. Preserve legacy branchless records for authorized administration without assigning them to a branch.
- [ ] Ensure zone propagation and branch reassignment remain compatible with existing compare-and-set behavior and are blocked when an active attention or opening reservation makes reassignment unsafe.
- **Likely files:** `backend/branch_access.py`, `backend/routes/orders.py`, `backend/routes/tables.py`, `backend/routes/zones.py`, notification producer/consumer files only where inspection finds an existing branch event path, and `tests/test_branch_isolation.py`.
- **Tests:** fake-only cases for branches A/B, tenant mismatch, payload branch spoofing, fresh staff reassignment, owner views, legacy branchless data, missing/disabled branch, and no-side-effect rejection. New paths are planned, not present.
- **Dependencies:** T1's branch-bound delivery order for end-to-end delivery scope. Keep this task focused on enforcing scope for existing operational surfaces.
- **Rollback boundary:** remove the branch-access policy and its route/event integrations plus tests; do not revert T1 order identity behavior.
- **Verification:** scoped route and fake tests; no real HTTP listener, database, or external service.

### T3 — Separate branch registers and cash operations (700–1,000 lines)

- [ ] Scope payment creation/replay, proof, history, void, refund, and register operations through the owned order and its immutable branch before reads or writes.
- [ ] Snapshot branch identity on new payments/movements and bind register selection to an explicit branch. Enforce at most one open register per `(restaurant_id, branch_id)` while allowing different branches to operate independently.
- [ ] Let assigned cashiers operate only within their branch. Provide owners a tenant-wide consolidated register view and explicit branch selection for open/close/cash actions.
- [ ] Preserve existing cash arithmetic, payment invariants, idempotency, and authorization. Keep any new UI controls scoped to the existing Caja experience.
- [ ] Replace the tenant-only unique-open-register assumption with a partial unique tenant+branch rule for new branch-bound registers while preserving branchless legacy records for admin reconciliation. Do not silently drop indexes, backfill live data, or run a migration during startup. Document the required separately approved deployment/migration precondition; stop if it cannot be made safe within this task.
- **Likely files:** `backend/routes/payments.py`, `backend/routes/cash.py`, `backend/database.py`, `backend/models.py` only if needed, `frontend/src/pages/Caja.jsx`, and focused fake/UI tests.
- **Tests:** same-branch concurrent opens have one winner; different branches can open independently; payment/retry/proof/void and close affect only the order's branch/register; owner consolidation; cashier isolation; branchless admin reconciliation. Fake-only; no production database/index operation.
- **Dependencies:** T2 access policy and T1 branch-bound orders. Existing staff assignment is reused; if no safe cashier assignment source exists, return that gap to the parent rather than inventing one.
- **Rollback boundary:** revert register identity/scope and Caja controls with tests as a unit; preserve T1/T2 order and branch access behavior. Any live index transition is explicitly outside rollback scope and requires its own authorization and plan.
- **Verification:** exact fake-only backend checks and focused Caja UI tests; index behavior is verified as pure configuration/model logic, not against a live server.

### T4 — Align reporting and close scoped regression coverage (250–400 lines)

- [ ] Constrain staff report filters and aggregates to their assigned branch; owner consolidation remains explicitly tenant-wide. A query parameter must not bypass the server-side scope.
- [ ] Verify aggregate JSON and any remaining SSE/event delivery cannot leak cross-branch records; add only fanout changes needed to complete earlier scoped producer/consumer work.
- [ ] Run the focused new backend/frontend tests and the approved fake-only regression modules. Report every unavailable, failed, or skipped check; do not claim live-system certification.
- **Likely files:** `backend/routes/reports.py`, any remaining scoped event surface only if required, and focused regression tests.
- **Dependencies:** T2 access policy and T3 branch/register data model.
- **Rollback boundary:** revert report/fanout filters and their tests without undoing access, order, or cash identity units.
- **Verification:** exact named fake-only backend tests, frontend tests/build below, and final structural diff check. No live HTTP/DB test.

## Verification plan

Use the existing `.venv-oc5\Scripts\python.exe -I -B` only, with process-only `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`, `PYTHONDONTWRITEBYTECODE=1`, `MONGO_URL=mongodb://127.0.0.1:1`, and `DB_NAME=audit_in_memory_only`. Add the isolated `backend` directory explicitly; invoke pytest with `-vv --tb=short -p no:cacheprovider` and exact named test paths. Inspect each selected test's safety before execution. Do not invoke generic pytest discovery, `conftest` routes with external access, live HTTP, MongoDB, server startup, or install/global-setting operations.

For focused checkout selection tests, use `npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/CheckoutBranchSelection.test.js src/__tests__/PickupBranchSelection.test.js`. The full frontend test command was run for T1 as recorded below. The build command began but did not complete; do not rerun without the parent bounded verification plan. The ten approved fake-only regression modules recorded in `/odd/tasks/deterministic-backend-tests.md` passed within the 204-test T1 closure.

## Progress and recovery

- **Task state:** T1 functional outcome accepted after writer, independent verifier, and parent spot check; work-unit commit is being recorded. T2–T4 remain unstarted. Checkboxes are not native review or publication authority.
- **TDD configuration:** strict TDD enabled by the project instructions; use RED → GREEN → REFACTOR for each testable task.
- **Route:** delegated direct per task. Record the exact delegation trigger and observed result in progress updates.
- **Feature branch and strategy:** `codex/branch-isolation` tracker; `feature-branch-chain` approved. T1 child is `codex/branch-isolation-delivery`, based on planning checkpoint `53e7f7768ec66cb16cc4f8a76435e701589873d9`. Child PRs would target the tracker and later children their immediate parent; no PR/push/merge is authorized. Parent owns commits and native review.
- **RED:** before production changes, named backend tests had 4 failed / 6 passed (missing delivery branch enforcement, branch persistence, and fingerprint binding); existing pickup tests all passed. Named UI tests had 2 failed / 4 passed (delivery selector/availability absent); pickup UI tests passed. A first post-change focused UI run exposed the new helper using the input setter on a textarea; the helper was corrected and focused tests then passed. No assertion was weakened.
- **Backend GREEN:** exact T1 delivery plus ten approved fake-only modules: 204 passed / 0 failed / 5 warnings in 1.49s.
- **Focused frontend GREEN:** named checkout/pickup tests: 2 suites passed, 6 tests passed, 0 failed in 2.254s.
- **Full frontend tests:** 21 suites passed, 1 suite skipped (22 total); 104 tests passed, 18 skipped (122 total) in 11.887s. Skips are reported, not represented as executed.
- **Build:** `npm run build` began `craco build` and printed “Creating an optimized production build...” plus a Node deprecation warning, then showed no progress for 60 seconds. The owned foreground command received Ctrl-C once and returned exit code 1; build is incomplete/unverified. No retry was made. No separately owned child process was observed or left intentionally running; process-tree status was not independently inspected.
- **Runtime harness:** N/A for T1 fake-only API tests and mocked Checkout UI; no real HTTP listener, database, or external service was used.
- **Authored scope:** `backend/routes/public.py`, `frontend/src/pages/Checkout.jsx`, `tests/test_delivery_branch_routing.py`, and `frontend/src/__tests__/CheckoutBranchSelection.test.js`. Authored estimate: approximately 324 lines (tracked source diff 66 lines changed; new test files 232 lines; task-document diff 26 lines changed). `git diff --check` passed on the final working diff; only line-ending warnings were reported.
- **Commit IDs:** none for T1; record only actual commit identities after parent creates them.
- **Mirror:** `odd/branch-isolation/tasks` pending authoritative runtime session registration; this local file is the recovery source.
- **Next step:** parent structural readback and acceptance; resolve incomplete frontend build according to its verification policy, record actual diff count, then parent owns T1 commit and native assessment. Dispatch T2 only after T1 closure.

### T1 independent closure evidence

- Independent backend check: the exact eleven named fake-only modules passed 204/204 in 1.48s, with five existing deprecation warnings.
- Independent focused frontend check: two suites and six tests passed in 1.733s.
- One bounded independent build completed successfully in about 40 seconds. The earlier interrupted build remains historical incomplete evidence; it is not the final outcome. The successful build emitted ignored local `frontend/build` files and one Node `DEP0176` warning.
- Parent spot check: `test_delivery_branch_routing.py` passed 5/5. Staged and unstaged diff checks passed; no unrelated source changes were observed.
- Current branch schema has `pickup_enabled`, but no explicit delivery-enabled or active state. Delivery selection uses registered branches from the current restaurant, not the pickup eligibility flag; adding delivery availability controls is outside T1. Legacy exact branchless retries remain unchanged and do not infer ownership.
- Live browser, HTTP, database, and deployment behavior remain unverified. The full frontend test run's 18 skipped tests remain skipped, not executed.
- Prospective native risk: medium, 324 authored changed lines, `review_due=false`, `under_budget`. The planning checkpoint was passive; T1's review boundary remains `53e7f7768ec66cb16cc4f8a76435e701589873d9` until a due range is acknowledged.
