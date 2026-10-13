# Batched order sync (option B)

## Objective and problem

Every composer tap still produces a server write, an SSE event, and refetches. The 2026-10-12 Playwright bisect measured about 557 ms of main-thread long tasks per tap at 6x CPU on current main versus about 141 ms for the October 5 build that kept the cart local until "Enviar", and the research on professional POS systems (Toast, Simphony, Lightspeed, Odoo, Square; Engram `ux/order-entry-sync-research`) found that none of them documents a remote network write per tap: taps land locally and sync in the background, and "Send/Fire" is the explicit kitchen boundary.

User decision (2026-10-12): option B. Taps stay on the phone and are saved in one batch when the waiter pauses, leaves, or sends, while keeping server-side drafts (shared visibility for other waiters, table occupied as soon as the order starts, per-person orders, card editing, kitchen review).

## Scope and authority

- Branch: `feat/batched-order-sync` from origin/main `39df43d`.
- User authorized option B and its merge in chat on 2026-10-12.
- Must preserve: table shows occupied as soon as the first product is added (the order is created on the first tap, as today); other waiters see drafts after the batch lands; per-person orders, card editing, rename, "Vaciar", kitchen review, guarded exits, send waits for pending writes (UX-14), rollback on failure with one toast, write-response confirmation (#91), topic events (#92).
- Money and kitchen actions stay server-confirmed; only draft-line quantities and notes are batched.
- No package installs; UI copy Spanish tuteo; code, tests, docs, commits English.

## Design

- **Batch window:** pending line changes are flushed about 1.5 s after the last tap, and immediately on send to kitchen, leaving the composer, switching or renaming an account, `visibilitychange` to hidden, `pagehide`, `online` after offline, and before the service-worker update reload.
- **Idempotent batch write:** one request carries all pending lines of an order. Lines use a client-generated `client_line_id` and absolute quantities, so a replayed batch never duplicates a line; quantity 0 removes a draft line. Sent (non-draft) lines are never changed by the batch. The response is the whole order (as #91 relies on).
- **Durable outbox:** pending changes are also persisted on the device (IndexedDB, falling back to `localStorage`) keyed by user and order, so a reload, crash, or app update does not lose taps; on reopen they are replayed.
- **Visibility:** a small "Guardando…" / "Sin guardar" state in the composer while the outbox is not empty; logout warns while it is not empty.
- **Errors:** a rejected line (e.g. product unavailable) rolls back to the last confirmed quantity with one toast via `apiErrorMessage`; the rest of the batch still applies.

## Implementation and checking

- Route: delegated direct, one bounded writer.
- TDD: **on** (global configuration).
- Backend: `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q` (baseline from the writer's first run).
- Frontend: `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4` (baseline from the writer's first run) and `CI=true npx craco build`.
- Performance proof: the parent compares writes, GETs, commits, and long tasks per tap burst against current main with the Playwright scripts.

## Tasks

- [x] **BS-01 Idempotent batch endpoint.** Backend endpoint that applies a list of draft-line upserts by `client_line_id` (absolute quantity, notes, person/account fields as the composer uses them) to one order atomically with an optimistic version check, rejects edits to non-draft lines per line, publishes one `orders` event (topic per #92, `kitchen=False`), and returns the order. Hermetic tests: replay idempotency, quantity 0 removal, non-draft protection, per-line rejection, branch/tenant scoping, one event per batch.
- [x] **BS-02 Debounced outbox in the composer.** Replace per-tap writes in `useOrderLineSync`/`lineSyncQueue` with the batch window and immediate-flush triggers above; first tap still creates the order immediately; send/leave/switch await the flush (existing UX-14 guarantees stay green).
- [x] **BS-03 Durable outbox.** Persist pending changes on the device and replay them on reopen; flush on hidden/pagehide/online and before the service-worker reload; "Guardando…"/"Sin guardar" state; logout warning while pending.
- [x] **BS-04 Docs.** Record the sync model (what is local, when it flushes, idempotency, failure modes) in this document and in the relevant project doc.

## Endpoint contract (BS-01)

`PUT /api/orders/{order_id}/draft-lines`, roles `admin` and `mozo`, tenant and branch scoping through `record_lookup_scope` (the same as `add_items`).

Request:

```json
{
  "lines": [
    { "client_line_id": "6b0f4f0e-...", "product_id": "p-sopa", "quantity": 3, "notes": null }
  ],
  "version": "2026-10-12T15:04:05.123456+00:00"
}
```

- `lines`: 1 to 100, unique `client_line_id` (1 to 64 characters of `[A-Za-z0-9._:-]`), `quantity` an absolute integer `>= 0`, `notes` up to 200 characters (`null` leaves the notes alone), `product_id` only needed to create a line. A person is an account (an order of its own), so there are no person fields per line: the account is the order in the URL.
- `version` is optional: the order's `updated_at` as the client last saw it. When it is sent and the order has changed since, nothing is applied and the answer is `409 {code: account_changed}`. The composer does not send it, because absolute quantities by line id merge without conflicts; it is there for callers that want a strict check.
- A line is found by `client_line_id` (stored on the item) or, for a line created before batches existed, by the line's own `id`, so old lines keep working. The server keeps its own `id` for lines it creates.
- Unknown id, `quantity > 0` and a `product_id`: a draft line is created with the same catalog, price, combo and availability checks as `add_items`. Unknown id and `quantity == 0`: nothing to do (`unchanged`). Known draft line: the quantity (and notes) are set, `quantity == 0` removes it; the unit price stays the one the line was created with.
- Only draft lines change. A sent or voided line is rejected with `not_draft`, unless the request already matches it (a replay after the send), which is `unchanged`.
- The batch is applied in memory and written once with the existing version guard (`claim_order`): one document update, so it either applies fully or answers `409` and the client sends the same batch again. Nothing is written (and no event is published) when no line changed.

Answer `200`: the whole order, as every write answers since #91, plus `line_results`, one entry per request line in order: `{client_line_id, result, line_id?, code?, detail?}` with `result` in `applied`, `unchanged`, `removed`, `rejected`. A rejected line carries `code` (`unavailable`, `not_draft`, `not_found`, `mismatch`, `paid`) and a Spanish `detail` ready to show; the other lines still apply.

Errors: `400` closed order, `403` role, `404` order not found in the caller's tenant and branch, `409` stale `version` or a concurrent change, `422` invalid body (repeated `client_line_id`, negative quantity, more than 100 lines, bad id).

Realtime: one `order` event per batch that changed something, `topics: ["orders"]` (`kitchen=False`, `extra: "draft_lines"`), the same as the per-tap draft edits it replaces.

## Sync model (BS-04)

How composer taps reach the server since this change. The functional summary is in `docs/spec/recorte-mesa-pedido-cocina-v0.1.md` (6.1 and the exceptional cases I to L); the operator view is in `docs/day-one-runbook.md` ("Si algo falla").

### What is local and what is on the server

- The server holds the drafts (lines with status `borrador`), so other waiters see them and the table stays occupied. What is local is the gap between the last answer of the server and now: the taps of the waiter that no answer has confirmed.
- That gap is an outbox: one entry per line, keyed `line:<line id>` for a line the server has and `new:<product id>` for a product with no line yet. An entry holds the wanted **absolute** quantity (not clicks), the order it belongs to, and, for a new product, the product and the `clientLineId` its line will have. Entries are plain objects in `lib/lineSyncQueue.js`; nothing is written per tap.
- The screen is always the last order the server confirmed with the outbox laid over it (`overlayPendingLines`), so the cards, the ticket and the send bar read the same optimistic numbers, and a confirmed answer replaces the base without the numbers moving.
- The waiter reads the state in the person strip of the table sheet and in the footer of the new order sheet: "Guardando…" while a request is on the wire, "Sin guardar" while lines wait (nothing when everything is saved).

### When it flushes

| Moment | What happens |
| --- | --- |
| 1500 ms after the last tap (`ORDER_SYNC_DELAY_MS`, injectable) | the whole outbox of an order goes out in one request; every new tap re-arms the window |
| First product of an account with no order | the order is created at once (a create-only pass), so the table shows as occupied; its line goes with the next batch |
| Confirming the send to the kitchen | flush now; the send waits and is cancelled if a line failed or could not be saved |
| Leaving the composer, switching or starting an account, editing another account, opening another table, renaming (card or strip), "Vaciar", item notes | flush now; the action stops with "Hay productos sin guardar..." if the lines could not be saved |
| App to the background (`visibilitychange` hidden) and `pagehide` | flush now with `fetch` and `keepalive`, which the browser finishes even if the page goes |
| `online` | flush now (and the stored outboxes of the user are replayed) |
| Closing the take-out sheet, or any composer unmounting | flush now |
| Service-worker update (`controllerchange`) | flush now with `keepalive`, wait at most 1500 ms, then reload once |
| Logout | flush, wait at most 2500 ms; if lines are still unsaved the waiter is asked (`ConfirmDialog`) |

One request is in flight per outbox. Taps made meanwhile stay in the outbox and travel in the next batch, which the next pause (or flush) sends: a long burst of taps is never a chain of requests.

### Idempotency

- Each line has an id the server dedupes on: the `client_line_id` made once per product line (`crypto.randomUUID`, with fallbacks), or the line's own id for lines that were created before batches. The id of an entry never changes, so "down to zero and up again" while the first batch is in flight still names the same line.
- Quantities are absolute and the endpoint upserts by id, so a batch sent twice (a lost answer, a reload, a replay, a 409 retry) changes nothing the second time.
- A tap that nets out to what the server already has is not sent. The exception is an entry flagged `attempted` (it went out once): its answer may have been lost, so the server can hold a different quantity than the last confirmed order says, and it is always sent again. The flag is written to the device before the request leaves.

### Failure modes

| What happened | What the outbox does | What the waiter sees |
| --- | --- | --- |
| The server rejects one line (product off sale, already sent, already charged) | that line goes back to the last confirmed quantity, the other lines apply | one toast with the server's reason (`apiErrorMessage`) |
| The server refuses the batch (400 closed order, 403, 404, 422, 500) | all its lines go back to the confirmed quantities, the order is re-read | one toast |
| 409 (the order changed under the batch) | the same batch is sent again, up to twice; then it counts as a refusal | nothing, or the toast of a refusal |
| No answer, timeout (15 s), 401, 408, 425, 429, 502, 503, 504 | nothing is rolled back; the lines stay on screen and on the device; retried after 4, 8, 16, 30 s (capped), at the next flush and on `online` | "Sin guardar" and one toast ("Sin conexión..."); send, leave, switch and rename are refused with "Hay productos sin guardar..." until it is saved |
| The answer of a batch is lost | the entries stay flagged `attempted` and go again; the server dedupes | nothing |
| The page dies (reload, crash, battery, app update) | entries are on the device (IndexedDB, else `localStorage`), written on every change and before every request | on reopening that order the taps are back, then saved; at app start they are saved without opening anything |
| Logout or an update with unsaved lines | they get a moment to be sent (2.5 s and 1.5 s); what does not make it stays on the device | the logout dialog, or nothing |
| The device storage is blocked or full | the outbox keeps working in memory; only the durability is lost | nothing |

### Persistence and replay

- `lib/outboxStorage.js`: one record per `userId:orderId` with the entries, the serialized `signature` and `savedAt`. IndexedDB database `restoflow-outbox`, store `draft-lines`; `localStorage` key `restoflow:outbox:v1:<user>:<order>` when IndexedDB is missing or fails to open. No method throws or rejects. Entries without an order (the order is still being created) are not stored.
- Replay on reopen: `useOrderLineSync` loads the record of the order it shows and `restore`s it into the outbox (what the waiter tapped in this session wins by key), then flushes at once.
- Replay at app start and on `online`: `AppShell` calls `replayStoredOutboxes(userId)`, which sends every stored record of that user as the same idempotent batch, skips the orders a live composer owns (`outboxRegistry.ownsOrder`) and deletes a record only if its signature did not change since it was read. A refused batch is dropped; a connection failure keeps the record. Rejected lines raise one toast.
- Records are per user: another user on the same device never replays them.

### Limits

- A tap on the first product is on screen but not on the device until the order exists (the create request is in flight, usually well under a second).
- Closing the take-out sheet while offline and tapping the same product in a new sheet before the connection returns takes the key of the old pending entry (`new:<product>`), which replaces it. The old order keeps the lines it already had.
- Two tabs of the same user on the same account share one record on the device: the last one to write wins. Each tab still sends its own lines.
- Two devices on the same account merge per line with absolute quantities; the last write wins for a quantity, and a draft line one device removed can come back if the other one still has it pending.
- `version` (optimistic check) exists on the endpoint but the composer does not send it.
- A request that hangs is cut after 15 s (`saveDraftLines`); `createOrder` has no timeout, as before.

## Progress and evidence

- 2026-10-12: document and branch created.
- 2026-10-12 writer start. Route: delegated direct, one bounded writer. TDD on (global configuration); runners: `python -m pytest` (backend) and Jest through CRA, `npx craco test` from `frontend/`.
- Baselines before any change: backend `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q`: 597 passed, 49 deselected. Frontend `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4`: 118 suites, 1063 tests passed (62.8 s). The first frontend run happened while the backend suite was running and had 3 suites / 4 tests fail with 5 s timeouts under that load; run alone it is clean, so the two suites are never run at the same time.
- BS-01 RED: `python -m pytest tests/test_draft_lines_batch.py -q`: 38 failed (`models.DraftLinesBatch` and `sync_draft_lines` did not exist).
- BS-01 GREEN: same file: 38 passed; full backend: 635 passed, 49 deselected (597 + 38). Mutation check, each made the file fail and was reverted: sent lines editable, version check removed, kitchen topic published, matching by id removed (replay duplicates lines), an unavailable product aborting the whole batch.

- BS-01 commit: `b4f0da6`.
- BS-02 decisions (the full model is written in BS-04):
  - `lib/lineSyncQueue.js` is now a batching outbox: `set` only records the wanted absolute quantity of a key, the whole outbox of an order goes out in one request `ORDER_SYNC_DELAY_MS` (1500 ms, injectable) after the last tap or at once on `flush()`; one request in flight, taps made meanwhile wait for the next window and do not chain into a request after every flight.
  - The first line of an account makes the outbox create the order straight away (a create-only pass, without waiting for the window), so the table shows as occupied; the line itself travels with the next batch.
  - Lines carry a client id made once per product line (`lib/clientId.js`, `crypto.randomUUID` with fallbacks) and never changed afterwards; an existing line is addressed by its `client_line_id` or its own `id`. `lib/draftLines.js` turns an entry into a batch line and skips a tap that nets out to what the server already has.
  - Failures split by who decides: a refusal (400/403/404/409 after two resends/422/500, or a rejected line) drops the lines so the screen goes back to what the server has, with one toast through `apiErrorMessage`; a failed connection (no answer, timeout, 401, 408, 425, 429, 502, 503, 504) keeps the lines on screen and in the outbox, says so once (`Sin conexión...`) and retries with a growing pause or at the next flush. An entry that already went out is flagged `attempted`, so a lost answer can never make a later "back to the old quantity" be skipped as already saved.
  - Moments that save at once: confirming the send, leaving the composer, switching or starting an account, renaming, "Vaciar", item notes, opening another table, the app going to the background (`visibilitychange` hidden), `pagehide`, `online`, and the composer unmounting. If the taps cannot be saved, the action stops with `Hay productos sin guardar...` instead of leaving them behind.
  - `NewOrderSheet` flushes when it closes and ignores the answers that arrive after it was reset.
- BS-02 RED: the new queue tests against the old `lineSyncQueue`: 40 of 41 failed (the 41st test, a connection stopping the pass, was added afterwards); queue, hook, overlay and api tests against the old sources (`useOrderLineSync`, `lineSyncQueue`, `optimisticOrder`, `api/orders` restored from HEAD): 4 suites failed, 74 tests failed; the table-sheet level tests (`useTableSheetOptimistic`, `useTableSheetRequests`, `useTableSheet`, `MesasPedidoInline`, `NuevoPedidoInline`, `SalonComposerProto`) against the old sources including `useTableSheet` and `NewOrderSheet`: 6 suites failed, 81 tests failed, 60 passed.
- BS-02 GREEN: `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4` (without the BS-03 module tests): 119 suites, 1146 tests passed (baseline 118 / 1063: +1 suite, +83 tests); `CI=true npx craco build`: compiled successfully with no warnings. Mutation check (each made tests fail and was reverted): the window sending at once, connection errors treated as refusals, `attempted` not set, a new client id on every tap, send not flushing, the unsaved-taps stop never refusing, rejected lines not reported, netted-out taps still sent, the overlay ignoring client ids. One mutation survived and is equivalent: dropping `|| sync.pending()` from the send check, because a failed flush already raises `failures()`; it stays as a second guard.
- Tests changed in BS-02 and why (they asserted a request per tap, which no longer exists):
  - `lineSyncQueue.test.js` rewritten (7 tests became 41): the serial per-key queue is now the batching outbox.
  - `useOrderLineSync.test.js` rewritten (6 tests became 33): the CP-02 cases (confirm from the answer, fall back to one GET, foreign order, caller that cannot accept) are kept through `saveDraftLines`; added the window, ids, rejections, connection failures, saving state and the immediate-flush events. It now renders the hook under a parent that holds the confirmed order, like the real screens.
  - `useTableSheetOptimistic.test.js` (UX-14) rewritten (13 tests became 24): the guarantees stay (rapid taps never lost, rollback with one toast, send waits for the outbox, no duplicate lines); PATCH/POST/DELETE per tap became one `saveDraftLines` per pause; added the flush moments (send, leave, switch, rename, "Vaciar", new account, background).
  - `useTableSheetRequests.test.js` (CP-02, 5 tests became 6): a burst of taps, however long and across products, is one request.
  - `useTableSheet.test.js`: 6 tests assert `saveDraftLines` after the pause instead of `addOrderItems`/`updateOrderItem`/`removeOrderItem`; fake timers; `startNewAccount` is awaited because it saves the taps first.
  - `MesasPedidoInline`, `NuevoPedidoInline`, `SalonComposerProto` (Salon level): the `api` mock gains `put`, fake timers play the pause, and the per-tap `api.patch`, `api.post .../items` and `api.delete` assertions became `api.put('/orders/:id/draft-lines', { lines }, { timeout: 15000 })`; the "send requested while a write is pending" case now confirms that the confirmation saves the tap first.
  - `optimisticOrder.test.js` +3 (a new entry lands on the line the server created from its client id), `apiModules.test.js` +1 (`saveDraftLines`), new `clientId.test.js` (6 tests).

- BS-02 commit: `ee6f280`.
- BS-03 decisions:
  - `lib/outboxStorage.js` keeps one record per `userId:orderId` (entries, serialized `signature`, `savedAt`) in IndexedDB (`restoflow-outbox` / `draft-lines`), falling back to `localStorage` (`restoflow:outbox:v1:<user>:<order>`) when IndexedDB is missing or does not open; no method throws or rejects, so a full disk or blocked storage costs durability only. `remove(..., { ifSignature })` deletes only a record nobody changed since it was read.
  - The hook writes the record on every change (only when it differs from what it wrote last), and writes the `attempted` flag before the request leaves, so a page that dies mid-flight still knows the answer may have been lost. On opening an order it loads the record and `restore`s it into the outbox (this session's taps win by key) and flushes at once. `userId` comes from `Salon` through `useTableSheet` and `NewOrderSheet`; without it nothing is kept.
  - `lib/outboxRegistry.js`: every live outbox registers; logout, the service-worker update and the replay ask from there (`hasPendingOutbox`, `flushAllOutboxes`, `ownsOrder`).
  - `lib/api/request.js` `keepaliveRequest` (`fetch` with `keepalive`, 15 s abort, same token header, answers and rejects in axios shape) is used by `saveDraftLines(..., { keepalive: true })` for `visibilitychange` hidden, `pagehide`, the service-worker reload and logout; everything else stays on axios.
  - `lib/serviceWorker.js`: on `controllerchange`, if an outbox holds unsaved lines the reload waits for `flushAllOutboxes({ timeoutMs: 1500 })` and then reloads once; with nothing pending it reloads at once, as before.
  - `AppShell`: `replayStoredOutboxes(user.id)` at mount and on `online` (skips orders a live composer owns; one toast when the server rejected some lines); the logout button flushes for up to 2500 ms and only then, if lines are still unsaved, opens `ConfirmDialog` ("Tienes pedidos sin guardar", "Salir igual" / "Quedarme").
  - `SyncStatus` ("Guardando…" while a request is on the wire, "Sin guardar" while lines wait) is a plain-text `role="status"` span, no motion. It sits in the person strip of the table sheet (on a phone the ticket is below the card grid, the strip is at the top where the waiter taps) and in the footer of the composer of the new order sheet.
- BS-03 RED: the BS-03 tests against the BS-02 sources and without the four new modules (`outboxStorage`, `outboxRegistry`, `outboxReplay`, `SyncStatus`): 11 suites failed, 19 tests failed (the suites that import a missing module do not run), 106 passed.
- BS-03 GREEN: full frontend suite 126 suites, 1233 tests passed (BS-02: 119 / 1146: +7 suites, +87 tests); `CI=true npx craco build`: compiled successfully with no warnings (`NoMotion` guard included in the suite). Mutation check, 13 changes, each made 1 to 7 tests fail and was reverted: nothing kept on the device, nothing taken back, `pagehide` without `keepalive`, the sent flag not kept before the request, confirmed entries left on the device, outbox not registered, update reloading without saving, logout never asking, logout not giving the taps a moment, no replay at app start, replay racing a live composer, a conditional remove that ignores the signature, the strip showing no state.
- Tests added or changed in BS-03: new `outboxStorage` (IndexedDB double and `localStorage`, same contract), `outboxRegistry`, `outboxReplay`, `SyncStatus`, `SyncStatusWiring`, `keepaliveRequest`, `AppShellOutbox`; `useOrderLineSync` gains the device, the registry and the keepalive events (the background and `pagehide` cases now expect `{ keepalive: true }`); `lineSyncQueue` gains `restore` and "a failed connection stops the pass"; `serviceWorker` gains the flush-before-reload cases; `SalonComposerProto` gains two Salon-level cases (the strip text through a batch, and a failed connection that keeps the tap on the device until `online`) and clears `localStorage` between tests because the outbox now writes there.

- BS-03 commit: `fabeb04`.
- BS-04 commit: `d0e1ed7`. BS-04 done: the model (what is local, when it flushes, idempotency, failure modes, persistence, limits) is the "Sync model" section of this file; the functional contract is `docs/spec/recorte-mesa-pedido-cocina-v0.1.md` (new 6.1 "Draft saving" and exceptional cases I to L); the operator view is two rows of "Si algo falla" in `docs/day-one-runbook.md`. Docs only plus one comment translated to English in `NewOrderSheet.jsx`.
- Also covered after BS-03: closing the new order sheet saves what was tapped at once and ignores the answer that arrives after the reset (`NuevoPedidoInline`, two mutations checked: the guard on late answers and the flush on close).

- Contract check over HTTP (commit `26c2e06`): `tests/test_draft_lines_http.py` (10 tests) drives the real app over ASGI with the body the composer sends: `PUT` with the lines unwrapped, the answer with the order and `line_results`, the same request twice, a line created by a batch still editable with `PATCH /items/:id` and found again by the batch, 422 details for a repeated id / negative quantity / empty list / wrapped body, 405 for `POST`, 403 for kitchen and cashier, 400 for a paid order, 409 for a stale `version`. They passed at once: the function-level tests had already pinned the same behavior.
- Final results (nothing run in parallel with anything else):
  - Backend `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q`: 645 passed, 49 deselected (baseline 597: +38 in `test_draft_lines_batch.py`, +10 in `test_draft_lines_http.py`).
  - Frontend `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4`: 126 suites, 1234 tests passed (baseline 118 / 1063: +8 suites, +171 tests).
  - `CI=true npx craco build`: compiled successfully, no warnings.
  - `git diff --check`: clean. `git status --short`: only the untracked roots that were already there (`.audit_tmp/`, `.tmp/`, `aprendisaje/`, `docs/audit/`, `documentos/`, `frontend/.tmp/`).
  - Branch against `39df43d`, before this entry: 46 files changed, +5236 / -526 (production code 22 files +1248 / -187, tests 21 files +3793 / -339, docs 3 files +195). Far over the 400-line planning heuristic, which was not cut for: most of it is tests, and the rewritten test files replace per-tap assertions with the batch contract.
- Engram: the writer saved one learnings observation (`odd/batched-order-sync/learnings`, id 6844, conflicts judged). The task-list mirror `odd/batched-order-sync/tasks` was not touched; the parent owns it and should refresh it from this file.

## Next step

The parent rebuilds the stack, checks the Salón in a browser (offline and reload with taps pending, the "Guardando…" and "Sin guardar" text, the logout dialog) and re-runs the Playwright comparison: writes, GETs, commits and long tasks per tap burst against main.
