"""Approval requests must respect the tenant and branch of the order they target."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1")
os.environ.setdefault("DB_NAME", "audit_in_memory_only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import routes.approvals as approval_routes
import routes.payments as payment_routes
from models import ApprovalCreate
from branch_isolation_fakes import _Collection, _DB, _order, _user


class _ApprovalDB(_DB):
    def __init__(self, *, orders=(), payments=()):
        super().__init__(orders=orders)
        self.payments = _Collection(payments)
        self.approvals = _Collection()


def _payment(payment_id, order_id, **extra):
    row = {"id": payment_id, "restaurant_id": "tenant-1", "order_id": order_id,
           "status": "completed", "amount": 30.0, "method": "efectivo", "order_number": 7}
    row.update(extra)
    return row


def _setup(monkeypatch, **kwargs):
    db = _ApprovalDB(**kwargs)
    for module in (approval_routes, payment_routes):
        monkeypatch.setattr(module, "db", db)
    monkeypatch.setattr(approval_routes, "emit_notice", lambda *a, **k: None)
    return db


def _create(payload, user):
    return asyncio.run(approval_routes.create_approval(ApprovalCreate(**payload), user))


def test_cashier_cannot_request_approval_for_a_foreign_branch_payment(monkeypatch):
    db = _setup(monkeypatch, orders=[_order("order-b", "branch-b")],
                payments=[_payment("pay-b", "order-b")])
    with pytest.raises(HTTPException) as caught:
        _create({"payment_id": "pay-b", "reason": "cobro duplicado"}, _user(role="cajero", branch_id="branch-a"))
    assert caught.value.status_code == 404
    assert db.approvals.rows == []


def test_cashier_cannot_request_approval_for_a_foreign_branch_order(monkeypatch):
    db = _setup(monkeypatch, orders=[_order("order-b", "branch-b")])
    with pytest.raises(HTTPException) as caught:
        _create({"order_id": "order-b", "reason": "descuento pedido"}, _user(role="cajero", branch_id="branch-a"))
    assert caught.value.status_code == 404
    assert db.approvals.rows == []


def test_order_lookup_is_scoped_to_the_tenant(monkeypatch):
    db = _setup(monkeypatch, orders=[_order("order-x", "branch-a", restaurant_id="tenant-2")],
                payments=[_payment("pay-x", "order-x")])
    with pytest.raises(HTTPException) as caught:
        _create({"payment_id": "pay-x", "reason": "cobro duplicado"}, _user(role="cajero", branch_id="branch-a"))
    assert caught.value.status_code == 404
    assert db.approvals.rows == []


def test_same_branch_cashier_can_request_approval(monkeypatch):
    db = _setup(monkeypatch, orders=[_order("order-a", "branch-a", order_number=7)],
                payments=[_payment("pay-a", "order-a")])
    created = _create({"payment_id": "pay-a", "reason": "cobro duplicado"}, _user(role="cajero", branch_id="branch-a"))
    assert created["payment_id"] == "pay-a"
    assert created["order_id"] == "order-a"
    assert len(db.approvals.rows) == 1


def test_admin_keeps_tenant_wide_access(monkeypatch):
    db = _setup(monkeypatch, orders=[_order("order-b", "branch-b")],
                payments=[_payment("pay-b", "order-b")])
    created = _create({"payment_id": "pay-b", "reason": "cobro duplicado"}, _user(role="admin", branch_id="branch-a"))
    assert created["order_id"] == "order-b"
    assert len(db.approvals.rows) == 1
