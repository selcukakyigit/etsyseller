"""Plan kurulumu: puan -> pazar şekli -> açılış ifadesi (farklılık) -> etiket yerleşimi -> alıcı soruları.

Simülasyonda (3 senaryo, bkz. tests/listing_plan) bulunan ve buraya kural olarak giren dersler:
- Google hacmi tek başına genel ifadeleri öne çıkarır ("gift for him"): ürün kelimesi taşımayan ve milyonlarca sonuçlu ifade cezalı (`_relevance`).
- Pazar şekli Etsy sonuç sayısı + Google hacmi birlikte; yalnızca Etsy'ye bakınca dev bir arama "niş" sayılıyordu.
- Niş pazarda Etsy'de dönüşümü yüksek ölçülmüş ifade başlığı açabilir (20 karakteri aşsa da başlıkta durur).
- Açılış ifadesinin talep alt sınırı var: rakibi az ama aranmayan ifade başlığı açamaz.
- Farklılık rastgele değil: mağazadaki benzer listing'in açılışı ve açısı başkasına bırakılır, kalabalık (çok mağazaya önerilmiş) ifade açılışta
  güçlü cezalıdır; puanı eşit iyi adaylar arasında seçimi listing'e özgü SABİT bir değer yapar (aynı listing hep aynı sonucu alır).
- Etiketleri model değil plan yerleştirir (model yazarken plandan sapıyordu); model başlığı ve açıklamayı yazar."""
import hashlib
from dataclasses import asdict, dataclass, field, replace

from app.ai import quality, standard
from app.core.i18n import tr
from app.keywords import scoring
from app.listing_plan import fit, ideas, sources
from app.listing_plan.facts import Facts, lead_phrase, words
from app.research import bands
from app.research.questions import is_question

VERSION = "plan-1"

QUOTAS = {  # 13 etiketin rollere dağılımı (scoring.role_of rolleri), pazar şekline göre
    "crowded": {"head": 1, "mid": 3, "long": 5, "occasion": 2, "style": 2},
    "niche": {"head": 3, "mid": 3, "long": 3, "occasion": 2, "style": 2},
    "no_data": dict(scoring.ROLE_TARGETS),
}
MIN_TAG_SCORE = 0.4  # rol kotası bundan zayıf adayla doldurulmaz
TIE = 0.9  # açılışta en iyinin %90'ı içindekiler eşit sayılır


@dataclass
class Plan:
    version: str
    shape: str  # crowded | niche | no_data
    lead: str | None
    lead_options: list[str]
    lead_angle: str | None
    tags: list[dict]  # [{tag, role, confidence}]
    great_for: list[str]
    questions: list[dict]  # [{q, demand}] alıcı soruları (bant, ham sayı değil)
    ask: list[dict]  # cevabı bilinmeyen alıcı soruları: kullanıcıya SORULUR (SSS'ye uydurma cevap yazılmaz)
    sibling_words: list[str]  # benzer listing başlıklarında geçen, ikincil öbekte tekrarlanmaması gereken kelimeler
    data: dict = field(default_factory=dict)  # {measured, partial, estimate, ideas, queued}
    rejected: list[tuple[str, str]] = field(default_factory=list)

    def public(self) -> dict:
        out = asdict(self)
        out["rejected"] = [{"phrase": p, "why": w} for p, w in self.rejected[:12]]
        return out

    def brief(self) -> str:
        """Modele giden plan (asistan ve editördeki AI önerisi aynı metni alır)."""
        shape = {"crowded": tr("kalabalık pazar", "crowded market"), "niche": tr("niş pazar", "niche market"), "no_data": tr("verisiz", "no data")}[self.shape]
        lines = [
            tr(f"KELİME PLANI ({self.version}, {shape}):", f"KEYWORD PLAN ({self.version}, {shape}):"),
            tr(f"- Başlık BU ifadeyle başlar: \"{self.lead}\"", f"- The title STARTS with: \"{self.lead}\"") if self.lead else tr("- Başlık: ürünün ne olduğuyla başla.", "- Title: start with what the item is."),
            tr(f"- Diğer açılış seçenekleri (kullanıcı seçerse): {', '.join(self.lead_options[1:])}", f"- Other opening options (if the user picks one): {', '.join(self.lead_options[1:])}") if len(self.lead_options) > 1 else "",
            tr("- Ardından karttan en önemli 2-3 nesnel niteleyici (malzeme, kapasite/ölçü yalnızca tek ölçüyse, kişiselleştirme varsa); toplam 15 kelimenin altı.",
               "- Then the 2-3 most important objective details from the facts (material, capacity/size only if single, personalization if offered); under 15 words in total."),
            tr(f"- Benzer listing'lerde zaten geçen şu kelimeleri ikincil öbekte tekrarlama: {', '.join(self.sibling_words)}", f"- Do not repeat these words already used by similar listings: {', '.join(self.sibling_words)}") if self.sibling_words else "",
            tr("- Etiketler (sunucu yerleştirir; açıklamanın ilk cümlelerinde bunlardan 1-2'sini doğal geçir): ", "- Tags (placed by the server; use 1-2 of them naturally in the opening): ")
            + ", ".join(f"{t['tag']} [{t['role']}]" for t in self.tags),
            tr(f"- GREAT FOR adayları: {', '.join(self.great_for)}", f"- GREAT FOR candidates: {', '.join(self.great_for)}") if self.great_for else "",
        ]
        if self.ask:
            lines.append(tr(
                "- KULLANICIYA SOR (cevabı bilinmiyor; brief_check'te kısa bir soru olarak, kullanıcının dilinde ve plan_question alanıyla): " + "; ".join(q["q"] + "?" for q in self.ask),
                "- ASK THE USER (answer unknown; as a short question in brief_check in the user's language with the plan_question field): " + "; ".join(q["q"] + "?" for q in self.ask),
            ))
        if self.questions:
            lines.append(tr(
                "- Alıcıların sorduğu sorular (talep bandıyla). SORU-CEVAP'a YALNIZCA cevabı verilen bilgide olanları yaz; cevabı bilinmeyen ama önemli olanı kullanıcıya sor, uydurma:",
                "- Questions buyers ask (with demand band). Answer in QUESTIONS ONLY those whose answer is in the given facts; ask the user about important unknown ones, never invent:",
            ))
            lines += [f"  • {q['q']}?" + (f" ({q['demand']})" if q.get("demand") else "") for q in self.questions]
        d = self.data
        lines.append(tr(f"- Veri: {d.get('measured', 0)} ölçülü, {d.get('partial', 0)} kısmi, {d.get('estimate', 0)} tahmin etiket; {d.get('queued', 0)} ölçüm sırada.",
                        f"- Data: {d.get('measured', 0)} measured, {d.get('partial', 0)} partial, {d.get('estimate', 0)} estimated tags; {d.get('queued', 0)} measurements queued."))
        return "\n".join(x for x in lines if x)


_QUESTION_NOISE = {"how", "what", "why", "when", "where", "which", "who", "can", "does", "do", "is", "are", "should", "will", "was", "you", "these", "this",
                   "that", "come", "comes", "with", "there", "have", "has", "get", "long", "much", "many", "need", "buy", "good", "best", "work", "works", "make", "made"}


def unanswered(qs: list[dict], facts: Facts, limit: int = 1) -> list[dict]:
    """Cevabı bilinmeyen sorular: sorunun içerik kelimeleri (ürün adı ve soru sözcükleri hariç) kullanıcının sözlerinde/olgularda hiç geçmiyorsa cevap
    bilinmiyor demektir ("do these come with a case?": "case" hiçbir yerde yok). Talebi yüksek olandan başlayarak en fazla `limit` soru."""
    known = facts.known_words | set(words(facts.claim_text))
    rank = {"high": 0, "medium": 1, "low": 2, None: 3}
    out = []
    for q in sorted(qs, key=lambda q: rank.get(q.get("demand"), 3)):
        if q.get("demand") != "high":  # kart gürültüsü: yalnızca alıcıların çok sorduğu bilinmeyen soru sorulur (oturum 57: 'Does it keep drinks hot?' gibi gereksiz sorular)
            continue
        content = {w for w in words(q["q"]) if len(w) > 2 and w not in _QUESTION_NOISE and w not in facts.item_words}
        if content and not content & known:
            out.append(q)
    return out[:limit]


def _stable(key: str, phrase: str) -> float:
    return int(hashlib.sha256(f"{key}|{phrase}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def _relevance(c: dict, facts: Facts) -> float:
    r = 1.0
    if not set(words(c["tag"])) & facts.item_words:
        r *= 0.7
    if (c.get("etsy_results") or 0) >= 1_000_000:
        r *= 0.7
    return r


def _angle(phrase: str) -> str | None:
    w = set(words(phrase))
    return next((a for a, vocab in fit.ANGLES.items() if w & vocab), None)


def _has_demand(c: dict) -> bool:
    return (c.get("google_volume") or 0) >= 500 or (c.get("etsy_searches") or 0) >= 5 or bool(c.get("units") or c.get("etsy_orders")) or c.get("source") == "own"


def _match(tag: str, facts: Facts) -> float:
    w, item = set(words(tag)), facts.item_words
    return len(w & item) / len(w | item) if w and item else 0.0


def _shape(cands: list[dict], facts: Facts) -> str:
    """Pazarı ürünün KENDİ ifadesi belirler (ürün adına en çok benzeyen, verisi olan aday): yusufçuk kazığının pazarı "metal yard art"
    kategorisi değil "metal dragonfly yard art"tır."""
    data = [c for c in cands if c["role"] != "occasion" and (c.get("etsy_results") or c.get("google_volume") or c.get("etsy_searches"))]
    head = max(data, key=lambda c: (_match(c["tag"], facts), (c.get("etsy_searches") or 0) + (c.get("google_volume") or 0)), default=None)
    if head is None or _match(head["tag"], facts) == 0:
        return "no_data"
    results = head.get("etsy_results") or 0
    big_google = (head.get("google_volume") or 0) >= 30_000 and results >= 50_000
    if results >= 100_000 or big_google or head.get("etsy_conversion") in ("very_low", "low") or (head.get("crowd") or 0) >= 0.5:
        return "crowded"
    return "niche"


def _candidates(raw: list[dict], facts: Facts, title_words: set[str], seen: set[str] | None = None) -> tuple[list[dict], list[tuple[str, str]], list[dict]]:
    """(uygun adaylar, elenenler, doğrulanacaklar: kartta olmayan kelime taşıyanlar)."""
    seen = set() if seen is None else seen
    out, rejected, check = [], [], []
    for c in raw:
        tag = " ".join(str(c.get("tag") or "").lower().split())
        if not tag or tag in seen or is_question(tag):
            continue
        seen.add(tag)
        why = fit.reason(tag, facts)
        item = _scored({**c, "tag": tag}, facts, title_words)
        if fit.unverified(why):
            check.append({**item, "why": why})
        elif why:
            rejected.append((tag, why))
        else:
            out.append(item)
    return out, rejected, check


def _dedupe(cands: list[dict]) -> list[dict]:
    """Aynı aramayı iki kez harcamamak için yakın-aynı adaylardan ("mens sunglasses" / "men sunglasses" / "womens sunglasses") yalnızca en iyisi kalır."""
    best: dict[str, dict] = {}
    for c in cands:
        k = quality.tag_key(c["tag"])
        if k not in best or c["score"] > best[k]["score"]:
            best[k] = c
    return list(best.values())


def _scored(item: dict, facts: Facts, title_words: set[str]) -> dict:
    s, conf = scoring.score(item)
    return {**item, "score": round(s * _relevance(item, facts), 3), "confidence": conf, "role": scoring.role_of(item["tag"], title_words), "angle": _angle(item["tag"])}


def build(
    raw_pool: list[dict], facts: Facts, *, key: str, others: list[dict] | None = None, model_tags: list[str] | None = None,
    research: tuple[list[dict], list[dict], int] | None = None, shop=None, use_ideas: bool = True, current_title: str = "",
) -> Plan:
    """`raw_pool`: keyword_service.scored_pool çıktısı. `others`: mağazanın diğer listing'leri (quality.shop_others). `key`: listing'e özgü sabit
    anahtar (farklılık için). `research`: (öneriler, sorular, kuyruk) — verilmezse ve `shop` varsa havuzdan okunur. `current_title`: kullanıcının
    seçtiği/yazdığı başlık varsa açılışı odur (plan ona saygı duyar, yalnızca etiketleri ve soruları kurar)."""
    others = others or []
    if research is None:
        research = sources.research(shop, facts.product) if shop is not None else ([], [], 0)
    suggestions, questions, queued = research
    title_words = set(words(current_title or facts.product))
    model_cands = [{"tag": t, "source": "model", "score": 0, "sample_size": 0} for t in model_tags or []]
    seen: set[str] = set()
    cands, rejected, to_check = _candidates([*raw_pool, *suggestions, *model_cands], facts, title_words, seen)

    # Yapay zekâ (tek çağrı): kartta olmayan kelime taşıyanları doğrula + veri zayıfsa yeni fikir. Model yoksa doğrulanmamışlar elenir.
    cands = _dedupe(cands)
    idea_count = 0
    thin = len([c for c in cands if len(c["tag"]) <= standard.TAG_MAX_LEN]) < ideas.MIN_CANDIDATES
    kept: set[str] = set()
    need_questions = not questions  # havuzda bu ürün için alıcı sorusu yoksa (araştırma işleri bütçeye takılabilir) yapay zekâ sorar
    if use_ideas and shop is not None and (to_check or thin or need_questions):
        kept, phrases, idea_questions, synonyms = ideas.run(facts, [c["tag"] for c in sorted(to_check, key=lambda c: -c["score"])], want_new=thin, want_questions=need_questions)
        if synonyms:  # ürün türü eşanlamlıları karta eklenir; doğrulanacaklar ve yeni fikirler genişlemiş kartla yeniden süzülür
            facts = replace(facts, text=" ".join([facts.text, *synonyms]))
            kept |= {c["tag"] for c in to_check if fit.reason(c["tag"], facts) is None}
        more, more_rejected, unchecked = _candidates([{"tag": p, "source": "ai", "score": 0, "sample_size": 0} for p in phrases], facts, title_words, seen)
        more_rejected += [(c["tag"], c["why"]) for c in unchecked]
        cands = _dedupe(cands + more)
        rejected += more_rejected  # yeni fikirlerde de kartta olmayan kelime varsa (doğrulanmadığı için) alınmaz
        idea_count = len(more)
        queued += sources.queue_measurement(shop, [c["tag"] for c in more])
        questions += [{"q": q, "google_volume": None} for q in idea_questions if q not in {x["q"] for x in questions}]
    for c in to_check:
        if c["tag"] in kept:
            cands.append({k: v for k, v in c.items() if k != "why"})
        else:
            rejected.append((c["tag"], c["why"]))

    similar = quality.similar_context(current_title or facts.product, model_tags or [], others)
    sibling_leads = {lead_phrase(o["title"]) for o in similar}
    sibling_angles = {_angle(lead_phrase(o["title"])) for o in similar} - {None}
    sibling_words = sorted({w for o in similar[:3] for w in words(o["title"]) if len(w) > 2} - set(words(facts.product)) - {"and", "with", "for"})
    shape = _shape(cands, facts)

    # Açılış ifadesi
    pool_lead = [c for c in cands if c["role"] != "occasion" and _has_demand(c) and c["tag"] not in sibling_leads and set(words(c["tag"])) & facts.item_words]
    if shape == "niche":
        pool_lead = [c for c in pool_lead if c["role"] == "head" or c.get("etsy_conversion") in ("high", "very_high")] or pool_lead
    elif shape == "crowded":
        pool_lead = [c for c in pool_lead if len(c["tag"].split()) >= 3 or c["role"] in ("style", "long")] or pool_lead

    def lead_value(c: dict) -> float:
        v = c["score"] * (1 - 0.6 * (c.get("crowd") or 0))
        return v * 0.85 if c["angle"] and c["angle"] in sibling_angles else v

    if not pool_lead:  # talep kanıtı yoksa (havuzda ölçüm henüz yok) açılış yine de seçilir: ürün kelimesini taşıyan en iyi puanlı aday, o da yoksa ürün adı
        pool_lead = [c for c in cands if c["role"] != "occasion" and c["tag"] not in sibling_leads and set(words(c["tag"])) & facts.item_words and len(c["tag"].split()) >= 2]
    ranked = sorted(pool_lead, key=lead_value, reverse=True)
    lead = None
    if current_title:
        chosen = lead_phrase(current_title)
        lead = next((c for c in cands if chosen.startswith(c["tag"])), None) or {"tag": chosen, "angle": _angle(chosen)}
    elif ranked:
        best = lead_value(ranked[0])
        ties = [c for c in ranked if lead_value(c) >= TIE * best]
        lead = max(ties, key=lambda c: _stable(key, c["tag"]))
    if lead is None and facts.product:
        lead = {"tag": facts.product, "angle": _angle(facts.product)}
    options = ([lead["tag"]] if lead else []) + [c["tag"] for c in ranked if not lead or c["tag"] != lead["tag"]][:2]

    # Etiketler: rol kotası, ölçülü/kısmi önce, puan bandı + listing'e özgü sıra, benzer listing'le en fazla MAX_SHARED_TAGS ortak.
    lead_angle = lead["angle"] if lead else None

    def tag_key(c: dict) -> tuple:
        v = c["score"] * (1 - 0.25 * (c.get("crowd") or 0)) + (0.08 if lead_angle and c["angle"] == lead_angle else 0)
        return (c["confidence"] != "estimate", round(v / 0.08), _stable(key, c["tag"]))

    fits_tag = sorted([c for c in cands if len(c["tag"]) <= standard.TAG_MAX_LEN], key=tag_key, reverse=True)
    sibling_tags = [{t.lower() for t in o["tags"]} for o in similar]
    chosen_tags: list[dict] = []
    quota = dict(QUOTAS[shape])

    def ok(c: dict) -> bool:
        mine = {t["tag"] for t in chosen_tags} | {c["tag"]}
        return c not in chosen_tags and all(len(mine & st) <= standard.MAX_SHARED_TAGS for st in sibling_tags)

    for c in fits_tag:
        if quota.get(c["role"], 0) > 0 and c["score"] >= MIN_TAG_SCORE and ok(c):
            chosen_tags.append(c)
            quota[c["role"]] -= 1
    for c in fits_tag:
        if len(chosen_tags) >= standard.TAG_COUNT:
            break
        if ok(c):
            chosen_tags.append(c)
    chosen_tags = chosen_tags[: standard.TAG_COUNT]

    great_for = [c["tag"] for c in sorted(cands, key=lambda c: -c["score"]) if c["role"] == "occasion"][:3]
    qs = []
    for q in questions:
        if fit.reason(q["q"], facts) is None and len(qs) < 6:
            qs.append({"q": q["q"], "demand": bands.demand_band(q.get("google_volume"))})
    ask = unanswered(qs, facts)
    conf =[c["confidence"] for c in chosen_tags]
    return Plan(
        version=VERSION, shape=shape, lead=lead["tag"] if lead else None, lead_options=options, lead_angle=lead_angle,
        tags=[{"tag": c["tag"], "role": c["role"], "confidence": c["confidence"]} for c in chosen_tags],
        great_for=great_for, questions=qs, ask=ask, sibling_words=sibling_words[:12],
        data={"measured": conf.count("measured"), "partial": conf.count("partial"), "estimate": conf.count("estimate"), "ideas": idea_count, "queued": queued},
        rejected=rejected,
    )


def place_tags(plan: Plan, written: list[str]) -> list[str]:
    """Son etiketler: planınkiler; plan 13'e ulaşamadıysa modelin yazdıklarından (uygunluk denetiminden geçmiş, tekrar etmeyen) tamamlanır."""
    out = [t["tag"] for t in plan.tags if not quality.junk_tag(t["tag"])]
    for t in written:
        if len(out) >= standard.TAG_COUNT:
            break
        low = " ".join(t.lower().split())
        if low and low not in out and len(low) <= standard.TAG_MAX_LEN and not quality.junk_tag(low):
            out.append(low)
    return out[: standard.TAG_COUNT]


def title_problems(title: str, plan: Plan) -> list[str]:
    """Başlık planın açılış seçeneklerinden biriyle başlamıyorsa geri bildirim (kullanıcının kendi başlığına karışılmaz: çağıran karar verir)."""
    if not plan.lead_options:
        return []
    head = set(words(" ".join(title.split()[:8])))  # açılışın tüm kelimeleri başlığın ilk 8 kelimesinde geçsin (sıra ve araya giren kelime serbest: "Retro Square Sunglasses" = "retro sunglasses")
    if any({w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words(o)} <= {w[:-1] if len(w) > 3 and w.endswith("s") else w for w in head} for o in plan.lead_options):
        return []
    return [tr(
        f"Başlık planın açılış ifadesiyle başlamıyor; şunlardan biriyle başlat: {', '.join(plan.lead_options)}.",
        f"The title does not start with the plan's opening phrase; start with one of: {', '.join(plan.lead_options)}.",
    )]
