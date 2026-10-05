from .auth import router as auth_router
from .users import router as users_router
from .restaurants import router as restaurants_router
from .tables import router as tables_router
from .table_groups import router as table_groups_router
from .categories import router as categories_router
from .products import router as products_router
from .orders import router as orders_router
from .payments import router as payments_router
from .cash import router as cash_router
from .reports import router as reports_router
from .public import router as public_router
from .payment_config import router as payment_config_router
from .notifications import router as notifications_router
from .approvals import router as approvals_router
from .zones import router as zones_router
from .branches import router as branches_router
from .data import router as data_router
from .system import router as system_router

__all__ = [
    "auth_router",
    "users_router",
    "restaurants_router",
    "tables_router",
    "table_groups_router",
    "categories_router",
    "products_router",
    "orders_router",
    "payments_router",
    "cash_router",
    "reports_router",
    "public_router",
    "payment_config_router",
    "notifications_router",
    "approvals_router",
    "zones_router",
    "branches_router",
    "data_router",
    "system_router",
]
