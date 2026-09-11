"""Role inbox mapping — keep in sync with frontend/src/lib/roleNotifications.js logic."""


def build(role, orders):
    # Mirror of the JS mapper for contract tests of *what each role sees*.
    items = []
    for o in orders:
        if o.get("status") in ("pagado", "cancelado"):
            continue
        n = o.get("order_number")
        if role in ("cocina", "admin") and o.get("status") == "enviado_cocina":
            items.append(("kitchen_new", n))
        if role in ("mozo", "admin") and o.get("status") == "listo":
            items.append(("kitchen_ready", n))
        if role in ("cajero", "admin") and o.get("source") == "public" and o.get("payment_status") == "comprobante_subido":
            items.append(("web_proof", n))
        if role in ("cajero", "admin") and o.get("status") in ("pendiente_pago", "entregado", "listo"):
            items.append(("cobro", n))
        if role in ("mozo", "admin") and o.get("status") == "pendiente_pago":
            items.append(("bill", n))
    return [t for t, _ in items]


def test_cocina_only_sees_new_passes():
    orders = [
        {"id": "1", "order_number": 1, "status": "enviado_cocina", "items": []},
        {"id": "2", "order_number": 2, "status": "listo", "items": []},
        {"id": "3", "order_number": 3, "status": "pagado", "items": []},
    ]
    types = build("cocina", orders)
    assert types == ["kitchen_new"]


def test_cajero_sees_proof_and_cobro_not_kitchen():
    orders = [
        {"id": "1", "order_number": 1, "status": "enviado_cocina", "source": "public", "payment_status": "comprobante_subido", "items": []},
        {"id": "2", "order_number": 2, "status": "listo", "items": []},
    ]
    types = build("cajero", orders)
    assert "kitchen_new" not in types
    assert "web_proof" in types
    assert "cobro" in types


def test_mozo_sees_ready_not_web_proof():
    orders = [
        {"id": "1", "order_number": 1, "status": "listo", "items": []},
        {"id": "2", "order_number": 2, "status": "enviado_cocina", "source": "public", "payment_status": "comprobante_subido", "items": []},
    ]
    types = build("mozo", orders)
    assert "kitchen_ready" in types
    assert "kitchen_new" not in types
    assert "web_proof" not in types
    assert "cobro" not in types
