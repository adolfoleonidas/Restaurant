from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import secrets
import uuid
from database import db
from auth import get_current_user, require_roles
from models import TableCreate, TableTransfer, TableUpdate
from notify import emit_notice
from guest_access import sign_table
from attention import AttentionBlocked, open_table_attention, recover_opening_intent
from branch_access import read_branch_filter, record_branch_filter, validate_user_branch
from routes.table_groups import attach_groups, record_audit

router = APIRouter()

_PRIVATE_OPENING_FIELDS = ("opening_intent", "opening_order_id", "opening_branch_id")

# An order still owns its table while it is unsettled or while its visit is open.
_OPEN_ORDER = {"$or": [
    {"status": {"$nin": ["pagado", "cancelado"]}},
    {"attention_state": {"$in": ["opening", "open", "mutating", "closing"]}},
]}
_TRANSFERABLE_TABLE_STATUSES = ("disponible", "ocupada")


def _table_response(table: dict) -> dict:
    return {key: value for key, value in table.items() if key not in _PRIVATE_OPENING_FIELDS and key != "_id"}


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _validate_branch(restaurant_id: str, branch_id: str | None):
    if branch_id is None:
        return
    branch = await db.branches.find_one({"id": branch_id, "restaurant_id": restaurant_id}, {"_id": 0, "id": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")

async def _validate_area(restaurant_id: str, area: str):
    if not area or not area.strip():
        raise HTTPException(status_code=400, detail="La zona es obligatoria")
    area = area.strip()
    zones = await db.zones.find({"restaurant_id": restaurant_id}).to_list(1000)
    if zones and not any(z.get("name") == area for z in zones):
        raise HTTPException(status_code=400, detail="La zona no existe")
    return area


async def _get_zone_branch(restaurant_id: str, area: str) -> str | None:
    """Get the branch_id from a zone, if it has one."""
    zone = await db.zones.find_one(
        {"restaurant_id": restaurant_id, "name": area},
        {"_id": 0, "branch_id": 1}
    )
    return zone.get("branch_id") if zone else None


async def _table_lookup_scope(table_id: str, user: dict) -> dict:
    branch_id = await validate_user_branch(user, db.branches)
    scope = {"id": table_id, "restaurant_id": user["restaurant_id"]}
    if branch_id is not None:
        scope["branch_id"] = branch_id
    return scope


@router.get("")
async def list_tables(
    user: dict = Depends(get_current_user),
    branch_id: str | None = None,
    legacy_only: bool = False,
):
    branch_filter = await read_branch_filter(user, db.branches, branch_id, legacy_only=legacy_only)
    items = await db.tables.find(
        {"restaurant_id": user["restaurant_id"], **branch_filter}, {"_id": 0}
    ).sort("number", 1).to_list(1000)
    proj = {"_id": 0, "id": 1, "table_id": 1, "created_at": 1, "source": 1,
            "order_type": 1, "customer_name": 1, "status": 1, "items": 1,
            "attention_id": 1, "attention_state": 1}
    if user.get("role") != "cocina":
        proj["total"] = 1
    active_filter = _OPEN_ORDER
    active_query = {"restaurant_id": user["restaurant_id"], **branch_filter}
    if "$or" in active_query:
        active_query = {"restaurant_id": user["restaurant_id"], "$and": [branch_filter, active_filter]}
    else:
        active_query.update(active_filter)
    active_orders = await db.orders.find(active_query, proj).to_list(1000)
    by_table = {o["table_id"]: o for o in active_orders if o.get("table_id")}
    await attach_groups(items, user)
    for table in items:
        for field in _PRIVATE_OPENING_FIELDS:
            table.pop(field, None)
        active = by_table.get(table["id"])
        if active:
            raw_items = active.pop("items", None) or []
            active["item_count"] = sum(int(item.get("quantity") or 0) for item in raw_items)
        table["active_order"] = active
        nonce = table.pop("qr_nonce", None)
        if table.pop("qr_revoked", False):
            table["qr_status"] = "revoked"
        elif nonce:
            table["qr_status"] = "active"
        else:
            table["qr_status"] = "none"
    return items


@router.post("")
async def create_table(data: TableCreate, user: dict = Depends(require_roles(["admin"]))):
    await _validate_branch(user["restaurant_id"], data.branch_id)
    exists = await db.tables.find_one({"restaurant_id": user["restaurant_id"], "number": data.number})
    if exists:
        raise HTTPException(status_code=400, detail="Número de mesa ya existe")
    
    area = await _validate_area(user["restaurant_id"], data.area)
    
    # Determine branch_id: explicit > zone's branch_id > None
    branch_id = data.branch_id
    if branch_id is None:
        branch_id = await _get_zone_branch(user["restaurant_id"], area)
    
    t = {
        "id": str(uuid.uuid4()),
        "restaurant_id": user["restaurant_id"],
        "number": data.number,
        "name": data.name or f"Mesa {data.number}",
        "capacity": data.capacity,
        "area": area,
        "status": "disponible",
        "created_at": _now(),
        "updated_at": _now(),
    }
    if branch_id is not None:
        t["branch_id"] = branch_id
    await db.tables.insert_one(t)
    return {k: v for k, v in t.items() if k != "_id"}


def _qr_payload(table: dict, nonce: str) -> dict:
    token = sign_table(table["id"], nonce)
    return {
        "token": token,
        "path": f"/checkout?mesa={token}",
        "table_number": table.get("number"),
    }


@router.get("/{table_id}/guest-link")
async def guest_link(table_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    table = await db.tables.find_one(
        await _table_lookup_scope(table_id, user),
        {"_id": 0, "id": 1, "number": 1, "qr_nonce": 1, "qr_revoked": 1},
    )
    if not table:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    if table.get("qr_revoked"):
        raise HTTPException(status_code=400, detail="El QR está revocado. Regeneralo desde el panel.")
    nonce = table.get("qr_nonce")
    if not nonce:
        nonce = secrets.token_urlsafe(16)
        await db.tables.update_one(
            await _table_lookup_scope(table_id, user),
            {"$set": {"qr_nonce": nonce, "updated_at": _now()}},
        )
    return _qr_payload(table, nonce)


@router.post("/{table_id}/qr/rotate")
async def rotate_qr(table_id: str, user: dict = Depends(require_roles(["admin"]))):
    table = await db.tables.find_one(
        {"id": table_id, "restaurant_id": user["restaurant_id"]},
        {"_id": 0, "id": 1, "number": 1},
    )
    if not table:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    nonce = secrets.token_urlsafe(16)
    await db.tables.update_one(
        {"id": table_id, "restaurant_id": user["restaurant_id"]},
        {"$set": {"qr_nonce": nonce, "qr_revoked": False, "updated_at": _now()}},
    )
    return _qr_payload(table, nonce)


@router.post("/{table_id}/qr/revoke")
async def revoke_qr(table_id: str, user: dict = Depends(require_roles(["admin"]))):
    res = await db.tables.update_one(
        {"id": table_id, "restaurant_id": user["restaurant_id"]},
        {"$set": {"qr_revoked": True, "updated_at": _now()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    return {"ok": True, "qr_status": "revoked"}


@router.post("/{table_id}/seat")
async def seat_table(table_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    scope = await _table_lookup_scope(table_id, user)
    table = await db.tables.find_one(scope, {"_id": 0})
    if not table:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    if table.get("active_attention_id"):
        raise HTTPException(status_code=400, detail="La mesa tiene una visita abierta")
    active = await db.orders.find_one({
        "restaurant_id": user["restaurant_id"], "table_id": table_id,
        "status": {"$nin": ["pagado", "cancelado"]},
        **record_branch_filter(user),
    })
    if active:
        raise HTTPException(status_code=400, detail="La mesa ya tiene un pedido activo")
    if table.get("status") == "pagada":
        raise HTTPException(status_code=400, detail="Liberá la mesa pagada antes de tomarla")
    if table.get("status") not in ("disponible", "ocupada"):
        raise HTTPException(status_code=400, detail="Esta mesa no se puede tomar")
    claim = await db.tables.update_one({**scope, "active_attention_id": {"$exists": False}, "opening_order_id": {"$exists": False}},
        {"$set": {"status": "ocupada", "updated_at": _now()}})
    if getattr(claim, "matched_count", 0) != 1:
        raise HTTPException(status_code=409, detail="La visita de la mesa cambió; volvé a cargarla")
    emit_notice(user["restaurant_id"], "table", table_id=table_id, status="ocupada", branch_id=table.get("branch_id"))
    result = await db.tables.find_one(scope, {"_id": 0})
    result["active_order"] = None
    return _table_response(result)


@router.post("/{table_id}/release")
async def release_table(table_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    scope = await _table_lookup_scope(table_id, user)
    table = await db.tables.find_one(scope, {"_id": 0})
    if not table:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    if table.get("active_attention_id"):
        raise HTTPException(status_code=400, detail="La mesa tiene una visita abierta")
    active = await db.orders.find_one({
        "restaurant_id": user["restaurant_id"], "table_id": table_id,
        "status": {"$nin": ["pagado", "cancelado"]},
        **record_branch_filter(user),
    })
    if active:
        raise HTTPException(status_code=400, detail="Hay un pedido enviado. No se puede liberar como borrador.")
    claim = await db.tables.update_one({**scope, "active_attention_id": {"$exists": False}, "opening_order_id": {"$exists": False}},
        {"$set": {"status": "disponible", "updated_at": _now()}})
    if getattr(claim, "matched_count", 0) != 1:
        raise HTTPException(status_code=409, detail="La visita de la mesa cambió; volvé a cargarla")
    emit_notice(user["restaurant_id"], "table", table_id=table_id, status="disponible", branch_id=table.get("branch_id"))
    result = await db.tables.find_one(scope, {"_id": 0})
    result["active_order"] = None
    return _table_response(result)


@router.post("/{table_id}/resume-opening")
async def resume_table_opening(table_id: str, user: dict = Depends(require_roles(["admin", "mozo"]))):
    scope = await _table_lookup_scope(table_id, user)
    table = await db.tables.find_one(scope, {"_id": 0})
    if not table:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    order_id = table.get("opening_order_id")
    if not order_id:
        raise HTTPException(status_code=404, detail="No hay una apertura pendiente para esta mesa")
    if table.get("status") not in ("disponible", "ocupada"):
        raise HTTPException(status_code=409, detail="La mesa ya no está disponible para completar la apertura")
    intent = table.get("opening_intent")
    if not isinstance(intent, dict) or intent.get("attention_state") != "opening":
        raise HTTPException(status_code=409, detail="La apertura requiere conciliación")
    order = await recover_opening_intent(
        db, table=table, order_id=order_id, restaurant_id=user["restaurant_id"]
    )
    if not order:
        raise HTTPException(status_code=409, detail="La apertura requiere conciliación")
    try:
        await open_table_attention(db, order=order, user=user, now=_now())
    except AttentionBlocked as exc:
        raise HTTPException(status_code=409, detail=exc.detail)
    from routes.orders import _current_order_response
    response = await _current_order_response(order_id, user)
    if not response:
        raise HTTPException(status_code=409, detail="No se encontró el pedido asociado a la apertura")
    return response


@router.patch("/{table_id}")
async def update_table(table_id: str, data: TableUpdate, user: dict = Depends(require_roles(["admin"]))):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "area" in update:
        update["area"] = await _validate_area(user["restaurant_id"], update["area"])
    scope = {"id": table_id, "restaurant_id": user["restaurant_id"]}
    table = None
    if "branch_id" in update:
        await _validate_branch(user["restaurant_id"], update["branch_id"])
        table = await db.tables.find_one(scope, {"_id": 0})
        if not table:
            raise HTTPException(status_code=404, detail="Mesa no encontrada")
        if table.get("group_id"):
            raise HTTPException(status_code=409, detail="Separala del grupo de mesas antes de cambiar de sucursal")
        if table.get("active_attention_id") or table.get("opening_order_id") or table.get("status") != "disponible":
            raise HTTPException(status_code=409, detail="No se puede cambiar la sucursal de una mesa ocupada o en apertura")
        active = await db.orders.find_one({
            "restaurant_id": user["restaurant_id"], "table_id": table_id,
            "$or": [
                {"status": {"$nin": ["pagado", "cancelado"]}},
                {"attention_state": {"$in": ["opening", "open", "mutating", "closing"]}},
            ],
        })
        if active:
            raise HTTPException(status_code=409, detail="La mesa conserva un pedido o una visita")
        scope.update({
            "active_attention_id": {"$exists": False},
            "opening_order_id": {"$exists": False},
            "status": "disponible",
            "branch_id": table.get("branch_id") if "branch_id" in table else {"$exists": False},
        })
    if "status" in update:
        table = table or await db.tables.find_one(scope, {"_id": 0})
        if not table:
            raise HTTPException(status_code=404, detail="Mesa no encontrada")
        if update.get("status") == "inactiva" and table.get("group_id"):
            raise HTTPException(status_code=409, detail="Separala del grupo de mesas antes de desactivarla")
        if table.get("active_attention_id") or table.get("opening_order_id"):
            raise HTTPException(status_code=409, detail="Cerrá la visita antes de cambiar el estado de la mesa")
        scope["active_attention_id"] = {"$exists": False}
        scope["opening_order_id"] = {"$exists": False}
    update["updated_at"] = _now()
    res = await db.tables.update_one(scope, {"$set": update})
    if res.matched_count == 0:
        if "branch_id" in update or "status" in update:
            raise HTTPException(status_code=409, detail="La mesa cambió; volvé a cargarla")
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    result = await db.tables.find_one({"id": table_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0})
    return _table_response(result)


@router.delete("/{table_id}")
async def delete_table(table_id: str, user: dict = Depends(require_roles(["admin"]))):
    grouped = await db.tables.find_one(
        {"id": table_id, "restaurant_id": user["restaurant_id"]}, {"_id": 0, "group_id": 1}
    )
    if grouped and grouped.get("group_id"):
        raise HTTPException(status_code=409, detail="Separala del grupo de mesas antes de eliminarla")
    res = await db.tables.delete_one({"id": table_id, "restaurant_id": user["restaurant_id"], "active_attention_id": {"$exists": False}, "opening_order_id": {"$exists": False}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    return {"ok": True}


# ============== MOVE AN OPEN VISIT TO ANOTHER TABLE ==============
async def _load_scoped_table(table_id: str, user: dict, detail: str = "Mesa no encontrada") -> dict:
    table = await db.tables.find_one(await _table_lookup_scope(table_id, user), {"_id": 0})
    if not table:
        raise HTTPException(status_code=404, detail=detail)
    return table


async def _open_order_for_table(table_id: str, user: dict) -> dict | None:
    return await db.orders.find_one({
        "restaurant_id": user["restaurant_id"],
        "table_id": table_id,
        **_OPEN_ORDER,
        **record_branch_filter(user),
    }, {"_id": 0})


def _table_fence(table: dict, user: dict) -> dict:
    return {
        "id": table["id"],
        "restaurant_id": user["restaurant_id"],
        "branch_id": table["branch_id"] if "branch_id" in table else {"$exists": False},
    }


async def _undo_reservation(target: dict, attention_id: str | None, user: dict, now: str) -> None:
    query = _table_fence(target, user)
    update = {"$set": {"status": target.get("status") or "disponible", "updated_at": now}}
    if attention_id:
        query["active_attention_id"] = attention_id
        update["$unset"] = {"active_attention_id": ""}
    await db.tables.update_one(query, update)


async def _finish_move(*, order: dict, source: dict, target: dict, attention_id: str | None,
                       user: dict, now: str) -> bool:
    """Idempotently complete a move whose order document already points at the target.

    It keeps the destination fenced for the visit and frees the source table only
    while that table still owns this visit, so a retry after a partial failure
    lands on the same end state instead of releasing somebody else's table.
    """
    restaurant_id = user["restaurant_id"]
    if attention_id:
        attention_filter = {"id": attention_id, "restaurant_id": restaurant_id, "order_id": order["id"]}
        attention = await db.attentions.find_one(attention_filter, {"_id": 0, "table_id": 1})
        if not attention or attention.get("table_id") not in (source["id"], target["id"]):
            return False
        if attention.get("table_id") != target["id"]:
            await db.attentions.update_one(
                {**attention_filter, "table_id": attention["table_id"]},
                {"$set": {"table_id": target["id"]}},
            )
            attention = await db.attentions.find_one(attention_filter, {"_id": 0, "table_id": 1})
            if not attention or attention.get("table_id") != target["id"]:
                return False
        await db.tables.update_one(
            {**_table_fence(target, user), "active_attention_id": {"$exists": False},
             "opening_order_id": {"$exists": False}},
            {"$set": {"status": "ocupada", "active_attention_id": attention_id, "updated_at": now}},
        )
    release = _table_fence(source, user)
    release["active_attention_id"] = attention_id if attention_id else {"$exists": False}
    await db.tables.update_one(
        release,
        {"$set": {"status": "disponible", "updated_at": now}, "$unset": {"active_attention_id": ""}},
    )
    return True


async def _transfer_response(order_id: str, source: dict, target: dict, user: dict,
                             *, reconciled: bool = False) -> dict:
    from routes.orders import _current_order_response
    emit_notice(user["restaurant_id"], "table", table_id=source["id"], status="disponible",
                branch_id=source.get("branch_id"))
    emit_notice(user["restaurant_id"], "table", table_id=target["id"], status="ocupada",
                branch_id=target.get("branch_id"))
    await record_audit("transfer", "order", order_id, user, {
        "from_table": source.get("number"), "to_table": target.get("number"),
        "from_table_id": source["id"], "to_table_id": target["id"],
        **({"reconciled": True} if reconciled else {}),
    })
    return {
        "ok": True,
        "order_id": order_id,
        "from_table_id": source["id"],
        "to_table_id": target["id"],
        "from_number": source.get("number"),
        "to_number": target.get("number"),
        "order": await _current_order_response(order_id, user),
    }


@router.post("/{table_id}/transfer")
async def transfer_table(table_id: str, data: TableTransfer, user: dict = Depends(require_roles(["admin", "mozo"]))):
    """Move the open visit of a table — order and visit together — to a free table.

    The destination is reserved first, the order document moves second (that is
    the point of no return) and the visit projection plus the freed source table
    are completed last. A retry finishes an interrupted move instead of
    duplicating it.
    """
    if data.target_table_id == table_id:
        raise HTTPException(status_code=400, detail="Elegí una mesa destino distinta")
    source = await _load_scoped_table(table_id, user)
    target = await _load_scoped_table(data.target_table_id, user, "Mesa destino no encontrada")
    if source.get("branch_id") != target.get("branch_id"):
        raise HTTPException(status_code=400, detail="Las mesas pertenecen a sucursales distintas")
    if source.get("group_id") or target.get("group_id"):
        raise HTTPException(
            status_code=409,
            detail="Hay mesas unidas en el grupo; separá las mesas antes de mover el pedido",
        )

    order = await _open_order_for_table(table_id, user)
    now = _now()
    if not order:
        # The order already left this table: either an interrupted move to finish
        # or a retry of a move that completed. Both end in the same floor state.
        stranded = await _open_order_for_table(target["id"], user)
        attention_id = (stranded or {}).get("attention_id")
        if not stranded or not attention_id:
            raise HTTPException(status_code=409, detail="La mesa no tiene un pedido activo para mover")
        attention = await db.attentions.find_one({
            "id": attention_id, "restaurant_id": user["restaurant_id"], "order_id": stranded["id"],
        }, {"_id": 0, "table_id": 1})
        if not attention or attention.get("table_id") not in (source["id"], target["id"]):
            raise HTTPException(status_code=409, detail="La mesa no tiene un pedido activo para mover")
        if not await _finish_move(order=stranded, source=source, target=target,
                                  attention_id=attention_id, user=user, now=now):
            raise HTTPException(
                status_code=409,
                detail="El movimiento quedó a medias; reintentá la operación para completarlo",
            )
        return await _transfer_response(stranded["id"], source, target, user, reconciled=True)

    if order.get("status") in ("pagado", "cancelado") or order.get("attention_state") == "closed":
        raise HTTPException(status_code=409, detail="La cuenta ya está cerrada; no se puede mover")
    attention_id = order.get("attention_id")
    if attention_id:
        attention = await db.attentions.find_one({
            "id": attention_id, "restaurant_id": user["restaurant_id"], "order_id": order["id"],
        }, {"_id": 0, "table_id": 1})
        if not attention:
            raise HTTPException(
                status_code=409,
                detail="La visita de la mesa todavía no está abierta; reintentá abrirla antes de moverla",
            )
        if attention.get("table_id") != source["id"]:
            raise HTTPException(status_code=409, detail="La visita cambió de mesa; volvé a cargar el salón")

    target_order = await _open_order_for_table(target["id"], user)
    if target_order:
        raise HTTPException(status_code=409, detail=f"La mesa {target.get('number')} ya tiene un pedido activo")
    if target.get("active_attention_id") or target.get("opening_order_id"):
        raise HTTPException(status_code=409, detail=f"La mesa {target.get('number')} tiene una visita en curso")
    if target.get("status") not in _TRANSFERABLE_TABLE_STATUSES:
        raise HTTPException(status_code=409, detail=f"La mesa {target.get('number')} no está disponible")
    if target.get("group_id"):
        raise HTTPException(status_code=409, detail=f"La mesa {target.get('number')} está unida a un grupo de mesas")

    fields = {"status": "ocupada", "updated_at": now}
    if attention_id:
        fields["active_attention_id"] = attention_id
    reserved = await db.tables.update_one({
        **_table_fence(target, user),
        "status": {"$in": list(_TRANSFERABLE_TABLE_STATUSES)},
        "active_attention_id": {"$exists": False},
        "opening_order_id": {"$exists": False},
    }, {"$set": fields})
    if getattr(reserved, "modified_count", 0) != 1:
        raise HTTPException(status_code=409, detail="La mesa destino cambió; volvé a cargar el salón")

    order_filter = {"id": order["id"], "restaurant_id": user["restaurant_id"], "table_id": source["id"]}
    if attention_id:
        order_filter["attention_id"] = attention_id
    stamp = order.get("updated_at")
    if stamp is None:
        order_filter["$or"] = [{"updated_at": None}, {"updated_at": {"$exists": False}}]
    else:
        order_filter["updated_at"] = stamp
    moved = await db.orders.update_one(order_filter, {"$set": {"table_id": target["id"], "updated_at": now}})
    if getattr(moved, "modified_count", 0) != 1:
        await _undo_reservation(target, attention_id, user, now)
        raise HTTPException(status_code=409, detail="El pedido cambió; volvé a cargarlo antes de mover la mesa")

    moved_order = await db.orders.find_one({"id": order["id"], "restaurant_id": user["restaurant_id"]}, {"_id": 0})
    if not await _finish_move(order=moved_order or order, source=source, target=target,
                              attention_id=attention_id, user=user, now=now):
        raise HTTPException(
            status_code=409,
            detail="El pedido se movió pero la visita quedó pendiente; reintentá la operación para completarla",
        )
    return await _transfer_response(order["id"], source, target, user)
