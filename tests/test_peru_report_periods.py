"""Fake-only report clock tests for the Peru business timezone."""
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from test_money_integrity import RID, _DB
import routes.cash as cash_routes
import routes.payments as payment_routes
import routes.reports as report_routes


class FrozenDateTime(datetime):
    instant = datetime(2026, 1, 15, 4, 59, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        return cls.instant.astimezone(tz) if tz else cls.instant.replace(tzinfo=None)


class UnexpectedBranchLookup:
    async def find_one(self, *_args, **_kwargs):
        raise AssertionError("report-period timezone must not depend on branch configuration")


def freeze_routes(monkeypatch, instant):
    FrozenDateTime.instant = datetime.fromisoformat(instant)
    for module in (cash_routes, payment_routes, report_routes):
        monkeypatch.setattr(module, "datetime", FrozenDateTime)
    return FrozenDateTime


@pytest.mark.parametrize(("instant", "expected"), [
    ("2026-01-15T04:59:00+00:00", "2026-01-14T05:00:00+00:00"),
    ("2026-01-15T05:00:00+00:00", "2026-01-15T05:00:00+00:00"),
])
def test_cash_payment_and_dashboard_day_boundaries_follow_lima_midnight(monkeypatch, instant, expected):
    async def run():
        freeze_routes(monkeypatch, instant)
        monkeypatch.setattr(cash_routes, "db", type("DB", (), {"branches": UnexpectedBranchLookup()})())
        monkeypatch.setattr(report_routes, "db", type("DB", (), {"branches": UnexpectedBranchLookup()})())
        cash_start = await cash_routes._period_start("day", RID)
        payment_start = payment_routes._period_start("day")
        dashboard_start, dashboard_end = await report_routes._today_range(RID)
        assert cash_start == payment_start == dashboard_start == expected
        assert dashboard_end == instant
        assert await cash_routes._resolve_timezone(RID) == ZoneInfo("America/Lima")
        assert await report_routes._resolve_timezone(RID) == ZoneInfo("America/Lima")

    asyncio.run(run())


@pytest.mark.parametrize(("period", "expected"), [
    ("day", "2026-01-14T05:00:00+00:00"),
    ("week", "2026-01-12T05:00:00+00:00"),
    ("month", "2026-01-01T05:00:00+00:00"),
])
def test_cash_and_payment_calendar_periods_keep_lima_week_and_month_semantics(monkeypatch, period, expected):
    async def run():
        freeze_routes(monkeypatch, "2026-01-15T04:59:00+00:00")
        assert await cash_routes._period_start(period, RID) == expected
        assert payment_routes._period_start(period) == expected

    asyncio.run(run())


@pytest.mark.parametrize(("period", "expected_start"), [
    ("day", "2026-01-15T05:00:00+00:00"),
    ("week", "2026-01-08T05:00:00+00:00"),
    ("month", "2025-12-16T05:00:00+00:00"),
])
def test_sales_report_preserves_rolling_lookbacks_using_lima_clock(monkeypatch, period, expected_start):
    async def run():
        freeze_routes(monkeypatch, "2026-01-15T05:00:00+00:00")
        monkeypatch.setattr(report_routes, "db", _DB())
        report = await report_routes.sales_report(
            {"id": "owner-1", "restaurant_id": RID, "role": "admin"}, period=period
        )
        assert report["date_from"] == expected_start
        assert report["date_to"] == "2026-01-15T05:00:00+00:00"

    asyncio.run(run())


def test_sales_report_preserves_explicit_custom_date_strings(monkeypatch):
    async def run():
        freeze_routes(monkeypatch, "2026-01-15T05:00:00+00:00")
        monkeypatch.setattr(report_routes, "db", _DB())
        start = "2025-12-31T23:30:00-05:00"
        end = "2026-01-15T04:59:59-05:00"
        report = await report_routes.sales_report(
            {"id": "owner-1", "restaurant_id": RID, "role": "admin"},
            period="month", date_from=start, date_to=end,
        )
        assert report["date_from"] == start
        assert report["date_to"] == end

    asyncio.run(run())
