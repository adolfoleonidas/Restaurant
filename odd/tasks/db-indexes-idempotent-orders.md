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
- [x] **IX-02 Idempotent staff order creation.** `OrderCreate` accepts an optional client-generated `request_id`; `create_order` returns the existing order (same response shape, no second order, no repeated side effects such as seating, attention numbering, or events) when an order with that `(restaurant_id, request_id)` already exists and the caller may access it, and handles the duplicate-key race on insert. The frontend generates one `request_id` per order-creation intent (composer `createOrders`/`resolveOrder`, `useTableSheet`, `NewOrderSheet`) and reuses it on every retry of that intent; a new account gets a new id. Tests: backend replay and race; frontend retry after a lost response sends the same `request_id` and ends with one order.
- [x] **IX-03 Docs.** Record the index rule (every collection looked up by `id` has an `id` index; startup degrades instead of failing) and the idempotency rule for creates in the relevant project doc and this file.

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

### Frontend lifecycle of the id

One id per order-creation intent, made with `newClientId()` (`crypto.randomUUID`, with the fallbacks `lib/clientId.js` already has), always inside what the backend accepts.

| Where the order is created | The intent | The id is kept until |
| --- | --- | --- |
| The composer (`useTableSheet.ensureAccount` for a table, `NewOrderSheet.ensureOrder` for take-out, pickup and delivery), through `lineSyncQueue` → `useOrderLineSync` | the pending creation of "the order these lines wait for" | the creation is over: the order exists, the caller wants none (`null`), the server refused, or the draft was discarded (`clear()`) |
| `PedidoNuevo` ("Enviar a cocina") | the press of send with this cart | the order is sent, the server refuses, or the cart changes |

- **Composer.** `lineSyncQueue.createOrders` makes the id the first time it asks and passes it as `resolveOrder({ requestId })`; `useOrderLineSync` hands it to `ensureOrderId({ requestId })`; both callers put it in the payload as `request_id`. Every retry of the same creation reuses it: the stall retry timer (4, 8, 16, 30 s), the next batch window, a `flush()` and `online` all end in the same `createOrders`. A connection that failed decided nothing, so the id stays (`isTransientError`: no answer, timeout, 401, 408, 425, 429, 502, 503, 504). A refusal (400, 403, 404, 409, 422, 500) drops the taps as before and drops the id too. After a success the next account (`startNewAccount`, a new person at the table) is a new creation and gets a new id.
- **Not kept on the device.** The durable outbox stores only entries that already have an order (`useOrderLineSync.persist`), so a creation is never replayed after a reload and the id would have nothing to be used for; it lives in memory with the pending creation. This is the known limit that a tap on the first product is on screen but not on the device until the order exists.
- **`PedidoNuevo`.** It keeps `{ signature of the payload, request id }` in a ref. Sending again with the same cart reuses the id, which also fixes a second order after the kitchen step failed (the replay returns the order, then it is sent). Changing the cart is another create. A refusal drops the id; a connection failure keeps it.
- Copy: nothing new for the waiter. A repeat is silent. If the id ever collides with another order the server answers `409` `Esa solicitud ya se usó para otro pedido. Vuelve a intentarlo.`, which the existing toast shows, and trying again works because the id was dropped.
- Limits: a `500` that the server produced after storing the order is a refusal for the client, so the next tap makes a new account (as before this change); `createOrder` still has no timeout, so a hung request is only retried when the browser gives up on it. If the take-out sheet is closed while its creation is still being retried (offline) and a different order is started before the connection returns, the stale id meets the new payload and the server answers `409` once, the taps are dropped with the toast, and the next tap works with a new id; before this change that case could make a second order without telling anyone (see the limits in `batched-order-sync.md`).

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

- IX-02 frontend RED: the affected suites (`lineSyncQueue`, `useOrderLineSync`, `useTableSheet`, `NuevoPedidoInline`, `MesasPedidoInline`, `MesasPersonasPedido`, `SalonComposerProto`, `PedidoNuevo`) against the old sources: 8 suites failed, 22 tests failed, 214 passed (236). The failures are the 10 payload assertions that now expect `request_id`, the 5 new queue tests, the hook test, the 2 table-sheet tests, the take-out sheet test and 3 of the 5 `PedidoNuevo` tests (the other 2 passed vacuously with both ids `undefined`, so they were strengthened to require a valid id before comparing).
- IX-02 frontend GREEN: the same suites 10 passed, 266 tests; full `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4`: 127 suites, 1248 tests passed (baseline 126 / 1234: +1 suite, +14 tests); `CI=true npx craco build`: Compiled successfully. Mutation check on the frontend, each made 1 to 7 tests fail and was reverted: a new id on every attempt, the id not forgotten after an order exists, forgotten on a connection failure too, not forgotten after a refusal, not forgotten by `clear()`, the id not handed from the hook to the caller, `request_id` left out of the table payload, left out of the take-out payload, `PedidoNuevo` always making a new id, never making one for a changed cart, forgetting it on a connection failure, never forgetting it on a refusal.
- Tests changed in IX-02 frontend and why: 10 assertions in `useTableSheet`, `NuevoPedidoInline`, `MesasPedidoInline`, `MesasPersonasPedido` and `SalonComposerProto` compared the whole create payload (`{ table_id, order_type }`, with or without `new_account`); the payload now also carries `request_id: expect.any(String)`. Tests added: `lineSyncQueue.test.js` (+5: one id across the retries and a new one for the next account; one id for several products tapped before the order exists; forgotten after a refusal, after "no order wanted" and after a discard), `useOrderLineSync.test.js` (+1: the hook hands the id to the caller and repeats it), `useTableSheet.test.js` (+2, with a backend that keeps one account per request id and loses the first answer: the retry asks with the same id and the table ends with one account; the next account asks with another), `NuevoPedidoInline.test.js` (+1, the same through the take-out sheet), new `PedidoNuevo.test.js` (5: payload, the same id after a lost answer, the same id after a kitchen failure with one order made, a new id for a changed cart, a new id after a refusal).

- IX-03 docs (no code): the index rule (with the table of collections) and the idempotency contract (with the lifecycle of the id) are the "Index rule (IX-01)" and "Idempotency rule for creates (IX-02)" sections of this file. The functional contract goes into `docs/spec/recorte-mesa-pedido-cocina-v0.1.md` (new 6.2 "Creating the account" and exceptional case M, next to 6.1 and cases I to L; case B of the same table, "se corta la conexión al enviar", is now true for the staff create). The operator view goes into `docs/day-one-runbook.md`: a row in "Si algo falla" for the startup `ERROR` and a short section "Ids repetidos al arrancar" with the `mongosh` commands to list the repeats, drop the plain index and restart. The rule next to the code is the comment above `ID_INDEXES` in `backend/database.py`, which also names the test that enforces it.

- Commits on `fix/db-indexes-idempotent-orders` (from `a6e40fd`): IX-01 `ef74f8b` (`fix(db): index every id lookup without letting a bad index stop the start`), IX-02 backend `029014d` (`feat(orders): answer a repeated staff create with the order it made`), IX-02 frontend `7393e2b` (`feat(composer): send one request id per order creation so a retry finds its order`), IX-03 `6dec423` (`docs(orders): record the id index rule and the idempotent create`). IX-02 is two commits because it spans two stacks and each carries its own tests.
- Final results (nothing run in parallel with anything else):
  - Backend `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q`: 692 passed, 49 deselected (baseline 645: +15 `test_id_indexes.py`, +18 `test_staff_order_replay.py`, +13 `test_staff_order_replay_http.py`, +1 `test_input_validation.py`).
  - Frontend `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4`: 127 suites, 1248 tests passed (baseline 126 / 1234: +1 suite, +14 tests).
  - `CI=true npx craco build`: Compiled successfully.
  - `git diff --check`: clean. `git status --short`: only the untracked roots that were already there (`.audit_tmp/`, `.tmp/`, `aprendisaje/`, `docs/audit/`, `documentos/`, `frontend/.tmp/`).
  - Branch against `a6e40fd`, before this entry: 25 files, +1854 / -47. Production code 8 files +341 / -34 (375 changed lines, under the 400 planning heuristic), tests 14 files +1359 / -13, docs 3 files +154.
- Not run here, for the parent: anything against a real MongoDB (no server in this environment). The unique-build failure codes and the index conflicts are modeled from the server documentation and pymongo's mapping, and pyflakes reports only the two findings that were already in `main` (`Query` unused in `routes/orders.py`, the `constr` pattern in `models.py`).

## Next step

The parent rebuilds the stack and checks it against a real MongoDB: `explain()` of an `orders` lookup by `{id, restaurant_id}` shows the `uniq_order_id` index (about 1 document examined instead of every order of the venue), the other `uniq_*_id` indexes exist, a second start changes nothing, and a replayed staff create (`POST /api/orders` twice with the same `request_id`, on a free table and as a new account) returns the same order with one order, one visit and one audit entry. Then the merge the user authorized.
