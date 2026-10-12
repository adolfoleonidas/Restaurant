# Targeted realtime refetch

## Objective and problem

After #91, a composer tap still triggers about 4 GETs within 2 s, because every realtime event bumps one global `generation` in `contexts/NotifyContext.jsx` and every screen that depends on it refetches all of its queries (Salón, Caja, Cocina, Pedidos, PedidoDetalle, Dashboard, Comprobantes, KitchenAlerts, RoleInbox, …). Measured with Playwright (4x/6x CPU), this refetch wave is the main remaining per-tap cost on low-end phones. Catalog, table, and zone CRUD publish no events at all, so those views rely on slow polls.

## Scope and authority

- Branch: `perf/targeted-refetch` from origin/main `0a81fa7`.
- User authorized targeted refetch and its merge in chat on 2026-10-12.
- Behavior: every screen must still update in realtime for the changes it shows; nothing may become stale that is live today. Reconnect and wake refetches (AF-03) and the stale-response guard stay.
- Single-process SSE (`backend/notify.py`) is unchanged.

## Implementation and checking

- Route: delegated direct, one bounded writer.
- TDD: **on** (global configuration).
- Frontend: `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4` (baseline 114 suites / 970 tests) and `npx craco build`.
- Backend: `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q` (baseline 552).
- Performance proof: the parent re-runs the Playwright before/after comparison (GETs and commits per tap).

## Tasks

- [x] **TR-01 Event topic map.** Inventory every backend `publish`/`emit_order`/`emit_notice` call and its payload fields; define a small topic vocabulary (e.g. `orders`, `kitchen`, `tables`, `payments`, `cash`, `catalog`, `prepay`, `notices`) and make every event carry its topic (and `order_id`, `table_id`, `branch_id` when known), keeping existing fields for compatibility. Document the map in this file.
- [ ] **TR-02 Topic-scoped refresh on the client.** `NotifyContext` keeps per-topic generations (coalesced like today); a hook such as `useRealtimeGeneration(['orders', 'tables'])` changes only when one of those topics fires. Reconnect, wake, and unknown/legacy events bump every topic. Migrate each consumer to the topics it actually renders; a screen showing one order may also ignore order events for other orders.
- [ ] **TR-03 Catalog and floor CRUD go live.** Product, category, availability, table, and zone create/update/delete publish `catalog` or `tables` events so menus and floor maps update without waiting for slow polls.

## Topic map (TR-01)

Every SSE event keeps its legacy fields (`type`, `order_id`, `status`, `branch_id`, ...) and adds `topic` (primary) and `topics` (all). An event with no `topic` makes every client refresh everything (safe default). Centralized in `backend/notify.py` (`emit_order`, `emit_notice`).

| Topic | Meaning | Published by |
|---|---|---|
| `orders` | any change to an order (lines, totals, status, account) | every `emit_order` |
| `kitchen` | the subset the kitchen board / kitchen alerts / role inbox show | `emit_order` unless `kitchen=False` (staff draft-line edits: `items_added`, `item_updated`, `item_removed`, which the kitchen never sees) |
| `payments` | collections, voids, refunds, proof reviews | `emit_order` with `payment_status`, or status `pagado` |
| `prepay` | prepaid / proof waiting for the cashier | `payment_status == comprobante_subido`, and `routes/prepay.py` |
| `tables` | floor state | `emit_notice` kinds `table` (seat, release, move, group, QR renew/rotate/revoke, CRUD) and `zone` |
| `cash` | register open / close / movement | kind `cash` |
| `catalog` | products, categories, availability | kinds `product`, `category` |
| `approvals` | void / refund requests | kind `approval` |

Extra fields: `order_id`, `table_id`, `branch_id`, `restaurant_id` when known; `related_order_ids` on `merged` (the cancelled source) and `split` (the child orders) so a screen on another order of the operation still refreshes. Public stream (`public_allowed`) also lets `category` through to the menu.

Action to topics: order create / add lines (public) / bump / serve / send-to-kitchen / void line -> orders+kitchen; staff add/edit/remove draft line -> orders; charge, void, refund, proof -> orders+kitchen+payments (+prepay); seat / release / transfer / group -> tables; cash open/close/movement -> cash; approval request/decision -> approvals.

## Progress and evidence

- 2026-10-12: document and branch created.
- TR-01 RED: `python -m pytest tests/test_realtime_topics.py -q` -> 15 failed, 3 passed (no topic fields, `kitchen=` kwarg, category not public).
- TR-01 GREEN: same file -> 29 passed; full backend `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q` -> 581 passed, 49 deselected.

## Next step

Writer implements TR-01 to TR-03.
