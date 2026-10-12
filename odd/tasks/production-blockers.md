# Production blockers (audit stage 1)

## Objective and problem

Close the six production-readiness defects confirmed by the 2026-10-12 full audit (Engram `audit/full-2026-10`) before any refactor work. Each fix is small, test-first, and independent.

## Scope and authority

- Branch: `fix/production-blockers`, rebased onto `origin/main` at `ec3c303` on 2026-10-12 (originally branched from the stale local `main` at `bf47b3d`). Independent of the unmerged `fix/salon-fixed-send`.
- User authorized stage 1 implementation in chat on 2026-10-12.
- Preserve unrelated untracked roots: `.audit_tmp/`, `.tmp/`, `aprendisaje/`, `docs/audit/`, `documentos/`, `frontend/.tmp/`.
- UI copy stays in neutral Spanish; code, comments, tests, and docs in English.
- No push, PR, merge, deploy, database, or remote operation without a separate user decision.

## Implementation and checking

- Route: delegated direct (one bounded writer; tasks touch backend, frontend, and infra files).
- TDD: **on**, source: global user configuration (`Strict TDD Mode: enabled`). RED observed before each production edit, then GREEN, then refactor.
- Backend runner (repo root, hermetic): `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q`.
- Frontend runner (`frontend/`): `CI=true npx craco test --watchAll=false` (focused with `--runTestsByPath`).
- RDD: **off** (`clone_local`). No review transaction.

## Tasks

- [x] **PB-01 Hide demo accounts in production login.** `frontend/src/pages/Login.jsx:15,143` renders demo credentials unconditionally. Render the "Cuentas demo" block only when `process.env.NODE_ENV !== 'production'` (or an explicit opt-in env flag). Test: block absent in production mode, present in development.
- [x] **PB-02 Order counter uses business day.** `backend/routes/orders.py:110` keys the daily counter on the UTC date, so numbering resets at 19:00 Lima. Use the existing business timezone (see `routes/reports.py`, `BUSINESS_TIMEZONE`). Test: an order created at 20:00 Lima on day D shares the counter key of day D.
- [x] **PB-03 Scope approval order lookup.** `backend/routes/approvals.py:47` loads the order with no `restaurant_id` and no branch authorization. Add the tenant predicate and the same branch authorization used by `payments.py` (`_authorized_order` or `branch_access`). Test: a cashier from another branch cannot create an approval for that payment.
- [x] **PB-04 Make the single-process SSE constraint explicit.** `backend/notify.py` keeps subscribers in process memory; multiple workers would silently drop events. Document the constraint in code and in the deployment docs, and fail fast at startup if more than one worker is configured (`WEB_CONCURRENCY` > 1). Redis pub/sub is a deferred follow-up for horizontal scaling.
- [x] **PB-05 Automated MongoDB backup.** No backup exists in `docker-compose*.yml`. Add a backup service (scheduled `mongodump`, compressed archives, retention) plus a restore runbook section.
- [x] **PB-06 Waiter table actions are recorded (decision B, 2026-10-12).** `backend/routes/tables.py` seat, release, and transfer stay open to any waiter of the branch (no ownership restriction), but each action must record who did it. Transfer already audited `user_id` only; seat and release recorded nothing. Now all three write an `audit_logs` entry via `record_audit` with actor id, name, role, branch, action, table id(s), and timestamp. Test: `tests/test_table_actor_audit.py`.

## Delivery forecast

About 250 to 350 authored changed lines across six work-unit commits. Strategy: `ask-on-risk`; one PR expected.

## Progress and evidence

- 2026-10-12: document created; branch created. No source edits yet.
- PB-01 (route: delegated direct, single writer). RED: `npx craco test --watchAll=false --runTestsByPath src/__tests__/LoginDemoAccounts.test.js` -> production-mode test failed (`Cuentas demo` still rendered), dev-mode test passed. GREEN: same command plus `LoginNavigation.test.js` -> 2 suites / 6 tests passed after gating the block on `process.env.NODE_ENV !== 'production'` (CRA inlines it, so prod bundles drop the block). Commit: bf7505a.
- PB-02. RED: `python -m pytest tests/test_order_counter_business_day.py -q` (hermetic env) -> 3 failed (no `_order_counter_key`; counter keyed on UTC date). GREEN: same command -> 3 passed after keying on `datetime.now(BUSINESS_TIMEZONE)` (imported from `routes.reports`). Full hermetic suite: 463 passed, 49 deselected. Note: the baseline on this tree (main bf47b3d, measured in a throwaway worktree) is 460 passed, not 492. Commit: da5029c.
- PB-03. RED: `python -m pytest tests/test_approval_branch_scope.py -q` (hermetic env) -> 3 failed, 2 passed (cross-branch payment, cross-branch order and cross-tenant order lookups succeeded). GREEN: same command -> 5 passed after `create_approval` used `_authorized_order` from `routes/payments.py` for both the payment and the order path. Full hermetic suite: 468 passed, 49 deselected. Behavior change: a payment whose order no longer exists now returns 404 instead of creating an approval without order context. Commit: 31ce41b.
- PB-04. RED: `python -m pytest tests/test_order_flow_and_secrets.py -q -k worker` (hermetic env) -> 1 failed (no worker guard), 1 passed (accepts 1/unset/non-numeric; a regression guard, passes by design). GREEN: whole file -> 12 passed after adding `assert_single_process` to `security_config.assert_runtime_config` (checks `WEB_CONCURRENCY` and `UVICORN_WORKERS`, in every APP_ENV). Docs: comment in `backend/notify.py` and `backend/Dockerfile`, runbook note (section 2) and "do not" entry in `docs/day-one-runbook.md`. Not testable: `uvicorn --workers N` on the CLI does not set an env var, so the guard cannot see it (documented as unsupported; the Dockerfile CMD is single process). Commit: a1e9bf0.
- PB-05 (infra/docs; no meaningful unit test). Validated: `docker compose config` with dummy env -> renders the `backup` service; `docker compose -f docker-compose.yml -f docker-compose.tls.yml config -q` -> ok (TLS override only touches `frontend`, so it is unchanged). Retention pipeline (`ls -1t | tail -n +8 | xargs rm`) checked on 9 dummy files in a temp dir -> newest 7 kept. NOT validated (containers were not started, per constraints): the live `mongodump` run, `mongorestore` command, and the restore path from Windows. Added `BACKUP_DIR`, `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP` to `env.example`, `/backups/` to `.gitignore`, and runbook section 12 "Backup y restauración". Commit: 9076e7c.
- PB-06 (user decision B authorized by the coordinator). RED: `python -m pytest tests/test_table_actor_audit.py -q` (hermetic env) -> 3 failed (seat/release wrote no audit entry; transfer entry had no `user_name`). GREEN: same command -> 3 passed after `record_audit` gained `user_name`, `user_role`, `branch_id` (additive top-level fields) and seat/release call it. Full hermetic suite: 473 passed, 49 deselected. Commit: 61b0c14.

- Final checks: backend hermetic suite 473 passed, 49 deselected; frontend full suite 52 suites / 321 tests passed (baselines of 492 and 61/438 quoted at delegation did not match this tree: main measured 460 backend passes).

## Rebase onto origin/main (2026-10-12)

New base: `origin/main` `ec3c303` (merged PRs #77 financial integrity chain, #80, #82, #84). Backup of the pre-rebase branch: `backup/fix/production-blockers` (`3ec5fe9`).

- Textual conflicts: none. The only files touched by both sides were `backend/routes/orders.py` and `tests/test_order_flow_and_secrets.py`; git merged both cleanly and the result was read back (PB-02 counter key helper intact, no origin/main logic changed).
- Semantic re-check: PB-03 still reuses `_authorized_order` from `routes/payments.py`, which exists unchanged on origin/main. PB-06 `record_audit` in `routes/table_groups.py` still serves seat, release and transfer on the new `tables.py`.
- No intent dropped or rewritten; computed amounts untouched.
- Commit hashes (old -> new): bf7505a -> 98d7947 (PB-01), da5029c -> f80fa0f (PB-02), 31ce41b -> 8606843 (PB-03), a1e9bf0 -> d530f54 (PB-04), 9076e7c -> 5ba187a (PB-05), 61b0c14 -> 7c01b38 (PB-06).
- Checks after rebase: backend hermetic suite 505 passed, 49 deselected (origin/main baseline: 492 passed, 49 deselected; delta +13 = this stage's new tests); frontend `LoginDemoAccounts` + `LoginNavigation`: 2 suites / 6 tests passed; `git diff --check origin/main...HEAD` clean.

## Next step

All six tasks are committed on `fix/production-blockers`. Pending user decisions: push and PR (one PR, or slices if the 400-line budget is judged exceeded). Not validated: live `mongodump`/`mongorestore`, and production Vite/CRA bundle contents (only the render path was tested).
