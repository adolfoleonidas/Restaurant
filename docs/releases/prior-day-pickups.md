# Prior-day ready pickups

## Scope
Kitchen and Service share a pure America/Lima calendar-day projection.
Only known ready, no-table pickups from previous days move to a collapsed history section.
Pending/preparing, table and delivery orders remain in the live pass.
Unknown, invalid, naive and future readiness timestamps remain live.
Ready timestamps, not order creation dates, determine the section.
History remains inspectable through existing order-detail links and existing API limits.
No order, payment, table, permission, counter or backend state changes.

## Verification
Published application files exactly match the verified OC-2 implementation.
Final focused suites: 3 suites / 17 tests passed.
Full frontend: 11 suites / 63 tests passed; production build succeeded.
Independent focused check and parent 4-test date-projection spot check passed.
Calendar keys use formatToParts rather than locale-specific display ordering.
The initial build sandbox EPERM was resolved by an authorized elevated build.
Tests use mocks; no real browser, server or database was exercised.
Additional native review was declined; no review receipt is claimed.

## Delivery and rollback
Second slice after table QR access. Item-ready alert checkpoint is explicitly excluded.
Collection extraction, canonical attention numbering and grouped tables remain out of scope.
Revert this slice to remove serviceDay, both board sections, their tests and this note.
Fetched order history and the existing table/financial workflow remain unchanged.
