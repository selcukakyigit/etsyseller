"""Kullanıcının verdiği bir adresi GÜVENLİ okumak (SSRF korumalı): sunucumuz kullanıcı adına dışarıdaki bir sayfaya gider, bu yüzden iç ağa, yerel makineye ve bulut meta veri adresine ASLA gitmemeli.

Kurallar:
- yalnızca http/https ve 80/443 bağlantı noktaları; adreste kullanıcı:parola yok;
- adın çözüldüğü TÜM IP'ler "global" olmalı (özel, yerel, link-local, CGNAT, çoklu yayın, ayrılmış, 169.254.169.254 meta veri… hepsi reddedilir);
- bağlantı DOĞRULANAN IP'ye kurulur (Host ve TLS adı özgün ad kalır): doğrulamadan sonra DNS'in başka IP'ye çevrilmesi (rebinding) işe yaramaz;
- yönlendirmeler elle izlenir (en çok MAX_REDIRECTS), her adım baştan doğrulanır;
- süre, gövde boyutu ve içerik türü sınırlıdır; çerez/kimlik bilgisi gönderilmez.
Okunan sayfa GÜVENİLMEYEN VERİDİR (içindeki talimatlara uyulmaz); bkz. research/page_reader.py ve asistan aracı."""
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx

from app.core.i18n import tr

MAX_BYTES = 1_500_000
TIMEOUT = 8.0
MAX_REDIRECTS = 3
ALLOWED_PORTS = {80, 443}
ACCEPTED_TYPES = ("text/html", "application/xhtml+xml", "text/plain")
USER_AGENT = "Mozilla/5.0 (compatible; UlaggReader/1.0; +product-research)"


class UnsafeUrl(ValueError):
    """Adres okunamaz ya da güvenli değil; mesaj kullanıcıya gösterilebilir."""


@dataclass
class Fetched:
    url: str  # yönlendirmeler sonrası son adres
    status: int
    content_type: str
    body: bytes
    truncated: bool


def _global_ips(host: str, port: int) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError) as exc:
        raise UnsafeUrl(tr("Adres çözülemedi.", "The address could not be resolved.")) from exc
    ips = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise UnsafeUrl(tr("Bu adrese gidilemez (yerel ya da özel ağ).", "This address cannot be opened (local or private network)."))
        ips.append(str(ip))
    if not ips:
        raise UnsafeUrl(tr("Adres çözülemedi.", "The address could not be resolved."))
    return ips


def check(url: str) -> tuple[str, str, int, str]:
    """Adresi doğrular. Döner: (şema, ana bilgisayar, bağlantı noktası, doğrulanan IP)."""
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise UnsafeUrl(tr("Yalnızca http/https adresleri okunur.", "Only http/https addresses can be read."))
    if parts.username or parts.password:
        raise UnsafeUrl(tr("Kullanıcı adı/parola içeren adresler okunmaz.", "Addresses containing a username/password are not read."))
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError as exc:
        raise UnsafeUrl(tr("Adres geçersiz.", "The address is invalid.")) from exc
    if port not in ALLOWED_PORTS:
        raise UnsafeUrl(tr("Bu bağlantı noktasına gidilemez.", "This port cannot be opened."))
    host = parts.hostname.rstrip(".").lower()
    return parts.scheme, host, port, _global_ips(host, port)[0]


def _pinned(scheme: str, host: str, port: int, ip: str, path: str) -> tuple[str, dict, dict]:
    """İstek adresi (doğrulanan IP), başlıklar (özgün Host) ve TLS uzantıları (özgün ad ile sertifika doğrulaması)."""
    literal = f"[{ip}]" if ":" in ip else ip
    default_port = (scheme, port) in (("http", 80), ("https", 443))
    netloc = literal if default_port else f"{literal}:{port}"
    return f"{scheme}://{netloc}{path}", {"Host": host if default_port else f"{host}:{port}"}, ({"sni_hostname": host} if scheme == "https" else {})


def fetch(url: str, *, transport: httpx.BaseTransport | None = None, max_bytes: int = MAX_BYTES) -> Fetched:
    """Sayfayı güvenle okur. `transport`: yalnızca testler için (gerçek ağ yok)."""
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        scheme, host, port, ip = check(current)
        parts = urlsplit(current)
        path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        request_url, headers, extensions = _pinned(scheme, host, port, ip, path)
        headers |= {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9", "Accept-Language": "en,tr;q=0.8"}
        try:
            with httpx.Client(timeout=TIMEOUT, follow_redirects=False, transport=transport, trust_env=False) as client:
                with client.stream("GET", request_url, headers=headers, extensions=extensions) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                        current = urljoin(current, resp.headers["location"])
                        continue
                    ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                    if resp.status_code >= 400:
                        raise UnsafeUrl(tr(f"Sayfa açılamadı (HTTP {resp.status_code}); site okunmasına izin vermiyor olabilir.", f"The page could not be opened (HTTP {resp.status_code}); the site may not allow reading."))
                    if ctype and not ctype.startswith(ACCEPTED_TYPES):
                        raise UnsafeUrl(tr("Bu içerik türü okunmaz (yalnızca web sayfası ve düz metin).", "This content type is not read (only web pages and plain text)."))
                    chunks, size, truncated = [], 0, False
                    for chunk in resp.iter_bytes():
                        size += len(chunk)
                        if size > max_bytes:
                            chunks.append(chunk[: max_bytes - (size - len(chunk))])
                            truncated = True
                            break
                        chunks.append(chunk)
                    return Fetched(current, resp.status_code, ctype, b"".join(chunks), truncated)
        except httpx.TimeoutException as exc:
            raise UnsafeUrl(tr("Sayfa zamanında yanıt vermedi.", "The page did not respond in time.")) from exc
        except httpx.HTTPError as exc:
            raise UnsafeUrl(tr("Sayfaya bağlanılamadı.", "Could not connect to the page.")) from exc
    raise UnsafeUrl(tr("Çok fazla yönlendirme.", "Too many redirects."))
