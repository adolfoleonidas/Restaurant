# Table guest QR access

## Scope
Admin table cards in configuration expose existing guest-link, rotate and revoke operations.
Links are requested only on an explicit action; table listings do not expose signed capabilities.
Each table has independent status, busy/error feedback and confirmed rotate/revoke actions.
Clipboard failures retain a selectable URL for manual copying.
No backend permissions, token rules or packages change.

## Verification
The published application files exactly match the verified OC-1 implementation.
Focused ConfiguracionTableQr suite: 8 tests passed.
Full frontend at that boundary: 10 suites / 57 tests passed; production build succeeded.
Independent verification and parent focused spot check passed.
The earlier interrupted build was superseded by a successful independent build.
API interactions are mocked; no real QR scan, browser clipboard or database was tested.
Additional native review was declined; no review receipt is claimed.

## Delivery and rollback
First of two independently deployable slices: table QR access, then prior-day pickup projection.
Item-ready alerts, collection extraction, attention numbering and grouped tables are excluded.
Revert this slice to remove TableQrActions, its configuration integration, test and this note.
Existing server APIs and all payment/attention behavior remain unchanged.
