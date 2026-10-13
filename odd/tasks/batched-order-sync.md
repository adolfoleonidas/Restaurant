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
- [ ] **BS-02 Debounced outbox in the composer.** Replace per-tap writes in `useOrderLineSync`/`lineSyncQueue` with the batch window and immediate-flush triggers above; first tap still creates the order immediately; send/leave/switch await the flush (existing UX-14 guarantees stay green).
- [ ] **BS-03 Durable outbox.** Persist pending changes on the device and replay them on reopen; flush on hidden/pagehide/online and before the service-worker reload; "Guardando…"/"Sin guardar" state; logout warning while pending.
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

## Next step

BS-02 (debounced outbox in the composer), then BS-03 and BS-04.
