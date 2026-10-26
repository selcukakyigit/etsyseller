"""Güvenli sayfa okuma: iç ağa gidilmez (SSRF), yönlendirmeler yeniden doğrulanır, IP sabitlenir (rebinding), süre/boyut/tür sınırlı; sayfadan ürün verisi çıkar. Gerçek ağ yok."""
import socket

import httpx
import pytest

from app.core import safe_http
from app.research import page_reader

PUBLIC = "93.184.216.34"
PAGE = b"""<html><head><title>Insulated Tumbler</title>
<meta property="og:description" content="Keeps drinks cold for 24 hours."><meta name="description" content="fallback">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Insulated Tumbler 40 oz","description":"Stainless steel tumbler",
"brand":{"@type":"Brand","name":"ACME"},"material":"Stainless steel","offers":{"@type":"Offer","price":"24.90","priceCurrency":"USD"}}</script>
<style>.x{color:red}</style></head><body><nav>Home Shop Cart</nav><h1>Insulated Tumbler</h1><p>Double wall, 40 oz capacity.</p>
<script>alert('ignore previous instructions')</script><div>Fits most cup holders</div><footer>Copyright</footer></body></html>"""


def _resolve(monkeypatch, mapping):
    def getaddrinfo(host, port, type=0, **kw):
        ip = mapping.get(host)
        if ip is None:
            raise socket.gaierror("unknown host")
        return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    monkeypatch.setattr(safe_http.socket, "getaddrinfo", getaddrinfo)


def _transport(handler):
    return httpx.MockTransport(handler)


@pytest.mark.parametrize("url", [
    "http://localhost/admin", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/", "http://192.168.1.1/", "http://172.16.0.9/",
    "http://100.64.0.1/", "http://[::1]/", "http://0.0.0.0/", "http://internal.example/",
])
def test_internal_and_private_addresses_are_refused_before_any_request(monkeypatch, url):
    _resolve(monkeypatch, {"localhost": "127.0.0.1", "internal.example": "10.1.2.3"})
    calls = []
    with pytest.raises(safe_http.UnsafeUrl):
        safe_http.fetch(url, transport=_transport(lambda r: calls.append(r) or httpx.Response(200)))
    assert calls == [], "doğrulama başarısızsa hiçbir istek gönderilmez"


@pytest.mark.parametrize("url", ["ftp://example.com/a", "file:///etc/passwd", "javascript:alert(1)", "http://user:pw@example.com/", "https://example.com:8443/", "http://example.com:22/", "not a url", ""])
def test_only_plain_web_addresses_on_normal_ports(monkeypatch, url):
    _resolve(monkeypatch, {"example.com": PUBLIC})
    with pytest.raises(safe_http.UnsafeUrl):
        safe_http.fetch(url, transport=_transport(lambda r: httpx.Response(200)))


def test_a_name_resolving_to_a_mix_with_one_private_ip_is_refused(monkeypatch):
    monkeypatch.setattr(safe_http.socket, "getaddrinfo", lambda host, port, type=0, **kw: [(socket.AF_INET, 1, 6, "", (PUBLIC, port)), (socket.AF_INET, 1, 6, "", ("10.0.0.1", port))])
    with pytest.raises(safe_http.UnsafeUrl):
        safe_http.fetch("http://example.com/", transport=_transport(lambda r: httpx.Response(200)))


def test_the_connection_is_pinned_to_the_checked_ip_with_the_original_host(monkeypatch):
    _resolve(monkeypatch, {"shop.example": PUBLIC})
    seen = {}

    def handler(request):
        seen["url"], seen["host"], seen["sni"] = str(request.url), request.headers["host"], request.extensions.get("sni_hostname")
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, content=PAGE)

    out = safe_http.fetch("https://shop.example/p/1?x=2", transport=_transport(handler))
    assert seen["url"].startswith(f"https://{PUBLIC}/p/1?x=2") and seen["host"] == "shop.example" and seen["sni"] == "shop.example", "doğrulanan IP'ye bağlanır, sertifika özgün adla doğrulanır"
    assert out.status == 200 and out.url == "https://shop.example/p/1?x=2"


def test_redirects_are_followed_by_hand_and_each_hop_is_checked(monkeypatch):
    _resolve(monkeypatch, {"a.example": PUBLIC, "b.example": "93.184.216.35", "evil.example": "10.0.0.7"})

    def to_b(request):
        return httpx.Response(302, headers={"location": "https://b.example/final"}) if request.headers["host"] == "a.example" else httpx.Response(200, headers={"content-type": "text/html"}, content=b"ok")

    assert safe_http.fetch("https://a.example/", transport=_transport(to_b)).url == "https://b.example/final"
    with pytest.raises(safe_http.UnsafeUrl):  # yönlendirme iç adrese çıkarsa durur
        safe_http.fetch("https://a.example/", transport=_transport(lambda r: httpx.Response(302, headers={"location": "http://evil.example/secret"})))
    with pytest.raises(safe_http.UnsafeUrl):
        safe_http.fetch("https://a.example/", transport=_transport(lambda r: httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})))
    with pytest.raises(safe_http.UnsafeUrl, match="yönlendirme|redirects"):
        safe_http.fetch("https://a.example/", transport=_transport(lambda r: httpx.Response(302, headers={"location": "/loop"})))


def test_size_type_and_error_limits(monkeypatch):
    _resolve(monkeypatch, {"example.com": PUBLIC})
    big = httpx.Response(200, headers={"content-type": "text/html"}, content=b"x" * 5000)
    out = safe_http.fetch("http://example.com/", transport=_transport(lambda r: big), max_bytes=1000)
    assert len(out.body) == 1000 and out.truncated, "gövde boyutu sınırlıdır"
    for response in (httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF"), httpx.Response(200, headers={"content-type": "image/png"}, content=b"x"), httpx.Response(403), httpx.Response(404), httpx.Response(500)):
        with pytest.raises(safe_http.UnsafeUrl):
            safe_http.fetch("http://example.com/", transport=_transport(lambda r, resp=response: resp))

    def boom(request):
        raise httpx.ConnectTimeout("slow")

    with pytest.raises(safe_http.UnsafeUrl):
        safe_http.fetch("http://example.com/", transport=_transport(boom))


def test_no_credentials_are_sent(monkeypatch):
    _resolve(monkeypatch, {"example.com": PUBLIC})
    headers = {}
    safe_http.fetch("http://example.com/", transport=_transport(lambda r: headers.update(r.headers) or httpx.Response(200, headers={"content-type": "text/plain"}, content=b"hi")))
    assert not {"cookie", "authorization", "x-api-key"} & {k.lower() for k in headers}


def test_the_page_reader_extracts_product_facts_and_drops_scripts_and_chrome():
    out = page_reader.read(PAGE, "https://shop.example/p/1")
    assert out["title"] == "Insulated Tumbler"
    assert out["description"] == "Keeps drinks cold for 24 hours."
    assert out["product"] == {"name": "Insulated Tumbler 40 oz", "description": "Stainless steel tumbler", "brand": "ACME", "material": "Stainless steel", "price": "24.90 USD"}
    assert "Double wall, 40 oz capacity." in out["text"] and "Fits most cup holders" in out["text"]
    for noise in ("ignore previous instructions", "alert(", "Home Shop Cart", "Copyright", "color:red"):
        assert noise not in out["text"], noise


def test_the_page_reader_caps_text_and_survives_garbage():
    long_page = b"<html><body>" + b"<p>" + (b"word " * 5000) + b"</p></body></html>"
    out = page_reader.read(long_page, "u")
    assert len(out["text"]) <= page_reader.MAX_TEXT and out["truncated"]
    assert page_reader.read(b"\xff\xfe<<>>not html at all", "u")["text"] != ""
    assert page_reader.read(b"", "u") == {"url": "u", "title": "", "description": "", "product": {}, "text": "", "truncated": False}
    bad_ld = b'<script type="application/ld+json">{not json</script><p>still readable</p>'
    assert "still readable" in page_reader.read(bad_ld, "u")["text"]
