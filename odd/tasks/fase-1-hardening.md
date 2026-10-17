# Fase 1 — Production hardening

**Objective**: Make the current single-tenant deployment safe to run in production: no event-loop stalls, no hanging requests, no spoofable limits, basic web hardening, and one payment-void path.

**Problem / why**: The 2026-10-15 audit (verified by an independent reviewer) found production-grade risks that do not block correctness today but degrade or expose the service under real load: blocking bcrypt on the event loop, no HTTP timeouts, in-process spoofable rate limiting, missing security headers, no error telemetry, and a second void path with weaker guarantees than the intent saga.

**Scope**: branch `hardening/fase-1` from `main@2f81b9a` (post Fase 0 merge). Backend + frontend + nginx config. No multi-tenant work (that is Fase 2).

**Constraints**:
- Strict TDD: observed RED → GREEN → REFACTOR per task. Runners: `python -m pytest tests -m "not integration" -q` (backend), `npx cross-env CI=true npm test -- --watchAll=false` (frontend, run inside `frontend/`).
- TDD mode source: session config "Strict TDD Mode: enabled".
- One work-unit commit per task (Conventional Commits), tests and docs alongside.
- Delivery strategy: `ask-on-risk` (default). Forecast: ~700 authored changed lines total → likely one PR, re-evaluate at 400.

## Tasks

- [x] **T1 — bcrypt off the event loop** (route: delegated writer — writer trigger: 5 backend files)
  `backend/auth.py` verify/hash via `asyncio.to_thread`; callers in `routes/auth.py`, `routes/users.py`, `routes/data.py` await them. `routes/system.py`: stop verifying up to 25 accounts × 4 demo passwords per call — compute the demo-password flag at login/seed time or cache it.
  Checks: new test proving the event loop is not blocked during verify (or handlers awaited), full hermetic suite green.
- [ ] **T2 — frontend network resilience** (route: delegated writer)
  Default axios timeout (~20 s) in `frontend/src/lib/api.js`; SSE idle watchdog (~45 s) + reconnect with backoff/jitter in `NotifyContext.jsx` and `usePublicStream.js`; stop retrying on 401 (trigger logout path).
  Checks: jest tests for timeout config, watchdog, 401 stop; full frontend suite green.
- [ ] **T3 — rate limiting at the edge + trusted proxy** (route: delegated writer)
  `nginx.conf`/`nginx.tls.conf`: `limit_req` zones for `/api/auth/login` and `/api/public/`; uvicorn `--forwarded-allow-ips` (Dockerfile) so `client.host` is the real peer; bound/evict the in-process `_login_failures` dict as defence in depth.
  Checks: backend tests for lockout-key behavior and dict bounds; config lint (`nginx -t` if available, else review).
- [ ] **T4 — nginx security headers** (route: inline, mechanical)
  CSP (first-party scripts + Google Fonts), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` in both nginx configs.
  Checks: config review; headers asserted in e2e smoke when available.
- [ ] **T5 — unify payment void paths** (route: delegated writer)
  Route the non-visit void (`payments.py:939-1072`) through the same intent saga as the visit path; deterministic `payment-refund:{pay_id}` movement id; keep behavior identical on the happy path.
  Checks: new tests for crash-retry idempotency (operation resumes, single cash movement, single audit row), hermetic suite green.
- [ ] **T6 — error telemetry** (route: blocked on product decision)
  Needs the user's choice of service (Sentry account/DSN or self-hosted alternative). Do not start until decided.

## Progress log

- 2026-10-17: Branch created from `main@2f81b9a`. Engram mirror PENDING (server connection timed out this session); re-sync when available.
- 2026-10-17 T1 done. TDD observed: RED `15 failed, 21 passed` on the three affected files → GREEN `36 passed`; full hermetic suite `792 passed, 49 deselected`. Parent spot check: `tests/test_bcrypt_off_loop.py` → `9 passed`. `auth.py` gains `*_async` wrappers via `asyncio.to_thread`; `system.py` replaces the per-request bcrypt sweep with a hash-keyed cache (cap 512, test hook `_reset_demo_password_cache`). Known caveat: the two loop-responsiveness tests are timing-based (10-tick floor over ~300 ms) and could be flaky on a very loaded CI machine. RDD: clone-local OFF (user decision) → ordinary checks only. Commit hash recorded at next log entry.
