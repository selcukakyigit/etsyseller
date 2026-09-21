import threading
import time

# Etsy's default per-app limit is 5 requests/second, shared across every
# shop and every code path (sync jobs, page loads, AI suggestion generation,
# keyword pool lookups...). A per-function sleep() only protects that one
# function — two different features calling Etsy around the same moment can
# still burst past the limit. This is the one choke point every Etsy call
# goes through (EtsyClient.request, plus the api-key-only endpoints in
# taxonomy/search), so the spacing is enforced app-wide, not per caller.
_lock = threading.Lock()
_last_call = 0.0
MIN_INTERVAL_SECONDS = 0.22  # a bit above 1/5s for safety margin


def throttle() -> None:
    global _last_call
    with _lock:
        now = time.monotonic()
        wait = MIN_INTERVAL_SECONDS - (now - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
