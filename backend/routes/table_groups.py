"""Floor-level table groups: the "unir mesas" marker of the salón.

A group never moves orders, money or visits. It states that these tables are
serving the same party, and it keeps that statement physically honest: a member
table without a visit of its own is shown as occupied so nobody seats a second
party there. Each member keeps its own account - a table that already ordered
keeps its visit and its bill, and a free member can open its own - so the group
reports how many accounts it holds instead of assuming a single one. Merging two
accounts into one is a different, money-touching capability that is deliberately
not implemented here.

Deliberate rules:
  * Any number of members may already own their own account; joining never
    merges or moves them. The group's anchor is one of those tables (the one
    that opened its visit first).
  * A table with a visit in progress but no order, a table already in another
    group, a table that is not available for a party and a table of another
    branch are still refused.
  * Groups are dissolved explicitly ("Separar mesas"), never by closing a visit:
    the tables usually stay physically together after the party leaves.
  * A grouped table cannot be deleted, moved to another branch, or have its
    order transferred until the group is dissolved.
"""
from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user, require_roles
from branch_access import (
    assert_record_branch_access,
    read_branch_filter,
    record_branch_filter,
    validate_user_branch,
)
from database import db
from models import TableGroupAddTable, TableGroupCreate
from notify import emit_notice

router = APIRouter()

# A table is busy while it owns an order that is not settled, or while it still
# carries the fence of an open visit.
_BUSY_ORDER = {"$or": [
    {"status": {"$nin": ["pagado", "cancelado"]}},
    {"attention_state": {"$in": ["opening", "open", "mutating", "closing"]}},
]}
# Statuses a table can be joined from when it owns no visit: "pagada" and
# "esperando_pago" still belong to a party that has not left the floor.
_JOINABLE_STATUSES = ("disponible", "ocupada")
_MAX_GROUP_SIZE = 12


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def record_audit(action: str, entity: str, entity_id: str, user: dict, details: dict | None = None,
                       branch_id: str | None = None) -> None:
    """Audit entry shared by the floor operations (groups, seat, release and table moves).

    It always names the acting user (id, name, role) and the branch, since any
    waiter of a branch may operate any of its tables.
    """
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "user_id": user.get("id"),
        "user_name": user.get("full_name"),
        "user_role": user.get("role"),
        "branch_id": branch_id or user.get("branch_id"),
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "details": details or {},
        "created_at": _now(),
    })


async def _active_group(group_id: str, user: dict) -> dict | None:
    return await db.table_groups.find_one({
        "id": group_id,
        "restaurant_id": user["restaurant_id"],
        "status": "active",
        **record_branch_filter(user),
    }, {"_id": 0})


async def _load_group(group_id: str, user: dict) -> dict:
    group = await _active_group(group_id, user)
    if not group:
        raise HTTPException(status_code=404, detail="Grupo de mesas no encontrado")
    return group


async def _load_tables(table_ids: list[str], user: dict) -> list[dict]:
    unique = list(dict.fromkeys(table_ids))
    if len(unique) != len(table_ids):
        raise HTTPException(status_code=400, detail="Hay mesas repetidas en la selección")
    tables = []
    for table_id in unique:
        table = await db.tables.find_one(
            {"id": table_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0}
        )
        assert_record_branch_access(table, user, "Mesa no encontrada")
        tables.append(table)
    return tables


async def _busy_tables(table_ids: list[str], user: dict) -> dict:
    """Map table_id -> open order for the tables that already own one."""
    if not table_ids:
        return {}
    rows = await db.orders.find({
        "restaurant_id": user["restaurant_id"],
        "table_id": {"$in": list(table_ids)},
        **_BUSY_ORDER,
        **record_branch_filter(user),
    }, {"_id": 0, "id": 1, "table_id": 1, "created_at": 1}).to_list(len(table_ids) * 4)
    return {row["table_id"]: row for row in rows if row.get("table_id")}


async def _forget_stale_group(table: dict, busy: dict, user: dict) -> None:
    """A pointer to a group that is gone must not block the floor forever."""
    fields = {"updated_at": _now()}
    if (table.get("group_joined_status") and not busy.get(table["id"])
            and not table.get("active_attention_id") and table.get("status") == "ocupada"):
        fields["status"] = table["group_joined_status"]
    await db.tables.update_one(
        {"id": table["id"], "restaurant_id": user["restaurant_id"], "group_id": table["group_id"]},
        {"$set": fields, "$unset": {"group_id": "", "group_joined_status": ""}},
    )
    table.pop("group_id", None)
    table.pop("group_joined_status", None)
    if "status" in fields:
        table["status"] = fields["status"]


async def _validate_join(
    tables: list[dict],
    busy: dict,
    user: dict,
    *,
    exclude_group_id: str | None = None,
) -> None:
    if len(tables) < 2:
        raise HTTPException(status_code=400, detail="Seleccioná al menos dos mesas para unirlas")
    if len(tables) > _MAX_GROUP_SIZE:
        raise HTTPException(status_code=400, detail=f"Un grupo admite hasta {_MAX_GROUP_SIZE} mesas")
    branch_id = tables[0].get("branch_id")
    for table in tables:
        number = table.get("number")
        if table.get("branch_id") != branch_id:
            raise HTTPException(status_code=400, detail="Las mesas deben pertenecer a la misma sucursal")
        group_id = table.get("group_id")
        if group_id and group_id != exclude_group_id:
            if await _active_group(group_id, user):
                raise HTTPException(
                    status_code=409,
                    detail=f"La mesa {number} ya está unida a otro grupo de mesas",
                )
            await _forget_stale_group(table, busy, user)
        if busy.get(table["id"]):
            continue
        if table.get("active_attention_id") or table.get("opening_order_id"):
            raise HTTPException(
                status_code=409,
                detail=f"La mesa {number} tiene una visita en curso; cerrala antes de unirla",
            )
        if table.get("status") not in _JOINABLE_STATUSES:
            raise HTTPException(
                status_code=409,
                detail=f"La mesa {number} no está disponible para unir",
            )


def _account_owners(tables: list[dict], busy: dict) -> list[dict]:
    """Members that already own their own account, earliest visit first."""
    owners = [table for table in tables if busy.get(table["id"])]
    return sorted(owners, key=lambda table: (
        (busy[table["id"]] or {}).get("created_at") or "",
        table.get("number") or 0,
    ))


def _auto_name(tables: list[dict]) -> str:
    numbers = sorted(table.get("number") for table in tables if table.get("number") is not None)
    return "Mesas " + " + ".join(str(number) for number in numbers)


def _lowest_number(tables: list[dict]) -> str:
    return min(tables, key=lambda table: (table.get("number") or 0, table.get("id") or ""))["id"]


def _resolve_anchor(tables: list[dict], busy: dict, requested: str | None) -> str:
    """The anchor is the group's reference table: an account owner when there is one."""
    owners = _account_owners(tables, busy)
    if requested and requested not in {table["id"] for table in tables}:
        raise HTTPException(status_code=400, detail="La mesa principal debe pertenecer al grupo")
    if owners:
        owner_ids = {table["id"] for table in owners}
        if requested and requested not in owner_ids:
            raise HTTPException(
                status_code=409,
                detail="La mesa principal debe ser una de las que ya tiene su propia cuenta",
            )
        return requested or owners[0]["id"]
    return requested or _lowest_number(tables)


def _group_response(group: dict, tables: list[dict]) -> dict:
    by_id = {table["id"]: table for table in tables}
    members = [by_id[table_id] for table_id in group.get("table_ids") or [] if table_id in by_id]
    return {
        "id": group["id"],
        "name": group.get("name"),
        "anchor_table_id": group.get("anchor_table_id"),
        "table_ids": list(group.get("table_ids") or []),
        "tables": [
            {
                "id": table["id"],
                "number": table.get("number"),
                "name": table.get("name"),
                "area": table.get("area"),
                "status": table.get("status"),
            }
            for table in members
        ],
        "status": group.get("status", "active"),
        "created_at": group.get("created_at"),
        "updated_at": group.get("updated_at"),
    }


async def _claim_members(group_id: str, tables: list[dict], busy: dict, user: dict) -> list[tuple[str, str | None]]:
    """Claim each table for the group, fenced against a concurrent visit.

    Returns the tables that were joined from a free status together with the
    status they must get back when they leave the group.
    """
    claimed: list[tuple[str, str | None]] = []
    for table in tables:
        owns_visit = bool(busy.get(table["id"]) or table.get("active_attention_id"))
        fields = {"group_id": group_id, "updated_at": _now()}
        claim = {
            "id": table["id"],
            "restaurant_id": user["restaurant_id"],
            "group_id": {"$exists": False},
            "branch_id": table["branch_id"] if "branch_id" in table else {"$exists": False},
        }
        previous = None
        if owns_visit:
            claim["opening_order_id"] = {"$exists": False}
        else:
            previous = table.get("status") if table.get("status") in _JOINABLE_STATUSES else "disponible"
            claim["status"] = {"$in": list(_JOINABLE_STATUSES)}
            claim["active_attention_id"] = {"$exists": False}
            claim["opening_order_id"] = {"$exists": False}
            fields["status"] = "ocupada"
            fields["group_joined_status"] = previous
        result = await db.tables.update_one(claim, {"$set": fields})
        if getattr(result, "modified_count", 0) != 1:
            await _rollback_claim(group_id, claimed, user)
            raise HTTPException(
                status_code=409,
                detail="Una de las mesas cambió; volvé a cargarla antes de unir",
            )
        claimed.append((table["id"], previous))
    return claimed


async def _rollback_claim(group_id: str, claimed: list[tuple[str, str | None]], user: dict) -> None:
    for table_id, previous in claimed:
        fields = {"updated_at": _now()}
        if previous is not None:
            fields["status"] = previous
        await db.tables.update_one(
            {"id": table_id, "restaurant_id": user["restaurant_id"], "group_id": group_id},
            {"$set": fields, "$unset": {"group_id": "", "group_joined_status": ""}},
        )


async def _release_membership(tables: list[dict], group_id: str, user: dict) -> None:
    """Drop the group marker, giving back the floor slot the group had blocked."""
    busy = await _busy_tables([table["id"] for table in tables], user)
    for table in tables:
        fields = {"updated_at": _now()}
        previous = table.get("group_joined_status")
        if (previous and not busy.get(table["id"]) and not table.get("active_attention_id")
                and table.get("status") == "ocupada"):
            fields["status"] = previous
        await db.tables.update_one(
            {"id": table["id"], "restaurant_id": user["restaurant_id"], "group_id": group_id},
            {"$set": fields, "$unset": {"group_id": "", "group_joined_status": ""}},
        )


async def _dissolve(group: dict, tables: list[dict], user: dict) -> None:
    await _release_membership(tables, group["id"], user)
    now = _now()
    result = await db.table_groups.update_one(
        {"id": group["id"], "restaurant_id": user["restaurant_id"], "status": "active"},
        {"$set": {"status": "dissolved", "dissolved_at": now, "dissolved_by": user.get("id"), "updated_at": now}},
    )
    if getattr(result, "modified_count", 0) != 1:
        latest = await _active_group(group["id"], user)
        if latest:
            raise HTTPException(status_code=409, detail="El grupo cambió; volvé a cargarlo")
    await record_audit("dissolve", "table_group", group["id"], user, {
        "tables": [table.get("number") for table in tables],
    })


def _announce(tables: list[dict], user: dict) -> None:
    for table in tables:
        emit_notice(
            user["restaurant_id"], "table",
            table_id=table["id"], status=table.get("status"), branch_id=table.get("branch_id"),
        )


async def attach_groups(tables: list[dict], user: dict) -> None:
    """Attach the active group of every listed table; used by the floor listing."""
    group_ids = {table["group_id"] for table in tables if table.get("group_id")}
    if not group_ids:
        return
    rows = await db.table_groups.find({
        "restaurant_id": user["restaurant_id"],
        "status": "active",
        "id": {"$in": list(group_ids)},
        **record_branch_filter(user),
    }, {"_id": 0, "id": 1, "name": 1, "anchor_table_id": 1, "table_ids": 1}).to_list(len(group_ids))
    groups = {row["id"]: row for row in rows}
    for table in tables:
        group_id = table.pop("group_id", None)
        group = groups.get(group_id) if group_id else None
        table["group_id"] = group_id if group else None
        table["group"] = None if not group else {
            "id": group["id"],
            "name": group.get("name"),
            "anchor_table_id": group.get("anchor_table_id"),
            "table_ids": list(group.get("table_ids") or []),
        }


@router.get("")
async def list_groups(
    user: dict = Depends(get_current_user),
    branch_id: str | None = None,
    legacy_only: bool = False,
):
    branch_filter = await read_branch_filter(user, db.branches, branch_id, legacy_only=legacy_only)
    groups = await db.table_groups.find(
        {"restaurant_id": user["restaurant_id"], "status": "active", **branch_filter}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    table_ids = {table_id for group in groups for table_id in group.get("table_ids") or []}
    tables = []
    if table_ids:
        tables = await db.tables.find(
            {"restaurant_id": user["restaurant_id"], "id": {"$in": list(table_ids)}},
            {"_id": 0, "id": 1, "number": 1, "name": 1, "area": 1, "status": 1},
        ).to_list(len(table_ids))
    return [_group_response(group, tables) for group in groups]


@router.post("")
async def create_group(data: TableGroupCreate, user: dict = Depends(require_roles(["admin", "mozo"]))):
    await validate_user_branch(user, db.branches)
    tables = await _load_tables(data.table_ids, user)
    busy = await _busy_tables([table["id"] for table in tables], user)
    await _validate_join(tables, busy, user)
    group_id = str(uuid.uuid4())
    custom_name = (data.name or "").strip()
    group = {
        "id": group_id,
        "restaurant_id": user["restaurant_id"],
        "table_ids": [table["id"] for table in tables],
        "anchor_table_id": _resolve_anchor(tables, busy, data.anchor_table_id),
        "name": custom_name or _auto_name(tables),
        "auto_name": not bool(custom_name),
        "status": "active",
        "created_at": _now(),
        "created_by": user.get("id"),
        "created_by_name": user.get("full_name"),
        "updated_at": _now(),
    }
    if tables[0].get("branch_id") is not None:
        group["branch_id"] = tables[0]["branch_id"]
    claimed = await _claim_members(group_id, tables, busy, user)
    try:
        await db.table_groups.insert_one(group)
    except Exception:
        await _rollback_claim(group_id, claimed, user)
        raise
    await record_audit("join", "table_group", group_id, user, {
        "tables": [table.get("number") for table in tables],
        "accounts": len(_account_owners(tables, busy)),
    })
    fresh = await _load_tables(group["table_ids"], user)
    _announce(fresh, user)
    return _group_response(group, fresh)


@router.post("/{group_id}/tables")
async def add_table_to_group(
    group_id: str,
    data: TableGroupAddTable,
    user: dict = Depends(require_roles(["admin", "mozo"])),
):
    group = await _load_group(group_id, user)
    if data.table_id in (group.get("table_ids") or []):
        raise HTTPException(status_code=400, detail="La mesa ya pertenece a este grupo")
    members = await _load_tables(group.get("table_ids") or [], user)
    incoming = await _load_tables([data.table_id], user)
    combined = members + incoming
    busy = await _busy_tables([table["id"] for table in combined], user)
    await _validate_join(combined, busy, user, exclude_group_id=group_id)
    claimed = await _claim_members(group_id, incoming, busy, user)
    table_ids = list(group.get("table_ids") or []) + [incoming[0]["id"]]
    # The reference table follows the earliest account of the whole group.
    owners = _account_owners(combined, busy)
    anchor_id = owners[0]["id"] if owners else group.get("anchor_table_id")
    name = _auto_name(combined) if group.get("auto_name") else group.get("name")
    result = await db.table_groups.update_one(
        {"id": group_id, "restaurant_id": user["restaurant_id"], "status": "active",
         "table_ids": group.get("table_ids") or []},
        {"$set": {"table_ids": table_ids, "anchor_table_id": anchor_id, "name": name, "updated_at": _now()}},
    )
    if getattr(result, "modified_count", 0) != 1:
        await _rollback_claim(group_id, claimed, user)
        raise HTTPException(status_code=409, detail="El grupo cambió; volvé a cargarlo antes de unir la mesa")
    await record_audit("join", "table_group", group_id, user, {
        "tables": [incoming[0].get("number")],
        "accounts": len(owners),
    })
    updated = {**group, "table_ids": table_ids, "anchor_table_id": anchor_id, "name": name}
    fresh = await _load_tables(table_ids, user)
    _announce(fresh, user)
    return _group_response(updated, fresh)


@router.delete("/{group_id}/tables/{table_id}")
async def remove_table_from_group(
    group_id: str,
    table_id: str,
    user: dict = Depends(require_roles(["admin", "mozo"])),
):
    group = await _load_group(group_id, user)
    if table_id not in (group.get("table_ids") or []):
        raise HTTPException(status_code=404, detail="La mesa no pertenece a este grupo")
    tables = await _load_tables(group.get("table_ids") or [], user)
    leaving = next(table for table in tables if table["id"] == table_id)
    remaining = [table for table in tables if table["id"] != table_id]
    if len(remaining) < 2:
        await _dissolve(group, tables, user)
        _announce(remaining, user)
        return {"ok": True, "dissolved": True, "group_id": group_id}

    await _release_membership([leaving], group_id, user)
    table_ids = [table["id"] for table in remaining]
    # The reference table must stay inside the group and, when any member owns an
    # account, be one of those members.
    owners = _account_owners(remaining, await _busy_tables(table_ids, user))
    anchor_id = group.get("anchor_table_id")
    if anchor_id not in table_ids or (owners and anchor_id not in {table["id"] for table in owners}):
        anchor_id = owners[0]["id"] if owners else _lowest_number(remaining)
    name = _auto_name(remaining) if group.get("auto_name") else group.get("name")
    result = await db.table_groups.update_one(
        {"id": group_id, "restaurant_id": user["restaurant_id"], "status": "active",
         "table_ids": group.get("table_ids") or []},
        {"$set": {"table_ids": table_ids, "anchor_table_id": anchor_id, "name": name, "updated_at": _now()}},
    )
    if getattr(result, "modified_count", 0) != 1:
        raise HTTPException(status_code=409, detail="El grupo cambió; volvé a cargarlo antes de separar la mesa")
    await record_audit("split", "table_group", group_id, user, {"tables": [leaving.get("number")]})
    _announce(remaining, user)
    updated = {**group, "table_ids": table_ids, "anchor_table_id": anchor_id, "name": name}
    return _group_response(updated, remaining)


@router.delete("/{group_id}")
async def dissolve_group(group_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    group = await _load_group(group_id, user)
    tables = await _load_tables(group.get("table_ids") or [], user)
    await _dissolve(group, tables, user)
    _announce(tables, user)
    return {"ok": True, "dissolved": True, "group_id": group_id, "table_ids": [table["id"] for table in tables]}
