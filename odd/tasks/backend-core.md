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
- [x] **BC-02 All money math in `billing.py`.** Totals are computed in `routes/orders.py:123,135,962`, `routes/public.py:794,924`, `routes/payments.py:492-555` (including hand-made `unit_price * quantity` at `:510`). Move every line and order total calculation into `billing.py` functions and have routes call them. Characterization tests must pin current totals (modifiers, combos, discounts, voided lines) before moving.
- [x] **BC-03 One branch-scope helper.** Fold `_payment_branch_scope` (`payments.py:52`), `_cash_branch`/`_branch_query` (`cash.py:84,103`), `_report_branch_filter` (`reports.py:40`), `_order_lookup_scope` (`orders.py:62`), and `_table_lookup_scope` (`tables.py:80`) into parameterized functions in `branch_access.py`. Existing branch-isolation tests must stay green; add direct unit tests for the helper.
- [x] **BC-04 One branch validator.** `_validate_branch` is duplicated in `routes/zones.py:16` and `routes/tables.py:34`, overlapping `routes/users.py:11` and `branch_access.validate_user_branch`. Keep one.
- [x] **BC-05 Close input-validation gaps.** In `models.py`: table `number` and `capacity` bounded and positive; `preparation_time`, `sort_order`, `ApprovalCreate.amount` non-negative and bounded; password minimum length 8 on create/update; `max_length` on free-text fields (`notes`, `customer_*`) and on order `items` lists. Replace deprecated `Query(regex=)` with `pattern=` (`payments.py:314`, `cash.py:162`, `reports.py:123,188`). Contract change: invalid input now returns 422.

## Delivery forecast

About 350 to 500 authored changed lines across five work-unit commits. Strategy: `feature-branch-chain`.

## Progress and evidence

- 2026-10-12: document created; branch created from `fix/production-blockers` (`3ec5fe9`).
- BC-01 (commit `476e716`): `backend/error_handlers.py` registers one `BillError` handler (400, `{"detail": ...}`, same body as the old `HTTPException`); `server.py` calls it; `_money_totals` (public) and `_apply_bill` (orders) and the `assert_can_cancel` try/except were deleted. Routes call `guarded_totals` directly.
  - Evidence: new `tests/test_error_handlers.py` drives a raw ASGI call through a route raising `BillError` and asserts status 400 and the exact detail, that other `HTTPException`s are untouched, and that `server.app` has the handler registered. (Test written together with the handler, so no separate RED run was observed.)
  - Existing-test change: three direct-call tests in `tests/test_money_integrity.py` (`test_cannot_remove_an_already_paid_item`, `test_cannot_shrink_an_item_below_what_was_paid`, `test_cannot_cancel_while_money_was_collected`) asserted `HTTPException(400)` from the route function. With the wrapper gone the route raises `BillError`, so they now assert `BillError` and its exact detail; the 400 mapping is covered by the new handler test. No other test changed.
  - `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q`: 484 passed, 49 deselected (473 baseline + 7 characterization tests for BC-02 + 4 handler tests).
- BC-02 (commit `4fa90e2`): `billing.py` gained `line_subtotal`, `sum_line_subtotals`, `line_charge_amount`, `split_group_totals`, `public_order_totals`, `paid_total`, `balance_due`, `remaining_due`, `paid_after_refund`. `routes/orders.py` (`_compute_total`, item edit, split), `routes/public.py` (`_enrich_items`, new-order totals, item edit) and `routes/payments.py` (line charge amount, paid/remaining/refund math, replay) now call them. The DB-reading `_compute_total` / `_enrich_items` stay in the routes (tests monkeypatch them); only their arithmetic moved. The line numbers listed in the task were stale; the real sites were the ones above.
  - Characterization first: `tests/test_billing_totals.py` pinned staff and public pricing (quantity > 1, combo, unavailable product, raw float `0.1 * 3`), quantity edit with delivery fee, discount, tip and a cancelled line, split rounding, a line-based charge (`unit_price * quantity`), and a public quantity edit. `python -m pytest tests/test_billing_totals.py`: 7 passed on the pre-refactor code, same 7 passed after the move.
  - Semantic differences kept explicit: (1) the staff/public pricing loops sum raw floats with `+=` (kept as a loop in `sum_line_subtotals`, because `sum()` on Python 3.12+ uses compensated summation and would change stored values); (2) `split_group_totals` sums every line including cancelled ones, whereas `guarded_totals` skips cancelled lines (kept as a separate function, documented in its docstring; no behavior change); (3) the public create path rounds subtotal and `subtotal + delivery_fee` with plain `round`, kept in `public_order_totals`. There are no per-line modifiers or per-line discounts in this codebase; discount and tip are order-level and already lived in `account_total`.
  - Left in place on purpose (payment-flow arithmetic, not line/order totals): split-payment sums, change, `new_paid = round(paid_so_far + amount, 2)` in `create_payment`, and the public table-session paid/pending display sums in `routes/public.py`.
  - 7 direct helper tests added to the same file. Suite: 491 passed, 49 deselected.
- BC-03 (commit `9239602`): `branch_access.py` gained `tenant_branch_scope`, `record_lookup_scope`, `resolve_branch_id` and `branch_query`. `_payment_branch_scope`, `_order_lookup_scope`, `_table_lookup_scope`, `_report_branch_filter`, `_cash_branch` and `_branch_query` were deleted; their callers use the helpers. `read_branch_filter` now delegates its non-legacy path to `resolve_branch_id` (same errors, same order).
  - RED: `tests/test_branch_scope_helpers.py` failed at import (`ImportError: cannot import name ...`) before the helpers existed. GREEN: 11 passed after.
  - Semantic differences kept explicit: `resolve_branch_id` (ex `_cash_branch`) treats an empty `requested` as "no request" and can force an owner to choose (`owner_must_choose`), while `read_branch_filter` keeps rejecting a blank id with 400 before delegating. `_authorized_order` in `payments.py` (404 instead of 403 for foreign staff) was not in scope and is untouched.
  - Suite: 502 passed, 49 deselected (491 + 11 helper tests); existing branch-isolation, cash, report, table and payment tests unchanged and green.
- BC-04 (commit `03e8148`): `branch_access.assert_owned_branch(branches, restaurant_id, branch_id, *, require_valid=False)` replaces `_validate_branch` in `zones.py` and `tables.py` and `_assert_owned_branch` in `users.py`. The copies were not identical: zones/tables accept `None` and look up any other value (an empty id gives 404), while users demands a non-blank string (400 `Debe indicar una sucursal válida`) before the lookup. That difference is the explicit `require_valid` parameter (users pass `True`), so no status code or message changed. `validate_user_branch` is a different rule (the caller's own assigned branch) and stays.
  - RED: the two new `assert_owned_branch` tests failed at import before the helper existed; GREEN after. Suite: 504 passed, 49 deselected.
- BC-05 (commit `c07cf73`): `models.py` bounds: table `number` 1..9999 and `capacity` 1..100 (create and update); `preparation_time` 0..1440; `sort_order` 0..100000 (zones, categories); `ApprovalCreate.amount` 0..1,000,000; staff `password` min 8 and max 72 on create and update (the 72 cap is bcrypt's input limit; it avoids a 500 on longer input); `max_length` on `notes` (500; 200 per order line), `customer_name` 100, `customer_phone` 30, `customer_address` 300, `customer_email` 254; `items` lists capped at 100 (`OrderCreate`, `PublicOrderCreate`, `PublicItemsAdd`). `Query(regex=)` became `pattern=` in `cash.py`, `payments.py` and `reports.py` (the real sites were `cash.py:137`, `payments.py:194`, `reports.py:114,179`). Login input is unchanged, so existing short passwords still sign in.
  - RED: `tests/test_input_validation.py` 7 failed before the model changes. GREEN: 7 passed after.
  - Contract change: invalid input now returns 422. Existing tests that built users with a 6-character password (`tests/test_user_branch_assignment.py`, 3 lines) now use `secret-pass` because of the new minimum. The frontend was not inspected or changed; its user form and any field longer than these limits will now get 422.
  - Suite: 511 passed, 49 deselected; the `regex` deprecation warnings are gone.

## Next step

All five tasks are done on `refactor/backend-core` (not pushed). Review, then decide delivery: stage 1 PR first, then this branch on top. Open decisions: confirm the frontend forms respect the new 422 limits (password 8+, text lengths, table number/capacity).
