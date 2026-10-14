from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from database import db, ensure_indexes
from error_handlers import register_error_handlers
from security_config import assert_runtime_config
from routes import (
    auth_router,
    users_router,
    restaurants_router,
    tables_router,
    table_groups_router,
    categories_router,
    products_router,
    orders_router,
    payments_router,
    cash_router,
    reports_router,
    public_router,
    prepay_router,
    payment_config_router,
    notifications_router,
    approvals_router,
    zones_router,
    branches_router,
    data_router,
    system_router,
    diag_router,
)
from seed import run_seed

# Create the main app
app = FastAPI(title="Sistema de Gestión para Restaurantes")
register_error_handlers(app)

# Master API router with /api prefix
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Sistema de Gestión para Restaurantes API", "version": "1.0.0"}


@api_router.get("/health")
async def health():
    try:
        await db.command("ping")
        return {"status": "ok", "database": "connected"}
    except Exception:
        # Unauthenticated endpoint: never leak driver errors (hosts, collection
        # names). The detail goes to the server log instead.
        logger.exception("Health check failed")
        return {"status": "degraded", "database": "disconnected"}


# Mount all module routers
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(users_router, prefix="/users", tags=["users"])
api_router.include_router(restaurants_router, prefix="/restaurants", tags=["restaurants"])
api_router.include_router(tables_router, prefix="/tables", tags=["tables"])
api_router.include_router(table_groups_router, prefix="/table-groups", tags=["table-groups"])
api_router.include_router(categories_router, prefix="/categories", tags=["categories"])
api_router.include_router(products_router, prefix="/products", tags=["products"])
api_router.include_router(orders_router, prefix="/orders", tags=["orders"])
api_router.include_router(payments_router, prefix="/payments", tags=["payments"])
api_router.include_router(cash_router, prefix="/cash", tags=["cash"])
api_router.include_router(reports_router, prefix="/reports", tags=["reports"])
api_router.include_router(public_router, prefix="/public", tags=["public"])
api_router.include_router(prepay_router, prefix="/public-prepay", tags=["prepay"])
api_router.include_router(payment_config_router, prefix="/payment-config", tags=["payment-config"])
api_router.include_router(notifications_router, prefix="/notifications", tags=["notifications"])
api_router.include_router(approvals_router, prefix="/approvals", tags=["approvals"])
api_router.include_router(zones_router, prefix="/zones", tags=["zones"])
api_router.include_router(branches_router, prefix="/branches", tags=["branches"])
api_router.include_router(data_router, prefix="/data", tags=["data"])
api_router.include_router(system_router, prefix="/system", tags=["system"])
# Diagnóstico del cliente: el medidor de `?diag=1` manda lo que solo el
# dispositivo puede medir (ver `routes/diag.py`).
api_router.include_router(diag_router, prefix="/diag", tags=["diag"])

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[origin.strip() for origin in os.environ.get('CORS_ORIGINS', '').split(',') if origin.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup():
    assert_runtime_config()
    await ensure_indexes()
    await run_seed()
    logger.info("Backend startup complete - DB seeded if empty")


@app.on_event("shutdown")
async def shutdown_db_client():
    from database import client as mongo_client
    mongo_client.close()
