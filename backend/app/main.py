from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings

# Every mapped model must be imported somewhere before the first query so
# SQLAlchemy can resolve the cross-module relationship() string references.
# Schema creation/changes are handled by Alembic (`alembic upgrade head`),
# not at app startup — see backend/README or alembic/env.py.
from app.auth import models as _auth_models  # noqa: F401
from app.shops import models as _shop_models  # noqa: F401
from app.listings import models as _listing_models  # noqa: F401

from app.auth.router import router as auth_router
from app.listings.router import router as listings_router
from app.shops.router import router as shops_router

app = FastAPI(title="Etsy Otomasyon")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(shops_router)
app.include_router(listings_router)
