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


def dashboard_db(monkeypatch):
    rows = [
        make_payment("branch-one", RID, "branch-1", amount=10),
        make_payment("branch-two", RID, "branch-2", amount=20),
        make_payment("legacy-null", RID, None, amount=30),
        make_payment("legacy-missing", RID, amount=40),
        make_payment("foreign-tenant", "other-tenant", "foreign-branch", amount=100),
        make_payment("before-today", RID, "branch-2", amount=500, created="2026-09-30T23:59:59+00:00"),
    ]
    db = report_db(monkeypatch, rows)
    db.tables = RecordingCollection()
    db.orders.docs.extend([
        {"id": "order-one", "restaurant_id": RID, "branch_id": "branch-1", "status": "pendiente"},
        {"id": "order-two", "restaurant_id": RID, "branch_id": "branch-2", "status": "en_preparacion"},
        {"id": "order-legacy-null", "restaurant_id": RID, "branch_id": None, "status": "pendiente"},
        {"id": "order-legacy-missing", "restaurant_id": RID, "status": "en_preparacion"},
        {"id": "order-foreign", "restaurant_id": "other-tenant", "branch_id": "foreign-branch", "status": "pendiente"},
        {"id": "order-paid", "restaurant_id": RID, "branch_id": "branch-2", "status": "pagado"},
    ])
    db.tables.docs.extend([
        {"id": "table-one", "restaurant_id": RID, "branch_id": "branch-1", "status": "ocupada"},
        {"id": "table-two", "restaurant_id": RID, "branch_id": "branch-2", "status": "esperando_pago"},
        {"id": "table-legacy-null", "restaurant_id": RID, "branch_id": None, "status": "ocupada"},
        {"id": "table-legacy-missing", "restaurant_id": RID, "status": "ocupada"},
        {"id": "table-foreign", "restaurant_id": "other-tenant", "branch_id": "foreign-branch", "status": "ocupada"},
    ])

    async def today_range(restaurant_id):
        return START, END

    monkeypatch.setattr(report_routes, "_today_range", today_range)
    return db


def test_dashboard_staff_kpis_and_financials_use_assigned_branch(monkeypatch):
    async def run():
        db = dashboard_db(monkeypatch)
        staff = {"id": "cashier", "restaurant_id": RID, "role": "cajero", "branch_id": "branch-2"}
        result = await report_routes.dashboard(staff)

        assert result["active_orders"] == 1
        assert result["occupied_tables"] == 1
        assert result["total_tables"] == 1
        assert result["daily_sales"] == 20
        assert result["orders_paid"] == 1
        assert result["avg_ticket"] == 20
        assert "top_products" not in result
        assert db.orders.count_queries[0]["branch_id"] == "branch-2"
        assert all(query["branch_id"] == "branch-2" for query in db.tables.count_queries)
        assert all(query["branch_id"] == "branch-2" for query in db.payments.queries)
        assert all(query["restaurant_id"] == RID for query in db.payments.queries)

    asyncio.run(run())


def test_dashboard_owner_consolidates_tenant_and_selected_branch_context(monkeypatch):
    async def run():
        db = dashboard_db(monkeypatch)
        consolidated = await report_routes.dashboard(OWNER)
        assert consolidated == {
            "active_orders": 4,
            "occupied_tables": 4,
            "total_tables": 4,
            "daily_sales": 100,
            "orders_paid": 4,
            "avg_ticket": 25,
            "top_products": report_routes.rank_products(
                [row for row in db.payments.docs if row["restaurant_id"] == RID and row["created_at"] >= START],
                START,
                report_routes._OPEN_END,
                limit=5,
            ),
        }
        assert all(query["restaurant_id"] == RID for query in db.orders.count_queries)
        assert all(query["restaurant_id"] == RID for query in db.tables.count_queries)
        assert all(query["restaurant_id"] == RID for query in db.payments.queries)

        selected = await report_routes.dashboard(OWNER, branch_id="branch-2")
        assert selected["active_orders"] == 1
        assert selected["occupied_tables"] == 1
        assert selected["total_tables"] == 1
        assert selected["daily_sales"] == 20
        assert selected["orders_paid"] == 1
        assert [row["product_id"] for row in selected["top_products"]] == ["branch-two"]
        assert all(query.get("branch_id") == "branch-2" for query in db.orders.count_queries[1:])
        assert all(query.get("branch_id") == "branch-2" for query in db.tables.count_queries[2:])
        assert all(query.get("branch_id") == "branch-2" for query in db.payments.queries[2:])

    asyncio.run(run())


def test_dashboard_owner_legacy_context_intersects_today_payment_or(monkeypatch):
    async def run():
        db = dashboard_db(monkeypatch)
        result = await report_routes.dashboard(OWNER, legacy_only=True)
        assert result["active_orders"] == 2
        assert result["occupied_tables"] == 2
        assert result["total_tables"] == 2
        assert result["daily_sales"] == 70
        assert result["orders_paid"] == 2
        assert {row["product_id"] for row in result["top_products"]} == {
            "legacy-null", "legacy-missing",
        }
        legacy = {"$or": [{"branch_id": None}, {"branch_id": {"$exists": False}}]}
        assert db.orders.count_queries[0]["$and"][0] == legacy
        assert all(query["$and"][0] == legacy for query in db.tables.count_queries)
        assert all(query["$and"][0] == legacy for query in db.payments.queries)
        assert all("$or" in query["$and"][1] for query in db.payments.queries)

    asyncio.run(run())


def test_dashboard_staff_cannot_spoof_or_read_legacy_and_invalid_assignment_fails_closed(monkeypatch):
    async def run():
        db = dashboard_db(monkeypatch)
        staff = {"id": "cashier", "restaurant_id": RID, "role": "cajero", "branch_id": "branch-2"}
        with pytest.raises(HTTPException) as spoof:
            await report_routes.dashboard(staff, branch_id="branch-1")
        assert spoof.value.status_code == 403
        with pytest.raises(HTTPException) as legacy:
            await report_routes.dashboard(staff, legacy_only=True)
        assert legacy.value.status_code == 403
        assert db.orders.count_queries == []
        assert db.tables.count_queries == []
        assert db.payments.queries == []

        unassigned = {**staff, "branch_id": None}
        with pytest.raises(HTTPException) as missing:
            await report_routes.dashboard(unassigned)
        assert missing.value.status_code == 403
        invalid = {**staff, "branch_id": "deleted-branch"}
        with pytest.raises(HTTPException) as deleted:
            await report_routes.dashboard(invalid)
        assert deleted.value.status_code == 403
        assert db.orders.count_queries == []
        assert db.tables.count_queries == []
        assert db.payments.queries == []

    asyncio.run(run())


@pytest.mark.parametrize(("params", "status_code"), [
    ({"branch_id": " "}, 400),
    ({"branch_id": "deleted-branch"}, 404),
    ({"branch_id": "branch-2", "legacy_only": True}, 400),
])
def test_dashboard_owner_invalid_or_conflicting_context_fails_before_queries(monkeypatch, params, status_code):
    async def run():
        db = dashboard_db(monkeypatch)
        with pytest.raises(HTTPException) as error:
            await report_routes.dashboard(OWNER, **params)
        assert error.value.status_code == status_code
        assert db.orders.count_queries == []
        assert db.tables.count_queries == []
        assert db.payments.queries == []

    asyncio.run(run())


def test_dashboard_preserves_nonfinancial_staff_field_visibility(monkeypatch):
    async def run():
        dashboard_db(monkeypatch)
        staff = {"id": "server", "restaurant_id": RID, "role": "mozo", "branch_id": "branch-2"}
        result = await report_routes.dashboard(staff)
        assert result["active_orders"] == 1
        assert result["total_tables"] == 1
        assert "daily_sales" not in result
        assert "orders_paid" not in result
        assert "avg_ticket" not in result
        assert "top_products" not in result

    asyncio.run(run())


def test_dashboard_applies_selected_branch_before_existing_payment_cap(monkeypatch):
    async def run():
        rows = [
            make_payment(f"other-{index}", RID, "branch-2", amount=1)
            for index in range(10000)
        ]
        rows.append(make_payment("selected-after-cap", RID, "branch-1", amount=25))
        db = report_db(monkeypatch, rows)
        db.tables = RecordingCollection()

        async def today_range(restaurant_id):
            return START, END

        monkeypatch.setattr(report_routes, "_today_range", today_range)
        result = await report_routes.dashboard(OWNER, branch_id="branch-1")
        assert result["daily_sales"] == 25
        assert [row["product_id"] for row in result["top_products"]] == ["selected-after-cap"]
        assert all(query["branch_id"] == "branch-1" for query in db.payments.queries)

    asyncio.run(run())
