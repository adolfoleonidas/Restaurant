from pydantic import BaseModel, Field, ConfigDict, EmailStr, constr, field_validator
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
    password: str
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
    password: Optional[str] = None
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
    theme_id: Optional[str] = None


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
    number: int
    name: Optional[str] = None
    capacity: int = 4
    area: str = "Salón"
    branch_id: Optional[str] = None

    @field_validator("branch_id")
    @classmethod
    def validate_branch_id(cls, value: Optional[str]) -> Optional[str]:
        return _user_branch_id(value) if value is not None else None


class TableUpdate(BaseModel):
    number: Optional[int] = None
    name: Optional[str] = None
    capacity: Optional[int] = None
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


# ============== ZONE ==============
class ZoneCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    sort_order: int = 0
    branch_id: Optional[str] = None

    @field_validator("branch_id")
    @classmethod
    def validate_branch_id(cls, value: Optional[str]) -> Optional[str]:
        return _user_branch_id(value) if value is not None else None


class ZoneUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    sort_order: Optional[int] = None
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
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
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
    preparation_time: int = 15  # minutes
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
    preparation_time: Optional[int] = None
    is_combo: Optional[bool] = None
    combo_items: Optional[List[ComboComponent]] = None
    code: Optional[str] = None


# ============== ORDER ==============
OrderStatus = Literal[
    "nuevo", "enviado_cocina", "en_preparacion", "listo",
    "entregado", "pendiente_pago", "pagado", "cancelado"
]
OrderItemStatus = Literal["pendiente", "en_preparacion", "listo", "entregado", "cancelado"]
OrderType = Literal["mesa", "local", "recojo", "delivery"]


class OrderItemInput(BaseModel):
    product_id: str
    quantity: int = Field(ge=1, default=1)
    notes: Optional[str] = None


class OrderCreate(BaseModel):
    table_id: Optional[str] = None
    branch_id: Optional[str] = None
    order_type: OrderType = "mesa"
    items: List[OrderItemInput] = []
    notes: Optional[str] = None

    @field_validator("branch_id")
    @classmethod
    def validate_branch_id(cls, value: Optional[str]) -> Optional[str]:
        return _user_branch_id(value) if value is not None else None


class PublicOrderCreate(BaseModel):
    request_id: Optional[constr(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", min_length=36, max_length=36)] = None
    order_type: Literal["local", "recojo", "delivery"]
    table_id: Optional[str] = None
    table_token: Optional[str] = None
    branch_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    customer_email: Optional[str] = None
    items: List[OrderItemInput]
    notes: Optional[str] = None
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
    items: List[OrderItemInput]


class PublicItemUpdate(BaseModel):
    quantity: int = Field(ge=1)


class OrderItemUpdate(BaseModel):
    quantity: Optional[int] = Field(default=None, ge=1)
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
    notes: Optional[str] = None
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
    amount: Optional[float] = None


class ApprovalDecide(BaseModel):
    action: Literal["approve", "reject"]
    note: Optional[str] = None


class OrderReassign(BaseModel):
    waiter_id: str


# ============== CASH REGISTER ==============
class CashOpen(BaseModel):
    opening_amount: float = Field(ge=0)
    notes: Optional[str] = None


class CashClose(BaseModel):
    closing_amount: float = Field(ge=0)
    notes: Optional[str] = None


class CashMovement(BaseModel):
    type: Literal["ingreso", "egreso"]
    amount: float = Field(gt=0)
    description: str
