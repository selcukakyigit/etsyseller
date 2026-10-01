"""Tek yerden hata cevapları. Tüm API hataları aynı biçimdedir: {"detail": "...", "code": <http durumu>}.
Beklenmeyen hatalar kullanıcıya yığın izi sızdırmaz; yalnızca bir `request_id` döner, ayrıntı sunucu günlüğündedir."""
import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings

log = logging.getLogger("app.errors")


def _body(status: int, detail, **extra) -> dict:
    return {"detail": detail, "code": status, **extra}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        # Bilinen hatalar (404, 401, 403...) olduğu gibi, ama tek biçimde.
        return JSONResponse(_body(exc.status_code, exc.detail), status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        fields = [".".join(str(p) for p in e["loc"] if p not in ("body", "query", "path")) for e in exc.errors()]
        return JSONResponse(_body(422, "Gönderilen bilgiler geçersiz.", fields=sorted({f for f in fields if f})), status_code=422)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        request_id = uuid.uuid4().hex[:12]
        log.exception("Beklenmeyen hata [%s] %s %s", request_id, request.method, request.url.path)
        headers = {}
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") == settings.frontend_url.rstrip("/"):
            # Bu hata CORS ara katmanının dışında üretilir; başlık eklemezsek tarayıcı gerçek 500 yerine "CORS hatası" gösterir.
            headers = {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true"}
        return JSONResponse(
            _body(500, "Beklenmeyen bir hata oluştu. Sorun sürerse destek ekibine şu kodu ilet.", request_id=request_id),
            status_code=500,
            headers=headers,
        )
