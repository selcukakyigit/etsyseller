"""Kamera açısı ve kadraj seçeneklerinin görsel üretim talimatına çevrilmesi: TEK kaynak. Düzenleyici (kamera küpü, kadraj seçici) ve sohbet
asistanı yalnızca seçimi (anahtarı) gönderir, cümleleri burada kurulur; böylece ikisi aynı davranır ve cümle değişince tek yer değişir.

Kamera, sabit duran sahnenin/ürünün çevresinde hareket eder (ürün ya da nesneler tek başına döndürülmez; bkz. image_gen.CAMERA_DIRECTIVE_TPL).
Yönler SAHNENİN/ÜRÜNÜN kendi yönüdür (izleyicinin sağı/solu değil). Model "sağdan" sözünü iki türlü okuyabildiği için kameranın konumu ve kaç
derece döndüğü açıkça yazılır. Kadraj ölçülebilir ifade edilir (ürün kadrajın yüzde kaçını kaplar): "yakın/uzak" göreli kalırsa model,
orijinal zaten yakın ya da uzaksa ne yapacağını bilemez."""

AZIMUTHS = {
    "front": "kamera ürünün tam karşısında, ona dik bakar (0°)",
    "front_right": "kamera ürünün önünden, ürünün kendi SAĞ tarafına doğru yaklaşık 45° kaymış ve ürüne çapraz bakar",
    "right": "kamera ürünün kendi SAĞ tarafına 90° geçmiş, ona tam yandan bakar",
    "back_right": "kamera ürünün kendi SAĞ tarafından arkasına doğru yaklaşık 135° dönmüş, çapraz arkadan bakar",
    "back": "kamera ürünün tam arkasında (180°), arkadan bakar",
    "back_left": "kamera ürünün kendi SOL tarafından arkasına doğru yaklaşık 135° dönmüş, çapraz arkadan bakar",
    "left": "kamera ürünün kendi SOL tarafına 90° geçmiş, ona tam yandan bakar",
    "front_left": "kamera ürünün önünden, ürünün kendi SOL tarafına doğru yaklaşık 45° kaymış ve ürüne çapraz bakar",
}

ELEVATIONS = {
    "low": "kamera ürünün biraz altında (yaklaşık 25° aşağıdan), yukarı doğru bakar",
    "eye": "kamera ürünle aynı yükseklikte, yatay bakar",
    "high": "kamera ürünün üstünde (yaklaşık 30° yukarıdan), aşağı doğru bakar",
}

DISTANCES = {
    "close": "Yakın çekim: kamera ürüne yaklaşsın; ürün kadrajın yaklaşık %80–90'ını kaplasın, dokusu ve detayları net görünsün, arka plan hafifçe bulanık olsun (sığ alan derinliği).",
    "medium": "Orta plan: kamera ürüne orta mesafede olsun; ürün kadrajın yaklaşık %40–50'sini kaplasın, çevresindeki sahne de belirgin biçimde görünsün.",
    "wide": "Geniş plan: kamera geri çekilsin; ürün kadrajın yaklaşık %15–25'ini kaplasın, çevresindeki ortam/mekân ağırlıkta görünsün.",
}


def prompts(azimuth: str | None, elevation: str | None, distance: str | None) -> tuple[str | None, str | None, str | None]:
    """(kamera talimatı, kadraj talimatı, hata). Seçim verilmediyse ilgili talimat None. Açı ya da yükseklikten yalnızca biri verilirse
    öteki varsayılanı alır (karşıdan, göz hizası)."""
    camera = framing = None
    if azimuth or elevation:
        az, el = azimuth or "front", elevation or "eye"
        if az not in AZIMUTHS or el not in ELEVATIONS:
            return None, None, f"azimuth {'/'.join(AZIMUTHS)}; elevation {'/'.join(ELEVATIONS)} olmalı."
        camera = f'Kamera açısı: {AZIMUTHS[az]}; {ELEVATIONS[el]}. ("Sağ/sol" ürünün kendi yönüdür, izleyicinin değil.)'
    if distance:
        if distance not in DISTANCES:
            return None, None, f"distance {'/'.join(DISTANCES)} olmalı."
        framing = DISTANCES[distance]
    return camera, framing, None
