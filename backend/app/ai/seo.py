import json
import re

from app.ai import catalog, quality
from app.ai.catalog import ResolvedModel
from app.ai.client import get_anthropic_client, get_openai_client
from app.billing import metering

SYSTEM_PROMPT = """Sen bir Etsy SEO uzmanısın. Sana bir listing'in mevcut başlığı, etiketleri ve \
açıklaması verilecek. Görevin, Etsy'nin 2026 "Context Update" sonrası arama algoritmasına göre optimize \
edilmiş yeni bir başlık, 13 etiket ve açıklama önerisi üretmek.

Etsy başlık kuralları (Etsy'nin Ağustos 2025 resmî rehberi; arama artık anlamı büyük dil modelleriyle anlıyor, \
anahtar kelime doldurma cezalandırılıyor):
- Başlık KISA ve NET: 15 kelimeden az. Önce ürünün NE olduğu (ana anahtar öbeği ilk 40 karakterde), ardından \
renk, boyut, malzeme, stil gibi NESNEL tanımlar. Ana arama öbeği listing'in mevcut başlığından ve satış getiren \
etiketlerinden gelsin (ör. mevcut başlıkta "metal garage sign" varsa onu koru); kısaltırken ana öbeği atma
- Listing'de birden çok ölçü seçeneği varsa (verilen "variations") başlığa ÖLÇÜ/BOYUT YAZMA (inç, cm, "24 Inch" gibi); \
ölçüler varyasyonlarda ve açıklamada durur. Ürün tek, sabit ölçüdeyse ve ölçü alıcının aradığı bir özellikse (ör. "11 oz \
mug", "8x10 print") listing'de yazan ölçüyü başlıkta tutabilirsin. Listing'de birden çok \
renk seçeneği varsa (verilen "variations") başlığa tek bir renk de yazma. Listing'de olmayan ölçü, renk ya da malzeme ASLA \
uydurma (başlıkta da açıklamada da). "Mevcut listing verisi"ndeki başlık daha önceki bir yapay zekâ önerisi olabilir; \
içindeki ölçü/renk bilgisine güvenme, "variations"a bak
- Açıklamada seçenekleri (renk, boyut) sayıyorsan "variations"taki seçeneklerin TAMAMINI yaz; eksik ya da fazla olmasın. \
Listing'e yeni bir seçenek eklendiyse (ör. yeni renk) açıklamadaki listeye de ekle
- Başlıkta OLMAYACAKLAR: hediye/alıcı ifadeleri ("gift for dad", "for her"), öznel sözcükler ("beautiful", "perfect", \
"best"), kargo/indirim bilgisi, aynı kelimenin tekrarı, virgülle sıralanmış kelime listesi
- Başlıktan çıkardığın hediye/alıcı/kullanım yeri/vesile ifadelerini SİLME: etiketlere ve açıklamaya taşı (Etsy bunları \
oralardan da okur)

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
  * "Etsy'de aylık N arama" ve "dönüşüm" Etsy Marketplace Insights verisidir (gerçek Etsy aramaları). Dönüşümü "çok düşük" olan geniş aramalar (ör. "metal wall art") çok aranır ama alıcı orada sadece gezinir: ana arama öbeği yapma, en fazla bir etikette kullan. Dönüşümü orta/yüksek, makul aranan ve ürüne birebir uyan uzun kuyruklu aramalar başlığın ana öbeği ve etiketler için en değerli adaylardır. Arama sonucu (rakip listing) sayısı aramaya göre azsa fırsattır; arama hacmi hızla düşüyorsa (değişim çok negatif) ana öbek yapma
  * "ARAŞTIRMA" işaretli kelimeler kullanıcının Etsy'de araştırdığı, bu ürünle ilgili aramalardır; ürüne gerçekten uyuyorsa değerlendir
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


def _generate_with_openai(model: ResolvedModel, user_content: str) -> dict:
    completion = get_openai_client().chat.completions.create(
        model=model.model_id,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    )
    metering.record_response("seo", model, completion)
    return json.loads(completion.choices[0].message.content or "{}")


def _generate_with_anthropic(model: ResolvedModel, user_content: str) -> dict:
    message = get_anthropic_client().messages.create(
        model=model.model_id,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )
    metering.record_response("seo", model, message)
    text = "".join(block.text for block in message.content if block.type == "text")
    return _extract_json(text or "{}")


_CONVERSION_TR = {"very_low": "çok düşük", "low": "düşük", "medium": "orta", "high": "yüksek", "very_high": "çok yüksek"}


def _format_keyword_pool(pool: list[dict]) -> str:
    lines = []
    for item in pool:
        if item.get("source") == "own":
            info = f"senin benzer listing'lerinde kullanılıyor, bu listing'lerin son 180 günde toplam {item.get('units', 0)} satışı var"
        elif item.get("source") == "etsy":
            info = (
                "ETSY VERİSİ: bu listing'e gerçekten bu aramayla gelinmiş "
                f"(görüntülenme {item.get('etsy_views') or 0}, tıklama {item.get('etsy_clicks') or 0}, sipariş {item.get('etsy_orders') or 0}) — yüksek öncelik"
            )
        elif item.get("source") == "research":
            info = "ARAŞTIRMA: kullanıcının Etsy kelime araştırmasından, bu ürünle ilgili"
        else:
            info = f"rakip kullanım: {item['score']}/{item['sample_size']}"
        if item.get("etsy_searches"):
            info += f", Etsy'de aylık {item['etsy_searches']} arama"
            if item.get("etsy_trend_pct") is not None:
                info += f" (değişim %{item['etsy_trend_pct']:+d})"
            if item.get("etsy_results"):
                info += f", {item['etsy_results']} arama sonucu"
            if item.get("etsy_conversion"):
                info += f", dönüşüm: {_CONVERSION_TR.get(item['etsy_conversion'], item['etsy_conversion'])}"
            if item.get("etsy_competition"):
                info += f" (rekabet: {item['etsy_competition']})"
        if item.get("google_score") is not None:
            info += f", google ilgisi: {item['google_score']}/100"
        lines.append(f'- "{item["tag"]}" [{info}]')
    return "\n".join(lines)


MAX_RETRIES = 2  # kalite/benzersizlik ihlalinde modele geri bildirimle en fazla bu kadar yeniden dene


def _call(user_content: str) -> dict:
    """Her deneme ayrı bir AI çağrısıdır ve ayrı ölçülür. Model katalogdaki "seo" görevinden gelir."""
    model = catalog.resolve_ready("seo")
    if model.provider == "anthropic":
        return _generate_with_anthropic(model, user_content)
    return _generate_with_openai(model, user_content)


def _others_block(title: str, tags: list[str], others: list[dict]) -> str:
    ctx = quality.similar_context(title, tags, others)
    if not ctx:
        return ""
    lines = "\n".join(f'- "{o["title"]}" | etiketler: {", ".join(o["tags"])}' for o in ctx)
    return (
        "\n\nMağazadaki benzer listing'ler. Bunlarla AYNI başlık kalıbını, aynı etiketleri (en fazla 5 ortak etiket) ve aynı açılış "
        "paragrafını KULLANMA; bu ürüne özgü, farklı uzun kuyruklu anahtar kelimeleri hedefle ki mağaza kendi listing'leriyle "
        "rekabet etmesin:\n" + lines
    )


def generate_seo_suggestion(
    listing: dict, keyword_pool: list[dict] | None = None, others: list[dict] | None = None, diagnosis_brief: str = "",
    variations: dict[str, list[str]] | None = None, fact_source: dict | None = None,
) -> dict:
    """`others`: mağazanın diğer listing'leri (başlık/etiket/açıklama). Verilirse öneri hem biçim kurallarına hem de
    "diğer listing'lerin kopyası olmama" denetimine tabi tutulur; ihlalde model geri bildirimle yeniden denenir."""
    others = others or []
    listing_payload = {
        "title": listing.get("title", ""),
        "tags": listing.get("tags", []),
        "description": listing.get("description", ""),
        "materials": listing.get("materials", []),
        "variations": variations or {},
    }
    # Uydurma denetimi için kaynak: mevcut metin, malzemeler ve varyasyon seçenekleri
    # Kaynak, formdaki taslak değil listing'in Etsy'deki hâlidir (`fact_source`): taslak bir önceki önerinin hatasını
    # taşıyabilir ve kendi uydurmasını "kaynakta var" saydırırdı.
    src = fact_source or listing_payload
    source_text = "\n".join([
        str(src.get("title", "")), str(src.get("description", "")), " ".join(map(str, src.get("materials") or [])),
        " ".join(v for vals in (variations or {}).values() for v in vals),
    ])

    user_content = f"Mevcut listing verisi:\n{json.dumps(listing_payload, ensure_ascii=False, indent=2)}"
    if keyword_pool:
        user_content += f"\n\nKullanılabilir anahtar kelime havuzu:\n{_format_keyword_pool(keyword_pool)}"
    user_content += _others_block(listing_payload["title"], listing_payload["tags"], others)
    if diagnosis_brief:
        user_content += f"\n\n{diagnosis_brief}\nGerekçede (rationale) bu teşhise göre neyi neden değiştirdiğini açıkla."

    suggestion = _call(user_content)
    problems: list[str] = []
    for attempt in range(MAX_RETRIES + 1):
        tags = quality.fix_long_tags(quality.clean_tags(suggestion.get("tags", [])))
        suggestion["tags"] = tags
        # Ölçü/renk temizliği denetimden önce: yeniden deneme, son hâli görsün (kısalan başlık benzerliği artırabilir)
        suggestion["title"] = quality.clean_title(str(suggestion.get("title", "")), variations or {})
        problems = quality.all_problems(
            suggestion["title"], tags, str(suggestion.get("description", "")), others, source_text, quality.size_options(variations or {}),
        )
        problems += quality.fact_problems(suggestion["title"], str(suggestion.get("description", "")), source_text, variations or {})
        if not problems or attempt == MAX_RETRIES:
            break
        feedback = "\n".join(f"- {p}" for p in problems)
        suggestion = _call(
            user_content
            + "\n\nÖnceki denemende şu sorunlar vardı; HEPSİNİ düzelt (sabit açıklama bölümlerini yine olduğu gibi koru):\n"
            + feedback
            + "\n\nÖnceki cevabın:\n"
            + json.dumps(suggestion, ensure_ascii=False)
        )

    if len(suggestion.get("tags", [])) != 13:
        raise ValueError(f"Beklenen 13 etiket, alınan: {len(suggestion.get('tags', []))}")

    # Malzeme: parantez Etsy'de kabul edilmiyor, en fazla 13 adet.
    suggestion["materials"] = [
        re.sub(r"[()]", "", str(m)).strip()[:45] for m in (suggestion.get("materials") or []) if str(m).strip()
    ][:13]
    # Denemelerden sonra hâlâ kalanlar kullanıcıya gösterilir. Diğer listing'lerle çakışma ayrı döner: iki listing'in
    # ortak durumudur ve aynı nişteki ürünlerde kaçınılmaz olabilir; arayüz onu "hata" değil bilgi olarak gösterir.
    description_part = quality.strip_common_paragraphs(str(suggestion.get("description", "")), others)
    suggestion["conflicts"] = quality.conflicts(suggestion["title"], suggestion["tags"], description_part, others)
    suggestion["warnings"] = [p for p in problems if p not in quality.uniqueness_problems(suggestion["title"], suggestion["tags"], description_part, others)]
    return suggestion
