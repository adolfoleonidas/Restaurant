"""Input bounds on the request models. Invalid input answers 422 (ValidationError here)."""
from pathlib import Path

import pytest
from pydantic import ValidationError

from models import (
    ApprovalCreate,
    CashClose,
    CashOpen,
    CategoryCreate,
    CategoryUpdate,
    OrderCreate,
    OrderItemInput,
    PaymentCreate,
    ProductCreate,
    ProductUpdate,
    PublicItemsAdd,
    PublicOrderCreate,
    TableCreate,
    TableUpdate,
    UserCreate,
    UserUpdate,
    ZoneCreate,
    ZoneUpdate,
)

BACKEND = Path(__file__).resolve().parents[1] / "backend"


def _invalid(factory, **kwargs):
    with pytest.raises(ValidationError):
        factory(**kwargs)


def test_table_number_and_capacity_are_positive_and_bounded():
    assert TableCreate(number=1, capacity=1).capacity == 1
    assert TableCreate(number=9999, capacity=100).number == 9999
    for number in (0, -3, 10_000):
        _invalid(TableCreate, number=number)
    for capacity in (0, -1, 101):
        _invalid(TableCreate, number=1, capacity=capacity)
    assert TableUpdate(number=5, capacity=2).capacity == 2
    _invalid(TableUpdate, number=0)
    _invalid(TableUpdate, capacity=0)
    _invalid(TableUpdate, capacity=101)


def test_preparation_time_and_sort_order_are_non_negative_and_bounded():
    base = dict(category_id="c", name="Sopa", price=1)
    assert ProductCreate(**base, preparation_time=0).preparation_time == 0
    _invalid(ProductCreate, **base, preparation_time=-1)
    _invalid(ProductCreate, **base, preparation_time=1441)
    _invalid(ProductUpdate, preparation_time=-5)
    _invalid(ProductUpdate, preparation_time=100_000)
    assert ZoneCreate(name="Salón", sort_order=0).sort_order == 0
    _invalid(ZoneCreate, name="Salón", sort_order=-1)
    _invalid(ZoneCreate, name="Salón", sort_order=100_001)
    _invalid(ZoneUpdate, sort_order=-1)
    _invalid(CategoryCreate, name="Platos", sort_order=-1)
    _invalid(CategoryCreate, name="Platos", sort_order=100_001)
    _invalid(CategoryUpdate, sort_order=-1)


def test_approval_amount_is_non_negative_and_bounded():
    assert ApprovalCreate(reason="motivo valido", amount=0).amount == 0
    assert ApprovalCreate(reason="motivo valido").amount is None
    _invalid(ApprovalCreate, reason="motivo valido", amount=-1)
    _invalid(ApprovalCreate, reason="motivo valido", amount=1_000_001)


def test_staff_passwords_need_eight_characters():
    base = dict(email="a@b.co", full_name="Ana", role="mozo")
    assert UserCreate(**base, password="12345678").password == "12345678"
    _invalid(UserCreate, **base, password="1234567")
    _invalid(UserCreate, **base, password="x" * 73)
    assert UserUpdate(password="12345678").password == "12345678"
    assert UserUpdate().password is None
    _invalid(UserUpdate, password="short")


def test_free_text_is_length_limited():
    long = "x" * 501
    _invalid(OrderCreate, notes=long)
    _invalid(OrderCreate, customer_name="n" * 101)
    _invalid(OrderCreate, customer_phone="9" * 31)
    _invalid(OrderCreate, customer_address="a" * 301)
    _invalid(OrderItemInput, product_id="p", notes="n" * 201)
    _invalid(PaymentCreate, order_id="o", method="efectivo", amount=1, notes=long)
    _invalid(CashOpen, opening_amount=1, notes=long)
    _invalid(CashClose, closing_amount=1, notes=long)
    public = dict(order_type="recojo", items=[], payment_method="efectivo")
    _invalid(PublicOrderCreate, **public, notes=long)
    _invalid(PublicOrderCreate, **public, customer_name="n" * 101)
    _invalid(PublicOrderCreate, **public, customer_email="a" * 250 + "@b.co")
    assert OrderCreate(notes="x" * 500, customer_name="n" * 100).notes == "x" * 500


def test_item_lists_are_capped():
    items = [OrderItemInput(product_id="p")] * 100
    assert len(OrderCreate(items=items).items) == 100
    _invalid(OrderCreate, items=items + [OrderItemInput(product_id="p")])
    _invalid(PublicItemsAdd, items=items + [OrderItemInput(product_id="p")])
    _invalid(PublicOrderCreate, order_type="recojo", payment_method="efectivo",
             items=items + [OrderItemInput(product_id="p")])


def test_period_queries_use_pattern_not_the_deprecated_regex():
    for name in ("cash.py", "payments.py", "reports.py"):
        source = (BACKEND / "routes" / name).read_text(encoding="utf-8")
        assert "regex=" not in source, name
