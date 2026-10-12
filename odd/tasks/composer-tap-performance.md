# Composer tap performance

## Objective and problem

Waiters on low-cost phones see a delay between tapping a product card and the quantity updating. A Playwright audit on 2026-10-12 (mobile emulation, real touch taps, CDP CPU throttling; scripts in the session scratchpad `perf/`) measured tap → painted p50 of 46 ms unthrottled, 194 ms at 4x CPU, and 401 ms at 6x CPU, with up to 900 ms of long tasks per tap at 6x. Touch delay is 0.1 ms and the quantity is optimistic, so network and server are not the cause of the visible delay.

Causes, verified in code:

1. The product grid in `frontend/src/components/OrderComposer.jsx` (cards ~206–267) is not memoized; each tap causes 9–12 React commits and every card plus its lucide icons re-renders.
2. Each tap triggers about 8 GETs: `onSynced: () => refreshAll()` in `pages/salon/useTableSheet.js:299`, `generation` in the products poll (`pages/salon/useSalonData.js:45`), undebounced `setGeneration` in `contexts/NotifyContext.jsx`, and `KitchenAlerts` refetching `/orders/kitchen`. Every response sets new state and commits again, even when unchanged.
3. The tap "pulse" is React state (`setPulse`, `OrderComposer.jsx:99,126,219,249`; keyframes `index.css:255`), adding 2 commits and about 44 ms per tap at 4x.

## Scope and authority

- Branch: `perf/composer-taps` from origin/main `cca4f35`.
- User authorized the three fixes and merge in chat on 2026-10-12.
- Behavior-preserving: same UI text, data-testids, accessible names, quantities, and server writes; the optimistic queue semantics from UX-14 stay intact.

## Implementation and checking

- Route: delegated direct, one bounded writer.
- TDD: **on** (global configuration). Render-count and request-count tests first (RED), then the change.
- Frontend: `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4` (baseline 107 suites / 937 tests) and `npx craco build`.
- Performance proof: the parent re-runs the same Playwright scripts before/after on the rebuilt test stack.

## Tasks

- [x] **CP-01 Memoized product cards.** Extract the card into a `React.memo` component that receives only its own product, quantity, and disabled state, with stable `onAdd`/`onRemove` callbacks; a tap re-renders only the tapped card (plus the summary/bar).
- [x] **CP-02 Fewer requests and commits per tap.** Confirm a synced line from the write response instead of `refreshAll()`; take `generation` out of the products poll; debounce `generation` bumps in `NotifyContext`; `usePolling` skips `setData` when the payload is unchanged; `KitchenAlerts` does not poll the kitchen list for roles that do not need it. Other screens still refresh on realtime events.
- [ ] **CP-03 CSS-only tap feedback.** Replace the `setPulse` state with a CSS-only effect (`:active` transform, transform/opacity only); remove `transition-colors` from the card row if it no longer serves a state; `touch-action: manipulation` on card and stepper buttons.

## Progress and evidence

- 2026-10-12: document and branch created.
- 2026-10-12 CP-01 (route: delegated direct, single writer; TDD on, runner `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4`, source: global configuration):
  - RED: new `OrderComposerRenders.test.js` counts card renders through `fmtMoney` calls (one per card render, unique price per card). Before the change `tapping a card re-renders that card only` and `the stepper + and - also leave the other cards alone` failed (`Expected: 0, Received: 1` for the untapped cards).
  - Commit: 51e8e3b `perf(composer): memoize product cards so a tap re-renders only the tapped card`.
  - GREEN: extracted `components/ComposerProductCard.jsx` (`React.memo`; props: product, qty, out, busy, canRemove, pulsing, testIdPrefix, stable `onAdd`/`onRemove`). `OrderComposer` builds a per-product `{qty, target}` map once per `lines` change and keeps `add`/`remove` stable with refs to the latest `onAddProduct`/`onRemoveProduct`; `onRemoveProduct(product, draftLine)` still receives the draft line. New test file 3/3 pass; full suite 108 suites / 940 tests green (baseline 107 / 937).
- 2026-10-12 CP-02 (route: delegated direct, single writer):
  - Backend check (`backend/routes/orders.py`): `POST /orders/{id}/items`, `PATCH .../items/{item_id}` and `DELETE .../items/{item_id}` all answer with `_current_order_response` (the whole order, same shape `GET /orders/{id}` returns for admin/mozo, the only roles allowed to write), so the write response is enough to confirm a line.
  - RED (new tests first): `useOrderLineSync`, `useTableSheetRequests`, `usePollingEqual`, `NotifyCoalesce` and `KitchenAlertsGating` = 13 failed / 14 passed in 5 files; the failures were the intended ones (extra `getOrder` and `refreshAll` after a tap, `loadOrder` called despite a usable response, `setData` committing equal payloads, 5 events producing 5 bumps). `KitchenAlertsGating` passed on the old code: the role gate already existed, the test pins it.
  - GREEN: `useOrderLineSync` takes an optional `acceptOrder(order)` and confirms a synced line from the write response (falls back to the old `loadOrder` GET when the response has no order for that id). `useTableSheet` extracts `applyOrder`, passes it as `acceptOrder`, and its `onSynced` calls `refreshAll()` only when the queue created the account in this drain (`floorChangedRef`); `NewOrderSheet` does the same with `setOrder` and `onCreated`. `useSalonData` products poll no longer depends on `generation`. `NotifyContext` coalesces event bumps (250 ms quiet period, 1000 ms max wait; reconnect and wake bumps unchanged) and memoizes its value. `usePolling` skips `setData` when the JSON text equals the one on screen (payloads over 1M chars or not serialisable are committed as before), no longer ticks a state counter every interval (nothing read `tick`), and only touches `error`/`loading` state when they change.
  - KitchenAlerts: the gate was already `ROLES = admin, cocina, mozo` (cajero, other roles and signed-out users never request `/orders/kitchen`). Mozo was added on purpose in 82c123b ("mozo role included"), so it was kept; its refetch per realtime burst is now one GET that commits nothing when the list is unchanged. No code change; role gating test added.
  - Tests changed: `useTableSheetOptimistic.test.js` fake server now answers writes with the order (the real shape), so the UX-14 scenarios run on the new path; its final `refreshAll` assertion became `not.toHaveBeenCalled()` because a plain quantity change no longer refreshes the floor.
  - Result: full suite 113 suites / 967 tests green.
