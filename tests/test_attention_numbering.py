"""Pure and in-memory regressions for immutable attention numbering."""
import asyncio
import copy
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from attention_numbering import (
    AttentionNumberingConfigurationError,
    AttentionNumberingOwnershipError,
    allocate_attention_number,
    attention_counter_key,
    resolve_business_date,
)


_UNSET = object()

class _MemoryCollection:
    """Minimal async fake for the atomic operations used by the allocator."""

    def __init__(self):
        self.docs = []
        self.lock = asyncio.Lock()
        self.fail_next_counter = False
        self.fail_next_insert = False
        self.duplicate_next_counter_upsert = False

    async def find_one(self, filt, projection=None):
        await asyncio.sleep(0)
        async with self.lock:
            for doc in self.docs:
                if all(doc.get(key) == value for key, value in filt.items()):
                    return copy.deepcopy(doc)
        return None

    async def find_one_and_update(self, filt, update, *, upsert=False, return_document=None):
        await asyncio.sleep(0)
        async with self.lock:
            if self.fail_next_counter:
                self.fail_next_counter = False
                raise RuntimeError("injected counter failure")
            if self.duplicate_next_counter_upsert:
                self.duplicate_next_counter_upsert = False
                contender = {key: value for key, value in filt.items()}
                contender.update(copy.deepcopy(update.get("$setOnInsert", {})))
                for key, amount in update.get("$inc", {}).items():
                    contender[key] = contender.get(key, 0) + amount
                self.docs.append(contender)
                raise DuplicateKeyError("simulated concurrent counter upsert")
            doc = next((row for row in self.docs if all(row.get(k) == v for k, v in filt.items())), None)
            if doc is None:
                if not upsert:
                    return None
                doc = {key: value for key, value in filt.items()}
                doc.update(copy.deepcopy(update.get("$setOnInsert", {})))
                self.docs.append(doc)
            for key, amount in update.get("$inc", {}).items():
                doc[key] = doc.get(key, 0) + amount
            return copy.deepcopy(doc)

    async def insert_one(self, doc):
        await asyncio.sleep(0)
        async with self.lock:
            if self.fail_next_insert:
                self.fail_next_insert = False
                raise RuntimeError("injected assignment failure")
            if any(row.get("_id") == doc.get("_id") for row in self.docs):
                raise DuplicateKeyError("duplicate attention assignment id")
            self.docs.append(copy.deepcopy(doc))


class _Collections:
    def __init__(self):
        self.assignments = _MemoryCollection()
        self.counters = _MemoryCollection()

    async def allocate(self, **kwargs):
        return await allocate_attention_number(
            assignments=self.assignments,
            counters=self.counters,
            **kwargs,
        )


def _instant(value):
    return datetime.fromisoformat(value)


def _request(attention_id, *, tenant="tenant-a", branch="branch-a", confirmed_at=_UNSET, order_id=_UNSET,
             zone="America/Lima", cutoff=time(4, 0)):
    return {
        "tenant_id": tenant,
        "branch_id": branch,
        "attention_id": attention_id,
        "confirmed_order_id": f"order-{attention_id}" if order_id is _UNSET else order_id,
        "confirmed_at": _instant("2026-10-01T09:00:00+00:00") if confirmed_at is _UNSET else confirmed_at,
        "timezone_name": zone,
        "cutoff": cutoff,
    }


def test_business_date_uses_explicit_lima_cutoff_and_aware_instants():
    before = _instant("2026-10-01T08:59:59+00:00")  # 03:59:59 in Lima
    at_cutoff = _instant("2026-10-01T09:00:00+00:00")  # 04:00:00 in Lima

    assert resolve_business_date(before, timezone_name="America/Lima", cutoff=time(4)) == date(2026, 9, 30)
    assert resolve_business_date(at_cutoff, timezone_name="America/Lima", cutoff=time(4)) == date(2026, 10, 1)
    assert resolve_business_date(at_cutoff, timezone_name="America/Lima", cutoff="04:00") == date(2026, 10, 1)
    with pytest.raises(AttentionNumberingConfigurationError, match="timezone-aware"):
        resolve_business_date(datetime(2026, 10, 1, 9), timezone_name="America/Lima", cutoff=time(4))


def test_business_date_rejects_missing_or_invalid_explicit_configuration():
    instant = _instant("2026-10-01T09:00:00+00:00")

    for zone, cutoff in ((None, time(4)), ("Not/A_Zone", time(4)), ("America/Lima", None),
                         ("America/Lima", "25:00"), ("America/Lima", time(4, tzinfo=timezone.utc))):
        with pytest.raises(AttentionNumberingConfigurationError):
            resolve_business_date(instant, timezone_name=zone, cutoff=cutoff)


def test_counter_context_key_is_injective_for_tuple_boundaries():
    day = date(2026, 10, 1)
    assert attention_counter_key("ab", "c", day) != attention_counter_key("a", "bc", day)
    assert attention_counter_key("tenant", "branch", day) != attention_counter_key("tenant", "branch-2", day)


def test_provisional_attention_does_not_write_or_consume_a_number():
    async def scenario():
        store = _Collections()
        requests = (
            _request("attention-no-order", order_id=None),
            _request("attention-no-time", confirmed_at=None),
            _request("attention-empty-order", order_id="   "),
        )
        for request in requests:
            assert await store.allocate(**request) is None
        assert store.counters.docs == []
        assert store.assignments.docs == []

    asyncio.run(scenario())


def test_missing_cutoff_fails_before_any_storage_write():
    async def scenario():
        store = _Collections()
        request = _request("attention-invalid", cutoff=None)
        with pytest.raises(AttentionNumberingConfigurationError):
            await store.allocate(**request)
        assert store.counters.docs == []
        assert store.assignments.docs == []

    asyncio.run(scenario())


def test_dine_in_and_pickup_share_branch_day_sequence_and_order_counter_is_separate():
    async def scenario():
        store = _Collections()
        instant = _instant("2026-10-01T09:00:00+00:00")
        first = await store.allocate(**_request("table-visit-1", confirmed_at=instant))
        second = await store.allocate(**_request("pickup-visit-2", confirmed_at=instant))

        assert first["number"] == 1
        assert second["number"] == 2
        assert first["business_date"] == second["business_date"] == "2026-10-01"
        assert not any(doc.get("key", "").startswith("order_") for doc in store.counters.docs)

    asyncio.run(scenario())


def test_branch_tenant_and_business_day_have_independent_sequences():
    async def scenario():
        store = _Collections()
        instant = _instant("2026-10-01T09:00:00+00:00")
        requests = [
            _request("a1", tenant="tenant-a", branch="branch-a", confirmed_at=instant),
            _request("b1", tenant="tenant-a", branch="branch-b", confirmed_at=instant),
            _request("c1", tenant="tenant-b", branch="branch-a", confirmed_at=instant),
            _request("d1", tenant="tenant-a", branch="branch-a", confirmed_at=instant + timedelta(days=1)),
        ]
        assigned = [await store.allocate(**request) for request in requests]

        assert [entry["number"] for entry in assigned] == [1, 1, 1, 1]
        assert len({entry["business_date"] for entry in assigned}) == 2

    asyncio.run(scenario())


def test_retry_returns_original_assignment_across_rollover_and_cutoff_change():
    async def scenario():
        store = _Collections()
        first = await store.allocate(**_request("stable-id", confirmed_at=_instant("2026-10-01T09:00:00+00:00")))
        retry = await store.allocate(**_request(
            "stable-id", confirmed_at=_instant("2026-10-02T12:00:00+00:00"), cutoff=time(8),
        ))

        assert retry == first
        assert len(store.assignments.docs) == 1
        assert len(store.counters.docs) == 1

    asyncio.run(scenario())


def test_attention_identity_cannot_be_reassigned_to_another_owner_scope():
    async def scenario():
        store = _Collections()
        await store.allocate(**_request("same-id"))
        with pytest.raises(AttentionNumberingOwnershipError):
            await store.allocate(**_request("same-id", tenant="tenant-b"))
        assert len(store.assignments.docs) == 1

    asyncio.run(scenario())


def test_concurrent_new_attentions_get_unique_numbers_without_cyclic_wrap():
    async def scenario():
        store = _Collections()
        instant = _instant("2026-10-01T09:00:00+00:00")
        existing = await store.allocate(**_request("existing-100", confirmed_at=instant))
        store.counters.docs[0]["value"] = 99

        assigned = await asyncio.gather(*(
            store.allocate(**_request(f"attention-{index}", confirmed_at=instant))
            for index in range(18)
        ))
        numbers = [entry["number"] for entry in assigned]

        assert existing["number"] == 1
        assert len(set(numbers)) == len(numbers)
        assert sorted(numbers) == list(range(100, 118))

    asyncio.run(scenario())


def test_concurrent_retries_of_same_attention_return_one_immutable_winner():
    async def scenario():
        store = _Collections()
        results = await asyncio.gather(*(
            store.allocate(**_request("race-one", order_id=f"confirmed-order-{index}"))
            for index in range(12)
        ))

        assert all(result == results[0] for result in results)
        assert len(store.assignments.docs) == 1

    asyncio.run(scenario())


def test_counter_upsert_duplicate_race_uses_one_bounded_atomic_fallback():
    async def scenario():
        store = _Collections()
        store.counters.duplicate_next_counter_upsert = True
        result = await store.allocate(**_request("counter-race"))

        assert result["number"] == 2
        assert len(store.counters.docs) == 1

    asyncio.run(scenario())


def test_assignment_storage_failure_leaves_allowed_gap_and_retry_is_immutable():
    async def scenario():
        store = _Collections()
        store.assignments.fail_next_insert = True
        with pytest.raises(RuntimeError, match="injected assignment failure"):
            await store.allocate(**_request("gap-case"))

        recovered = await store.allocate(**_request("gap-case"))
        assert recovered["number"] == 2
        assert len(store.assignments.docs) == 1

    asyncio.run(scenario())


def test_counter_failure_does_not_create_assignment_and_retry_succeeds():
    async def scenario():
        store = _Collections()
        store.counters.fail_next_counter = True
        with pytest.raises(RuntimeError, match="injected counter failure"):
            await store.allocate(**_request("counter-failure"))
        assert store.assignments.docs == []

        retry = await store.allocate(**_request("counter-failure"))
        assert retry["number"] == 1
        assert len(store.assignments.docs) == 1

    asyncio.run(scenario())