# Prototype order-taking integration

Complete the approved Salon table-order flow while preserving sent kitchen history, payment behavior, API authorization, and existing backend contracts.

## Scope

- Draft composition with an optional alias and a mobile ticket.
- Safe discard/clear behavior that only affects unsent items.
- Draft review before kitchen submission.
- Editing eligible unsent drafts, locked after sending.
- A two-step mobile action: review, then confirm submission.

Out of scope: backend/payment contract changes, unrelated POS modules, real backend mutations, and deployment. The final merge to `main` remains held until the maintainer's final checks.

## Delivery

- Strategy: feature-branch chain; this branch is the draft integration tracker.
- Work begins from `e9df8dc` (the verified `main` baseline).
- Five child slices integrate in order: composition → safeguards → review → draft edit → mobile send.
- User-approved final accumulated `size:exception`: 1,022 authored changed lines.
- RDD is clone-local OFF; do not enable or start it.

## Verification boundaries

Frontend tests and build passed on the completed source candidate. Child branches do not trigger this repository's configured PR checks; final tracker CI remains required. No real-backend end-to-end proof has been performed. Do not claim it or manually deploy.
