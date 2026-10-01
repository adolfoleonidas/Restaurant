# Operational flow corrections

Correct the audited lifecycle blockers before publishing the local attention changes. Preserve the published UI/login and the original dirty checkout.

## Authorized scope
The user approved correction, verification, publication, and merge through stacked-to-main PRs. Work in this isolated checkout based on origin/main c837c77. No production transactions, SSH, destructive reset, seed changes, or edits to synced PRD originals. Full multi-table grouping and completion of the entire PRD are not part of this correction.

## Configuration
- TDD: enabled by explicit user instructions. Observe RED -> GREEN -> REFACTOR for each behavior.
- Backend runner: C:/Users/adolf/Downloads/07_Proyectos-Codigo/Restaurant/backend/.venv/Scripts/python.exe -m pytest (from this checkout).
- Frontend runner: npm test -- --watchAll=false --runInBand; npm run build.
- Mongo: checked Compose is standalone; do not assume multi-document transactions.
- Delivery: auto-chain; chain strategy: stacked-to-main; each PR <=400 authored additions plus deletions.
- Native review: on (global). Candidate consent remains human-owned.
- Engram mirror: odd/operational-flow/tasks, PENDING; runtime session identity unavailable, memory writes prohibited.

## Tasks
- [x] OF-1: Separate payment request from food fulfillment; retain ready/paid food for delivery, block unsettled daily cash close. Route: delegated; multiple behavior/test files. Focused in-memory backend regression tests passed; integration-only cash-close suite intentionally not run (real HTTP/mutating harness). Work-unit commit recorded below; native review and publication remain pending.
- [ ] OF-2: Port explicit attention opening/closing with standalone-safe concurrent/retry behavior and history-preserving legacy handling. Route: delegated; multi-file new lifecycle. Validate payment ledger and all delivery requirements, failure injection, no premature table release, no duplicate attention.
- [ ] OF-3: Isolate QR guest order/tracking ownership under an open attention. Route: delegated; public routes, schema/indexes, tests. Preserve existing order capability lifetime, never infer old visits or expose another guest's order/balance.
- [ ] OF-4: Port close actions into the modern waiter/table/order UI without automatic unconfirmed cash recording. Route: delegated; multiple UI/test files. Verify explicit collection versus closure, permissions, frontend tests/build.
- [ ] OF-5: Run independent final readiness checks; publish and merge verified stacked PR slices, confirm GitHub deployment. Route: delegated verification and parent delivery. Preserve all failed/skipped/pending evidence.

## Acceptance and boundaries
- Payment request/confirmation is independent of food preparation/delivery.
- Only explicit verified attention closure releases tables; repeat operations are safe.
- QR capability stays scoped to its owner's order and balance.
- Unsettled operations block daily cash close.
- No irreversible handoff/reset code or unrelated seed changes enter any PR.
- Existing dirty work remains untouched. Synced PRD documents remain read-only and are a separate documentation task.

## Forecast and slices
About 900-1300 authored changed lines including tests and tracking, planning estimate only. Start with OF-1 as a standalone regression-fix PR. Determine subsequent cohesive slice boundaries from implementation; no code compression or test omission to fit budget. If one honest slicing pass cannot fit a coherent slice, stop and request a size exception.

## Progress and verification
Initial baseline: original dirty checkout targeted backend suite 36 passed / 5 failed; several failures are stale fixtures. Frontend build passed; original frontend had no tests. This is not verification of the isolated correction.
Reviewed boundary: c837c77bf8f99919ba7d153be1bc7ccd1c324481.
OF-1 work-unit commit: ce1dffae472d2733e6d2afcde99c80c9f906ad47 (217 authored changed lines including tracking). No PR published yet. Mirror pending as noted above.

OF-1 implementation evidence (isolated branch `codex/operational-flow`):
- Added regression coverage for ready orders after requesting payment, fully paid but unserved ready food, and cash-close rejection for active orders or unresolved payment proof.
- RED: request-payment cases exposed food fulfillment being overwritten, fully-paid ready food becoming `pagado` and blocked from service, duplicate serving after delivery, and all three cash-close cases failing to inspect unresolved orders/payment proof.
- GREEN: `backend/.venv/Scripts/python.exe -m pytest tests/test_order_flow_and_secrets.py tests/test_money_integrity.py -q` — 37 passed (5 existing dependency/deprecation warnings).
- The integration-only `tests/test_cash_close.py` was not run: it performs real HTTP requests and can mutate a running backend; the route guard is covered by in-memory database tests instead. No database, network, seed, or backend boot was used.
- Parent created the work-unit commit after confirming 37 focused unit tests passed. Native review-boundary assessment remains pending. Runtime API behavior has no live integration boundary here; mocked in-memory route coverage is the available harness.
- Rollback boundary: `backend/order_flow.py`, `backend/routes/orders.py`, `backend/routes/cash.py`, and the OF-1 regression tests in `tests/test_money_integrity.py`.

## Next step
Parent records and reviews the OF-1 work-unit commit, then continues with OF-2 after the usual review-boundary assessment.
