# Backend core consolidation (audit stage 2)

## Objective and problem

The 2026-10-12 audit (Engram `audit/full-2026-10`) found money math and branch-scope rules duplicated across route files, even though `billing.py` and `branch_access.py` already exist. Duplicated rules drift: one copy gets a fix, the others do not. This stage makes each rule live in one place, without changing observable behavior, and closes the remaining input-validation gaps.

## Scope and authority

- Branch: `refactor/backend-core`, stacked on `fix/production-blockers` (stage 1, not yet merged). Delivery strategy: `feature-branch-chain` (stage 1 PR first, this one on top).
- User authorized stage 2 in chat on 2026-10-12.
- Backend only (`backend/`, `tests/`) plus this document. No frontend changes.
- Behavior-preserving refactor: characterization tests first; API responses, status codes, and stored documents stay identical unless a task says otherwise.
- Preserve unrelated untracked roots: `.audit_tmp/`, `.tmp/`, `aprendisaje/`, `docs/audit/`, `documentos/`, `frontend/.tmp/`.
- No push, PR, merge, deploy, database, or remote operation without a separate user decision.

## Out of scope (deferred, need their own decision)

- Float to integer-cents money storage (requires a data migration).
- Tenant-scoped repository wrapper for all ~286 `restaurant_id` predicates.
- Redis pub/sub for multi-process realtime.

## Implementation and checking

- Route: delegated direct, one bounded writer (4+ files, coordinated refactor).
- TDD: **on**, source: global user configuration. For refactors, RED means a characterization or new-contract test that fails before the change where a contract changes; pure moves are proven by the existing suite staying green plus new direct unit tests of the consolidated helper.
- Backend runner (repo root, hermetic): `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q`. Baseline on this branch: 473 passed, 49 deselected.
- RDD: **off** (`clone_local`).

## Tasks

- [x] **BC-01 Single `BillError` to HTTP mapping.** `routes/public.py:253` (`_money_totals`) and similar wrappers in `routes/orders.py` only convert `BillError` into `HTTPException`. Register one FastAPI exception handler (same status and detail as today) and delete the wrappers.
- [ ] **BC-02 All money math in `billing.py`.** Totals are computed in `routes/orders.py:123,135,962`, `routes/public.py:794,924`, `routes/payments.py:492-555` (including hand-made `unit_price * quantity` at `:510`). Move every line and order total calculation into `billing.py` functions and have routes call them. Characterization tests must pin current totals (modifiers, combos, discounts, voided lines) before moving.
- [ ] **BC-03 One branch-scope helper.** Fold `_payment_branch_scope` (`payments.py:52`), `_cash_branch`/`_branch_query` (`cash.py:84,103`), `_report_branch_filter` (`reports.py:40`), `_order_lookup_scope` (`orders.py:62`), and `_table_lookup_scope` (`tables.py:80`) into parameterized functions in `branch_access.py`. Existing branch-isolation tests must stay green; add direct unit tests for the helper.
- [ ] **BC-04 One branch validator.** `_validate_branch` is duplicated in `routes/zones.py:16` and `routes/tables.py:34`, overlapping `routes/users.py:11` and `branch_access.validate_user_branch`. Keep one.
- [ ] **BC-05 Close input-validation gaps.** In `models.py`: table `number` and `capacity` bounded and positive; `preparation_time`, `sort_order`, `ApprovalCreate.amount` non-negative and bounded; password minimum length 8 on create/update; `max_length` on free-text fields (`notes`, `customer_*`) and on order `items` lists. Replace deprecated `Query(regex=)` with `pattern=` (`payments.py:314`, `cash.py:162`, `reports.py:123,188`). Contract change: invalid input now returns 422.

## Delivery forecast

About 350 to 500 authored changed lines across five work-unit commits. Strategy: `feature-branch-chain`.

## Progress and evidence

- 2026-10-12: document created; branch created from `fix/production-blockers` (`3ec5fe9`).
- BC-01 (commit recorded in the next entry): `backend/error_handlers.py` registers one `BillError` handler (400, `{"detail": ...}`, same body as the old `HTTPException`); `server.py` calls it; `_money_totals` (public) and `_apply_bill` (orders) and the `assert_can_cancel` try/except were deleted. Routes call `guarded_totals` directly.
  - Evidence: new `tests/test_error_handlers.py` drives a raw ASGI call through a route raising `BillError` and asserts status 400 and the exact detail, that other `HTTPException`s are untouched, and that `server.app` has the handler registered. (Test written together with the handler, so no separate RED run was observed.)
  - Existing-test change: three direct-call tests in `tests/test_money_integrity.py` (`test_cannot_remove_an_already_paid_item`, `test_cannot_shrink_an_item_below_what_was_paid`, `test_cannot_cancel_while_money_was_collected`) asserted `HTTPException(400)` from the route function. With the wrapper gone the route raises `BillError`, so they now assert `BillError` and its exact detail; the 400 mapping is covered by the new handler test. No other test changed.
  - `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q`: 484 passed, 49 deselected (473 baseline + 7 characterization tests for BC-02 + 4 handler tests).

## Next step

Delegate BC-01 to BC-05 to one writer.
