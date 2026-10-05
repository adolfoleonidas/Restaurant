# Unir mesas y mover el pedido de mesa

Implement "unir mesas" in a new worktree: visually group tables that serve the same party, and move an open visit from one table to another. Requested by the user in a fresh worktree; no remote publication was requested.

## Authorized scope
The user asked for "la funcion de unir mesas" inside a NEW worktree and explicitly chose, when asked:

- **Both** semantics: group tables visually in the salón **and** transfer an order from one table to another.
- **Block** the join when a selected table already owns a running account (never merge two accounts). *Superseded on 2026-10-04*: the user then authorized F1, so two tables that already own their own accounts can be joined and each keeps its bill. What stays forbidden is merging those accounts into one.
- **Full slice**: backend + frontend (Salón) + tests.

Publishing the branch was authorized separately (push to `origin/feat/unir-mesas` only).

Not authorized, and not done here: merging the items of two running accounts (F2 below), moving money or payments between orders, touching prices/totals, deleting orders, merging into `main`, deployment, seed or production data changes. The original checkout `C:\Users\adolf\Downloads\07_Proyectos-Codigo\Restaurant` and the `/Users/adolf/Downloads/cobro-restaurante` worktree are untouched.

## Design decisions (why)
- **A group is a floor marker, not an account.** Members keep their own visits and their own accounts, and a group may hold several: the API and the salón report how many bills a group has instead of assuming one. What the group enforces is physical honesty: a member table without a visit of its own is shown as `ocupada` so nobody seats a second party there. This is why the group never touches `orders`, `attentions` or `payments`.
- **Joining never merges, moves or blocks an existing account.** Tables that already ordered join as they are; the group's anchor is one of them (the one that opened its visit first), and a free member can still open its own bill afterwards. Joining is refused for a table that already belongs to another active group, a table with a visit in progress but no order, a table that is not `disponible`/`ocupada` while free, and tables from different branches.
- **Separation is explicit.** A group is dissolved by the staff, never automatically when a visit closes: after the party leaves the tables usually stay physically together. To keep that honest, a group whose members have all gone free is still listed and offers a one-tap "Separar mesas".
- **A stale group pointer is repaired, not fatal.** If a table still points at a group that is dissolved or gone, the join repairs the marker and gives the floor slot back instead of blocking the table forever.
- **Moving a visit is a three-step durable sequence**: reserve the destination, relocate the order document (the point of no return), then relocate the visit projection and free the source table. A retry finishes an interrupted move - both crash windows are covered - instead of duplicating it.
- **A grouped table cannot be moved or transferred** until it is separated, so a group never keeps pointing at a table that no longer holds the account. The same rule protects deletion and branch changes of a grouped table.

## API surface
- `GET /api/table-groups` — active groups of the caller's branch scope.
- `POST /api/table-groups` — `{ table_ids: [>=2], name?, anchor_table_id? }` (admin/mozo). Any number of the selected tables may already own their own account; the anchor must be one of those when any exists (default: the earliest visit).
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
- [x] UM-5 (F1, authorized 2026-10-04): allow joining tables that already own their own accounts, keeping every bill separate. Backend: the "two running accounts" refusal is gone, the anchor is chosen among the account owners (earliest visit first, and an explicit anchor must be an owner), and the join audit records the account count. Frontend: `groupAccountTables` reads the group's bills in the plural, the badge reports `· N cuentas`, the sheet lists each bill with its order number, total and an "Abrir" action, and it only follows a single bill automatically (with two, nothing is implied). Regressions updated and added on both sides.

## Evidence
- Backend focused (latest, after F1): `python.exe -m pytest tests/test_table_groups.py tests/test_table_transfer.py -q` -> **30 passed**.
- Backend full hermetic suite (CI command, after F1): `python.exe -m pytest tests -m "not integration" -q` -> **390 passed, 49 deselected**.
- Frontend full suite (after F1): `craco test --watchAll=false --runInBand` -> **33 suites / 216 tests passed** (28 of them in `tableGroups.test.js` and `SalonTableGroups.test.js`).
- Frontend production build: `CI=true craco build` -> compiled successfully (warnings are errors in CI; one `react-hooks/exhaustive-deps` warning introduced by F1 was fixed).
- **Real Mongo checks** (throwaway scripts, scratch databases `restaurant_unir_mesas_check` and `restaurant_unir_mesas_f1`, both dropped afterwards; the app databases `restaurant_db`/`restaurant_e2e` were never touched):
  - First round: `ensure_indexes()` created the new indexes, joining/adding/listing/dissolving groups behaved as specified, the guards refused a reserved table and a foreign-branch table, a grouped table refused the transfer, the transfer moved the order and the visit and freed the source, and a retry of a completed move converged. Output: `REAL MONGO CHECK OK · groups=1 audits=6`.
  - F1 round: two tables that already owned a bill were joined and **both bills stayed exactly where they were**, the free third member was blocked and then released on dissolve, the anchor resolved to the earliest account, a free member was refused as anchor (409) and the audit recorded `accounts=2`. Output: `REAL MONGO F1 CHECK OK · both bills untouched, free member released`.
- Test-fixture maintenance required by the new collection: `tests/branch_isolation_fakes.py` (added `attentions`/`table_groups`), `tests/test_branch_cash_isolation.py` (index fake), `tests/test_data_reset.py` (reset now clears groups and table markers). These fakes were failing before the update, not the behavior.
- Existing `data-testid` contracts of the floor were preserved; the new ones are `salon-unir-mesas`, `salon-seleccion*`, `salon-unir-confirmar`, `mesa-card-grupo-*`, `mesa-sheet-grupo*`, `mesa-sheet-grupo-cuentas`, `mesa-sheet-grupo-cuenta-*`, `mesa-sheet-grupo-resumen`, `mesa-sheet-separar-grupo`, `mesa-sheet-mover-pedido`, `mover-pedido*`.

## Acceptance
- Two free tables of the same branch can be joined from the Salón; every member shows the group badge; the free member reads `ocupada` on the floor and nobody can seat a second party there.
- Tables that already own their own accounts can be joined, and joining neither moves nor merges those bills: each table keeps its order, its visit and its status, and the group reports how many bills it holds.
- The group's reference table is one of the tables that already owns an account (the earliest visit by default); asking for a free member as the reference is refused.
- A group can be dissolved whole or member by member; blocked free members return to `disponible`, while a member that opened its own account keeps its status and its visit untouched.
- `POST /tables/{id}/transfer` moves the order and its visit to a free table, frees the source, and a retry after an interrupted move converges on the same end state.
- A grouped table cannot be transferred, deleted or moved to another branch until it is separated.
- Terminal isolation is unchanged: a group of another restaurant or another branch is not even visible (404), and grouped tables keep the existing branch-scoped reads.

## Verification limits and rollback
Verification is local: FastAPI routes are exercised against in-memory collections (the whole hermetic CI command) and twice against a real local Mongo on scratch databases that were dropped afterwards. The UI regressions are rendered React trees with a mocked API, plus a full production build. What was **not** exercised: a browser or device against the running app, the HTTP layer of the new endpoints (no curl against a live server), concurrent clients racing on the same table, and production data. Merging into `main` and deployment were not performed. The integration modules that need a running stack stay excluded (`-m "not integration"`).

Rollback: revert the group endpoints/collection and the transfer route together with their helpers, UI and tests; drop `table_groups` and the `group_id`/`group_joined_status` fields on `tables` (the operational reset already unsets them). No existing order, payment, attention or cash behavior depends on the new feature.

## Progress and next step
Implementation and both local suites are green in the worktree `.worktrees/unir-mesas` on branch `feat/unir-mesas`, in work-unit commits (backend, frontend, docs, one sheet fix). The user authorized publishing the branch, so `refs/heads/feat/unir-mesas` exists on origin. `main` itself was **not** touched, so the `Deploy to VPS` workflow (triggered only by a push to `main`) did not run.

`main` moved twice while this ran (`f3d5d0f..8f88e76`: cash/payments/public/TLS-deploy work, then per-branch table numbers and zone names, the login limiter fix and the API error handling). The second batch overlapped this branch in `backend/database.py`, `backend/routes/data.py`, `backend/routes/tables.py`, `backend/server.py` and `tests/test_data_reset.py`, so `main` was merged **into** this branch instead of leaving it stale:

- `c3645de Merge main into feat/unir-mesas`. Everything auto-merged except one hunk in `database.py`: the index block, resolved by keeping this branch's `table_groups`/`group_id` indexes **and** main's per-branch zone index (which supersedes the tenant-wide one, so the old line is not re-created). The auto-merge of `tests/test_data_reset.py` correctly kept both sides' assertions.
- Merged state re-verified: backend `python.exe -m pytest tests -m "not integration" -q` -> **387 passed, 49 deselected** (includes main's new tests); frontend `craco test --watchAll=false --runInBand` -> **33 suites / 213 tests passed**.
- When F1 was pushed, `main` had moved again (`8f88e76..5f77ae1`, five more commits: auth/admin scope, public tracking throttle, system info, feature-switch UI, e2e smoke). None of them touch a file this branch changed and `git merge-tree` still reports a **clean** merge, but the branch is no longer a fast-forward of `main`. `main` has moved five times during this delivery, so re-check the merge right before merging. Any push to `main` still triggers the production deploy.

Next possible steps, if requested: open the pull request (`https://github.com/adolfoleonidas/Restaurant/pull/new/feat/unir-mesas`), merge into `main`, or build F2 (the remaining future capability specified below).

## F1 — IMPLEMENTED (2026-10-04): join tables that already have their own orders

The user asked on 2026-10-04 to record the option that was deliberately deferred in this delivery: the second answer to "what happens when a selected table already owns its order" was **"Fusionar cuentas"** - *move the items of one order into the other and free the source table*. It was split into two variants by risk and the user authorized **only F1** ("la 1").

**The real use case (user's words, translated):** somebody arrives early, sits at table 4 and orders. Later their family or friends arrive, sit with them or at table 5, and order something else; the waiter joins the tables and each bill stays with whoever ordered it.

What F1 changed (see UM-5):
- `_validate_join` no longer refuses a selection because two members already own an account. It still refuses a table already in another group, a table with a visit in progress but no order, a table that is not available for a party while free, and tables from different branches.
- `_resolve_anchor` (and the anchor recomputation on add/remove) now picks the group's reference table among the account owners, earliest visit first; an explicitly requested anchor must be an owner, otherwise 409. A free member can still open its own bill inside the group.
- The join audit records `accounts`, so a later investigation can tell one bill from two.
- Frontend: `groupAccountTables` reads the bills in the plural; the member card badge reports `· N cuentas`; the sheet lists every bill (member, order number, total, "Abrir"), and it only follows a bill automatically when the group holds exactly one.

## F2 — FUTURE (NOT implemented, NOT authorized): merge two accounts into one

- **F2 — Merge into a single account.** Pick the account that survives, move the items of the other order into it, recompute subtotal/total/discount/tip, rebuild the kitchen state, close the source visit and free the source table, with an audit entry. This is the money-and-kitchen half and needs its own careful delivery.

**Open questions to answer before implementing F2** (they decide the design, not the implementation):
1. Which account survives: the oldest, the group's anchor, or the one the waiter picks? What happens to the surviving attention number?
2. Does a partial payment or a pending proof block the merge (recommended) or does the payment follow the surviving order?
3. Items already `entregado` or `en_preparacion`: do they move with their state, or get flagged for the kitchen?
4. Who may merge (admin/mozo/cajero) and does it need a reason or an approval, like voids and discounts do today?

**Status:** F2 is not implemented and no route or schema exists for it; F1 shipped as described above. When authorized, this section is the starting point and should become its own task list (merge endpoint, money verification, kitchen state rebuild, audit), each with its own fake-only and real-Mongo evidence.
