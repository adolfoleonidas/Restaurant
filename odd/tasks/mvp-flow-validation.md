# MVP Flow Validation — mozo → cocina → caja → cobro (Playwright, local)

## Objective

Prove the core restaurant MVP flow end-to-end with Playwright against a LOCAL stack with seeded data: mozo takes order → cocina prepares → cuenta reaches caja → cajero opens register → collects with the new CobrarDialog (desktop + mobile) → paid state. Produce a UI/UX findings report and a reusable test harness for tomorrow's MVP testing.

## Problem / Context

User wants to start MVP testing tomorrow with the waiter→kitchen→cash path. Production path is currently blocked by the known legacy-register reconciliation (odd/tasks/legacy-test-reconciliation.md, R1–R3) — explicitly OUT of scope here (user chose local+seed; no production mutations, no credentials).

## Scope

- Local stack: MongoDB (docker), FastAPI backend, CRA frontend, seed data (branches, tables, products, users per role).
- Playwright dev-dependency + config + chromium; specs in a dedicated e2e folder.
- Journey: login mozo → nuevo pedido (mesa) → cocina ve y avanza estados → pedido/cuenta → login cajero → abrir caja turno → Cobrar (CobrarDialog) efectivo + yape-with-proof → pagado → historial. Screenshots per step (desktop + mobile viewports).
- UI/UX review findings from actual observed flow (labels, states, mobile behavior, friction).
- Commit harness + how-to-run docs on branch `feat/mvp-flow-validation` (local commits; push only if user asks).

Out of scope: production URL, legacy reconciliation, backend changes unless a REAL defect blocks the MVP flow (report first), performance testing.

## Constraints

- Never point tests at 93.127.214.26:8081.
- No secrets committed; local .env / seed creds are test-only.
- Keep e2e deterministic: fresh seeded DB per run where possible, unique data per run otherwise.
- Use existing `data-testid` contracts where present (caja-*, comprobante-*).
- Route: delegated (writer trigger). One sequential writer per unit. TDD mode: off (no strict-tdd record; the deliverable IS tests + harness).

## Tasks

- [x] **E1** — Bring-up local stack: mongo (docker, :27017) + backend (:8000) ya estaban arriba y sanos; se levantó el frontend CRA en :3000 (`npm start`). Health + login verificados. Cuentas demo: `admin@resto.com/admin123`, `mozo@resto.com/mozo123`, `cajero@resto.com/cajero123`, `cocina@resto.com/cocina123`.
- [x] **E2** — Playwright ya instalado (`@playwright/test` en devDeps + navegadores chromium). `playwright.config.ts` con baseURL `localhost:3000`, proyectos `desktop`/`mobile` y `globalSetup`. Smoke test corregido para apuntar a `/login` (la raíz `/` es la carta pública).
- [x] **E3** — `e2e/fixtures/seed-roles.js` crea/verifica la sucursal "Sucursal MVP" + usuarios por rol con `branch_id` (`mozo/cocinero/cajero.test@example.com` / `test1234`) + mesas 20-22. FIXTURE READY.
- [x] **E4** — `e2e/flow-desktop.spec.ts`: mozo→mesa→cocina (llegan/fuego/listo)→cuenta→cajero abre caja→CobrarDialog efectivo exacto→pagado→historial. VERDE.
- [x] **E5** — `e2e/flow.mobile.spec.ts` (Pixel 5 / Chromium, `hasTouch`): mismo flujo + asserts de CobrarDialog táctil ("Ver N items", grilla de 6 métodos, teclado numérico en pantalla). VERDE.
- [x] **E6** — `e2e/UIUX-FINDINGS.md`: lista P0–P3 (sin P0; P1 = liberación manual de mesa post-pago vía Servicio; P2 = `/` no es login + doble confirmación en efectivo; P3 = mobile/colores/copy positivos).
- [ ] **E7** — Green gate ✓ (3/3 verde). Pendiente: commit del harness a `feat/mvp-flow-validation` (solo los archivos intencionados) + registrar commit id.

## Cómo correr (mañana)

```bash
# 1) stack arriba (mongo :27017, backend :8000, frontend :3000)
# 2) fixture de sucursal/usuarios (idempotente)
cd frontend && node e2e/fixtures/seed-roles.js
# 3) suite completa (smoke + desktop + mobile)
npx playwright test
# solo desktop / solo mobile
npx playwright test --project=desktop
npx playwright test --project=mobile
```

Notas: el `globalSetup` crea mesas frescas por corrida (números altos) para no depender del estado previo; los artefactos quedan en `e2e/artifacts/` y los fallos en `test-results/` (ignorados por git).

## Verification (all)

- E1: `curl http://localhost:8000/health` (or actual route) → ok; frontend 200; login POST returns token for seeded user.
- E4/E5: `yarn playwright test` exit 0; artifacts screenshots present.
- No changes to backend business logic without parent-approved defect finding.

## Next Step

Commit del harness (solo archivos intencionados: `frontend/e2e/**`, `frontend/playwright.config.ts`, `frontend/.gitignore`, `frontend/package*.json`/`yarn.lock` si corresponde, y este tracker) a `feat/mvp-flow-validation`, dejando fuera `tests/test_charge_and_close.py` y `frontend/src/__tests__/PedidoDetalleChargeClose.test.js` (tarea aparte) y los artefactos (`e2e/artifacts/`, `e2e/.runtime.json`, `test-results/`).
