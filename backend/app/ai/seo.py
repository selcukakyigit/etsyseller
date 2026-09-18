import json

from app.ai.client import get_client
from app.core.config import settings

SYSTEM_PROMPT = """Sen bir Etsy SEO uzmanısın. Sana bir listing'in mevcut başlığı, etiketleri ve \
açıklaması verilecek. Görevin, Etsy'nin arama algoritmasına (Etsy Search / CASSANDRA benzeri sinyaller: \
başlıktaki anahtar kelime eşleşmesi, etiket-başlık tutarlılığı, dönüşüm oranı) göre optimize edilmiş yeni \
bir başlık, 13 etiket ve açıklama önerisi üretmek.

Kurallar:
- title: en fazla 140 karakter, en önemli anahtar kelimeler baştan başlasın, doğal okunsun (kelime yığını olmasın)
- tags: tam olarak 13 adet, her biri en fazla 20 karakter, çoğu çok kelimeli uzun kuyruk (long-tail) ifadeler \
olsun, başlıkla ve birbiriyle gereksiz tekrar etmesin, tekil/çoğul ve eş anlamlı varyasyonlarla kapsamı genişlet
- description: ilk 160 karakter en güçlü anahtar kelimeleri ve değer önerisini içersin (Etsy ve Google \
arama sonuçlarında görünen kısım budur), devamında ürün detayları, kullanım senaryoları, malzeme/boyut \
bilgisi ve SSS tarzı bilgiler olsun
- Orijinal dile (Türkçe/İngilizce vb.) sadık kal, ürünün gerçek özelliklerini uydurma, sadece verilen \
bilgiyi yeniden düzenle ve genişlet
- Eğer sana bir "kullanılabilir anahtar kelime havuzu" verilirse, uygun olanları etiketlere/başlığa \
doğal şekilde dahil et — havuzdaki her kelimeyi zorla kullanma, sadece ürüne gerçekten uyanları seç
- rationale: yaptığın değişikliklerin SEO gerekçesini 2-3 cümleyle Türkçe özetle

Yanıtını SADECE şu JSON şemasıyla ver, başka metin ekleme:
{"title": "...", "tags": ["...", ... 13 adet], "description": "...", "rationale": "..."}
"""


def generate_seo_suggestion(listing: dict, keyword_pool: list[str] | None = None) -> dict:
    listing_payload = {
        "title": listing.get("title", ""),
        "tags": listing.get("tags", []),
        "description": listing.get("description", ""),
    }

    user_content = f"Mevcut listing verisi:\n{json.dumps(listing_payload, ensure_ascii=False, indent=2)}"
    if keyword_pool:
        user_content += f"\n\nKullanılabilir anahtar kelime havuzu:\n{json.dumps(keyword_pool, ensure_ascii=False)}"

    completion = get_client().chat.completions.create(
        model=settings.openai_model,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    )

    text = completion.choices[0].message.content or "{}"
    suggestion = json.loads(text)

    if len(suggestion.get("tags", [])) != 13:
        raise ValueError(f"Beklenen 13 etiket, alınan: {len(suggestion.get('tags', []))}")

    return suggestion
