import json
import re

from app.ai import audit, catalog, layout, quality, standard
from app.ai.catalog import ResolvedModel
from app.ai.client import get_anthropic_client, get_openai_client, openai_limits
from app.billing import metering
from app.listing_plan import plan as plan_mod
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
- Sana bir KELİME PLANI verilir (sunucu kurdu: ürüne uymayan, marka içeren ve kalabalık ifadeler zaten elendi; açılış farklılık için seçildi):
  * Başlığı plandaki açılış ifadesiyle BAŞLAT, ardından karttan 2-3 nesnel niteleyici ekle; plan "benzer listing'lerde geçen kelimeler" verdiyse ikincil öbekte onları tekrarlama
  * Etiketleri sunucu plandan yerleştirir: "tags" alanına plandaki etiketleri yaz (ürüne açıkça uymayan varsa çıkar, yerine ürüne özgü bir tane koy)
  * Açılış cümlesinde plandaki ifadelerden 1-2'sini doğal geçir; GREAT FOR için plandaki vesile/alıcı adaylarından ürüne uyanları kullan
  * SORU-CEVAP için plandaki alıcı sorularından YALNIZCA cevabı verilen bilgide olanları yaz; cevabı bilinmeyen soruyu yazma, uydurma
  * Plan açılışı mevcut başlığın açılışıyla aynıysa (satış getirmiş ya da düzeltme turu) onu değiştirme
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


def generate_seo_suggestion(
    listing: dict, plan: plan_mod.Plan | None = None, others: list[dict] | None = None, diagnosis_brief: str = "",
    variations: dict[str, list[str]] | None = None, fact_source: dict | None = None,
) -> dict:
    """`plan`: kelime planı (bkz. app/listing_plan): model başlığı açılış ifadesiyle kurar, etiketleri sunucu plandan yerleştirir
    (modelinkiler yalnızca eksik kalanı tamamlar). `others`: mağazanın diğer listing'leri (başlık/etiket/açıklama). Verilirse öneri hem
    biçim kurallarına hem de "diğer listing'lerin kopyası olmama" denetimine tabi tutulur; ihlalde model geri bildirimle yeniden denenir."""
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
    if plan is not None:
        user_content += f"\n\n{plan.brief()}"
    user_content += _others_block(listing_payload["title"], listing_payload["tags"], others)
    if diagnosis_brief:
        user_content += f"\n\n{diagnosis_brief}\nGerekçede (rationale) bu teşhise göre neyi neden değiştirdiğini açıkla."

    suggestion = _call(user_content)
    problems: list[str] = []
    for attempt in range(MAX_RETRIES + 1):
        tags = quality.fix_long_tags(quality.clean_tags(suggestion.get("tags", [])))
        if plan is not None:
            tags = plan_mod.place_tags(plan, tags)
        suggestion["tags"] = tags
        # Ölçü/renk temizliği denetimden önce: yeniden deneme, son hâli görsün (kısalan başlık benzerliği artırabilir)
        suggestion["description"] = layout.normalize(str(suggestion.get("description", "")))
        suggestion["title"] = quality.clean_title(str(suggestion.get("title", "")), variations or {})
        problems = audit.generation_problems(suggestion["title"], tags, str(suggestion.get("description", "")), others, source_text, variations or {}, listing.get("listing_type") == "download", bool(listing.get("is_personalizable")))
        if plan is not None:
            problems += plan_mod.title_problems(suggestion["title"], plan)
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
