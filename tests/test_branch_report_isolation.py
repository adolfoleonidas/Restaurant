"""Fake-only tests for branch-safe sales and product report aggregates."""
import asyncio
import copy
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from test_money_integrity import RID, _Collection, _DB
import routes.reports as report_routes


START = "2026-10-01T00:00:00+00:00"
END = "2026-10-02T00:00:00+00:00"
OWNER = {"id": "owner-1", "restaurant_id": RID, "role": "admin"}


class RecordingCollection(_Collection):
    def __init__(self):
        super().__init__()
        self.queries = []
        self.count_queries = []

    async def count_documents(self, filt):
        self.count_queries.append(copy.deepcopy(filt))
        return await super().count_documents(filt)

    def find(self, filt, projection=None):
        self.queries.append(copy.deepcopy(filt))
        return super().find(filt, projection)


def report_db(monkeypatch, payments):
    db = _DB()
    db.branches.docs.extend([
        {"id": "branch-2", "restaurant_id": RID},
        {"id": "foreign-branch", "restaurant_id": "other-tenant"},
    ])
    db.orders = RecordingCollection()
    db.payments = RecordingCollection()
    db.payments.docs.extend(copy.deepcopy(payments))
    monkeypatch.setattr(report_routes, "db", db)
    async def period_start(period, restaurant_id):
        return START
    monkeypatch.setattr(report_routes, "_period_start", period_start)
    return db


def make_payment(payment_id, restaurant_id, branch_id=..., *, amount=10, created=START,
                 status="completed", voided=None, product_id=None):
    row = {
        "id": payment_id,
        "restaurant_id": restaurant_id,
        "created_at": created,
        "status": status,
        "method": "efectivo",
        "amount": amount,
        "sold_lines": [{
            "product_id": product_id or payment_id,
            "name": product_id or payment_id,
            "quantity": 1,
            "unit_price": amount,
        }],
    }
    if branch_id is not ...:
        row["branch_id"] = branch_id
    if voided:
        row["voided_at"] = voided
    return row


def query_date_range(start=START, end=END):
    return {"$or": [
        {"created_at": {"$gte": start, "$lte": end}},
        {"voided_at": {"$gte": start, "$lte": end}},
    ]}


def test_owner_default_reports_consolidate_tenant_rows_and_exclude_other_tenants(monkeypatch):
    async def run():
        rows = [
            make_payment("branch-one", RID, "branch-1", amount=10),
            make_payment("branch-two", RID, "branch-2", amount=20),
            make_payment("legacy-null", RID, None, amount=30),
            make_payment("legacy-missing", RID, amount=40),
            make_payment("foreign-tenant", "other-tenant", "foreign-branch", amount=100),
        ]
        db = report_db(monkeypatch, rows)
        sales = await report_routes.sales_report(OWNER, period="day", date_from=START, date_to=END)
        assert sales["total_sales"] == 100
        staff = {"id": "cashier", "restaurant_id": RID, "role": "cajero", "branch_id": "branch-2"}
        staff_sales = await report_routes.sales_report(
            staff, period="day", date_from=START, date_to=END
        )
        assert staff_sales["total_sales"] == 20
        assert {row["product_id"] for row in sales["top_products"]} == {
            "branch-one", "branch-two", "legacy-null", "legacy-missing",
        }
        assert db.orders.count_queries[-2] == {
            "restaurant_id": RID,
            "status": "cancelado",
            "created_at": {"$gte": START, "$lte": END},
        }
        assert db.orders.count_queries[-1]["branch_id"] == "branch-2"
        assert db.payments.queries[-2] == {
            "restaurant_id": RID,
            **query_date_range(),
        }

        products = await report_routes.product_sales(OWNER, period="day")
        assert products["total_units"] == 4
        assert {row["product_id"] for row in products["products"]} == {
            "branch-one", "branch-two", "legacy-null", "legacy-missing",
        }
        assert db.payments.queries[-1] == {
            "restaurant_id": RID,
            **{"$or": [
                {"created_at": {"$gte": START}},
                {"voided_at": {"$gte": START}},
            ]},
        }

    asyncio.run(run())


def test_owner_selected_branch_filters_sales_and_product_aggregates(monkeypatch):
    async def run():
        db = report_db(monkeypatch, [
            make_payment("branch-one", RID, "branch-1", amount=10),
            make_payment("branch-two", RID, "branch-2", amount=20),
            make_payment("legacy", RID, None, amount=30),
        ])
        sales = await report_routes.sales_report(
            OWNER, period="day", date_from=START, date_to=END, branch_id="branch-2"
        )
        assert sales["total_sales"] == 20
        assert [row["product_id"] for row in sales["top_products"]] == ["branch-two"]
        assert db.payments.queries[-1] == {
            "restaurant_id": RID,
            "branch_id": "branch-2",
            **query_date_range(),
        }

        assert db.orders.count_queries[-1]["branch_id"] == "branch-2"

        products = await report_routes.product_sales(OWNER, period="day", branch_id="branch-2")
        assert products["total_units"] == 1
        assert [row["product_id"] for row in products["products"]] == ["branch-two"]
        assert db.payments.queries[-1]["branch_id"] == "branch-2"
        assert db.payments.queries[-1]["restaurant_id"] == RID

    asyncio.run(run())


def test_owner_legacy_scope_is_conjunctive_with_created_or_voided_date_filter(monkeypatch):
    async def run():
        db = report_db(monkeypatch, [
            make_payment("legacy-created", RID, None, amount=10),
            make_payment("legacy-voided", RID, None, amount=15,
                         created="2026-09-30T12:00:00+00:00", status="refunded",
                         voided="2026-10-01T12:00:00+00:00"),
            make_payment("branch-created", RID, "branch-1", amount=30),
            make_payment("branch-voided", RID, "branch-2", amount=40,
                         created="2026-09-30T12:00:00+00:00", status="refunded",
                         voided="2026-10-01T12:00:00+00:00"),
            make_payment("foreign-legacy", "other-tenant", None, amount=100),
            make_payment("legacy-outside", RID, None, amount=60,
                         created="2026-09-30T12:00:00+00:00"),
        ])
        sales = await report_routes.sales_report(
            OWNER, period="day", date_from=START, date_to=END, legacy_only=True
        )
        assert sales["total_sales"] == -5
        assert {row["product_id"] for row in sales["top_products"]} == {
            "legacy-created", "legacy-voided",
        }
        query = db.payments.queries[-1]
        assert query["restaurant_id"] == RID
        assert query["$and"] == [
            {"$or": [
                {"branch_id": None},
                {"branch_id": {"$exists": False}},
            ]},
            query_date_range(),
        ]

        assert db.orders.count_queries[-1]["$and"] == [
            {"$or": [{"branch_id": None}, {"branch_id": {"$exists": False}}]},
            {"status": "cancelado", "created_at": {"$gte": START, "$lte": END}},
        ]

        products = await report_routes.product_sales(OWNER, period="day", legacy_only=True)
        assert {row["product_id"] for row in products["products"]} == {
            "legacy-created", "legacy-voided",
        }
        assert products["total_units"] == 0
        query = db.payments.queries[-1]
        assert query["restaurant_id"] == RID
        assert query["$and"] == [
            {"$or": [
                {"branch_id": None},
                {"branch_id": {"$exists": False}},
            ]},
            {"$or": [
                {"created_at": {"$gte": START}},
                {"voided_at": {"$gte": START}},
            ]},
        ]

    asyncio.run(run())


def test_assigned_staff_reports_are_scoped_and_cannot_spoof_or_read_legacy(monkeypatch):
    async def run():
        db = report_db(monkeypatch, [
            make_payment("branch-one", RID, "branch-1", amount=10),
            make_payment("branch-two", RID, "branch-2", amount=20),
        ])
        current_staff = {"id": "cashier", "restaurant_id": RID, "role": "cajero", "branch_id": "branch-2"}
        sales = await report_routes.sales_report(current_staff, period="day", date_from=START, date_to=END)
        assert sales["total_sales"] == 20
        assert db.payments.queries[-1]["branch_id"] == "branch-2"

        with pytest.raises(HTTPException) as spoof:
            await report_routes.sales_report(
                current_staff, period="day", date_from=START, date_to=END, branch_id="branch-1"
            )
        assert spoof.value.status_code == 403
        with pytest.raises(HTTPException) as legacy:
            await report_routes.product_sales(current_staff, period="day", legacy_only=True)
        assert legacy.value.status_code == 403
        unassigned = {**current_staff, "branch_id": None}
        with pytest.raises(HTTPException) as missing:
            await report_routes.product_sales(unassigned, period="day")
        assert missing.value.status_code == 403
        invalid_assignment = {**current_staff, "branch_id": "deleted-branch"}
        with pytest.raises(HTTPException) as deleted:
            await report_routes.sales_report(
                invalid_assignment, period="day", date_from=START, date_to=END
            )
        assert deleted.value.status_code == 403

    asyncio.run(run())


@pytest.mark.parametrize(("params", "status_code"), [
    ({"branch_id": " "}, 400),
    ({"branch_id": "deleted-branch"}, 404),
    ({"branch_id": "branch-1", "legacy_only": True}, 400),
])
def test_owner_invalid_or_conflicting_report_context_fails_closed(monkeypatch, params, status_code):
    async def run():
        db = report_db(monkeypatch, [])
        with pytest.raises(HTTPException) as error:
            await report_routes.sales_report(
                OWNER, period="day", date_from=START, date_to=END, **params
            )
        assert error.value.status_code == status_code
        assert db.payments.queries == []

    asyncio.run(run())


def test_product_branch_filter_is_applied_before_existing_query_cap(monkeypatch):
    async def run():
        foreign_rows = [
            make_payment(f"foreign-{index}", RID, "branch-2", product_id="foreign-product")
            for index in range(20000)
        ]
        selected = make_payment("selected-late", RID, "branch-1", amount=25, product_id="selected-product")
        db = report_db(monkeypatch, [*foreign_rows, selected])
        products = await report_routes.product_sales(OWNER, period="day", branch_id="branch-1")
        assert products["total_units"] == 1
        assert [row["product_id"] for row in products["products"]] == ["selected-product"]
        assert db.payments.queries[-1]["branch_id"] == "branch-1"

    asyncio.run(run())
