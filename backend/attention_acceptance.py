"""Acceptance-time branch context and retry-safe attention-number propagation."""
from __future__ import annotations

from datetime import datetime, timezone

from attention_numbering import (
    AttentionNumberingConfigurationError,
    AttentionNumberingOwnershipError,
    AttentionNumberingStorageError,
    allocate_attention_number,
    resolve_business_date,
)


class AttentionAcceptanceError(ValueError):
    """The order cannot be confirmed with the requested branch context."""


def _aware_instant(value) -> datetime:
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise AttentionNumberingConfigurationError("confirmation timestamp must be valid") from exc
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise AttentionNumberingConfigurationError("confirmation timestamp must be timezone-aware")
    return value.astimezone(timezone.utc)


async def capture_attention_context(db, *, tenant_id: str, branch_id: str | None, confirmed_at) -> dict:
    """Read and validate one tenant-owned branch's explicit local-date settings."""
    if not isinstance(branch_id, str) or not branch_id.strip():
        raise AttentionAcceptanceError("Asigna una sucursal antes de confirmar el pedido")
    branch = await db.branches.find_one({"id": branch_id, "restaurant_id": tenant_id}, {"_id": 0})
    if not branch:
        raise AttentionAcceptanceError("La sucursal no está disponible para este restaurante")
    timezone_name = branch.get("timezone")
    cutoff = branch.get("business_day_cutoff")
    instant = _aware_instant(confirmed_at)
    try:
        resolve_business_date(instant, timezone_name=timezone_name, cutoff=cutoff)
    except AttentionNumberingConfigurationError as exc:
        raise AttentionAcceptanceError("Configura la zona horaria y el corte del día de negocio de la sucursal") from exc
    # Canonicalize cutoff once; the snapshot, not a later settings lookup, owns retries.
    from attention_numbering import _parse_cutoff
    return {
        "branch_id": branch_id,
        "timezone_name": timezone_name,
        "cutoff": _parse_cutoff(cutoff).isoformat(),
        "confirmed_at": instant.isoformat(),
    }


async def number_accepted_order(db, *, order: dict) -> dict | None:
    """Allocate and propagate a frozen accepted context; retries reuse its immutable winner."""
    attention_id = order.get("attention_id")
    context = order.get("attention_number_context")
    if not attention_id or not isinstance(context, dict):
        return None
    if order.get("acceptance_status") != "aceptado":
        return None
    tenant_id = order.get("restaurant_id")
    branch_id = context.get("branch_id")
    if not tenant_id or not branch_id or branch_id != order.get("branch_id"):
        raise AttentionNumberingOwnershipError("accepted attention context does not match its order owner")
    confirmed_at = _aware_instant(context.get("confirmed_at"))
    try:
        assignment = await allocate_attention_number(
            assignments=db.attention_number_assignments,
            counters=db.counters,
            tenant_id=tenant_id,
            branch_id=branch_id,
            attention_id=attention_id,
            confirmed_order_id=order.get("id"),
            confirmed_at=confirmed_at,
            timezone_name=context.get("timezone_name"),
            cutoff=context.get("cutoff"),
        )
    except Exception:
        # An insert may have committed before an error was observed. Reconcile once
        # by the immutable attention _id; a later exact route retry handles absence.
        winner = await db.attention_number_assignments.find_one({"_id": attention_id})
        if not winner:
            raise
        if (winner.get("tenant_id") != tenant_id or winner.get("branch_id") != branch_id
                or winner.get("confirmed_order_id") != order.get("id")):
            raise AttentionNumberingOwnershipError("attention ID is assigned to another accepted order")
        assignment = winner
    if assignment is None:
        raise AttentionNumberingStorageError("accepted attention did not receive an assignment")
    await _validate_assignment_origin(db, assignment, tenant_id=tenant_id, branch_id=branch_id,
                                      attention_id=attention_id)
    fields = {
        "attention_number": assignment["number"],
        "attention_business_date": assignment["business_date"],
        "attention_number_assigned_at": assignment["confirmed_at"],
    }
    try:
        result = await db.orders.update_one({
            "id": order["id"], "restaurant_id": tenant_id, "attention_id": attention_id,
            "branch_id": branch_id, "acceptance_status": "aceptado",
            "attention_number_context": context,
        }, {"$set": fields, "$unset": {"attention_number_pending": ""}})
    except Exception:
        persisted = await _numbered_order_readback(db, order, tenant_id, branch_id, attention_id, fields)
        if persisted:
            return assignment
        raise
    if getattr(result, "modified_count", 0) != 1:
        persisted = await _numbered_order_readback(db, order, tenant_id, branch_id, attention_id, fields)
        if not persisted:
            raise AttentionNumberingStorageError("accepted order changed before its attention number was saved")
    return assignment


async def _validate_assignment_origin(db, assignment: dict, *, tenant_id: str, branch_id: str,
                                      attention_id: str) -> None:
    """Verify immutable assignment fields against the accepted originating order."""
    from attention_numbering import _parse_cutoff

    origin_id = assignment.get("confirmed_order_id")
    confirmed_at = assignment.get("confirmed_at")
    timezone_name = assignment.get("timezone_name")
    cutoff = assignment.get("cutoff")
    if (assignment.get("_id") != attention_id or assignment.get("tenant_id") != tenant_id
            or assignment.get("branch_id") != branch_id or not isinstance(origin_id, str)
            or not origin_id or not isinstance(assignment.get("number"), int)
            or isinstance(assignment.get("number"), bool)):
        raise AttentionNumberingOwnershipError("attention assignment identity does not match its owner")
    instant = _aware_instant(confirmed_at)
    normalized_cutoff = _parse_cutoff(cutoff).isoformat()
    if resolve_business_date(instant, timezone_name=timezone_name, cutoff=normalized_cutoff).isoformat() != assignment.get("business_date"):
        raise AttentionNumberingOwnershipError("attention assignment date does not match its original context")
    origin = await db.orders.find_one({
        "id": origin_id, "restaurant_id": tenant_id, "branch_id": branch_id, "attention_id": attention_id,
        "acceptance_status": "aceptado",
    }, {"_id": 0})
    context = origin.get("attention_number_context") if origin else None
    if (not isinstance(context, dict) or context.get("branch_id") != branch_id
            or context.get("timezone_name") != timezone_name
            or _aware_instant(context.get("confirmed_at")) != instant
            or _parse_cutoff(context.get("cutoff")).isoformat() != normalized_cutoff):
        raise AttentionNumberingOwnershipError("attention assignment origin context is unavailable or inconsistent")


async def _numbered_order_readback(db, order: dict, tenant_id: str, branch_id: str,
                                   attention_id: str, fields: dict) -> dict | None:
    persisted = await db.orders.find_one({
        "id": order.get("id"), "restaurant_id": tenant_id, "branch_id": branch_id,
        "attention_id": attention_id, "acceptance_status": "aceptado",
        "attention_number_context": order.get("attention_number_context"),
    }, {"_id": 0})
    if (not persisted or persisted.get("attention_number_pending")
            or any(persisted.get(key) != value for key, value in fields.items())):
        return None
    return persisted
