import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.errors import register_error_handlers
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
from app.assistant import models as _assistant_models  # noqa: F401
from app.keywords import models as _keyword_models  # noqa: F401
from app.contact import models as _contact_models  # noqa: F401

from app.account.router import router as account_router
from app.account.service import AVATAR_DIR
from app.auth.router import router as auth_router
from app.assistant.router import router as assistant_router
from app.contact.router import router as contact_router
from app.finance.router import router as finance_router
from app.finance.invoices_router import router as finance_invoices_router
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


app = FastAPI(
    title="Ulagg API",
    lifespan=lifespan,
    docs_url="/docs" if settings.expose_docs else None,
    redoc_url="/redoc" if settings.expose_docs else None,
    openapi_url="/openapi.json" if settings.expose_docs else None,
)
register_error_handlers(app)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Yalnızca avatarlar herkese açık servis edilir (dosya adı tahmin edilemez). Taslak/sohbet/önbellek görselleri
# uploads/ altında kalır ve yalnızca yetki kontrolü yapan uç noktalardan sunulur — klasörün tamamı asla mount edilmez.
app.mount("/static/avatars", StaticFiles(directory=str(AVATAR_DIR)), name="avatars")

@app.exception_handler(EtsyAuthError)
async def etsy_auth_error_handler(_: Request, exc: EtsyAuthError):
    return JSONResponse(status_code=401, content={"detail": str(exc), "code": 401})


@app.exception_handler(EtsyApiError)
async def etsy_api_error_handler(_: Request, exc: EtsyApiError):
    # Etsy's own status codes (400/403/404/409/...) map straight through so
    # the frontend sees a real reason instead of a generic 500 — this is a
    # catch-all safety net; routes with a narrower try/except still win.
    status_code = exc.status_code if 400 <= exc.status_code < 500 else 502
    return JSONResponse(status_code=status_code, content={"detail": f"Etsy API: {exc.message}", "code": status_code})


@app.get("/healthz", include_in_schema=False)
def healthz():
    """Render'ın sağlık kontrolü için hafif uç nokta: veritabanına ya da dış servise dokunmaz."""
    return {"ok": True}


app.include_router(auth_router)
app.include_router(account_router)
app.include_router(shops_router)
app.include_router(listings_router)
app.include_router(orders_router)
app.include_router(finance_router)
app.include_router(finance_invoices_router)
app.include_router(assistant_router)
app.include_router(taxonomy_router)
app.include_router(keywords_router)
app.include_router(contact_router)
