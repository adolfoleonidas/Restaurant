# Audit agent prompts

Fill `<repo>` with the absolute repo path and `<branch>` with the current branch. Both agents are READ-ONLY: they must not modify any file. Require `file:line` evidence for every claim and an explicit severity (CRITICAL/HIGH/MEDIUM/LOW), ending with a ranked top-10.

## Backend agent (model: sonnet)

> You are auditing the BACKEND of a restaurant system at `<repo>` (branch `<branch>`). Stack: FastAPI + Motor (MongoDB), routes in `backend/routes/`, in-process SSE hub (`backend/notify.py`), single-process constraint (`backend/security_config.py`). READ-ONLY.
>
> Assess with `file:line` evidence:
> 1. MULTI-TENANCY: every query filtered by `restaurant_id`; JWT claims never trusted for authz (`auth.py` loads the user per request); public surface tenant resolution (`routes/public.py` — `_get_restaurant`); branch scoping fail-closed (`branch_access.py` helpers vs ad-hoc `user.get("branch_id")`).
> 2. MONEY: payment intent saga (`routes/payments.py` — `payment_operation`, `_resume_payment_operation`, `_resume_void_operation`); deterministic idempotency ids; counters race safety (`attention_numbering.py`, order-number allocators in `routes/orders.py` vs `routes/public.py`); cash close invariants (`routes/cash.py`).
> 3. SECURITY: login lockout and rate limiting (`routes/auth.py`, `guest_access.py`, nginx configs in `frontend/`); JWT lifetime/revocation; secrets handling; audit_logs integrity (`routes/data.py` reset scope).
> 4. SCALE: SSE hub fan-out cost, blocking calls on the event loop (bcrypt), unbounded `to_list`/`limit` reads, report truncation (`routes/reports.py`).
> 5. Read `docs/audit/` and `odd/tasks/` first; mark prior findings FIXED or STILL OPEN instead of re-reporting them as new.

## Frontend agent (model: sonnet)

> You are auditing the FRONTEND at `<repo>/frontend` (branch `<branch>`). Stack: React CRA+craco, Tailwind/shadcn, api clients in `src/lib/api` (axios wrapper `request.js`), SSE streaming (`contexts/NotifyContext.jsx`, `hooks/usePublicStream.js`), offline tap outbox (`lib/lineSyncQueue.js`, `lib/outbox*`). Custom test harness in `src/test-utils/` — the repo does NOT use @testing-library. READ-ONLY.
>
> Assess with `file:line` evidence:
> 1. UX STATES: per page — loading/error/empty states, failures masked as empty lists (`.catch(() => set...([]))`), double-submit guards (`usePendingAction`), confirmations on destructive actions (`ConfirmDialog`), toast-only validation.
> 2. ROUTING/AUTH: route shadowing in `App.js` (public vs guarded paths), `ROUTE_ROLES`/`NAV_ITEMS`/`ROUTE_TITLES` consistency (`lib/permissions.js`), 401 handling (`lib/authSession.js`), tests that mount `App` (`__tests__/AppRoutes.test.js`).
> 3. RESILIENCE: axios timeout config, SSE idle watchdog and backoff (`lib/streamResilience.js`), service worker + chunk recovery behavior on public routes.
> 4. ACCESSIBILITY: focus traps in nested dialogs (`components/cobro/*Dialog.jsx`), tap target sizes, aria wiring; cross-check the design-system tests (`TouchTargets`, `ThemeContrast`, `LabelAssociation`).
> 5. HYGIENE: dead deps/components, god hooks (`pages/salon/useTableSheet.js`, `pages/Checkout.jsx`), bundle weight of eager public pages.
> 6. Read `docs/audit/` first; mark prior findings FIXED or STILL OPEN.
