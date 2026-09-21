import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.etsy.client import EtsyApiError, EtsyAuthError

# Uygulama logları (Etsy'ye giden yazma istekleri, yayın adımları) uvicorn çıktısıyla aynı yere düşsün.
logging.getLogger("app").setLevel(logging.INFO)
logging.getLogger("etsy").setLevel(logging.INFO)
if not logging.getLogger().handlers:
    logging.basicConfig(format="%(levelname)s:     %(name)s - %(message)s")

# Every mapped model must be imported somewhere before the first query so
# SQLAlchemy can resolve the cross-module relationship() string references.
# Schema creation/changes are handled by Alembic (`alembic upgrade head`),
# not at app startup — see backend/README or alembic/env.py.
from app.auth import models as _auth_models  # noqa: F401
from app.shops import models as _shop_models  # noqa: F401
from app.listings import models as _listing_models  # noqa: F401
from app.orders import models as _order_models  # noqa: F401
from app.finance import models as _finance_models  # noqa: F401
from app.keywords import models as _keyword_models  # noqa: F401

from app.account.router import router as account_router
from app.account.service import AVATAR_DIR
from app.auth.router import router as auth_router
from app.finance.router import router as finance_router
from app.jobs.scheduler import start_scheduler, stop_scheduler
from app.keywords.router import router as keywords_router
from app.listings.router import router as listings_router
from app.orders.router import router as orders_router
from app.shops.router import router as shops_router
from app.taxonomy.router import router as taxonomy_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Etsy Otomasyon", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AVATAR_DIR.parent is the shared uploads/ dir; mounted whole so future
# uploaded-file features (beyond avatars) don't need a new mount each time.
app.mount("/static", StaticFiles(directory=str(AVATAR_DIR.parent)), name="static")

@app.exception_handler(EtsyAuthError)
async def etsy_auth_error_handler(_: Request, exc: EtsyAuthError):
    return JSONResponse(status_code=401, content={"detail": str(exc)})


@app.exception_handler(EtsyApiError)
async def etsy_api_error_handler(_: Request, exc: EtsyApiError):
    # Etsy's own status codes (400/403/404/409/...) map straight through so
    # the frontend sees a real reason instead of a generic 500 — this is a
    # catch-all safety net; routes with a narrower try/except still win.
    status_code = exc.status_code if 400 <= exc.status_code < 500 else 502
    return JSONResponse(status_code=status_code, content={"detail": f"Etsy API: {exc.message}"})


app.include_router(auth_router)
app.include_router(account_router)
app.include_router(shops_router)
app.include_router(listings_router)
app.include_router(orders_router)
app.include_router(finance_router)
app.include_router(taxonomy_router)
app.include_router(keywords_router)
