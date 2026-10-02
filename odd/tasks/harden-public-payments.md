# Harden Public Payments

## Objective
Prevent public clients from mutating closed payment state or selecting payment methods disabled by the restaurant.

## Problem
The public proof endpoint can overwrite payment state after an order is closed, and public order creation trusts the requested payment method without checking restaurant configuration.

## Why
Both behaviors can create incorrect payment workflows and reconciliation data even when the frontend behaves correctly.

## Scope
- Reject proof uploads for paid or cancelled orders.
- Reject public orders that select a disabled payment method.
- Add focused backend regression tests.

## Constraints
- Preserve existing public API behavior for valid open orders and enabled payment methods.
- Keep existing Spanish API error-message convention.
- Do not change frontend behavior or broaden into timezone/cart fixes.
- Technical artifacts remain in English except existing user-facing API messages.

## Configuration
- TDD mode: unknown; no explicit project/session setting found.
- Test runner: `py -m pytest`.
- Delivery strategy: `ask-on-risk`.
- Engram mirror topic: `odd/harden-public-payments/tasks` (pending: no callable memory tools are available).

## Tasks

### ODD-1 — Protect closed orders from proof uploads
- Status: pending
- Route: delegated writer; multi-file write trigger (backend behavior plus regression tests).
- Acceptance criteria:
  - Paid and cancelled orders reject public proof uploads.
  - Valid open orders retain current proof-upload behavior.
- Checks:
  - Focused regression tests for closed and open order states.
- Evidence: pending.

### ODD-2 — Enforce enabled public payment methods
- Status: pending
- Route: delegated writer; multi-file write trigger (backend behavior plus regression tests).
- Acceptance criteria:
  - Public order creation rejects a configured disabled method.
  - Enabled methods and existing defaults remain accepted.
- Checks:
  - Focused regression tests for disabled and enabled methods.
- Evidence: pending.

## Forecast
Approximately 40–100 authored changed lines across backend behavior and tests; below the 400-line review heuristic.

## Progress
Authorized by the user after the audit recommendation. No source changes yet.

## Verification Evidence
Pending.

## Next Step
Create a feature branch, delegate both bounded fixes and focused tests to one writer, then verify the result.
