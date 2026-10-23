"""Talep bantları: kullanıcıya ham arama sayısı değil, düşük/orta/yüksek bant gösterilir (ham sayılar yalnızca yönetimde). Eşikler başlangıç varsayımıdır
(Google aylık arama); gerçek dağılıma göre ayarlanır. Tek yerde durur: puanlama notu, kelime havuzu arayüzü ve asistan aynı sınırları kullanır."""

LOW_BELOW = 100
HIGH_FROM = 1000


def demand_band(volume: int | None) -> str | None:
    """low | medium | high (hacim bilinmiyorsa None)."""
    if volume is None:
        return None
    return "low" if volume < LOW_BELOW else "high" if volume >= HIGH_FROM else "medium"
