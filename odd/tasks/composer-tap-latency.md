# Composer tap latency: never swallow a tap, never hold the grid

## Objective and problem

A waiter reports that after choosing a table, tapping products on the menu feels
unresponsive: the quantity appears late or the tap seems to be ignored. The
measured history (see `composer-tap-performance.md`, `targeted-refetch.md`,
`remove-animations.md`, `batched-order-sync.md`) already removed the two big
costs (unmemoized cards, floor animation, one request per tap). What was left is a
set of places where a tap is **silently dropped**, plus a table open that kept the
whole menu disabled until a history listing came back, plus the request budget of
the two calls the composer depends on.

Verified in code before the change:

1. **The grid was disabled by state that has nothing to do with the product.**
   `pages/salon/TableSheet.jsx` passed `savingItem={savingItem || sendingToKitchen
   || loading}` into `OrderComposer`, which turned it into `busy` and then into
   `disabled` on every card (`ComposerProductCard`). The card has no disabled
   styling, so it looked tappable and did nothing.
2. **The handler dropped the tap with no feedback.** `addProductToAccount` and
   `removeProductFromAccount` returned early on `sendingToKitchen ||
   openTable?.loading`: no toast, no state change.
3. **Opening a table was a three-request waterfall** that kept `loading` true for
   all of it: `getOrder`, then `listOrders({ table_id, limit: 50 })` and, when the
   table had no active order, a second `getOrder` through `selectAccount`;
   `loading` only cleared in the `finally`. `listOrders` returns full orders with
   their items (same projection as the detail), so the history did not need to
   gate the composer at all.
4. **A waiter's own writes still refreshed the whole floor.** The batch save
   publishes an `orders` event, and the Salón tables poll follows both `tables`
   and `orders`, so every tap burst refetched `listTables` (which embeds every
   table's open orders) and `listOrders`.
5. **The two calls cost a round trip per row.** `GET /products` resolved each
   combo component with its own query (`1 + C*K`); `PUT /orders/{id}/draft-lines`
   read the product of each new line plus one per component (`N + N*K`); and
   `orders` had no index for `branch_id` or `attention_state`, which both 8-second
   polls filter on.

Evidence used to size the problem (measured, not assumed):

- The repo's own Playwright audits: tap → painted p50 46 / 194 / 401 ms at 1× /
  4× / 6× CPU, up to 900 ms of long tasks per tap at 6×, and an infinite
  `box-shadow` on late tables keeping a low-end phone's main thread 98–99 % busy.
- Every backend endpoint p50 < 130 ms, max 235 ms (`action-feedback-realtime.md`).
- A temporary jsdom probe (since deleted) on the current code: `resolveTap`
  0.008 ms, overlaying 40 pending taps 0.12 ms, one tap's re-render 8–16 ms with
  300 cards on screen, and the `/tables` payload 62.9 KB for 60 tables / 20
  accounts. So the tap itself and the render were not the seconds; the requests
  and the swallowed taps were.
- Production (`http://93.127.214.26:8081`) serves this exact code: its CSS and all
  20 lazy chunks are byte-identical to a fresh build, and every app source in
  `main.js` matches the working tree.

## Scope and authority

- Branch: `perf/composer-tap-latency` from origin/main `677347e`.
- User authorized items 1 and 2 first, then 3 and 4, in chat on 2026-10-13.
- Behavior that must not change: the optimistic queue semantics (UX-14), the batch
  save (`batched-order-sync`), the absence of motion (`NoMotion` guard), every
  `data-testid`, and the rule that a tap is never lost or double counted.
- UI copy Spanish tuteo; code, tests, docs, commits English.

## Implementation and checking

- Route: direct, one bounded writer.
- TDD: **on** (global configuration). Red first for every unit, then the change.
- Frontend: `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false
  --maxWorkers=4` and `CI=true npx craco build`. Baseline: 127 suites / 1248 tests.
- Backend: `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test
  python -m pytest -m "not integration" -q`. Baseline: 692 passed / 49 deselected.

## Tasks

- [x] **TB-01 A tap is never swallowed.** The cards are disabled only by their own
  product (`out`); a tap that lands while the account in view is still being
  resolved is held, per table and in order, and applied the moment it is known; a
  tap refused because the order is on its way to the kitchen says so.
- [x] **TB-02 The table open stops holding the grid.** `loading` covers only the
  account in view; the listing and the account cards arrive in the background.
- [x] **TB-03 A waiter's own write does not refetch the floor.** The draft-line
  echo of the same user is skipped; everything else still refreshes.
- [x] **TB-04 The remaining refetches cost less.** `/products` and the draft-line
  batch read their catalog once per request, and `orders` has the indexes its
  list filters need.

## Progress and evidence

- 2026-10-13: document and branch created from origin/main `677347e`.
- TB-01 RED: new `ComposerTapNeverLost.test.js` → 4 failed / 1 passed. GREEN: 5/5.
  - `OrderComposer` no longer takes `savingItem`: `busy` is `out` and nothing else.
    `TableSheet` stopped passing it. The old test that pinned the removed rule
    ("a busy composer (saving) still re-renders every card so they disable
    together") became "saving the taps does not disable the cards".
  - `useTableSheet` holds a tap that lands while `openTable.loading` (a ref, per
    table) and applies it from an effect the moment the account in view is known,
    through `sync.tap` / `sync.changeLine`; taps held for another table are
    dropped, because the waiter moved on.
  - `sendingToKitchen` now answers with the sheet's existing `busyToast()`.
- TB-02 RED: new `TableOpenStopsHoldingTheGrid.test.js` → 2 failed / 2 passed.
  GREEN: 5/5.
  - `openSheet` starts the listing without awaiting it, awaits only the account in
    view, clears `loading`, opens the composer for a resumed draft, and only then
    applies the listing (accounts, history) and the "follow the first account"
    step.
  - Splitting the gate was necessary: `NewOrderButton` and `startNewAccount` must
    still wait for the listing, or a waiter could start an independent account
    before knowing the table already has one. That is `accountsLoading`, exposed
    by `selectSheetModel` and checked by both the button and the action. Two
    existing `SalonComposerProto` tests protect exactly that (one during the
    initial listing, one during an account switch).
  - Full frontend suite after TB-01 + TB-02: 129 suites / 1258 tests green
    (baseline 127 / 1248).
  - Commit `6d240c3`.
- TB-03: `emit_order` payloads may name `actor_user_id`; `sync_draft_lines` sets
  it. `useSalonData` skips only `extra === 'draft_lines'` events caused by the
  signed-in user, for `/tables`, the unassigned-count poll and `/orders`.
  - Backend: two new tests in `tests/test_draft_lines_http.py` (the event names
    the waiter; a refused batch publishes nothing) → 41 passed in the file plus
    `test_realtime_topics.py`.
  - Frontend: the Salón "a composer tap refetches the orders and the tables"
    expectation became four tests (own echo 0 refetches, another waiter's batch
    1/1, no actor 1/1, own table event still refetches the tables), plus two in
    `useSalonData.test.js`, which needed an `AuthContext` mock and a
    `NotifyContext` mock that captures the filters.
  - Full frontend suite: 129 suites / 1263 tests green. Commit `aa1855b`.
- TB-04: `combo_components_map` + `components_from` in `routes/products.py`
  (used by the staff and the public menu), `_load_catalog` + an optional `catalog`
  on `_compute_total` / `_create_draft_line` / `_apply_draft_line` in
  `routes/orders.py`, and two compound indexes on `orders`
  (`orders_by_branch_status`, `orders_by_branch_attention`).
  - New `tests/test_catalog_query_budget.py` (13 tests) counts the reads: a menu
    with one 3-component combo is 2 reads instead of 4; two combos sharing a
    component are 2; a batch of 30 new lines is 1 product read instead of 30; a
    batch that only changes quantities or removes a line reads no products at all;
    a missing product is rejected from the same single read. Sold-out components,
    combo-in-combo and "a rejected line does not stop the others" are unchanged.
  - `tests/test_id_indexes.py` pins the two new index definitions.
  - The lines still apply in the order the client sent them, sequentially: after
    the catalog is preloaded there is no I/O left inside them to overlap and they
    all mutate the one `items` list, so `asyncio.gather` would only add risk.
  - Backend: 708 passed / 49 deselected (baseline 692). Commit `7e1e311`.
- Final results: frontend 129 suites / 1263 tests green; `CI=true npx craco build`
  exit 0; backend 708 passed / 49 deselected; `git diff --check` clean.

## Deliberately left out

- Only the **draft-line echo** is skipped. A send, a void, a merge or a move still
  refreshes the floor from its event, because those change what the floor shows
  and the reviewer should see that boundary rather than a blanket "ignore my own
  events" rule.
- `GET /orders` is still unpaginated (`limit` 200 by default) and the batch write
  still re-reads the order at the end.
- `usePolling` still has no in-flight guard, so a poll slower than its interval can
  stack.
- `routes/public.py` `_get_restaurant`-scoped table list still resolves each
  table's combo with `combo_components_for` one by one.
- Whether MongoDB's planner actually picks the two new indexes is **not** asserted:
  the missing-index facts are, and the keys match the filters. Confirming it needs
  `explain()` against a real database with history in it.

## Next step

Review the three commits, then push the branch and open the PR.
