"""E-posta şablonlarını (Jinja2) HTML + düz metin olarak üretir. Kullanıcıdan gelen içerik otomatik olarak
HTML-escape edilir (autoescape); şablonlara asla güvenilmeyen metni `|safe` ile vermeyin."""
import html
import re
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import settings

ASSETS = {
    "wordmark": "{site}/brand/wordmark-dark.png",
}

_env = Environment(
    loader=FileSystemLoader(str(Path(__file__).parent / "templates")),
    autoescape=select_autoescape(["html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


def _globals() -> dict:
    site = settings.frontend_url.rstrip("/")
    return {
        "brand": "Ulagg",
        "site_url": site,
        "wordmark_url": ASSETS["wordmark"].format(site=site),
        "company": {
            "name": "CATCHOPS YAZILIM SAN. VE TİC. LTD. ŞTİ.",
            "address": "Ünsal Mah. 5 Temmuz Kurtuluş Cad. Rima Apt. Sitesi No:226/B Kepez/ANTALYA",
        },
        "etsy_disclaimer": "The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.",
    }


def html_to_text(markup: str) -> str:
    """Düz metin sürümü: bağlantılar `metin (adres)` olur, bloklar satır sonuna çevrilir."""
    text = re.sub(r"(?is)<(script|style|head).*?</\1>", "", markup)
    text = re.sub(r'(?is)<div style="display:none.*?</div>', "", text)  # gizli önizleme (preheader) metne girmez
    text = re.sub(r"(?is)<a\s[^>]*>\s*<img[^>]*>\s*</a>", "", text)  # yalnızca logo olan bağlantı
    text = re.sub(r'(?is)<a\s[^>]*href="([^"]+)"[^>]*>(.*?)</a>', lambda m: f"{re.sub('<[^>]+>', '', m.group(2)).strip()} ({m.group(1)})", text)
    text = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|h[1-6]|li)>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(line.strip() for line in text.splitlines())).strip()


def render(template: str, **context) -> tuple[str, str]:
    """(html, text) döndürür. `template` örn. "contact_notification.html"."""
    markup = _env.get_template(template).render(**_globals(), **context)
    return markup, html_to_text(markup)
