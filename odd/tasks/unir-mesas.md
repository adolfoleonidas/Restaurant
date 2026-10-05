# Unir mesas y mover el pedido de mesa

Implement "unir mesas" in a new worktree: visually group tables that serve the same party, and move an open visit from one table to another. Requested by the user in a fresh worktree; no remote publication was requested.

## Authorized scope
The user asked for "la funcion de unir mesas" inside a NEW worktree and explicitly chose, when asked:

- **Both** semantics: group tables visually in the salón **and** transfer an order from one table to another.
- **Block** the join when a selected table already owns a running account (never merge two accounts).
- **Full slice**: backend + frontend (Salón) + tests.

Not authorized, and not done here: merging the items of two running accounts, moving money or payments between orders, touching prices/totals, deleting orders, remote push/PR/merge, deployment, seed or production data changes. The original checkout `C:\Users\adolf\Downloads\07_Proyectos-Codigo\Restaurant` and the `/Users/adolf/Downloads/cobro-restaurante` worktree are untouched.

## Design decisions (why)
- **A group is a floor marker, not an account.** Members keep their own visits and their own accounts. What the group enforces is physical honesty: a member table without a visit of its own is shown as `ocupada` so nobody seats a second party there. This is why the group never touches `orders`, `attentions` or `payments`.
- **Joining is refused as soon as two selected tables own a running account**, which is the user's chosen conservative rule. It also refuses a table that already belongs to another active group, a table with a visit in progress, a table that is not `disponible`/`ocupada` while free, and tables from different branches.
- **Separation is explicit.** A group is dissolved by the staff, never automatically when a visit closes: after the party leaves the tables usually stay physically together. To keep that honest, a group whose members have all gone free is still listed and offers a one-tap "Separar mesas".
- **A stale group pointer is repaired, not fatal.** If a table still points at a group that is dissolved or gone, the join repairs the marker and gives the floor slot back instead of blocking the table forever.
- **Moving a visit is a three-step durable sequence**: reserve the destination, relocate the order document (the point of no return), then relocate the visit projection and free the source table. A retry finishes an interrupted move - both crash windows are covered - instead of duplicating it.
- **A grouped table cannot be moved or transferred** until it is separated, so a group never keeps pointing at a table that no longer holds the account. The same rule protects deletion and branch changes of a grouped table.

## API surface
- `GET /api/table-groups` — active groups of the caller's branch scope.
- `POST /api/table-groups` — `{ table_ids: [>=2], name?, anchor_table_id? }` (admin/mozo).
- `POST /api/table-groups/{id}/tables` — add one table to an existing group.
- `DELETE /api/table-groups/{id}/tables/{table_id}` — separate one member; below two members the group dissolves.
- `DELETE /api/table-groups/{id}` — dissolve the group.
- `POST /api/tables/{id}/transfer` — `{ target_table_id }` (admin/mozo).
- `GET /api/tables` now carries `group` and `group_id` per table so the floor can group without extra calls.

## Tasks
- [x] UM-1: Backend floor marker: `table_groups` collection, group lifecycle endpoints, join guards, status restore, stale-marker repair, tenant/branch scoping, audit entries, floor notices, indexes and operational-reset cleanup. Fake-only regressions in `tests/test_table_groups.py`.
- [x] UM-2: Backend transfer: destination reservation, fenced order relocation, visit relocation, source release, rollback of the reservation when the order changed, crash-recovery retry, audit with `reconciled`. Fake-only regressions in `tests/test_table_transfer.py`.
- [x] UM-3: Frontend: `lib/tableGroups.js` floor helpers, "Unir mesas" selection mode with an explicit conflict message, group badge on every member card, group section plus "Separar mesas"/single-member separation in the sheet, "Mover pedido a otra mesa" dialog, group account readback for a member without its own order.
- [x] UM-4: Tests and docs: helper and rendered-UI regressions, full local suites, this tracker.

## Evidence
- Backend focused: `python.exe -m pytest tests/test_table_groups.py tests/test_table_transfer.py -q` -> **27 passed**.
- Backend full hermetic suite (CI command): `python.exe -m pytest tests -m "not integration" -q` -> **377 passed, 49 deselected**.
- Frontend full suite: `craco test --watchAll=false --runInBand` -> **33 suites / 212 tests passed** (24 of them new: `tableGroups.test.js`, `SalonTableGroups.test.js`).
- Frontend production build: `CI=true craco build` -> compiled successfully (warnings are errors in CI).
- Test-fixture maintenance required by the new collection: `tests/branch_isolation_fakes.py` (added `attentions`/`table_groups`), `tests/test_branch_cash_isolation.py` (index fake), `tests/test_data_reset.py` (reset now clears groups and table markers). These fakes were failing before the update, not the behavior.
- Existing `data-testid` contracts of the floor were preserved; the new ones are `salon-unir-mesas`, `salon-seleccion*`, `salon-unir-confirmar`, `mesa-card-grupo-*`, `mesa-sheet-grupo*`, `mesa-sheet-separar-grupo`, `mesa-sheet-mover-pedido`, `mover-pedido*`.

## Acceptance
- Two free tables of the same branch can be joined from the Salón; every member shows the group badge; the free member reads `ocupada` on the floor and nobody can seat a second party there.
- Joining a table that already owns an account to another table that owns one is refused with a clear message, and the API refuses it too (409) without writing anything.
- A group can be dissolved whole or member by member; blocked free members return to `disponible`, while a member that opened its own account keeps its status and its visit untouched.
- `POST /tables/{id}/transfer` moves the order and its visit to a free table, frees the source, and a retry after an interrupted move converges on the same end state.
- A grouped table cannot be transferred, deleted or moved to another branch until it is separated.
- Terminal isolation is unchanged: a group of another restaurant or another branch is not even visible (404), and grouped tables keep the existing branch-scoped reads.

## Verification limits and rollback
Verification is local and hermetic: FastAPI routes are called against in-memory collections, and the UI regressions are rendered React trees with a mocked API. No live Mongo, no real HTTP server, no browser, no device and no production transaction was exercised, and no deployment or push was performed. The integration modules that need a running stack stay excluded (`-m "not integration"`).

Rollback: revert the group endpoints/collection and the transfer route together with their helpers, UI and tests; drop `table_groups` and the `group_id`/`group_joined_status` fields on `tables` (the operational reset already unsets them). No existing order, payment, attention or cash behavior depends on the new feature.

## Progress and next step
Implementation and both local suites are green in the worktree `.worktrees/unir-mesas` on branch `feat/unir-mesas`. Nothing is pushed. Next possible steps, if requested: publish the branch, or extend the feature (for example a group-level "una sola cuenta" that deliberately merges accounts, which is a different and money-touching decision).
