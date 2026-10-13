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
- [ ] **BS-04 Docs.** Record the sync model (what is local, when it flushes, idempotency, failure modes) in this document and in the relevant project doc.

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

## Next step

BS-04 (document the sync model in this file, in the table-order-kitchen spec and in the runbook), then the parent's browser and performance check.
