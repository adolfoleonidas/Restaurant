"""Branch-scope helpers shared by orders, tables, payments, cash, reports, zones, and users."""
import asyncio

import pytest
from fastapi import HTTPException

from branch_access import (
    assert_owned_branch,
    branch_query,
    read_branch_filter,
    record_lookup_scope,
    resolve_branch_id,
    tenant_branch_scope,
)

RID = "rest-1"


class _Branches:
    def __init__(self, *ids):
        self.docs = [{"id": branch_id, "restaurant_id": RID} for branch_id in ids]
        self.queries = []

    async def find_one(self, query, projection=None):
        self.queries.append(query)
        return next(
            (d for d in self.docs if all(d.get(key) == value for key, value in query.items())), None
        )


def _admin():
    return {"role": "admin", "restaurant_id": RID}


def _staff(branch_id="b1"):
    return {"role": "mozo", "restaurant_id": RID, "branch_id": branch_id}


def _run(coro):
    return asyncio.run(coro)


def _status(coro):
    with pytest.raises(HTTPException) as caught:
        _run(coro)
    return caught.value.status_code, caught.value.detail


# --- tenant_branch_scope / record_lookup_scope ---------------------------------------

def test_tenant_scope_is_tenant_wide_for_administrators():
    assert _run(tenant_branch_scope(_admin(), _Branches("b1"))) == {"restaurant_id": RID}


def test_tenant_scope_binds_staff_to_their_branch_and_merges_matches():
    scope = _run(tenant_branch_scope(_staff(), _Branches("b1"), id="o1"))
    assert scope == {"restaurant_id": RID, "id": "o1", "branch_id": "b1"}


def test_tenant_scope_fails_closed_for_unassigned_and_removed_branches():
    assert _status(tenant_branch_scope(_staff(None), _Branches("b1"))) == (
        403, "El usuario no tiene una sucursal asignada")
    assert _status(tenant_branch_scope(_staff("gone"), _Branches("b1"))) == (
        403, "La sucursal asignada ya no está disponible")


def test_record_lookup_scope_matches_one_record_in_the_users_scope():
    assert _run(record_lookup_scope(_admin(), _Branches(), "t1")) == {"id": "t1", "restaurant_id": RID}
    assert _run(record_lookup_scope(_staff(), _Branches("b1"), "t1")) == {
        "id": "t1", "restaurant_id": RID, "branch_id": "b1"}


# --- resolve_branch_id ---------------------------------------------------------------

def test_resolve_admin_without_selection_is_tenant_wide_unless_owner_must_choose():
    assert _run(resolve_branch_id(_admin(), _Branches("b1"))) is None
    assert _status(resolve_branch_id(_admin(), _Branches("b1"), owner_must_choose=True)) == (
        400, "Selecciona una sucursal para esta operación")


def test_resolve_admin_selection_must_belong_to_the_restaurant():
    branches = _Branches("b1")
    assert _run(resolve_branch_id(_admin(), branches, "b1")) == "b1"
    assert branches.queries[-1] == {"id": "b1", "restaurant_id": RID}
    assert _status(resolve_branch_id(_admin(), branches, "other")) == (404, "Sucursal no encontrada")


def test_resolve_staff_gets_their_branch_and_cannot_pick_another():
    branches = _Branches("b1", "b2")
    assert _run(resolve_branch_id(_staff(), branches)) == "b1"
    assert _run(resolve_branch_id(_staff(), branches, "b1")) == "b1"
    assert _status(resolve_branch_id(_staff(), branches, "b2")) == (403, "No tiene acceso a esa sucursal")


def test_resolve_treats_an_empty_request_as_no_request():
    assert _run(resolve_branch_id(_admin(), _Branches("b1"), "")) is None
    assert _run(resolve_branch_id(_staff(), _Branches("b1"), "")) == "b1"


# --- read_branch_filter keeps its contract on top of resolve_branch_id -----------------

def test_read_filter_keeps_blank_request_as_a_400():
    assert _status(read_branch_filter(_admin(), _Branches("b1"), "  ")) == (400, "La sucursal no es válida")


def test_read_filter_shapes():
    branches = _Branches("b1")
    assert _run(read_branch_filter(_admin(), branches)) == {}
    assert _run(read_branch_filter(_admin(), branches, "b1")) == {"branch_id": "b1"}
    assert _run(read_branch_filter(_staff(), branches)) == {"branch_id": "b1"}
    assert _status(read_branch_filter(_staff(), branches, "b2")) == (403, "No tiene acceso a esa sucursal")


# --- branch_query -----------------------------------------------------------------------

def test_branch_query():
    assert branch_query("b1") == {"branch_id": "b1"}
    assert branch_query(None) == {}
    assert branch_query(None, legacy=True) == {"branch_id": None}
    assert branch_query("b1", legacy=True) == {"branch_id": "b1"}


# --- assert_owned_branch (BC-04) --------------------------------------------------------

def test_owned_branch_accepts_none_by_default_and_registered_branches():
    branches = _Branches("b1")
    _run(assert_owned_branch(branches, RID, None))
    _run(assert_owned_branch(branches, RID, "b1"))
    assert _status(assert_owned_branch(branches, RID, "b9")) == (404, "Sucursal no encontrada")
    # Lenient mode looks up even an empty id, as zones and tables always did.
    assert _status(assert_owned_branch(branches, RID, "")) == (404, "Sucursal no encontrada")


def test_owned_branch_strict_mode_rejects_blank_and_missing_ids_first():
    branches = _Branches("b1")
    _run(assert_owned_branch(branches, RID, "b1", require_valid=True))
    for bad in (None, "", "   ", 7):
        assert _status(assert_owned_branch(branches, RID, bad, require_valid=True)) == (
            400, "Debe indicar una sucursal válida")
    assert _status(assert_owned_branch(branches, RID, "b9", require_valid=True)) == (
        404, "Sucursal no encontrada")
