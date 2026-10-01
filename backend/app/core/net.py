from fastapi import Request


def client_ip(request: Request) -> str:
    """İstemcinin gerçek IP'si. Cloudflare arkasında `CF-Connecting-IP` gerçek adresi taşır; yoksa `X-Forwarded-For`'un
    ilk değeri, o da yoksa doğrudan bağlantı adresi kullanılır (proxy arkasında bu proxy'nin IP'si olurdu)."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
