from fastapi import Request


def client_ip(request: Request) -> str:
    """İstemcinin gerçek IP'si. Cloudflare arkasında `CF-Connecting-IP` gerçek adresi taşır; yoksa `X-Forwarded-For`'un
    SON değeri (Render'ın ön proxy'si ekler; ilk değer istemcinin kendi yazdığı olabilir ve her istekte değiştirilerek
    IP sınırı aşılırdı), o da yoksa doğrudan bağlantı adresi kullanılır."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"
