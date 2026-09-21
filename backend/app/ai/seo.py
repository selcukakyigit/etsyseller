import json
import re

from app.ai.client import get_anthropic_client, get_openai_client
from app.core.config import settings

SYSTEM_PROMPT = """Sen bir Etsy SEO uzmanısın. Sana bir listing'in mevcut başlığı, etiketleri ve \
açıklaması verilecek. Görevin, Etsy'nin 2026 "Context Update" sonrası arama algoritmasına göre optimize \
edilmiş yeni bir başlık, 13 etiket ve açıklama önerisi üretmek.

Etsy 2026 başlık kuralları (önemli, eski keyword-stuffing yaklaşımı artık cezalandırılıyor):
- Etsy artık başlığı NLP ile bütün bağlam olarak değerlendiriyor, tek tek kelime eşleşmesine bakmıyor — \
virgülle ayrılmış keyword listesi gibi görünen başlıklar tespit edilip sıralamada geriye düşürülüyor
- İlk 40 karakter en kritik kısım (mobil/masaüstü sonuçlarında başlık orada kesiliyor) — en güçlü, en çok \
aranan öbek başta olmalı
- Yapı: doğal okunan 2-3 anlamlı öbek — [ana ürün + en güçlü anahtar kelime öbeği] | [ikincil özellik/varyant] \
| [kullanım amacı/hediye/alıcı öbeği] — virgülle ayrılmış tekil kelime listesi DEĞİL
- Tek başına geniş kelime hedefleme (ör. sadece "Kolye"), bunun yerine 3-5 kelimelik spesifik uzun kuyruk öbekler kullan
- Karakter sınırı 140 ama "sweet spot" 80-120 arası — okunabilirlik için sona kadar zorlama

Diğer kurallar:
- tags: tam olarak 13 adet, her biri en fazla 20 karakter, çoğu çok kelimeli uzun kuyruk (long-tail) ifadeler \
olsun, başlıkla ve birbiriyle gereksiz tekrar etmesin, tekil/çoğul ve eş anlamlı varyasyonlarla kapsamı genişlet
- description: SADECE ürünü tanıtan pazarlama kısmını SEO için yeniden yaz/genişlet (ilk 160 karakter en güçlü \
anahtar kelimeleri ve değer önerisini içersin, devamında ürün detayları/kullanım senaryoları/malzeme-boyut bilgisi). \
Açıklamanın sonundaki sabit/standart bölümleri (kargo-teslimat süreleri, garanti/iade politikası, iletişim bilgisi, \
telif/yasal uyarı, özel boyut talebi gibi ürüne özel olmayan, mağaza genelinde tekrar eden kısımlar) SEO açısından \
optimize etmeye ÇALIŞMA — bunları OLDUĞU GİBİ, kısaltmadan, sembollerini (☛ ➲ ✔ ツ vb.) ve formatını koruyarak \
açıklamanın sonuna aynen ekle. Bu sabit bölümleri asla silme, kısaltma veya parafraze etme.
- Orijinal dile (Türkçe/İngilizce vb.) sadık kal, ürünün gerçek özelliklerini uydurma, sadece verilen \
bilgiyi yeniden düzenle ve genişlet
- Eğer sana bir "kullanılabilir anahtar kelime havuzu" verilirse, her kelimenin yanındaki bilgiyi bir rehber \
olarak kullanarak uygun olanları etiketlere/başlığa doğal şekilde dahil et:
  * "kendi kanıtlanmış kazanan" etiketli kelimeler senin en iyi performanslı listing'lerinden geliyor — bunlara öncelik ver
  * "rakip kullanım: X/N" yüksek olanlar (ör. N'e yakın) çok doygun/rekabetçi olabilir — düşük-orta olanlar daha \
az kullanılmış, öne çıkma şansı daha yüksek olabilir
  * "google ilgisi: X/100" varsa, bu Etsy içi değil Google'daki genel arama ilgisidir — yüksek google ilgisi + \
düşük rakip kullanımı bir fırsat sinyali olabilir
  * Yine de havuzdaki her kelimeyi zorla kullanma ve bu sayılara körü körüne bağlı kalma — asıl öncelik her zaman \
kelimenin ürüne gerçekten uyup uymadığı, uydurma/alakasız kelime ekleme
- materials: ürünün gerçekten yapıldığı malzemeler (en fazla 13, her biri en fazla 45 karakter, parantez ve özel karakter yok). Verilen mevcut malzeme listesini ve açıklamadan açıkça anlaşılan malzemeleri düzenle; verilmeyen bir malzemeyi UYDURMA. Bilgi yoksa mevcut listeyi aynen döndür.
- rationale: yaptığın değişikliklerin SEO gerekçesini 2-3 cümleyle Türkçe özetle

Yanıtını SADECE şu JSON şemasıyla ver, başka metin ekleme:
{"title": "...", "tags": ["...", ... 13 adet], "description": "...", "materials": ["...", ...], "rationale": "..."}
"""


def _extract_json(text: str) -> dict:
    """Anthropic doesn't have an OpenAI-style forced JSON mode, so despite the
    prompt it can wrap the reply in a ```json fence — strip that before parsing."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(match.group(0) if match else text)


def _generate_with_openai(user_content: str) -> dict:
    completion = get_openai_client().chat.completions.create(
        model=settings.openai_model,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    )
    return json.loads(completion.choices[0].message.content or "{}")


def _generate_with_anthropic(user_content: str) -> dict:
    message = get_anthropic_client().messages.create(
        model=settings.anthropic_model,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )
    text = "".join(block.text for block in message.content if block.type == "text")
    return _extract_json(text or "{}")


def _format_keyword_pool(pool: list[dict]) -> str:
    lines = []
    for item in pool:
        if item.get("source") == "own":
            info = "kendi kanıtlanmış kazanan"
        else:
            info = f"rakip kullanım: {item['score']}/{item['sample_size']}"
        if item.get("google_score") is not None:
            info += f", google ilgisi: {item['google_score']}/100"
        lines.append(f'- "{item["tag"]}" [{info}]')
    return "\n".join(lines)


def generate_seo_suggestion(listing: dict, keyword_pool: list[dict] | None = None) -> dict:
    listing_payload = {
        "title": listing.get("title", ""),
        "tags": listing.get("tags", []),
        "description": listing.get("description", ""),
        "materials": listing.get("materials", []),
    }

    user_content = f"Mevcut listing verisi:\n{json.dumps(listing_payload, ensure_ascii=False, indent=2)}"
    if keyword_pool:
        user_content += f"\n\nKullanılabilir anahtar kelime havuzu:\n{_format_keyword_pool(keyword_pool)}"

    if settings.ai_provider == "anthropic":
        suggestion = _generate_with_anthropic(user_content)
    else:
        suggestion = _generate_with_openai(user_content)

    if len(suggestion.get("tags", [])) != 13:
        raise ValueError(f"Beklenen 13 etiket, alınan: {len(suggestion.get('tags', []))}")

    # Malzeme: parantez Etsy'de kabul edilmiyor, en fazla 13 adet.
    suggestion["materials"] = [
        re.sub(r"[()]", "", str(m)).strip()[:45] for m in (suggestion.get("materials") or []) if str(m).strip()
    ][:13]
    return suggestion
