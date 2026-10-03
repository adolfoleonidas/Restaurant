# Restore deterministic backend regression checks

Stabilize the existing fake-only backend checks without changing production behavior. The user approved test stabilization and branch isolation; this document tracks the independent test-stability work unit only. Branch isolation remains pending its cash and delivery policy decisions.

## Scope and authority

- Source root: `C:\Users\adolf\.codex\worktrees\restaurant-ui-redesign\Restaurant`.
- Branch: `codex/backend-test-stability`; base: `1530e8bd7fc39b8be29d8899bb0afbbc12f612ab`.
- Authorized: local test fixes, in-memory regression checks, documentation, and conventional work-unit commits. T1 covers the same missing-collection fixture repair in `test_attention_numbering_routes.py`, `test_table_branch_assignment.py`, `test_pickup_branch_selection.py`, and `test_attention_lifecycle.py`.
- Excluded: production source changes, branch authorization implementation, schema/index changes, migration/backfill, remote operations, deployment, installation, or global settings.
- Preserve the Downloads checkout, other worktrees, existing environment, and CodeGraph assets.

## Work unit

- [x] T1 — Freeze the numbering-route clock, complete public-order database fakes, bound the race-test wait, and scope lifecycle-test patches. Ten-module closure is green after removing the shared test-state leak.

Route: delegated direct. Two non-trivial test files and execution checks trigger delegation. Read-only preparation identified all three failure causes and the unreachable event; no source writes preceded this document.

Estimated authored changes: 100–180 lines including this tracker. Delivery strategy: `ask-on-risk`; no push, PR, merge, or deployment authorized. The approximately 400-line work-unit heuristic is advisory, never grounds to omit tests or compress code. Native RDD is on (global); new candidate consent remains independent. Initial review boundary is the base above.

## Acceptance and constraints

- The fixed business-date assertion uses an explicit aware UTC clock, not today's date or changed production date logic.
- All four affected fake databases provide `payment_configs` using existing in-memory collection semantics.
- The race test cannot await an unreachable event indefinitely; timeout cleanup retrieves/cancels the owned task safely and surfaces failures.
- Preserve the original concurrent branch-assignment scenario and its assertions.
- Tests do not contact HTTP, MongoDB, production, or any external service.
- Unrelated failures stay visible; do not weaken assertions, silently skip, or change production money behavior. T1 restores two temporary lifecycle-test substitutions that independent verification proved leak into later money tests.

## TDD and checks

Strict TDD: enabled by the user's AGENTS.md. Observe RED before fixing, GREEN after, then refactor and recheck. Earlier diagnostics identified the live-clock mismatch, absent payment-config fakes, and race wait blocked by setup failure. All repairs were preceded by named failing tests or reproducible prior test evidence.

Use only `.venv-oc5\Scripts\python.exe -I -B` with process-only `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`, `PYTHONDONTWRITEBYTECODE=1`, `MONGO_URL=mongodb://127.0.0.1:1`, `DB_NAME=audit_in_memory_only`; explicitly add the isolated backend path and invoke pytest with `-vv --tb=short -p no:cacheprovider` and absolute named test paths. No generic suite or unsafe fixtures. Run each command in the foreground with a bounded wait; interrupt only the owned process if stalled.

1. RED: the three identified tests in `tests/test_attention_numbering_routes.py` and `tests/test_table_branch_assignment.py`.
2. Focused GREEN: both complete affected modules, including the previously stalled race test.
3. Closure: `test_attention_numbering_routes.py`, `test_attention_numbering.py`, `test_user_branch_assignment.py`, `test_table_branch_assignment.py`, `test_branch_catalog.py`, `test_pickup_branch_selection.py`, `test_attention_lifecycle.py`, `test_money_integrity.py`, `test_order_flow_and_secrets.py`, `test_staff_payment_proof.py` only.
4. Parent spot check: focused fixed tests using the same isolated runner.
5. `git diff --check`; native risk assessment and applicable review transitions without inventing consent or authority.

## Progress and recovery

- Exploration completed: clock not frozen; two public-order fakes lack `payment_configs`; the missing collection prevents the race event from being signalled.
- Task state: functional outcome accepted after writer, independent verifier, and parent spot check. Local work-unit commit and native assessment pending. This checkbox is not review or publication authority.
- Initial RED: the named staff-confirmation test failed because the date depended on the live route clock; the table-order test failed because its fake lacked `payment_configs`; the third public race test stalled at the event wait and the owned process was interrupted once after 60 seconds. This was not three observed test failures.
- Expanded RED before fixture repair: all four named public-order tests in `test_pickup_branch_selection.py` (three) and `test_attention_lifecycle.py` (one) failed with `AttributeError` for missing fake `payment_configs`.
- Focused GREEN for all four affected modules: 107 passed / 0 failed / 5 warnings in 2.36s. The route clock is frozen to aware UTC 2026-10-02 11:00; affected fakes use their existing in-memory collection implementations; the race-event wait is bounded and propagates task errors if setup fails.
- Independent diagnostic correction: the ten-module run's two money failures were test-order leaks, not production money defects. The independent verifier observed the money module alone pass 27/27 and the selected two tests alone pass 2/2; at base `1530e8b`, the lifecycle test file directly replaces `order_routes._compute_total` near line 388 and `order_routes.assert_can_cancel` near line 541 without restoring either. Production route, billing, order-flow, model, and money-test files are blob-identical to base; this establishes the leaking test state on base but is not a full-base test run.
- Lifecycle leak RED: the ten-module run after fixture expansion was 197 passed / 2 failed / 5 warnings in 3.58s; the two failures were `test_cannot_cancel_while_money_was_collected` (did not raise `HTTPException`) and `test_editing_items_keeps_the_delivery_fee` (expected subtotal 30, got 20.0). Replaced only the two temporary global assignments with pytest-scoped monkeypatches in those lifecycle tests.
- Four-module focused GREEN after all fixes: 107 passed / 0 failed / 5 warnings in 1.85s.
- Ten-module closure after all fixes: 199 passed / 0 failed / 5 warnings in 1.95s.
- Verification: independent verifier repeated the exact ten modules: 199 passed / 0 failed / 5 deprecation warnings in 1.59s. Parent repeated the fixed cases plus lifecycle-before-money regression: 54 passed / 0 failed / 5 warnings in 1.17s. Parent and verifier structural readback and `git diff --check` passed. Initial assessment was unassessable due to untracked generated files; no review consent or receipt exists. Frontend checks were not rerun because no frontend files changed; no live DB, HTTP, production, or unrestricted discovery was tested.
- Commit evidence: pending.
- Engram mirror `odd/deterministic-backend-tests/tasks`: pending because the runtime hook has not confirmed registration after compaction. Do not write with a retained, invented, or omitted session identity. The complete local document is the recovery source until the host restores registration.
- Next step: parent creates the authorized local work-unit commit, records its identity, and follows native assessment. No commit was created by this worker. Separate branch-isolation work needs a focused cash policy decision; this task does not resolve it.

## Independent diagnostic correction

The ten-module rerun reproduced 197 passed / 2 failed in 4.82s. The money module alone passed 27/27; both selected tests alone passed 2/2. `tests/test_attention_lifecycle.py` directly replaces `order_routes._compute_total` and `order_routes.assert_can_cancel` without restoring them. Both assignments exist in base `1530e8b`; production routes, order flow, models, billing, and the money tests are unchanged. This proves the shared test-state leak exists on base, but is not a full baseline-suite run or a production money defect. The scoped monkeypatch correction is now implemented and the exact ten-module suite passes.
