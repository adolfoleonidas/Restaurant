# DB id indexes and idempotent staff order creation

## Objective and problem

A review of external advice on 2026-10-13 (indexes, cache, queues, idempotency) against the code found two real gaps:

1. **No index on the `id` field the app looks records up by.** `orders` lookups by `{id, restaurant_id}` use the `restaurant_id_1_status_1_created_at_-1` prefix and examine every order of the restaurant. Measured on a synthetic 50,000-order collection: 50,000 documents examined and about 60 ms per lookup without an `id` index, 1 document and about 1 ms with a unique `{id: 1}` index. `tables`, `products`, and `users` lookups by `id` are full collection scans (small collections today). Order lookups by id happen on every draft-line batch, send to kitchen, payment, and order detail, and the collection grows every day.
2. **Staff order creation is not idempotent.** `POST /api/orders` (`backend/routes/orders.py` ~313) has no idempotency key, while the frontend retries order creation on transient errors (`frontend/src/lib/lineSyncQueue.js` `createOrders` → `stalled` → retry). If the server creates the order but the response is lost, the retry creates a second order at the same table. Public QR orders are already protected by a unique partial index on `(restaurant_id, request_id)` (`uniq_public_order_request`, `backend/database.py`).

Already satisfied (no work): optimistic UI and pending labels; order plus items are one MongoDB document, so their writes are atomic; payments idempotency keys; draft-line batches idempotent by `client_line_id`; catalog refreshes on `catalog` events; no background queue needed today.

## Scope and authority

- Branch: `fix/db-indexes-idempotent-orders` from origin/main `a6e40fd`.
- User authorized both fixes and the merge in chat on 2026-10-13.
- Startup must never fail because of an index: production data could, in theory, contain duplicate `id` values; a unique index build would then fail and stop the backend.
- No package installs; code, tests, docs, commits English.

## Implementation and checking

- Route: delegated direct, one bounded writer.
- TDD: **on** (global configuration).
- Backend: `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q` (baseline from the writer's first run).
- Frontend: `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4` and `CI=true npx craco build` (never run together with the backend suite).
- Parent live check: `explain()` on the rebuilt stack shows the new `id` indexes; a replayed staff create returns the same order.

## Tasks

- [x] **IX-01 Unique `id` indexes, safely.** In `backend/database.py`, create unique indexes on `id` for `orders`, `tables`, `products`, `users` (and other collections the routes look up by `id` without an index, after checking). If a unique build fails with a duplicate key error, log the collection and the duplicate count clearly and create a non-unique index with the same key instead, so startup continues and lookups are still indexed. Tests for both paths.
- [ ] **IX-02 Idempotent staff order creation.** `OrderCreate` accepts an optional client-generated `request_id`; `create_order` returns the existing order (same response shape, no second order, no repeated side effects such as seating, attention numbering, or events) when an order with that `(restaurant_id, request_id)` already exists and the caller may access it, and handles the duplicate-key race on insert. The frontend generates one `request_id` per order-creation intent (composer `createOrders`/`resolveOrder`, `useTableSheet`, `NewOrderSheet`) and reuses it on every retry of that intent; a new account gets a new id. Tests: backend replay and race; frontend retry after a lost response sends the same `request_id` and ends with one order.
- [ ] **IX-03 Docs.** Record the index rule (every collection looked up by `id` has an `id` index; startup degrades instead of failing) and the idempotency rule for creates in the relevant project doc and this file.

## Index rule (IX-01)

**Rule:** every collection the routes read or write by its own `id` has an `id` index, and a startup never fails because of one.

Which collections: a scan of `backend/` for `db.<collection>.<call>({... "id" ...})` (and `$and`/`$or` branches) found thirteen. `tests/test_id_indexes.py` repeats that scan on every run and fails when a collection is looked up by `id` without an `id` index, so the rule holds for new code, not just for today's list.

| Collection | Unique index | Plain index if the data repeats an id | Before |
| --- | --- | --- | --- |
| `orders` | `uniq_order_id` | `order_id_lookup` | none (lookups used the `restaurant_id_1_status_1_created_at_-1` prefix and examined every order of the venue) |
| `tables` | `uniq_table_id` | `table_id_lookup` | none |
| `products` | `uniq_product_id` | `product_id_lookup` | none |
| `users` | `uniq_user_id` | `user_id_lookup` | none |
| `categories` | `uniq_category_id` | `category_id_lookup` | none |
| `zones` | `uniq_zone_id` | `zone_id_lookup` | none |
| `payments` | `uniq_payment_id` | `payment_id_lookup` | none |
| `cash_registers` | `uniq_cash_register_id` | `cash_register_id_lookup` | none |
| `approvals` | `uniq_approval_id` | `approval_id_lookup` | none |
| `restaurants` | `uniq_restaurant_id` | `restaurant_id_lookup` | none |
| `attentions` | `uniq_attention_id` | `attention_id_lookup` | had it (same name, so a no-op on a running system) |
| `branches` | `uniq_branch_id` | `branch_id_lookup` | had it (same name) |
| `table_groups` | `uniq_table_group_id` | `table_group_id_lookup` | had it (same name) |

Not looked up by `id`, so not indexed here: `audit_logs` (`event_id`, already unique), `cash_movements` and `attention_number_assignments` (`_id`), `counters` (`restaurant_id` + `key`), `payment_configs` (`restaurant_id`, already unique). There is no `combos` collection: a combo is a `products` row with `is_combo`, covered by `products`.

**How a start behaves** (`ensure_id_index` in `backend/database.py`, one call per row above, before the other indexes):

| What the server answers to `create_index("id", unique=True, name=...)` | What happens |
| --- | --- |
| built, or the same index is already there | nothing else; the second start is a no-op |
| duplicate key (E11000, code 11000; pymongo raises `DuplicateKeyError`) | one `ERROR` naming the collection and the count (`orders: 2 id values repeated across 5 documents, so the unique index uniq_order_id cannot be built...`), then a plain index on `id` under the `*_lookup` name. No document is changed or deleted. The start continues and the other collections get their unique index |
| the key or the name is already used with other options (codes 85 and 86) | the existing index is left alone. A unique `id` index under another name counts as done. A plain index made by hand (`id_1`) keeps serving, with a `WARNING` that names it. A name taken by an index on other fields gets a `WARNING` with the server's reason and a plain `id` index next to it. Our own `*_lookup` index from an earlier start blocks the unique build until it is dropped, so every start says which it is: still repeated ids (the same `ERROR` with the count) or none left (`WARNING`: drop `order_id_lookup` and restart) |
| anything else (not authorized, network, ...) | raised: the database is not usable, the start fails as before |

Nothing is dropped automatically: an index is not data, but replacing one at startup is a decision for the operator, and the log says exactly which one. Counting the repeats is diagnostics only (`maxTimeMS` 30 s); if it fails the `ERROR` is logged without the count.

## Idempotency rule for creates (IX-02)

**Rule:** a create the client may send again carries a client-made `request_id`, and the server answers every repeat with the order the first attempt made, repeating none of its side effects. Staff creation (`POST /api/orders`) now follows it; the public QR orders already did (`PublicOrderCreate.request_id`, UUID v4 and a request fingerprint), and payments have their own `idempotency_key`.

### Backend contract (`POST /api/orders`)

- `request_id` is optional: 8 to 64 characters of `[A-Za-z0-9._:-]` (a UUID, or the fallback id `lib/clientId.js` makes without crypto), `422` otherwise. Without it nothing changes from before.
- Role and branch checks come first, as before (a `branch_id` of another branch is still `403`).
- **With a `request_id`, look up `(restaurant_id, request_id)`** (the existing partial unique index `uniq_public_order_request` covers any string) before any table or number work:
  - Found, but the caller may not see it (staff of another branch; tenant-wide roles see all) or it is not what this request asks for (another `table_id`, another `order_type`, or a named `branch_id` that differs): `409` `Esa solicitud ya se usó para otro pedido. Vuelve a intentarlo.` and nothing is written. `new_account` is deliberately not compared: it is derived from the screen when the request is built, and by the retry the first attempt may already have opened the visit.
  - Found and valid: answer `200` with the order, in the same shape as a create (`_current_order_response`). A create that finished writes nothing: no number, no table reservation, no visit, no audit entry, no `order` event. A create that stopped halfway is finished now, once: a first account still `opening` gets its visit opened (the call `POST /orders/{id}/attention/open` makes), and the audit entry (key `staff-order-create:<restaurant>:<request id>` in the unique `event_id`) is written and the event published only if no entry carries that key yet.
  - Not found: create as before and store `request_id` on the order.
- **Races.** If the normal flow is refused (any `HTTPException`: the insert hit the unique index, or the table was already reserved or occupied by the other attempt) it looks once more for an order of the same request and answers with it. That second look also finds an attempt that reserved the table and died before storing its order: the table keeps the order it meant to write (`opening_intent`, with the request id) and `recover_opening_intent` stores it, the same recovery the attention route uses. A refusal that is not about a competing attempt (unknown product, missing table, ...) finds nothing and keeps its own error; the id is not used up by it.
- What a replay does not repeat: the order number, the table reservation, the visit, the audit entry, the event. What can still happen: a retry that races a running original, or finds a half-written create, takes an order number it does not use (a gap in the day's numbering, as any create that fails after taking one).
- Not covered: the `$addToSet` that registers a new account in `attentions.order_ids` is not repeated by a replay (the field is advisory; closing a visit reads the orders by `attention_id`).

## Progress and evidence

- 2026-10-13: document and branch created; measurement recorded above.
- 2026-10-13 writer start. Route: delegated direct, one bounded writer. TDD on (global configuration); runners: `python -m pytest` (backend) and Jest through CRA, `npx craco test` from `frontend/`.
- Baselines before any change (suites never run at the same time): backend `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q`: 645 passed, 49 deselected (56 s). Frontend `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4`: 126 suites, 1234 tests passed (87 s). `CI=true npx craco build`: compiled.
- IX-01 RED: `python -m pytest tests/test_id_indexes.py -q` before touching `database.py`: 11 failed, 4 passed (the 4 are guards on behavior that must not change: a second start changes nothing, a unique index made by hand is left alone, a non-data error and a plain driver error still stop the start).
- IX-01 GREEN: same file 15 passed; with `tests/test_branch_cash_isolation.py`, `tests/test_cash_index_migration.py` and `tests/test_deploy_preflight.py`: 58 passed; full backend: 660 passed, 49 deselected (645 + 15). Mutation check, each made the file fail and was reverted: no plain index after a duplicate error, every server error treated as a data error, conflicts re-raised, the `ERROR` demoted to `INFO`, one collection (`zones`) removed from the table, a start that finds its own plain index always saying the repeats are gone. One mutation survived and is equivalent (an extra `maxTimeMS` argument the fake ignores).
- Tests changed in IX-01 and why: `tests/test_branch_cash_isolation.py` has two fakes of the whole database that list the collections `ensure_indexes` touches; they gain `approvals`, `categories` and `restaurants`, and the "no unique index on `cash_registers`" assertion now excludes the register's own `id` index (it guarded the open-register rule, not ids). The fake of `test_id_indexes.py` models MongoDB's refusals (duplicate keys, codes 85 and 86); there is no MongoDB in this environment, so the codes are taken from the server documentation and from pymongo's own mapping (`helpers._check_command_response` raises `DuplicateKeyError` for 11000, 11001 and 12582; 85 and 86 arrive as plain `OperationFailure`). The parent's `explain()` on the rebuilt stack is the check against a real server.

- IX-02 backend RED: `python -m pytest tests/test_staff_order_replay.py tests/test_staff_order_replay_http.py tests/test_input_validation.py -q` before touching `models.py` and `routes/orders.py`: 25 failed, 12 passed (the passing ones are the old validation tests and the cases that must not change: no `request_id`, another restaurant, kitchen and cashier refused). Failures are behavior, not harness: the repeat answered `400 La mesa pertenece a una visita abierta`, or made a second order with another number, or lost the race with `409 La mesa cambió`, or `request_id` was not stored.
- IX-02 backend GREEN: the same three files 37 passed at once, then 39 after two tests added for the audit lookup (below); full backend `python -m pytest -m "not integration" -q`: 692 passed, 49 deselected (660 + 32). Mutation check, each made tests fail and was reverted: no early lookup, branch rule always true, "asked for" always true, no second look after a refusal, no table-intent recovery, visit not opened by the replay, `request_id` not stored, `data.request_id` instead of `getattr` (breaks the old `SimpleNamespace` tests in `test_attention_lifecycle.py`), `409` turned into `400`. Two mutations survived the first round (the audit lookup removed; the `DuplicateKeyError` on the audit entry re-raised) because the fake's unique `event_id` index covers the first and no test lost the race for the entry; two tests were added (`test_the_audit_entry_alone_keeps_a_replay_from_announcing_twice`, `test_losing_the_race_for_the_audit_entry_announces_nothing`) and both mutations are now killed.
- Tests added in IX-02 backend: `tests/staff_order_world.py` (helper, an in-memory restaurant on top of the visit fakes of `test_attention_lifecycle.py` plus the unique `(restaurant_id, request_id)` index), `tests/test_staff_order_replay.py` (18: first account, extra account and take-out replays change nothing; stored totals not recomputed; no id means no change; two attempts running together on a take-out order and on a free table; an attempt that stopped before the visit opened; one that died holding the table; another branch, the owner, another restaurant, another table or kind; refusals keep their own error and do not use the id up; the audit lookups), `tests/test_staff_order_replay_http.py` (13, through the real app: `200` twice with the same order, new-account replay, no id, six malformed ids `422`, `409` in Spanish, kitchen and cashier `403`), one case in `tests/test_input_validation.py` (the bounds of `request_id`).

## Next step

Writer implements the IX-02 frontend and IX-03.
