import threading
import time

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


# Commercial Access anahtarı günde 100.000 istek verir. Sayaç bellek içidir (yeniden
# başlatmada sıfırlanır, yaklaşık bir ölçüdür): amaç, zamanlanmış yenilemelerin kullanıcının etkileşimli kullanımına
# ayrılan payı yememesi.
DAILY_LIMIT = 100_000
DAILY_BUDGET_FOR_BACKGROUND = 70_000
_day = ""
_calls = 0


def calls_today() -> int:
    return _calls if _day == time.strftime("%Y-%m-%d", time.gmtime()) else 0


def background_budget_ok() -> bool:
    return calls_today() < DAILY_BUDGET_FOR_BACKGROUND


def throttle() -> None:
    global _last_call, _day, _calls
    with _lock:
        today = time.strftime("%Y-%m-%d", time.gmtime())
        if today != _day:
            _day, _calls = today, 0
        _calls += 1
        now = time.monotonic()
        wait = MIN_INTERVAL_SECONDS - (now - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
