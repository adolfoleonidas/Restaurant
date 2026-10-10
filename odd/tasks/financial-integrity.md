# Preserve financial integrity before production

## Objective and authority

Fix the audited payment, account merge/split, and cash reconciliation defects without changing production data or Mongo deployment topology. The maintainer authorized phase-one implementation and confirmed feature-branch-chain delivery on 2026-10-09. The target deadline is 2026-10-10 04:00 America/Lima, not a guarantee or a reason to skip verification.

- Baseline: `581b3b81136a1f75b9d5911494f67639b1875499`.
- Feature branch: `codex/financial-integrity`.
- Scope: mixed payment change, complete shift totals, crash-recoverable payment creation and merge/split operations, regression tests and this recovery record.
- Excluded: unrelated security/UI refactors, real database access, server execution, deployment, existing untracked audit/mock/document files.
- Current authorization covers local development and work-unit commits. GitHub publishing/main delivery remains a separate action after verified implementation.
- Artifacts use English; extend existing Spanish API/UI copy in neutral Spanish.

## Implementation and delivery

- Route: delegated direct, not SDD. Each task needs multi-file behavior/test changes and preparation reading.
- Delivery strategy: `ask-on-risk`; chain strategy: `feature-branch-chain`, explicitly reconfirmed. Plan one independently reviewable work unit per child PR and a final integration tracker. No final tracker size exception is assumed for this feature.
- Initial forecast: 430-750 authored additions plus deletions, excluding generated files. Preserve clear code and tests rather than compressing to a line budget. Revise estimates from actual diffs.
- RDD: clone-local off, verified read-only by `gentle-ai review mode status`; do not enable or start native review.
- TDD: enabled by the supplied AGENTS.md Strict TDD Mode. Observe RED before source changes, GREEN, then REFACTOR. Never infer failing-test chronology.
- Runner: `backend/.venv/Scripts/python.exe -B -m pytest`; use inert local Mongo environment and verified in-memory fixtures, never an ambient/live database.
- Focused command: `backend/.venv/Scripts/python.exe -B -m pytest tests/test_money_integrity.py -q -p no:cacheprovider`.
- Isolated preflight command: `backend/.venv/Scripts/python.exe -B -m pytest tests/test_deploy_preflight.py -q -p no:cacheprovider`.
- Set `PYTHONDONTWRITEBYTECODE=1` and `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` where fixtures support it. Do not install dependencies or start services without separately resolving the need.
- Functional checks: task-specific regressions, existing payment/concurrency/refund/order-flow regressions, complete applicable isolated suites and `git diff --check`. Independent verification plus a parent spot check before closure. Real-backend E2E remains unperformed until a safe isolated runtime is available.
- Approach constraint: evaluate existing durable intent/recovery patterns; no replica-set deployment or schema migration on production is authorized. Recovery must survive process interruption, not merely caught exceptions.

## Work units

- [x] FI-01 — Reject mixed payments when returned change exceeds cash tender; prove every accepted payment attributes exactly its charged amount. Include the audited S/40 charge, Yape S/50, cash S/10, change S/20 case and valid cash-change/replay cases.
  - Route: delegated writer; payment validation, shared billing and tests are non-trivial coordinated files.
  - Estimate: 40-70 authored lines. Rollback boundary: only mixed-change validation and associated regressions.
  - Progress: route rejects change above cash tender, requires every mixed tender component to be representable at cent precision, and verifies the actual shared `method_amounts` attribution equals the charged amount before any write. Tests cover the audited S/40/Yape S/50/cash S/10/change S/20 rejection, valid S/100 cash change + idempotent replay, sub-cent over-attribution rejection before writes, and valid S/0.03 cent-level attribution. Shared `method_amounts` remains unchanged; route validation now guarantees it cannot round accepted tender components into excess attribution.
  - TDD evidence: initial over-change selector failed on the unmodified route (`DID NOT RAISE HTTPException`, 1 failed, 45 deselected). The subsequent sub-cent selector also failed before the correction (`DID NOT RAISE HTTPException`, 1 failed, 47 deselected). After correction, both sub-cent reject and ordinary-cent acceptance tests passed (2 passed, 47 deselected, 9 warnings in 1.21s).
  - Verification: exact focused suite passed (49 passed, 56 warnings in 3.35s); deploy preflight passed (8 passed, 10 warnings in 0.16s); `git diff --check` passed (only Git LF-to-CRLF working-copy warnings). Independent verification and parent spot-check remain pending; do not check FI-01 complete yet. Current authored diff: 125 changed lines (16 additions + 1 deletion in route; 108 test additions). Rollback boundary: revert only `backend/routes/payments.py` mixed-payment validation and `tests/test_money_integrity.py` regressions; unrelated untracked audit/mock/document files remain untouched.
- [x] FI-02 — Eliminate silent cash-shift truncation above 5,000 payments and 1,000 movements while preserving response contracts and complete totals.
  - Route: delegated writer; query semantics and overflow fixtures require analysis and tests.
  - Estimate: 40-80 authored lines. Rollback boundary: shift query/reconciliation changes and associated regressions.
  - Progress: `_shift_totals` now materializes the full filtered payment cursor and full sorted register-movement cursor with Motor's `to_list(None)`, then computes complete totals. The movement response remains capped at the prior 1,000 rows to preserve its existing payload-size behavior; no history/report caps changed.
  - TDD evidence: the separate 5,001-payment and 1,001-movement regressions each failed before the source edit at S/50.00 vs S/50.01 and S/10.00 vs S/10.01 respectively. After implementation, both overflow regressions passed (2 passed, 49 deselected, 9 warnings in 1.03s).
  - Verification: full money suite passed (51 passed, 58 warnings in 1.95s); isolated deploy preflight passed (8 passed, 10 warnings in 0.15s); `git diff --check` passed (only Git LF-to-CRLF working-copy warnings). Independent verification and parent spot-check pending; leave FI-02 unchecked. Actual diff: 48 changed lines (3 insertions + 3 deletions in `backend/routes/cash.py`; 45 test additions). Rollback boundary: revert only complete shift-cursor reads/response slice and FI-02 overflow tests. Known performance limit: totals now fetch and hold every matched payment and movement in memory (O(N)); API movement list itself remains at most 1,000 rows. A future aggregation/paged-streaming change could reduce peak memory if real shift sizes warrant it; not needed to correct this bounded defect. Unrelated untracked assets remain untouched.
- [ ] FI-03 — Make payment creation durably recoverable across the order/ledger write boundary. A retry must recover the same operation without duplicate charging or an unrecoverable settled order without payment evidence.
  - Route: delegated writer; payment state machine, CAS/idempotency, helpers and failure-injection tests require analysis.
  - Estimate: 150-250 authored lines. Rollback boundary: new payment intent/recovery behavior and tests; account for persisted in-flight operations before removing recovery code.
- [ ] FI-04 — Make merge/split operations crash-safe and retryable. Inject failure after each write boundary and concurrent edits; each original item must remain in exactly one active account with matching totals and attention membership after recovery.
  - Route: delegated writer; multi-account operation state and failure-injection tests require analysis.
  - Estimate: 200-350 authored lines. Rollback boundary: merge/split intent/recovery behavior and tests; preserve or recover any persisted unfinished operations first.

## Progress and recovery

- FI-01 independently verified: money suite 49 passed (56 non-failing warnings), isolated deploy preflight 8 passed (10 non-failing warnings), and parent spot-check `git diff --check` passed. A read-only in-memory endpoint repro confirmed sub-cent splits now return HTTP 400 with zero payment rows and unchanged order balance. The actual shared accounting computation is checked before writes, not merely raw split sums. Initial and corrective RED/GREEN evidence is recorded with the work unit. RDD assessment was unavailable/high because of unrelated untracked inventory; clone-local RDD remained off, and independent functional verification was used instead.
- FI-01 work-unit commit: `8bb8865103d7f692b3ddf30d0a581ac512f67ca9` (`fix(payments): reconcile mixed cash change before charging`), 175 additions / 1 deletion including the initial recovery document. Source/test portion: 124 additions / 1 deletion. Planned first chain boundary is this verified work unit plus its bookkeeping; no remote delivery was performed.
- FI-02 independently verified: complete ledger calculations include the 5,001st payment and 1,001st movement, while the sorted movement response remains capped at 1,000. Existing register/tenant/branch/time/status filters are unchanged. Independent money suite: 51 passed (58 non-failing warnings); isolated deploy preflight: 8 passed (10 non-failing warnings); parent `git diff --check` passed. Assessment remained unavailable/high because of unrelated untracked inventory; RDD stayed off. Known tradeoff: full cursor materialization has O(N) memory cost; live Motor/database scale was not tested.
- FI-02 work-unit commit: `5dd4138c2c3d3aa6eb6fbf0b840a8479e9bb268a` (`fix(cash): reconcile complete shift ledgers`), 54 additions / 5 deletions including recovery evidence. Cumulative work-unit changes including FI-01 bookkeeping: 238 authored lines. Second chain boundary is this verified work unit plus bookkeeping; remote delivery remains held.
- Next: implement FI-03. No live database or backend E2E verification has been performed.
- Record observed RED/GREEN commands, independent checks, commit identities and actual slice counts per task. Check off only proven outcomes.
- Engram mirror `odd/financial-integrity/tasks` is pending: the runtime has not supplied an authoritative registered session identity. Agent-attributed Engram calls are prohibited; this local document is the recovery record until registration is restored.
