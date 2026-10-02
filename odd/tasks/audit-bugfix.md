# Audit Bugfix — Restaurant POS

## Objective
Fix 5 confirmed bugs from full system audit.

## Problem
System audit identified critical bugs: zone propagation broken on rename, public upload missing image validation, hardcoded timezone in reports/cash, double ThemeProvider, health check without DB verification.

## Scope
- Backend: zones.py, public.py, cash.py, reports.py, server.py
- Frontend: index.js, App.js

## Constraints
- Each fix must be minimal and surgical
- No new dependencies
- No behavioral changes beyond the bug fix

## Tasks

- [x] **FIX-1**: Zone branch_id propagation broken on rename
  - File: `backend/routes/zones.py` line 100
  - Bug: After name propagation (line 91-95), tables already have new name, but branch_id propagation (line 98-102) queries by old name `z["name"]`
  - Fix: Use `update["name"]` instead of `z["name"]` on line 100
  - Route: delegated

- [x] **FIX-2**: Public proof upload missing magic bytes validation
  - File: `backend/routes/public.py` lines 720-735
  - Bug: Only checks `data:image` prefix, no magic bytes validation (unlike staff endpoint)
  - Fix: Add base64 decode + magic bytes validation (PNG/JPEG/WEBP) matching `payments.py` pattern
  - Route: delegated

- [x] **FIX-3**: Hardcoded timezone "America/Lima" in cash.py and reports.py
  - Files: `backend/routes/cash.py:11-22`, `backend/routes/reports.py:11-23`
  - Bug: System supports configurable branch timezones but these use hardcoded Lima
  - Fix: Resolve branch timezone from user context or default branch, fall back to UTC
  - Route: delegated

- [x] **FIX-4**: Double ThemeProvider in frontend
  - Files: `frontend/src/index.js:21` + `frontend/src/App.js:45`
  - Bug: ThemeProvider wraps App in index.js AND inside App.js
  - Fix: Remove ThemeProvider from App.js (keep in index.js where QueryClientProvider is)
  - Route: delegated

- [x] **FIX-5**: Health check without DB verification
  - File: `backend/server.py` lines 45-47
  - Bug: `/api/health` returns `{"status": "ok"}` without checking MongoDB
  - Fix: Add MongoDB ping check, return degraded status on failure
  - Route: delegated

- [x] **VERIFY**: Backend starts without errors after all fixes
  - Route: inline

## Acceptance Criteria
- Zone rename + branch_id change propagates correctly to tables
- Public proof upload rejects non-image files with magic bytes check
- Cash/reports use branch timezone, not hardcoded Lima
- Single ThemeProvider in component tree
- Health check reflects actual DB connectivity
- Backend starts clean, no import errors

## Progress
- Started: 2026-10-02
- Status: In progress
