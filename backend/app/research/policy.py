"""Araştırma politikası: yenileme süreleri (TTL), bütçe ve sınırlar. Değerler Yönetim > Araştırma'dan değişir (app_settings); burada yalnızca
varsayılanlar ve okuma vardır. TTL değerleri başlangıç varsayımıdır: gerçek değişim hızı ve maliyete göre ayarlanır."""
import datetime as dt
import random
from typing import Any

from app.core import app_settings

DEFAULTS: dict[str, Any] = {
    "research_enabled": True,
    "research_default_market": "US",
    "research_default_language": "en",
    "research_auto_refresh": True,  # zamanlanmış otomatik yenileme (haftalık hacim yenileme, etiket ısındırma, aylık trend); kapalıysa yalnızca yönetici elle yeniler
    "research_ttl_volume_days": 30,  # hacim/CPC ölçümü (Google Ads aylık veridir; daha sık sormak aynı sayıyı tekrar almaktır)
    "research_ttl_suggest_days": 60,  # tohum kelime önerileri (adaylar uzun yaşar; metrikleri ayrı yenilenir)
    "research_ttl_season_days": 90,  # mevsimsellik profili (yıllık şekil çok yavaş değişir)
    "research_season_min_volume": 100,  # ölçülmüş aylık araması bunun altındaki kelime için mevsimsellik çekilmez (Google Trends çok az aramada desen vermez; boşuna ücret)
    "research_ttl_trend_days": 30,  # Google ilgi endeksi (yıllık değişim) ölçümü
    "research_ttl_jitter": 0.15,  # TTL'e ±%15 sapma: aynı gün toplanan binlerce kelime aynı gün dolmasın
    "research_monthly_budget_usd": 30.0,  # sistem geneli aylık tavan; aşılınca eski veriyle devam edilir
    # İş türü başına aylık tavan (sistem tavanının içinde): bir tür (ör. mevsimsellik) bütçenin tamamını yemesin. 0 = bu tür için ayrı tavan yok.
    "research_budget_volume_usd": 14.0,
    "research_budget_suggest_usd": 10.0,
    "research_budget_season_usd": 5.0,
    "research_budget_trend_usd": 1.0,
    "research_low_balance_usd": 5.0,  # sağlayıcı bakiyesi bunun altına inince yönetim panelinde uyarı çıkar
    "research_shop_daily_jobs": 40,  # bir mağazanın günde en fazla kaç yeni iş açabileceği (listing havuzu işleri dahil)
    "research_shop_monthly_searches": 150,  # bir mağazanın ayda en fazla kaç YENİ kelime araştırması (Keşfet); havuzda hazır olan aramalar sayılmaz
    "research_shop_daily_searches": 40,  # aylık hakkın tek günde tüketilmesini önleyen günlük üst sınır
    "research_refresh_per_day": 2000,  # her yenileme turunda (haftalık otomatik iş ya da yönetici düğmesi) en fazla kelime; ücret istek başınadır, bu yüzden sınır düşük maliyetlidir
    "research_active_days": 90,  # bu kadar gündür istenmeyen kelime otomatik yenilenmez
    "research_crowd_window_days": 28,  # kalabalık sayacı: son kaç günde önerilen mağazalar sayılır
    "research_crowd_full_shops": 25,  # bu kadar farklı mağazaya önerilmiş ifade "tamamen kalabalık" sayılır (özgünlük puanı 0)
}
EDITABLE = tuple(DEFAULTS)


def get(name: str) -> Any:
    return app_settings.get(name, DEFAULTS[name])


def snapshot() -> dict[str, Any]:
    return {k: get(k) for k in EDITABLE}


def expires_at(now: dt.datetime, days: float) -> dt.datetime:
    jitter = float(get("research_ttl_jitter"))
    return now + dt.timedelta(days=days * (1 + random.uniform(-jitter, jitter)))
