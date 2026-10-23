import json
import re

from app.ai import audit, catalog, layout, quality, standard
from app.ai.catalog import ResolvedModel
from app.ai.client import get_anthropic_client, get_openai_client, openai_limits
from app.billing import metering
from app.keywords import scoring
from app.listings import fields

SYSTEM_PROMPT = f"""Sen bir Etsy SEO uzmanısın. Sana bir listing'in mevcut başlığı, etiketleri ve açıklaması verilecek. Görevin, Etsy'nin Ağustos 2025 başlık rehberine ve alıcı niyetini anlayan aramaya uygun; aynı zamanda yapay zekâ alışveriş asistanlarının rahat okuyup önerebileceği net, olgusal ve tutarlı bir başlık, {standard.TAG_COUNT} etiket ve açıklama önerisi üretmek.

STANDART (başlık, etiket, açıklama):
{standard.prompt_block()}

Bu listing'e özgü ek kurallar:
- Ana arama öbeği listing'in mevcut başlığından ve satış getiren etiketlerinden gelsin (ör. mevcut başlıkta "metal garage sign" varsa onu koru); kısaltırken ana öbeği atma
- "Mevcut listing verisi"ndeki başlık daha önceki bir yapay zekâ önerisi olabilir; içindeki ölçü/renk bilgisine güvenme, "variations"a bak
- Açıklamada seçenekleri (renk, boyut) sayıyorsan "variations"taki seçeneklerin TAMAMINI yaz; eksik ya da fazla olmasın. Listing'e yeni bir seçenek eklendiyse açıklamadaki listeye de ekle
- Açıklamanın sonundaki sabit/standart bölümleri (kargo-teslimat süreleri, garanti/iade politikası, iletişim bilgisi, telif/yasal uyarı, özel boyut talebi gibi mağaza genelinde tekrar eden kısımlar) OLDUĞU GİBİ, kısaltmadan, sembollerini (☛ ➲ ✔ ツ vb.) ve formatını koruyarak açıklamanın sonuna aynen ekle; asla silme, kısaltma veya parafraze etme
- Açıklamadaki kısa olgu maddelerini (malzeme, ölçü, seçenekler) yalnızca verilen veriden yaz. Kurulum/montaj, donanım, garanti, su/hava dayanımı gibi verilmeyen bilgiyi ASLA ekleme; bir madde için veri yoksa o maddeyi hiç yazma
- Orijinal dile (Türkçe/İngilizce vb.) sadık kal, ürünün gerçek özelliklerini uydurma, sadece verilen bilgiyi yeniden düzenle ve genişlet
- Sana "Kullanılabilir anahtar kelime havuzu" verilirse: ifadeler ROLLERE ayrılmış ve puana göre sıralıdır; her birinin yanında verinin durumu yazar.
  * ÖNCE alaka: ürüne gerçekten uymayan ifadeyi puanı ne olursa olsun kullanma. Sonra rollere göre seç: başlık ana öbeği ve etiketlerde ana ürün ifadesi, orta kapsam, uzun kuyruk, vesile/alıcı ve stil/malzeme etiketlerinden dengeli bir karışım kur; 13 etiketin hepsi aynı geniş ifadenin varyasyonu olmasın
  * veri "ölçülü": aylık arama ve sonuç sayısı gerçek; ARAMA ÷ SONUÇ oranı yüksek ifadeler fırsattır. "kısmi": sonuç sayısı, dönüşüm ya da senin satışın biliniyor. "tahmin": talep BİLİNMİYOR, yalnızca kelime yapısı ya da rakip kullanımı var; bunları körü körüne güvenme. "kalabalık": birçok farklı mağazaya önerilmiş ifadeyi ana öbek yapma, en fazla bir etikette kullan; ürüne özgü, daha az önerilmiş uzun kuyruklu alternatifleri öne al (herkes aynı kelimeyle yarışmasın). "Google verisi hazırlanıyor": talep SIFIR değil, henüz bilinmiyor. "Google'da talep: düşük/orta/yüksek" yardımcı bir göstergedir, Etsy hacmi DEĞİLDİR: tek başına ana öbek seçme gerekçesi yapma
  * Yüz binlerce sonuçlu geniş aramalar (ör. "metal wall art") ve dönüşümü düşük olanlar ana öbek olmasın, en fazla bir etikette geçsin; kanıtlanmış satışı olan ("senin benzer listing'lerinde N satış", "bu listing'e N siparişle gelmiş") ifadeleri koru
  * Arama hacmi hızla düşen (değişim çok negatif) ifadeyi ana öbek yapma; havuzdaki her kelimeyi zorla kullanma, uydurma/alakasız kelime ekleme
- materials: ürünün gerçekten yapıldığı malzemeler (en fazla 13, her biri en fazla 45 karakter, parantez ve özel karakter yok). Verilen mevcut malzeme listesini ve açıklamadan açıkça anlaşılan malzemeleri düzenle; verilmeyen bir malzemeyi UYDURMA. Bilgi yoksa mevcut listeyi aynen döndür.
- rationale: yaptığın değişikliklerin gerekçesini 2-3 cümleyle Türkçe özetle

Yanıtını SADECE şu JSON şemasıyla ver, başka metin ekleme:
{{"title": "...", "tags": ["...", ... {standard.TAG_COUNT} adet], "description": "...", "materials": ["...", ...], "rationale": "..."}}
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
        **openai_limits(model.model_id),
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


def _fit_tags(tags: list[str], pool: list[dict], title: str) -> list[str]:
    """Etsy 20 karakteri aşan etiketi reddeder. Kısaltılamayan etiketi havuzdaki en yüksek puanlı, sığan ve kullanılmayan adayla değiştirir;
    havuz yetmezse kelime atarak (tek kelimeye kadar) ya da kesilerek sığdırır. Böylece öneri yayınlanamaz etiketle çıkmaz."""
    limit = standard.TAG_MAX_LEN
    out = [t for t in tags if len(t) <= limit]
    if len(out) == len(tags):
        return tags
    used = {t.lower() for t in out}
    spare = [p["tag"] for p in scoring.rank(pool, title) if len(p["tag"]) <= limit and p["tag"].lower() not in used]
    for t in tags:
        if len(t) <= limit:
            continue
        if spare:
            pick = spare.pop(0)
        else:
            words = t.split()
            while len(words) > 1 and len(" ".join(words)) > limit:
                words.pop()
            pick = " ".join(words)[:limit].strip()
        if pick and pick.lower() not in {x.lower() for x in out}:
            out.append(pick)
    return out


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
        user_content += f"\n\nKullanılabilir anahtar kelime havuzu:\n{scoring.brief(keyword_pool, listing_payload["title"])}"
    user_content += _others_block(listing_payload["title"], listing_payload["tags"], others)
    if diagnosis_brief:
        user_content += f"\n\n{diagnosis_brief}\nGerekçede (rationale) bu teşhise göre neyi neden değiştirdiğini açıkla."

    suggestion = _call(user_content)
    problems: list[str] = []
    for attempt in range(MAX_RETRIES + 1):
        tags = quality.fix_long_tags(quality.clean_tags(suggestion.get("tags", [])))
        suggestion["tags"] = tags
        # Ölçü/renk temizliği denetimden önce: yeniden deneme, son hâli görsün (kısalan başlık benzerliği artırabilir)
        suggestion["description"] = layout.normalize(str(suggestion.get("description", "")))
        suggestion["title"] = quality.clean_title(str(suggestion.get("title", "")), variations or {})
        problems = audit.generation_problems(suggestion["title"], tags, str(suggestion.get("description", "")), others, source_text, variations or {}, listing.get("listing_type") == "download", bool(listing.get("is_personalizable")))
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

    suggestion["tags"] = _fit_tags(suggestion.get("tags", []), keyword_pool or [], str(suggestion.get("title", "")))
    description = str(suggestion.get("description", ""))
    suggestion["description"] = quality.strip_claims(description, source_text)  # model denemelerde bırakmadığı uydurma iddia koddan silinir
    if suggestion["tags"] != tags or suggestion["description"] != description:  # düzeltme sonrası uyarılar yeniden hesaplanır
        problems = audit.generation_problems(suggestion["title"], suggestion["tags"], str(suggestion.get("description", "")), others, source_text, variations or {}, listing.get("listing_type") == "download", bool(listing.get("is_personalizable")))
    if len(suggestion.get("tags", [])) != standard.TAG_COUNT:
        raise ValueError(f"Beklenen {standard.TAG_COUNT} etiket, alınan: {len(suggestion.get('tags', []))}")

    # Malzeme: Etsy yalnızca harf, rakam ve boşluk kabul eder ("&", "-", "/", "," gibi işaretler "contains invalid characters" verir).
    suggestion["materials"] = fields.clean_words(suggestion.get("materials") or [], fields.MAX_MATERIALS, 45)
    # Denemelerden sonra hâlâ kalanlar kullanıcıya gösterilir. Diğer listing'lerle çakışma ayrı döner: iki listing'in
    # ortak durumudur ve aynı nişteki ürünlerde kaçınılmaz olabilir; arayüz onu "hata" değil bilgi olarak gösterir.
    description_part = quality.strip_common_paragraphs(str(suggestion.get("description", "")), others)
    suggestion["conflicts"] = quality.conflicts(suggestion["title"], suggestion["tags"], description_part, others)
    suggestion["warnings"] = [p for p in problems if p not in quality.uniqueness_problems(suggestion["title"], suggestion["tags"], description_part, others)]
    return suggestion
