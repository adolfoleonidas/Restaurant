# App map and known findings

## App map

- Roles/flows: salon (waiter floor, offline tap outbox), caja (cash register, payments, prepay queue), cocina (KDS board), público (QR → Landing/Checkout/PedidoTracking by `tracking_code`), admin (products, categories, users, menu-of-the-day at `/gestion/menu`, reports, config).
- Realtime: in-process SSE hub (`backend/notify.py`); single-process enforced by `security_config.assert_single_process`. Server ping every 15s; client watchdog 45s.
- Tests: backend `tests/` (hermetic via module fakes; 49 integration-marked tests need a live seeded server), frontend `frontend/src/__tests__/` (custom harness, no @testing-library), Playwright e2e in `frontend/e2e` (not in CI).
- Money invariants: payment/void share the `payment_operation` intent saga; deterministic ids `payment-void:{pid}`, `payment-refund:{pid}`; idempotency unique per `(restaurant_id, idempotency_key)` partial index; a pending operation blocks cash close.

## Audit history (update after each audit)

- 2026-10-05: `docs/audit/auditoria-funcionamiento-2026-10-05.md` (C1, A5-A7, M1, M4, M15...).
- 2026-10-15 session audit → Fase 0 fixes merged in PR #123 (commits 8947d44..fe38505): `/gestion/menu` route unshadowed, idempotency partial index + legacy-index migration, business-day order counter, prepay fail-closed branch scope, tracking read limiter, deterministic void audit event_id, SSE tenant filter fail-closed, admin pages honest error states.
- 2026-10-17 Fase 1 (PR #124, `odd/tasks/fase-1-hardening.md`): bcrypt off event loop, axios timeout + SSE watchdog + 401 stop, nginx limit_req + trusted proxy, security headers/CSP (inline dark-mode script allowed by BUILD-minified hash), unified void saga. Pending: nginx configs never linted locally; T6 telemetry deferred.

- 2026-10-19: `docs/audit/auditoria-funcionamiento-2026-10-19.md` — no new CRITICALs; 6 confirmed HIGHs: public SSE without connection cap, `--forwarded-allow-ips=*` baked into the image, CSP blocks external images (T4 regression), 20s timeout kills proof uploads (T2 regression), `isPublicPath` matches `/pedidos*`, Checkout silent on config-fetch failure. Fase 0/1 fixes verified FIXED (void saga reviewed hard, no money loss found).

## Known STILL OPEN (as of 2026-10-19)

- Multi-tenant blockers (Fase 2): `_get_restaurant()` = `find_one({})` on the public surface; global `tracking_code` lookups; no tenant provisioning; global email uniqueness; `America/Lima` + PEN hardcoded; in-process SSE scaling ceiling; no TenantRepo layer (tenant filter is manual in ~360 call sites).
- Session model: 7-day JWT in localStorage, no revocation; QR HMAC keyed with `JWT_SECRET`, 10-year TTL.
- Reports: `.to_list(10000/20000)` truncation without warning; float money everywhere (no Decimal).
- Frontend: no error telemetry (T6 deferred); god hooks (`useTableSheet.js` ~969 lines, `Checkout.jsx` ~784); dead deps (react-query provider unused, ~31 unused shadcn components); SW forced reload can interrupt public checkout; audit_logs deleted by admin reset and write-only.
