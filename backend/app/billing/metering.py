"""AI kullanım ölçümü. AI isteği yapan uç noktalar `require_ai_enabled` (shops/deps.py) üzerinden geçer; o, isteğin
çalışma alanını ve kullanıcısını bu modüldeki bağlam değişkenine yazar. AI çağrısı yapan kod (seo, vision, image_gen,
asistan…) yalnızca `record(...)` çağırır; kimin adına olduğunu bilmek zorunda değildir.

`record` hiçbir zaman hata fırlatmaz: kullanım kaydedilemezse loglanır, kullanıcının cevabı etkilenmez.
Bağlam yoksa (ör. zamanlanmış bir iş) kayıt atlanır.

İleride işler ayrı bir worker'a taşınırsa iş kuyruğa `Scope` ile birlikte konur ve worker işi `bind(scope)` içinde
çalıştırır; çağrı noktaları değişmez."""
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from app.ai.catalog import ResolvedModel
from app.billing import credits

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Scope:
    workspace_id: int
    user_id: int | None


_scope: ContextVar[Scope | None] = ContextVar("ai_scope", default=None)


def set_scope(scope: Scope) -> None:
    """İstek boyunca geçerli bağlam. Async bir FastAPI bağımlılığından çağrılmalı: oradaki değer, aynı isteğin senkron
    uç noktasının çalıştığı iş parçacığına da geçer (anyio bağlamı kopyalar) ve istekler arasında sızmaz."""
    _scope.set(scope)


@contextmanager
def bind(scope: Scope):
    """Bağlamı bir kod bloğu için kurar (iş parçacığı, worker işi, test)."""
    token = _scope.set(scope)
    try:
        yield
    finally:
        _scope.reset(token)


def current() -> Scope | None:
    return _scope.get()


def tokens(provider: str, response) -> tuple[int, int]:
    """Sağlayıcı cevabından (girdi, çıktı) token sayısı. Claude'da önbellekten okunan/yazılan girdi de girdiye eklenir."""
    u = getattr(response, "usage", None)
    if u is None:
        return 0, 0
    if provider == "anthropic":
        inp = (getattr(u, "input_tokens", 0) or 0) + (getattr(u, "cache_read_input_tokens", 0) or 0) + (getattr(u, "cache_creation_input_tokens", 0) or 0)
        return inp, getattr(u, "output_tokens", 0) or 0
    return getattr(u, "prompt_tokens", 0) or 0, getattr(u, "completion_tokens", 0) or 0


def record(task: str, model: ResolvedModel, input_tokens: int = 0, output_tokens: int = 0, units: int = 0) -> None:
    scope = _scope.get()
    if scope is None:
        log.debug("AI kullanımı bağlamsız, kaydedilmedi (%s)", task)
        return
    try:
        credits.charge_usage(scope.workspace_id, scope.user_id, task, model, input_tokens, output_tokens, units)
    except Exception:  # noqa: BLE001 — ölçüm hatası kullanıcının cevabını düşürmemeli
        log.exception("AI kullanımı kaydedilemedi (ws=%s, %s)", scope.workspace_id, task)


def record_response(task: str, model: ResolvedModel, response) -> None:
    record(task, model, *tokens(model.provider, response))
