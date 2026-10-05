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
- **Real Mongo check** (throwaway script, scratch database `restaurant_unir_mesas_check`, dropped afterwards; the app databases `restaurant_db`/`restaurant_e2e` were never touched): `ensure_indexes()` created the new indexes, joining/adding/listing/dissolving groups behaved as specified, the guards refused a reserved table and a foreign-branch table, a grouped table refused the transfer, the transfer moved the order and the visit and freed the source, and a retry of a completed move converged. Output: `REAL MONGO CHECK OK · groups=1 audits=6`.
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
Verification is local: FastAPI routes are exercised against in-memory collections (the whole hermetic CI command) and once against a real local Mongo on a scratch database that was dropped afterwards. The UI regressions are rendered React trees with a mocked API, plus a full production build. What was **not** exercised: a browser or device against the running app, the HTTP layer of the new endpoints (no curl against a live server), concurrent clients racing on the same table, and production data. No push, PR, merge or deployment was performed. The integration modules that need a running stack stay excluded (`-m "not integration"`).

Rollback: revert the group endpoints/collection and the transfer route together with their helpers, UI and tests; drop `table_groups` and the `group_id`/`group_joined_status` fields on `tables` (the operational reset already unsets them). No existing order, payment, attention or cash behavior depends on the new feature.

## Progress and next step
Implementation and both local suites are green in the worktree `.worktrees/unir-mesas` on branch `feat/unir-mesas`, in work-unit commits (backend, frontend, docs, one sheet fix). The user authorized publishing the branch, so `refs/heads/feat/unir-mesas` exists on origin. `main` itself was **not** touched, so the `Deploy to VPS` workflow (triggered only by a push to `main`) did not run.

`main` moved twice while this ran (`f3d5d0f..8f88e76`: cash/payments/public/TLS-deploy work, then per-branch table numbers and zone names, the login limiter fix and the API error handling). The second batch overlapped this branch in `backend/database.py`, `backend/routes/data.py`, `backend/routes/tables.py`, `backend/server.py` and `tests/test_data_reset.py`, so `main` was merged **into** this branch instead of leaving it stale:

- `c3645de Merge main into feat/unir-mesas`. Everything auto-merged except one hunk in `database.py`: the index block, resolved by keeping this branch's `table_groups`/`group_id` indexes **and** main's per-branch zone index (which supersedes the tenant-wide one, so the old line is not re-created). The auto-merge of `tests/test_data_reset.py` correctly kept both sides' assertions.
- Merged state re-verified: backend `python.exe -m pytest tests -m "not integration" -q` -> **387 passed, 49 deselected** (includes main's new tests); frontend `craco test --watchAll=false --runInBand` -> **33 suites / 213 tests passed**.
- `main` is now an ancestor of this branch, so merging the branch into `main` is a fast-forward and `git merge-tree` reports no conflicts. Any push to `main` still triggers the production deploy.

Next possible steps, if requested: open the pull request (`https://github.com/adolfoleonidas/Restaurant/pull/new/feat/unir-mesas`), merge into `main`, or build the future capability specified below.

## Future capability (NOT implemented, NOT authorized): join tables that already have their own orders

The user asked on 2026-10-04 to record the option that was deliberately deferred in this delivery: the second answer to "what happens when a selected table already owns its order" was **"Fusionar cuentas"** - *move the items of one order into the other and free the source table*. The accepted answer for this delivery was to block the join instead; that guard is what ships today.

**The real use case (user's words, translated):** somebody arrives early, sits at table 4 and orders. Later their family or friends arrive, sit with them or at table 5, and order something else; the waiter joins the tables. Today that flow only works while at most one of the joined tables already owns an order.

**What already works today** (no change needed): a table with an order plus a free table can be joined, and the free table can then open its own order, so the group shows two accounts. **What is blocked** (the gap): joining when *two* selected tables already own an order.

Two variants are worth specifying separately, because their risk is not the same:

- **F1 — Group without merging (separate accounts).** Allow joining two occupied tables; each keeps its own visit and its own account; the group must show how many accounts it has and which member owns each one. Code impact: relax the "two running accounts" guard in `_validate_join`, and teach the salón to render several accounts inside one group (today `groupAccountTable` in `frontend/src/lib/tableGroups.js` assumes a single account). Money risk: none, nothing is written to orders or payments. This is the cheap half.
- **F2 — Merge into a single account.** Pick the account that survives, move the items of the other order into it, recompute subtotal/total/discount/tip, rebuild the kitchen state, close the source visit and free the source table, with an audit entry. This is the money-and-kitchen half and needs its own careful delivery.

**Open questions to answer before implementing F1/F2** (they decide the design, not the implementation):
1. One bill or two grouped bills? (The user's story suggests one bill is the common case, but two bills must stay possible.)
2. If merging, which account survives: the oldest, the group's anchor, or the one the waiter picks? What happens to the surviving attention number?
3. Does a partial payment or a pending proof block the merge (recommended) or does the payment follow the surviving order?
4. Items already `entregado` or `en_preparacion`: do they move with their state, or get flagged for the kitchen?
5. Who may merge (admin/mozo/cajero) and does it need a reason or an approval, like voids and discounts do today?

**Status:** nothing of F1/F2 is implemented, no route or schema exists for it, and the current guard stays as is until the user authorizes the work. When authorized, this section is the starting point and should become its own task list (F-1 guards and listing, F-2 merge with money verification), each with its own fake-only and real-Mongo evidence.
