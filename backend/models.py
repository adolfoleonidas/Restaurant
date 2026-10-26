from pydantic import BaseModel, Field, ConfigDict, EmailStr, constr, field_validator, model_validator
from typing import List, Optional, Literal
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import re
import uuid


def _id() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ============== AUTH ==============
class LoginInput(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


# ============== USER ==============
Role = Literal["admin", "cajero", "mozo", "cocina"]


def _user_branch_id(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("Branch ID cannot be blank")
    return normalized


class UserCreate(BaseModel):
    email: EmailStr
    # bcrypt only reads the first 72 bytes, and newer versions refuse longer input.
    password: str = Field(min_length=8, max_length=72)
    full_name: str
    role: Role
    phone: Optional[str] = None
    can_discount: bool = False
    can_void: bool = False
    functions: Optional[List[str]] = None
    branch_id: Optional[str] = None

    @field_validator("branch_id")
    @classmethod
    def validate_branch_id(cls, value: Optional[str]) -> Optional[str]:
        return _user_branch_id(value) if value is not None else None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[Role] = None
    phone: Optional[str] = None
    status: Optional[Literal["active", "inactive"]] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=72)
    can_discount: Optional[bool] = None
    can_void: Optional[bool] = None
    functions: Optional[List[str]] = None
    home_view: Optional[str] = None
    branch_id: Optional[str] = None

    @field_validator("branch_id", mode="before")
    @classmethod
    def reject_explicit_null_branch(cls, value):
        if value is None:
            raise ValueError("Branch assignment cannot be cleared")
        return value

    @field_validator("branch_id")
    @classmethod
    def validate_branch_id(cls, value: Optional[str]) -> Optional[str]:
        return _user_branch_id(value) if value is not None else None


# ============== RESTAURANT ==============
class RestaurantFeatures(BaseModel):
    """Optional modules the venue can switch on from Ajustes. Everything defaults to off."""
    voice_assistant: bool = False
    voice_commands: bool = False
    voice_queries: bool = False
    proof_ocr: bool = False
    item_void: bool = False


class RestaurantUpdate(BaseModel):
    name: Optional[str] = None
    ruc: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    logo_url: Optional[str] = None
    cover_url: Optional[str] = None
    currency: Optional[str] = None
    timezone: Optional[str] = None
    opening_hours: Optional[str] = None
    delivery_fee: Optional[float] = Field(default=None, ge=0)
    require_table_qr: Optional[bool] = None
    public_description: Optional[str] = None
    social_facebook: Optional[str] = None
    social_instagram: Optional[str] = None
    social_whatsapp: Optional[str] = None
    prep_mode: Optional[Literal["simple", "detailed"]] = None
    auto_release_table: Optional[bool] = None
    # Si se apaga, el local usa la app solo como tomador de pedidos: liberar la
    # mesa y cerrar la visita no exigen pago (ver `service_policy.py`).
    require_payment_to_close: Optional[bool] = None
    theme_id: Optional[str] = None
    features: Optional[RestaurantFeatures] = None
    # Cobro de pedidos hechos por el cliente desde el QR.
    table_prepay_mode: Optional[Literal["never", "always", "by_order_type"]] = None
    prepay_pickup: Optional[bool] = None
    prepay_delivery: Optional[bool] = None


# ============== PAYMENT CONFIG ==============
class PaymentConfigUpdate(BaseModel):
    yape_number: Optional[str] = None
    yape_holder: Optional[str] = None
    yape_qr: Optional[str] = None  # base64 data URL
    plin_number: Optional[str] = None
    plin_holder: Optional[str] = None
    plin_qr: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    bank_cci: Optional[str] = None
    bank_holder: Optional[str] = None
    transfer_instructions: Optional[str] = None
    enable_efectivo: Optional[bool] = None
    enable_yape: Optional[bool] = None
    enable_plin: Optional[bool] = None
    enable_transferencia: Optional[bool] = None
    enable_tarjeta: Optional[bool] = None


# ============== TABLE ==============
TableStatus = Literal["disponible", "ocupada", "esperando_pago", "reservada", "inactiva", "pagada"]


class TableCreate(BaseModel):
    number: int = Field(ge=1, le=9999)
    name: Optional[str] = None
    capacity: int = Field(default=4, ge=1, le=100)
    area: str = "Salón"
    branch_id: Optional[str] = None

    @field_validator("branch_id")
    @classmethod
    def validate_branch_id(cls, value: Optional[str]) -> Optional[str]:
        return _user_branch_id(value) if value is not None else None


class TableUpdate(BaseModel):
    number: Optional[int] = Field(default=None, ge=1, le=9999)
    name: Optional[str] = None
    capacity: Optional[int] = Field(default=None, ge=1, le=100)
    area: Optional[str] = None
    status: Optional[TableStatus] = None
    branch_id: Optional[str] = None

    @field_validator("branch_id", mode="before")
    @classmethod
    def reject_explicit_null_branch(cls, value):
        if value is None:
            raise ValueError("Branch assignment cannot be cleared")
        return value

    @field_validator("branch_id")
    @classmethod
    def validate_branch_id(cls, value: Optional[str]) -> Optional[str]:
        return _user_branch_id(value) if value is not None else None


# ============== TABLE GROUP (unir mesas) ==============
def _table_id_list(value: List[str]) -> List[str]:
    normalized = [item.strip() for item in value]
    if any(not item for item in normalized):
        raise ValueError("Table identifiers cannot be blank")
    if len(set(normalized)) != len(normalized):
        raise ValueError("Table identifiers cannot repeat")
    return normalized


class TableGroupCreate(BaseModel):
    """Join two or more tables into one floor group."""

    table_ids: List[str] = Field(min_length=2, max_length=12)
    name: Optional[str] = Field(default=None, max_length=60)
    # The table the staff reads as the group's reference. It is forced to the
    # table that already owns the open visit, when there is one.
    anchor_table_id: Optional[str] = None

    @field_validator("table_ids")
    @classmethod
    def validate_table_ids(cls, value: List[str]) -> List[str]:
        return _table_id_list(value)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() or None if isinstance(value, str) else value


class TableGroupAddTable(BaseModel):
    table_id: str = Field(min_length=1)


class TableTransfer(BaseModel):
    """Move the open visit of a table to another table of the same branch."""

    target_table_id: str = Field(min_length=1)


# ============== ZONE ==============
class ZoneCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    sort_order: int = Field(default=0, ge=0, le=100_000)
    branch_id: Optional[str] = None

    @field_validator("branch_id")
    @classmethod
    def validate_branch_id(cls, value: Optional[str]) -> Optional[str]:
        return _user_branch_id(value) if value is not None else None


class ZoneUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    sort_order: Optional[int] = Field(default=None, ge=0, le=100_000)
    branch_id: Optional[str] = None

    @field_validator("branch_id", mode="before")
    @classmethod
    def reject_explicit_null_branch(cls, value):
        if value is None:
            raise ValueError("Branch assignment cannot be cleared")
        return value

    @field_validator("branch_id")
    @classmethod
    def validate_branch_id(cls, value: Optional[str]) -> Optional[str]:
        return _user_branch_id(value) if value is not None else None


# ============== BRANCH ==============
def _branch_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("Branch name is required")
    if len(normalized) > 100:
        raise ValueError("Branch name must be at most 100 characters")
    return normalized


def _branch_timezone(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("An IANA timezone is required")
    try:
        ZoneInfo(normalized)
    except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
        raise ValueError("Timezone must be a valid IANA timezone") from exc
    return normalized


def _business_day_cutoff(value: str) -> str:
    normalized = value.strip()
    if not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", normalized):
        raise ValueError("Business-day cutoff must use local HH:MM time")
    return normalized


class BranchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    timezone: str
    business_day_cutoff: str
    pickup_enabled: bool = Field(default=False, strict=True)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return _branch_name(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return _branch_timezone(value)

    @field_validator("business_day_cutoff")
    @classmethod
    def validate_cutoff(cls, value: str) -> str:
        return _business_day_cutoff(value)


class BranchUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    timezone: Optional[str] = None
    business_day_cutoff: Optional[str] = None
    pickup_enabled: Optional[bool] = Field(default=None, strict=True)

    @field_validator("name", "timezone", "business_day_cutoff", mode="before")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("Explicit null is not allowed for branch settings")
        return value

    @field_validator("pickup_enabled", mode="before")
    @classmethod
    def reject_null_pickup_flag(cls, value):
        if value is None:
            raise ValueError("Pickup availability cannot be null")
        return value

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return _branch_name(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return _branch_timezone(value)

    @field_validator("business_day_cutoff")
    @classmethod
    def validate_cutoff(cls, value: str) -> str:
        return _business_day_cutoff(value)


# ============== CATEGORY ==============
class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    sort_order: int = Field(default=0, ge=0, le=100_000)


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = Field(default=None, ge=0, le=100_000)
    status: Optional[Literal["active", "inactive"]] = None


# ============== PRODUCT ==============
class ComboComponent(BaseModel):
    product_id: str
    quantity: int = Field(default=1, ge=1)


class ProductCreate(BaseModel):
    category_id: str
    name: str
    description: Optional[str] = None
    price: float = Field(ge=0)
    image_url: Optional[str] = None
    is_available: bool = True
    preparation_time: int = Field(default=15, ge=0, le=1440)  # minutes
    is_combo: bool = False
    combo_items: Optional[List[ComboComponent]] = None
    code: Optional[str] = None


class ProductUpdate(BaseModel):
    category_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = Field(default=None, ge=0)
    image_url: Optional[str] = None
    is_available: Optional[bool] = None
    # Carta fija: se ofrece siempre, sin tener que volver a seleccionarlo cada
    # mañana (bebidas y clásicos). Un plato «del día» solo se ofrece si está en el
    # menú publicado de hoy; ver `menu_day.py`.
    is_fixed: Optional[bool] = None
    preparation_time: Optional[int] = Field(default=None, ge=0, le=1440)
    is_combo: Optional[bool] = None
    combo_items: Optional[List[ComboComponent]] = None
    code: Optional[str] = None


# ============== ORDER ==============
OrderStatus = Literal[
    "nuevo", "enviado_cocina", "en_preparacion", "listo",
    "entregado", "pendiente_pago", "pagado", "cancelado",
    # Terminal propios del modo «solo pedidos» (ver `order_states.py`).
    "cerrado_sin_cobro",
]
# `borrador` es el "Pendiente" de la pantalla: el producto está cargado en la
# cuenta pero todavía no viajó a cocina, así que se puede corregir o borrar.
OrderItemStatus = Literal["borrador", "pendiente", "en_preparacion", "listo", "entregado", "cancelado"]
OrderType = Literal["mesa", "local", "recojo", "delivery", "llevar"]


# Most units of one product a client may put on one order line. Nobody serves 100
# of one dish at a table; the cap keeps a typo (or a hostile client) from asking
# for a billion and from overflowing every total computed from the line.
MAX_LINE_QUANTITY = 99


class OrderItemInput(BaseModel):
    product_id: str
    quantity: int = Field(ge=1, le=MAX_LINE_QUANTITY, default=1)
    notes: Optional[str] = Field(default=None, max_length=200)


# The id the composer makes up for a line (a UUID) or reads back from the order
# (the server's own line id), and the one it makes up for an order creation
# (`OrderCreate.request_id`): letters, digits and a few separators, nothing else.
_LINE_ID_PATTERN = r"^[A-Za-z0-9._:-]+$"


class DraftLineUpsert(BaseModel):
    """One draft line the composer wants in the order: an absolute state, not a delta.

    `client_line_id` names the line: the id the client made up when it first
    tapped the product or, for a line the server already had, that line's own
    `id`. `product_id` is only needed to create the line. `quantity` 0 removes it.
    """

    client_line_id: str = Field(min_length=1, max_length=64, pattern=_LINE_ID_PATTERN)
    product_id: Optional[str] = Field(default=None, min_length=1, max_length=64)
    quantity: int = Field(ge=0, le=MAX_LINE_QUANTITY)
    notes: Optional[str] = Field(default=None, max_length=200)


class DraftLinesBatch(BaseModel):
    """Every pending line of one order, saved together (`PUT /orders/{id}/draft-lines`)."""

    lines: List[DraftLineUpsert] = Field(min_length=1, max_length=100)
    # `updated_at` of the order as the client last saw it. Optional: when it is
    # sent, a batch for an order that has changed since is refused as a conflict.
    version: Optional[str] = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def lines_are_distinct(self):
        ids = [line.client_line_id for line in self.lines]
        if len(ids) != len(set(ids)):
            raise ValueError("Una línea no puede repetirse en el mismo lote")
        return self


class OrderCreate(BaseModel):
    # Names one create, not one order: the client makes it up once per intent and repeats it on
    # every retry, so a retry whose answer was lost gets the order back instead of a second one.
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=64, pattern=_LINE_ID_PATTERN)
    table_id: Optional[str] = None
    branch_id: Optional[str] = None
    order_type: OrderType = "mesa"
    items: List[OrderItemInput] = Field(default=[], max_length=100)
    notes: Optional[str] = Field(default=None, max_length=500)
    # Cuenta adicional dentro de la misma visita de la mesa (multi-cuenta).
    new_account: bool = False
    # Cuenta "Compartido": lo que pide la mesa entera (fuente, jarra, entrada).
    shared: bool = False
    # Staff can take counter/pickup/delivery orders too, so they need the customer.
    customer_name: Optional[str] = Field(default=None, max_length=100)
    customer_phone: Optional[str] = Field(default=None, max_length=30)
    customer_address: Optional[str] = Field(default=None, max_length=300)

    @field_validator("branch_id")
    @classmethod
    def validate_branch_id(cls, value: Optional[str]) -> Optional[str]:
        return _user_branch_id(value) if value is not None else None


class OrderMerge(BaseModel):
    """Fusiona la cuenta `source_order_id` dentro de la cuenta destino (ruta)."""

    source_order_id: str


class OrderMove(BaseModel):
    """Mueve una cuenta (orden) a otra mesa libre de la misma sucursal."""

    target_table_id: str


class OrderSplit(BaseModel):
    """Reparte los productos de una cuenta en `parts` cuentas (2 a 4)."""

    parts: int = Field(ge=2, le=4)


class OrderAlias(BaseModel):
    """Identidad de una cuenta: cómo se llama la persona y si es la compartida."""

    alias: Optional[str] = Field(default=None, max_length=40)
    shared: Optional[bool] = None


class OrderNotes(BaseModel):
    """Nota general para cocina del pedido (no la observación de un producto).

    Vacía limpia la nota; 500 caracteres es el mismo orden de largo que una
    instrucción de cocina y evita que un pegado accidental infle el documento.
    """

    notes: Optional[str] = Field(default=None, max_length=500)


class OrderItemMove(BaseModel):
    """Mueve un producto de una persona a otra de la misma mesa."""

    target_order_id: str = Field(min_length=1)


class OrderItemVoid(BaseModel):
    """Anulación de un producto ya enviado a cocina."""

    reason: str = Field(min_length=3, max_length=140)


class PublicOrderCreate(BaseModel):
    request_id: Optional[constr(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", min_length=36, max_length=36)] = None
    order_type: Literal["local", "recojo", "delivery"]
    table_id: Optional[str] = None
    table_token: Optional[str] = None
    branch_id: Optional[str] = None
    customer_name: Optional[str] = Field(default=None, max_length=100)
    customer_phone: Optional[str] = Field(default=None, max_length=30)
    customer_address: Optional[str] = Field(default=None, max_length=300)
    customer_email: Optional[str] = Field(default=None, max_length=254)
    items: List[OrderItemInput] = Field(max_length=100)
    notes: Optional[str] = Field(default=None, max_length=500)
    payment_method: Literal["efectivo", "yape", "plin", "transferencia", "tarjeta"]

    @field_validator("branch_id")
    @classmethod
    def validate_branch_id(cls, value: Optional[str]) -> Optional[str]:
        return _user_branch_id(value) if value is not None else None


class PublicProofUpload(BaseModel):
    payment_proof: str  # data URL (base64 image)


class StaffPaymentProof(BaseModel):
    payment_proof: str = Field(min_length=1, max_length=2_500_000)
    method: Literal["yape", "plin"]


class PublicItemsAdd(BaseModel):
    items: List[OrderItemInput] = Field(max_length=100)


class PublicItemUpdate(BaseModel):
    quantity: int = Field(ge=1, le=MAX_LINE_QUANTITY)


class OrderItemUpdate(BaseModel):
    quantity: Optional[int] = Field(default=None, ge=1, le=MAX_LINE_QUANTITY)
    notes: Optional[str] = None


class OrderStatusUpdate(BaseModel):
    status: OrderStatus
    reason: Optional[str] = None  # for cancellation


class OrderItemStatusUpdate(BaseModel):
    status: OrderItemStatus


class KitchenBump(BaseModel):
    from_status: Literal["pendiente", "en_preparacion"] = "pendiente"


# ============== PAYMENT ==============
PaymentMethod = Literal["efectivo", "yape", "plin", "tarjeta", "transferencia", "mixto"]


class PaymentSplit(BaseModel):
    method: PaymentMethod
    amount: float = Field(gt=0)


class PaymentLine(BaseModel):
    item_id: str
    quantity: int = Field(ge=1)


class PaymentCreate(BaseModel):
    order_id: str
    method: PaymentMethod
    amount: float = Field(ge=0)
    received_amount: Optional[float] = Field(default=None, ge=0)
    discount: float = Field(default=0.0, ge=0)
    tip: float = Field(default=0.0, ge=0)
    splits: Optional[List[PaymentSplit]] = None  # for mixto
    lines: Optional[List[PaymentLine]] = None
    notes: Optional[str] = Field(default=None, max_length=500)
    discount_reason: Optional[str] = None
    idempotency_key: Optional[str] = None
    expected_updated_at: Optional[str] = None
    expected_total: Optional[float] = None


class PaymentVoid(BaseModel):
    reason: str = Field(min_length=5)
    kind: Literal["void", "refund"] = "void"


class ProductAvailability(BaseModel):
    is_available: bool


class ProductImportRow(BaseModel):
    name: str = ""
    category: str = ""
    price: str = ""
    description: Optional[str] = None
    preparation_time: Optional[str] = None
    image_url: Optional[str] = None
    code: Optional[str] = None


class ProductsImport(BaseModel):
    items: List[ProductImportRow]


class ApprovalCreate(BaseModel):
    kind: Literal["void", "refund", "discount"] = "void"
    reason: str = Field(min_length=5)
    payment_id: Optional[str] = None
    order_id: Optional[str] = None
    amount: Optional[float] = Field(default=None, ge=0, le=1_000_000)


class ApprovalDecide(BaseModel):
    action: Literal["approve", "reject"]
    note: Optional[str] = None


class OrderReassign(BaseModel):
    waiter_id: str


# ============== CASH REGISTER ==============
class CashOpen(BaseModel):
    opening_amount: float = Field(ge=0)
    notes: Optional[str] = Field(default=None, max_length=500)
    branch_id: Optional[str] = None


class CashClose(BaseModel):
    closing_amount: float = Field(ge=0)
    notes: Optional[str] = Field(default=None, max_length=500)
    branch_id: Optional[str] = None


class CashMovement(BaseModel):
    type: Literal["ingreso", "egreso"]
    amount: float = Field(gt=0)
    description: str
    branch_id: Optional[str] = None
