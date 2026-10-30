import logging
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.errors import register_error_handlers
from app.core.i18n import set_lang, tr, translate_detail
from app.core.limits import SlidingWindow
from app.core.net import client_ip
from app.etsy import rate_limit
from app.etsy.client import DemoShopError, EtsyApiError, EtsyAuthError

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
from app.contact import models as _contact_models  # noqa: F401
from app.support import models as _support_models  # noqa: F401
from app.insights import models as _insights_models  # noqa: F401
from app.notifications import models as _notification_models  # noqa: F401
from app.ai import models as _ai_models  # noqa: F401
from app.billing import models as _billing_models  # noqa: F401
from app.admin import models as _admin_models  # noqa: F401
from app.modkit import models as _modkit_models  # noqa: F401
from app.supply import models as _supply_models  # noqa: F401
from app.taxonomy import models as _taxonomy_models  # noqa: F401
from app.research import models as _research_models  # noqa: F401
from app.core import app_settings as _app_settings  # noqa: F401

from app.account.router import public_router as avatar_router
from app.account.router import router as account_router
from app.admin.router import router as admin_router
from app.research.admin_router import router as research_admin_router
from app.research.discover_router import router as discover_router
from app.auth.router import router as auth_router
from app.assistant.router import router as assistant_router
from app.banners.router import router as banners_router
from app.billing.router import router as billing_router
from app.billing.webhooks import router as billing_webhooks_router
from app.contact.router import router as contact_router
from app.support import errors as support_errors
from app.support.admin_router import router as support_admin_router
from app.support.inbound import router as support_inbound_router
from app.support.router import router as support_router
from app.site.router import router as site_router
from app.finance.router import router as finance_router
from app.finance.invoices_router import router as finance_invoices_router
from app.modkit.routes import core_router as modkit_router, invite_router
from app.supply.router import base_router as supply_base_router, router as supply_router
from app.core.db_guard import warn_unlocked_tables
from app.jobs.scheduler import start_scheduler, stop_scheduler
from app.keywords.router import router as keywords_router
from app.listings.generation_router import router as listing_generation_router
from app.listings.router import router as listings_router
from app.listings.templates_router import router as description_templates_router
from app.insights.router import router as insights_router
from app.notifications.router import router as notifications_router
from app.orders.router import router as orders_router
from app.shops.router import router as shops_router
from app.taxonomy.router import router as taxonomy_router
from app.listings.rules_router import router as etsy_rules_router
from app.webhooks.router import router as webhooks_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    warn_unlocked_tables()
    rate_limit.start_persistence()
    start_scheduler()
    yield
    stop_scheduler()
    try:
        rate_limit.flush()  # kapanırken biriken çağrılar kaybolmasın
    except Exception:  # noqa: BLE001
        logging.getLogger("app").exception("Etsy çağrı sayacı kapanışta yazılamadı")


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


# IP başına dakikada en fazla 600 istek (saniyede 10): sayfa açılışları onlarca istek yapar, bu sınıra bir kullanıcı takılmaz;
# hatalı bir istemci ya da bot ise sunucuyu boğamaz. Webhook'lar (imzalı, sağlayıcıdan gelir) ve CORS ön isteği sayılmaz.
_ip_window = SlidingWindow(limit=600, window=60)
_UNLIMITED_PREFIXES = ("/webhooks", "/static", "/health")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    set_lang(request.headers.get("x-lang"))  # arayüz dili; hata ve bildirim metinleri buna göre seçilir (core/i18n.py)
    if request.method != "OPTIONS" and not request.url.path.startswith(_UNLIMITED_PREFIXES) and not _ip_window.hit(client_ip(request)):
        return JSONResponse(
            status_code=429,
            content={"detail": tr("Çok fazla istek gönderildi. Biraz bekleyip tekrar dene.", "Too many requests. Wait a moment and try again."), "code": 429},
            headers={"Retry-After": "30", **SECURITY_HEADERS},
        )
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

# Yalnızca avatarlar herkese açık servis edilir (dosya adı tahmin edilemez; `account.avatar_file`, kalıcı depodan). Taslak/sohbet/önbellek görselleri
# yalnızca yetki kontrolü yapan uç noktalardan sunulur — klasörün tamamı asla mount edilmez.

@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    """Yakalanmamış hata: yöneticinin "Hatalar" sayfasına düşer, kullanıcıya genel 500 döner."""
    logging.getLogger("app").error("Yakalanmamış hata: %s %s", request.method, request.url.path, exc_info=exc)
    support_errors.record_server_error(f"{request.method} {request.url.path}", exc, "".join(traceback.format_exception(exc)))
    return JSONResponse(status_code=500, content={"detail": tr("Beklenmeyen bir hata oluştu.", "An unexpected error occurred."), "code": 500})


@app.exception_handler(EtsyAuthError)
async def etsy_auth_error_handler(_: Request, exc: EtsyAuthError):
    return JSONResponse(status_code=401, content={"detail": translate_detail(str(exc)), "code": 401})


@app.exception_handler(DemoShopError)
async def demo_shop_error_handler(_: Request, exc: DemoShopError):
    detail = tr("Demo mağaza: değişiklikler Etsy'ye gönderilmez.", "Demo shop: changes are not sent to Etsy.")
    return JSONResponse(status_code=403, content={"detail": detail, "code": 403})


@app.exception_handler(EtsyApiError)
async def etsy_api_error_handler(_: Request, exc: EtsyApiError):
    # Etsy's own status codes (400/403/404/409/...) map straight through so
    # the frontend sees a real reason instead of a generic 500 — this is a
    # catch-all safety net; routes with a narrower try/except still win.
    status_code = exc.status_code if 400 <= exc.status_code < 500 else 502
    return JSONResponse(status_code=status_code, content={"detail": translate_detail(f"Etsy API: {exc.message}"), "code": status_code})


@app.get("/healthz", include_in_schema=False)
def healthz():
    """Render'ın sağlık kontrolü için hafif uç nokta: veritabanına ya da dış servise dokunmaz."""
    return {"ok": True}


app.include_router(auth_router)
app.include_router(account_router)
app.include_router(avatar_router)
app.include_router(shops_router)
app.include_router(listings_router)
app.include_router(listing_generation_router)
app.include_router(description_templates_router)
app.include_router(insights_router)
app.include_router(orders_router)
app.include_router(notifications_router)
app.include_router(finance_router)
app.include_router(finance_invoices_router)
app.include_router(modkit_router)
app.include_router(invite_router)
app.include_router(supply_base_router)
app.include_router(supply_router)
app.include_router(assistant_router)
app.include_router(taxonomy_router)
app.include_router(etsy_rules_router)
app.include_router(keywords_router)
app.include_router(contact_router)
app.include_router(support_router)
app.include_router(support_inbound_router)
app.include_router(support_admin_router)
app.include_router(webhooks_router)
app.include_router(admin_router)
app.include_router(research_admin_router)
app.include_router(discover_router)
app.include_router(billing_router)
app.include_router(billing_webhooks_router)
app.include_router(banners_router)
app.include_router(site_router)
