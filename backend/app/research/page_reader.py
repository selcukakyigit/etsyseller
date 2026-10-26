"""Bir web sayfasından ÜRÜN BİLGİSİ çıkarır (başlık, açıklama, yapılandırılmış ürün verisi, okunur metin). Saf işlev: ağ yok (okuma `core/safe_http.py`'de).

Sayfa içeriği GÜVENİLMEYEN VERİDİR: içinde "önceki talimatları yok say" gibi yazılar olabilir. Bu modül yalnızca veriyi çıkarır ve boyutunu sınırlar; modele verilirken veri olarak
işaretlenir (bkz. toolsets/links.py) ve içindeki hiçbir talimata uyulmaz. Okunan metin saklanmaz; yalnızca o istekte modele gider."""
import html
import json
import re
from html.parser import HTMLParser

MAX_TEXT = 5000
MAX_DESCRIPTION = 600
_SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "aside", "form", "template", "iframe", "button"}
_BLOCK = {"p", "div", "li", "br", "tr", "h1", "h2", "h3", "h4", "section", "article", "ul", "ol", "table"}
_PRODUCT_KEYS = ("name", "description", "brand", "material", "color", "size", "sku", "category", "model", "gtin")
_SPACES = re.compile(r"[ \t\r\f\v]+")


class _Reader(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.meta: dict[str, str] = {}
        self.jsonld: list[str] = []
        self.parts: list[str] = []
        self._skip = 0
        self._in_title = False
        self._in_jsonld = False
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key and a.get("content"):
                self.meta.setdefault(key, a["content"])
        elif tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._in_jsonld, self._buf = True, []
            return
        if tag in _SKIP:
            self._skip += 1
        elif tag in _BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag == "script" and self._in_jsonld:
            self.jsonld.append("".join(self._buf))
            self._in_jsonld = False
            return
        if tag in _SKIP and self._skip:
            self._skip -= 1
        elif tag in _BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_jsonld:
            self._buf.append(data)
        elif self._in_title:
            self.title += data
        elif not self._skip:
            self.parts.append(data)


def _clean(text: str) -> str:
    lines = (" ".join(_SPACES.sub(" ", line).split()) for line in html.unescape(text).split("\n"))
    out: list[str] = []
    for line in lines:
        if line and (not out or out[-1] != line):
            out.append(line)
    return "\n".join(out)


def _products(blocks: list[str]) -> dict:
    """JSON-LD'deki ilk Product (ya da ProductGroup): ad, açıklama, marka, malzeme, renk, ölçü, fiyat."""
    def walk(node):
        if isinstance(node, list):
            for item in node:
                yield from walk(item)
        elif isinstance(node, dict):
            yield node
            yield from walk(node.get("@graph") or [])

    for raw in blocks:
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        for node in walk(data):
            kind = node.get("@type")
            kinds = kind if isinstance(kind, list) else [kind]
            if any(k in ("Product", "ProductGroup") for k in kinds):
                out = {k: _text(node.get(k)) for k in _PRODUCT_KEYS if node.get(k)}
                offers = node.get("offers")
                offer = (offers[0] if isinstance(offers, list) and offers else offers) if offers else None
                if isinstance(offer, dict) and (offer.get("price") or offer.get("lowPrice")):
                    out["price"] = f"{offer.get('price') or offer.get('lowPrice')} {offer.get('priceCurrency') or ''}".strip()
                return {k: v[:MAX_DESCRIPTION] for k, v in out.items() if v}
    return {}


def _text(value) -> str:
    if isinstance(value, dict):
        value = value.get("name") or value.get("value") or ""
    if isinstance(value, list):
        value = ", ".join(_text(v) for v in value)
    return " ".join(html.unescape(str(value or "")).split())


def read(body: bytes, url: str) -> dict:
    """{url, title, description, product (yapılandırılmış ürün verisi), text (okunur metin, kısaltılmış), truncated}."""
    reader = _Reader()
    reader.feed(body.decode("utf-8", errors="replace"))
    title = _text(reader.meta.get("og:title") or reader.title)
    description = _text(reader.meta.get("og:description") or reader.meta.get("description"))
    text = _clean("".join(reader.parts))
    return {
        "url": url, "title": title[:200], "description": description[:MAX_DESCRIPTION], "product": _products(reader.jsonld),
        "text": text[:MAX_TEXT], "truncated": len(text) > MAX_TEXT,
    }
