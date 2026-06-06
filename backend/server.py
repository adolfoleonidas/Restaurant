from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from database import db, ensure_indexes
from routes import (
    auth_router,
    users_router,
    restaurants_router,
    tables_router,
    categories_router,
    products_router,
    orders_router,
    payments_router,
    cash_router,
    reports_router,
    public_router,
    payment_config_router,
)
from seed import run_seed

# Create the main app
app = FastAPI(title="Sistema de Gestión para Restaurantes")

# Master API router with /api prefix
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Sistema de Gestión para Restaurantes API", "version": "1.0.0"}


@api_router.get("/health")
async def health():
    return {"status": "ok"}


# Mount all module routers
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(users_router, prefix="/users", tags=["users"])
api_router.include_router(restaurants_router, prefix="/restaurants", tags=["restaurants"])
api_router.include_router(tables_router, prefix="/tables", tags=["tables"])
api_router.include_router(categories_router, prefix="/categories", tags=["categories"])
api_router.include_router(products_router, prefix="/products", tags=["products"])
api_router.include_router(orders_router, prefix="/orders", tags=["orders"])
api_router.include_router(payments_router, prefix="/payments", tags=["payments"])
api_router.include_router(cash_router, prefix="/cash", tags=["cash"])
api_router.include_router(reports_router, prefix="/reports", tags=["reports"])
api_router.include_router(public_router, prefix="/public", tags=["public"])
api_router.include_router(payment_config_router, prefix="/payment-config", tags=["payment-config"])

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
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
    await ensure_indexes()
    await run_seed()
    logger.info("Backend startup complete - DB seeded if empty")


@app.on_event("shutdown")
async def shutdown_db_client():
    from database import client as mongo_client
    mongo_client.close()
