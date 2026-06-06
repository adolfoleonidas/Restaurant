from .auth import router as auth_router
from .users import router as users_router
from .restaurants import router as restaurants_router
from .tables import router as tables_router
from .categories import router as categories_router
from .products import router as products_router
from .orders import router as orders_router
from .payments import router as payments_router
from .cash import router as cash_router
from .reports import router as reports_router

__all__ = [
    "auth_router",
    "users_router",
    "restaurants_router",
    "tables_router",
    "categories_router",
    "products_router",
    "orders_router",
    "payments_router",
    "cash_router",
    "reports_router",
]
