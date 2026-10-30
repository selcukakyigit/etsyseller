import datetime as dt
import threading
import time

from app.etsy import call_counter

# Etsy's per-app limit (Commercial Access: 150 requests/second, 100,000/day) is shared across every
# shop and every code path (sync jobs, page loads, AI suggestion generation,
# keyword pool lookups...). A per-function sleep() only protects that one
# function — two different features calling Etsy around the same moment can
# still burst past the limit. This is the one choke point every Etsy call
# goes through (EtsyClient.request, plus the api-key-only endpoints in
# taxonomy/search), so the spacing is enforced app-wide, not per caller.
_lock = threading.Lock()
_last_call = 0.0
MIN_INTERVAL_SECONDS = 0.01  # ~100/s, well under the 150 QPS commercial limit


# Commercial Access anahtarı günde 100.000 istek verir. Amaç, zamanlanmış yenilemelerin kullanıcının etkileşimli kullanımına
# ayrılan payı yememesi. Çağrılar önce bellekte sayılır; `start_persistence()` çağrılmışsa birikenler periyodik olarak veritabanındaki
# günlük toplama eklenir (etsy/call_counter.py), böylece yeniden başlatma ve ayrı worker süreci toplamı bozmaz.
DAILY_LIMIT = 100_000
DAILY_BUDGET_FOR_BACKGROUND = 70_000
_day = ""
_calls = 0  # bu süreçte bugün sayılan
_unsaved: dict[str, int] = {}  # gün -> henüz veritabanına eklenmemiş çağrı
_saved = 0  # veritabanındaki `_saved_day` toplamı (en son okunan; başka süreçlerin eklediği dahil)
_saved_day = ""
_persist = False


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def calls_today() -> int:
    today = _today()
    if _persist and _saved_day == today:
        return _saved + _unsaved.get(today, 0)
    return _calls if _day == today else 0


def background_budget_ok() -> bool:
    return calls_today() < DAILY_BUDGET_FOR_BACKGROUND


def flush() -> None:
    """Biriken çağrıları veritabanındaki günlük toplama ekler ve güncel gün toplamını okur. Hata olursa biriken silinmez, sonraki turda yeniden
    denenir. Başarıyla eklenen kısım ancak yazıldıktan sonra bellekten düşülür (arada sayı geriye gitmez)."""
    global _saved, _saved_day

    today = _today()
    with _lock:
        batch = dict(_unsaved)
    for day, n in sorted(batch.items()):
        total = call_counter.add(dt.date.fromisoformat(day), n)
        with _lock:
            _unsaved[day] = _unsaved.get(day, 0) - n
            if day == today:
                _saved, _saved_day = total, today
            if _unsaved[day] <= 0:
                del _unsaved[day]
    if today not in batch:  # bu turda eklenecek yok: yalnızca güncel toplamı oku (başka süreç eklemiş olabilir)
        total = call_counter.add(dt.date.fromisoformat(today), 0)
        with _lock:
            _saved, _saved_day = total, today


def start_persistence() -> None:
    """Uygulama açılışında çağrılır (testlerde çağrılmaz: sayaç yalnızca bellekte kalır)."""
    global _persist

    _persist = True
    call_counter.start(flush)


def throttle() -> None:
    global _last_call, _day, _calls
    with _lock:
        today = _today()
        if today != _day:
            _day, _calls = today, 0
        _calls += 1
        if _persist:
            _unsaved[today] = _unsaved.get(today, 0) + 1
        now = time.monotonic()
        wait = MIN_INTERVAL_SECONDS - (now - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
