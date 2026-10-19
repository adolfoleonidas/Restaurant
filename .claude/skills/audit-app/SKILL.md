---
name: audit-app
description: "Trigger: audit the app, auditar, buscar fallos, encontrar bugs, probar el sistema, pre-release check. Run the Restaurant app audit: test suites, delegated code audits, evidence-ranked findings and a phased fix plan."
license: Apache-2.0
metadata:
  author: "adolfoleonidas"
  version: "1.0"
---

# Restaurant App Audit

## Activation Contract

Load when the user asks to audit the system, find bugs, test the app end to end, or check release readiness for this repo.

## Hard Rules

- Audit is READ-ONLY. Report findings first; write fixes only after the user authorizes a fix phase.
- Every finding carries evidence: a `file:line`, a failing test name, or probe output. No evidence, no finding.
- Test counts come only from suites actually run in this session — never from docs or memory.
- Before reporting, cross-check `docs/audit/` and `odd/tasks/` so already-fixed findings are marked fixed, not re-reported.
- Verify any surprising claim empirically before reporting it (run the test, read the line).
- The 49 `integration`-marked tests need a live server at `127.0.0.1:8000` with seeded demo data; never count their failures as product bugs when run without one.

## Decision Gates

| Scope asked | Do |
|---|---|
| Full (default) | Steps 1-5 |
| Backend only | Steps 1 (backend), 2 (backend agent), 4-5 |
| Frontend only | Steps 1 (frontend), 2 (frontend agent), 4-5 |
| Live UX | Steps 1, 3, 4-5 (needs backend + Mongo running) |

## Execution Steps

1. Baseline, in background, both at once:
   - Backend: `MONGO_URL="mongodb://127.0.0.1:27017" python -m pytest tests -m "not integration" -q` (repo root)
   - Frontend: `npx cross-env CI=true npm test -- --watchAll=false` (from `frontend/`)
2. Launch the two audit agents in parallel using the prompts in `assets/audit-agent-prompts.md` (backend: tenancy, money, security; frontend: architecture, UX states, SaaS readiness). Model: sonnet.
3. Live UX pass only when asked or scope=Live: start the app, then invoke the `ux-ui-audit` skill against it.
4. Reconcile: diff agent findings against `references/known-findings.md` and `docs/audit/*`; label each finding NEW / STILL OPEN / FIXED. Re-verify every CRITICAL/HIGH yourself before accepting it.
5. Deliver the Output Contract. Offer the fix phase; on acceptance route it through ODD (feature doc + work-unit commits), one branch per phase.

## Output Contract

Return in chat, and save to `docs/audit/auditoria-funcionamiento-YYYY-MM-DD.md`:

- Verdict: is the system functional (suite numbers from this run) and what blocks production/SaaS.
- Findings table ranked CRITICAL/HIGH/MEDIUM/LOW: evidence, failure scenario, concrete fix, status (NEW/STILL OPEN/FIXED).
- Phased fix plan (quick bugs → hardening → structural) with effort estimates.
- Explicit "Not verified" list — what the audit could not check and why.

## References

- `assets/audit-agent-prompts.md` — delegation prompts for the backend and frontend audit agents.
- `references/known-findings.md` — app map, invariants, and the status of past audit findings.
