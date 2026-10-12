# Action feedback and resilient realtime

## Objective and problem

The user reported tapping "Cobrar" and other actions about six times with no response until a page reload. A live diagnosis on 2026-10-12 (test stack, branch `feat/usability`) ruled out server latency (every endpoint p50 under 130 ms, max 235 ms) and found two causes:

1. Silent controls. The cash charge's final "Registrar" (`components/cobro/VerifyDialog.jsx:40`) is `disabled` until a checkbox is ticked, with no visible reason; six clicks sent zero requests. Deliver, request bill, release table, send to kitchen, serve, cancel, and the kitchen bump show no pending state; rapid taps fire duplicates (kitchen bump: one 200, then 400 "Nada para avanzar") or are silently ignored by `if (saving) return` guards.
2. Realtime that dies silently. `backend/notify.py` `publish` drops a subscriber whose queue is full, but the SSE generator in `backend/routes/notifications.py` keeps sending pings, so the client believes it is connected and never receives another event until reload. The client also does not refetch after reconnect or wake, and `usePolling` lets an older response overwrite a newer one.

## Scope and authority

- Branch: `fix/action-feedback-realtime` from origin/main `3bcef73` (after PRs #85–#88 merged).
- User authorized these three fixes in chat on 2026-10-12.
- Money actions stay server-confirmed (no optimistic UI). Idempotency keys for payments already exist and must keep working.
- UI copy Spanish tuteo; code, tests, docs, commits English.

## Implementation and checking

- Route: delegated direct, one bounded writer.
- TDD: **on** (global configuration).
- Frontend: `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4` (baseline 101 suites / 897 tests) and `npx craco build`.
- Backend: `MONGO_URL=mongodb://127.0.0.1:1 DB_NAME=audit_dummy APP_ENV=test python -m pytest -m "not integration" -q` (baseline 548).
- Browser re-check on the rebuilt test stack after the writer finishes.

## Tasks

- [x] **AF-01 Charge verify gate explains itself.** The final "Registrar" stays clickable; when the confirmation checkbox is not ticked it does not submit, highlights and focuses the checkbox, and shows "Marca la casilla para continuar" (`aria-describedby`, `aria-invalid`). The `CobroFooter` reason for a disabled register action is visible next to the button.
- [x] **AF-02 Every action shows it is working.** One shared pending-action helper (hook or button wrapper): disables the control while in flight, shows a pending label ("Entregando…", "Enviando…", "Cobrando…", "Abriendo cobro…"), ignores repeat taps, and surfaces errors through `apiErrorMessage`. Applied to deliver, request bill, release table, close attention, kitchen bump and per-item bump, send to kitchen, serve, remove item, cancel order, and the "Cobrar" button that fetches the cash register before opening the dialog. Silent busy guards show a short toast instead of returning silently.
- [x] **AF-03 Realtime never dies silently.** Backend: a dropped subscriber's stream ends (sentinel on overflow) so the client reconnects; per-event user lookup in the stream is not repeated for every event if it can be cached safely. Frontend: `NotifyContext` refetches (bumps `generation`) after a reconnect and on `visibilitychange` to visible, `online`, and `focus`; `usePolling` ignores responses older than the last applied one.

## Deferred

Event-typed targeted refetch per screen; publishing events for catalog, table, zone, user, and branch CRUD; client heartbeat watchdog; Redis pub/sub when scaling out.

## Progress and evidence

- 2026-10-12: document and branch created from origin/main `3bcef73`.
- AF-01: RED `craco test VerifyGate` -> 3 failed / 1 passed (button disabled, no hint, no aria-describedby on footer). GREEN after change: `craco test VerifyGate CobrarDialog CajaPaymentProof PedidoDetalleCollection` -> 5 suites / 42 tests passed. Files: VerifyDialog.jsx (clickable Registrar, focus + hint + aria-invalid), CobroFooter.jsx (always-visible reason, aria-describedby), cobro.css, __tests__/VerifyGate.test.js. Route: delegated direct (single writer).
- AF-02: RED per unit before each change (usePendingAction/PendingButton missing module; useFloorActions 4 failed; FloorActionFeedback 4 failed; Cocina 2 failed; PedidoDetalleActionFeedback 6 failed; useTableSheet 2 failed; footer Cobrando… 1 failed). GREEN: full suite `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4` -> 105 suites / 926 tests passed (baseline 101/897). Design: `hooks/usePendingAction.js` (`[run, pending]`, ref-backed per-key guard, errors via `apiErrorMessage`), `components/ui/pending-button.jsx`, `contexts/PendingActionsContext.jsx` (floor buttons read pending keys). Wrapped: deliver (card, group card, account card, mini bar, sheet menu), request bill, release table, close attention, kitchen bump and per-item bump, send to kitchen (sheet + order detail), serve, remove item, cancel order, Cobrar register lookup, final payment button ("Cobrando…"). Busy guards in requestSend/confirmReviewedSend/leaveComposer now toast "Un momento, guardando…".
- AF-03 backend: RED `pytest tests/test_notify_overflow.py` -> 2 failed (no close marker; stream never ended; public stream crashed on the marker, 1 more failed once added). Fix: `notify.CLOSED` sentinel; `publish` drops an overflowing subscriber and leaves only the marker in its queue; `/notifications/stream` and `/public/stream` return when they read it. GREEN: `pytest -m "not integration" -q` -> 552 passed (baseline 548, +4). Per-event `users.find_one` left uncached on purpose: existing tests require the branch and active flag to be fresh per event (reassignment and deactivation must take effect on the next event), and a TTL cache would delay revocation; the lookup is bounded now that a slow subscriber is dropped.
- AF-03 frontend: RED `craco test NotifyRefetch usePollingStale` -> 4 failed. Fix: `NotifyContext` bumps `generation` after a reconnect (not the first connect) and, debounced 300 ms, on visible `visibilitychange`, `online` and `focus`; pauses 500 ms before reconnecting after a clean server end; `usePolling` request counter drops any response from a superseded request. GREEN: full suite 107 suites / 933 tests passed.

## Next step

Browser re-check on the rebuilt test stack, then PR.
