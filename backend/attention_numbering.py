"""Separate, idempotent human-facing numbering for restaurant attentions."""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError


class AttentionNumberingError(ValueError):
    """Base exception for invalid attention-numbering operations."""


class AttentionNumberingConfigurationError(AttentionNumberingError):
    """The branch time zone or business-day cutoff is absent or invalid."""


class AttentionNumberingOwnershipError(AttentionNumberingError):
    """An immutable attention ID is already bound to another owner scope."""


class AttentionNumberingStorageError(RuntimeError):
    """A bounded atomic storage operation did not produce a verifiable result."""


def _required_id(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AttentionNumberingError(f"{name} must be a non-empty string")
    return value


def _parse_cutoff(cutoff: time | str | None) -> time:
    if isinstance(cutoff, str):
        try:
            cutoff = time.fromisoformat(cutoff)
        except ValueError as exc:
            raise AttentionNumberingConfigurationError("business-day cutoff must be a valid local time") from exc
    if not isinstance(cutoff, time) or cutoff.utcoffset() is not None:
        raise AttentionNumberingConfigurationError("an explicit local business-day cutoff is required")
    return cutoff.replace(tzinfo=None)


def _load_zone(timezone_name: str | None) -> ZoneInfo:
    if not isinstance(timezone_name, str) or not timezone_name:
        raise AttentionNumberingConfigurationError("an explicit IANA branch time zone is required")
    try:
        return ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise AttentionNumberingConfigurationError("branch time zone must be a valid IANA zone") from exc


def resolve_business_date(
    confirmed_at: datetime,
    *,
    timezone_name: str | None,
    cutoff: time | str | None,
) -> date:
    """Resolve the configured branch-local business date for an aware instant."""
    zone = _load_zone(timezone_name)
    local_cutoff = _parse_cutoff(cutoff)
    if not isinstance(confirmed_at, datetime) or confirmed_at.tzinfo is None or confirmed_at.utcoffset() is None:
        raise AttentionNumberingConfigurationError("confirmation timestamp must be timezone-aware")
    local = confirmed_at.astimezone(zone)
    local_clock = local.timetz().replace(tzinfo=None)
    result = local.date()
    if local_clock < local_cutoff:
        result -= timedelta(days=1)
    return result


def _encoded_component(value: str) -> str:
    raw = value.encode("utf-8")
    return f"{len(raw)}:{raw.hex()}"


def attention_counter_key(tenant_id: str, branch_id: str, business_day: date) -> str:
    """Build an injective counter key from the full owner/date tuple."""
    tenant = _required_id(tenant_id, "tenant_id")
    branch = _required_id(branch_id, "branch_id")
    if not isinstance(business_day, date) or isinstance(business_day, datetime):
        raise AttentionNumberingError("business_day must be a date")
    return (
        "attention-number:v1:"
        f"{_encoded_component(tenant)}:{_encoded_component(branch)}:{business_day.isoformat()}"
    )


def _assert_assignment_owner(assignment: dict, tenant_id: str, branch_id: str) -> dict:
    if assignment.get("tenant_id") != tenant_id or assignment.get("branch_id") != branch_id:
        raise AttentionNumberingOwnershipError("attention ID is already assigned to another tenant or branch")
    number = assignment.get("number")
    if isinstance(number, bool) or not isinstance(number, int) or number < 1:
        raise AttentionNumberingStorageError("stored attention assignment has an invalid number")
    if not isinstance(assignment.get("business_date"), str):
        raise AttentionNumberingStorageError("stored attention assignment lacks its origin business date")
    return deepcopy(assignment)


async def allocate_attention_number(
    *,
    assignments,
    counters,
    tenant_id: str,
    branch_id: str,
    attention_id: str,
    confirmed_order_id: str | None,
    confirmed_at: datetime | None,
    timezone_name: str | None,
    cutoff: time | str | None,
) -> dict | None:
    """Assign once after a valid order is confirmed; provisional contexts write nothing.

    The caller owns order acceptance. This function only persists an assignment when
    both that confirmed order's ID and its aware confirmation instant are supplied.
    Counter increments and immutable assignment insertion are intentionally separate;
    failures may leave gaps, while successful attention identities never change.
    """
    tenant = _required_id(tenant_id, "tenant_id")
    branch = _required_id(branch_id, "branch_id")
    identity = _required_id(attention_id, "attention_id")

    existing = await assignments.find_one({"_id": identity})
    if existing is not None:
        return _assert_assignment_owner(existing, tenant, branch)

    if confirmed_order_id is None or not isinstance(confirmed_order_id, str) or not confirmed_order_id.strip():
        return None
    if confirmed_at is None:
        return None

    business_day = resolve_business_date(
        confirmed_at,
        timezone_name=timezone_name,
        cutoff=cutoff,
    )
    business_day_text = business_day.isoformat()
    context_key = attention_counter_key(tenant, branch, business_day)
    counter_filter = {
        "_id": context_key,
        "tenant_id": tenant,
        "branch_id": branch,
        "business_date": business_day_text,
    }
    counter_update = {
        "$inc": {"value": 1},
        "$setOnInsert": {
            "tenant_id": tenant,
            "branch_id": branch,
            "business_date": business_day_text,
        },
    }
    try:
        counter = await counters.find_one_and_update(
            counter_filter,
            counter_update,
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        # A concurrent first upsert created the unique counter; retry exactly once.
        try:
            counter = await counters.find_one_and_update(
                counter_filter,
                counter_update,
                upsert=False,
                return_document=ReturnDocument.AFTER,
            )
        except DuplicateKeyError as exc:
            raise AttentionNumberingStorageError("counter upsert race could not be reconciled") from exc
    if not counter:
        raise AttentionNumberingStorageError("atomic attention counter did not return a document")
    if (
        counter.get("tenant_id") != tenant
        or counter.get("branch_id") != branch
        or counter.get("business_date") != business_day_text
    ):
        raise AttentionNumberingStorageError("counter context does not match the requested owner/date")
    number = counter.get("value")
    if isinstance(number, bool) or not isinstance(number, int) or number < 1:
        raise AttentionNumberingStorageError("atomic attention counter returned an invalid value")

    assignment = {
        "_id": identity,
        "tenant_id": tenant,
        "branch_id": branch,
        "number": number,
        "business_date": business_day_text,
        "confirmed_order_id": confirmed_order_id,
        "confirmed_at": confirmed_at.astimezone(timezone.utc).isoformat(),
        "timezone_name": timezone_name,
        "cutoff": _parse_cutoff(cutoff).isoformat(),
    }
    try:
        await assignments.insert_one(assignment)
        return deepcopy(assignment)
    except DuplicateKeyError:
        # Same attention raced us. Never overwrite: return only its verified winner.
        winner = await assignments.find_one({"_id": identity})
        if winner is None:
            raise AttentionNumberingStorageError("duplicate assignment had no readable winner")
        return _assert_assignment_owner(winner, tenant, branch)