from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Literal
from datetime import datetime, timezone
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


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: Role
    phone: Optional[str] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[Role] = None
    phone: Optional[str] = None
    status: Optional[Literal["active", "inactive"]] = None
    password: Optional[str] = None


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
    delivery_fee: Optional[float] = None
    public_description: Optional[str] = None
    social_facebook: Optional[str] = None
    social_instagram: Optional[str] = None
    social_whatsapp: Optional[str] = None


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
TableStatus = Literal["disponible", "ocupada", "esperando_pago", "reservada", "inactiva"]


class TableCreate(BaseModel):
    number: int
    name: Optional[str] = None
    capacity: int = 4
    area: str = "Salón"


class TableUpdate(BaseModel):
    number: Optional[int] = None
    name: Optional[str] = None
    capacity: Optional[int] = None
    area: Optional[str] = None
    status: Optional[TableStatus] = None


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
    quantity: int = 1


class ProductCreate(BaseModel):
    category_id: str
    name: str
    description: Optional[str] = None
    price: float
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
    price: Optional[float] = None
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
    order_type: OrderType = "mesa"
    items: List[OrderItemInput] = []
    notes: Optional[str] = None


class PublicOrderCreate(BaseModel):
    order_type: Literal["local", "recojo", "delivery"]
    table_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    customer_email: Optional[str] = None
    items: List[OrderItemInput]
    notes: Optional[str] = None
    payment_method: Literal["efectivo", "yape", "plin", "transferencia", "tarjeta"]


class PublicProofUpload(BaseModel):
    payment_proof: str  # data URL (base64 image)


class OrderItemUpdate(BaseModel):
    quantity: Optional[int] = None
    notes: Optional[str] = None


class OrderStatusUpdate(BaseModel):
    status: OrderStatus
    reason: Optional[str] = None  # for cancellation


class OrderItemStatusUpdate(BaseModel):
    status: OrderItemStatus


# ============== PAYMENT ==============
PaymentMethod = Literal["efectivo", "yape", "plin", "tarjeta", "transferencia", "mixto"]


class PaymentSplit(BaseModel):
    method: PaymentMethod
    amount: float


class PaymentCreate(BaseModel):
    order_id: str
    method: PaymentMethod
    amount: float
    received_amount: Optional[float] = None  # for cash to calculate change
    discount: float = 0.0
    tip: float = 0.0
    splits: Optional[List[PaymentSplit]] = None  # for mixto
    notes: Optional[str] = None


# ============== CASH REGISTER ==============
class CashOpen(BaseModel):
    opening_amount: float
    notes: Optional[str] = None


class CashClose(BaseModel):
    closing_amount: float
    notes: Optional[str] = None


class CashMovement(BaseModel):
    type: Literal["ingreso", "egreso"]
    amount: float
    description: str
