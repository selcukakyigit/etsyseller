"""Keşfet (kelime araştırması) araçları: ekranla AYNI işlevleri çağırır (research/discover.py), ikinci bir uygulama yoktur. Sağlayıcıya istek atılmaz:
havuzda olmayan ya da eskimiş aramalar kuyruğa girer, sonuç genellikle bir iki dakikada hazır olur. Kullanıcıya ham arama sayısı gösterilmez, yalnızca bant."""
from app.research import discover

_DEMAND = {"low": "düşük", "medium": "orta", "high": "yüksek", None: "henüz ölçülmedi"}
_INTENT = {"informational": "bilgi arıyor", "commercial": "karşılaştırıyor", "transactional": "satın almaya yakın", "navigational": "belirli bir yer arıyor", None: None}
_REFUSED = {
    "budget": "Araştırma bütçesi doldu; havuzda zaten olan veriler gösterilir.",
    "shop_daily": "Bugünkü araştırma hakkı doldu; yarın yeniden dene.",
    "shop_searches": "Bugünkü yeni kelime araştırması hakkı doldu (daha önce araştırılmış kelimeler sınırsız); yarın yeniden dene.",
    "disabled": "Kelime araştırması şu an kapalı.",
    "not_configured": "Kelime araştırması henüz kurulu değil.",
    "market": "Bu pazar desteklenmiyor.",
}


def _item(i: discover.Item) -> dict:
    out = {"kelime": i.term, "talep": _DEMAND[i.demand]}
    if i.volume is not None:
        out["google_aylik_arama"] = i.volume  # Google verisi; Etsy hacmi DEĞİL
    if i.cpc is not None:
        out["cpc_usd"] = i.cpc
    if i.competition is not None:
        out["reklam_rekabeti_0_100"] = i.competition
    if i.trend_pct is not None:
        out["yillik_egilim_yuzde"] = i.trend_pct
    if i.intent:
        out["niyet"] = _INTENT[i.intent]
    if i.crowded:
        out["kalabalik"] = True  # son günlerde birçok mağazaya önerildi
    if i.mine:
        out["listingde_var"] = True
    if i.saved:
        out["kayitli"] = True
    return out


def research_keywords(ctx, a: dict) -> dict:
    seed = " ".join(str(a.get("seed", "")).split())
    if not seed:
        return {"error": "Araştırılacak kelime gerekli (İngilizce, ör. 'metal farm sign')."}
    r = discover.search(ctx.db, ctx.shop, seed)
    if r.status == "invalid":
        return {"error": "Kelime çok uzun ya da boş (en fazla 10 kelime / 80 karakter)."}
    if r.status == "pending":
        return {"arama": r.seed, "durum": "hazirlaniyor", "not": "Bu kelime ilk kez araştırılıyor; sonuç genellikle 1-2 dakikada hazır olur. Kullanıcıya söyle, biraz sonra aynı aramayı tekrar çağır."}
    if r.status == "refused":
        return {"arama": r.seed, "durum": "yapilamadi", "not": _REFUSED.get(r.refused, "Araştırma şu an yapılamıyor.")}
    if r.status == "empty":
        return {"arama": r.seed, "durum": "sonuc_yok", "not": "Bu kelime için öneri bulunamadı; daha genel bir ifade dene."}
    shown = sorted(r.items, key=lambda i: -(i.volume or 0))[:40]
    items = [_item(i) for i in shown]
    if a.get("etsy_competition"):  # en çok aranan ilk 15 için Etsy'deki ilan sayısı (Etsy kotası ortak: ölçüm sınırlıdır)
        counts = discover.etsy_results(ctx.shop, [i.term for i in shown[:15]])
        if counts is None:
            etsy_note = "Etsy ilan sayısı ölçüm hakkı geçici doldu; birkaç dakika sonra dene."
        else:
            etsy_note = None
            for item in items:
                if counts.get(item["kelime"]) is not None:
                    item["etsy_ilan_sayisi"] = counts[item["kelime"]]
    return {
        "arama": r.seed, "durum": "hazir", "tohum": _item(r.seed_item) if r.seed_item else None, "oneriler": items,
        "toplam_oneri": len(r.items), "toplam_aylik_arama": r.total_volume, **({"etsy_not": etsy_note} if a.get("etsy_competition") and etsy_note else {}),
        "not": ("google_aylik_arama = Google'daki aylık arama (Etsy arama hacmi DEĞİL; söylerken Google olduğunu belirt). reklam_rekabeti Google Ads reklam rekabetidir, Etsy rekabeti değil. "
                "etsy_ilan_sayisi (varsa) = Etsy'de o aramada kaç aktif ilan var: gerçek Etsy rekabeti; arama ÷ ilan oranı yüksekse fırsattır. "
                "kalabalik = son günlerde birçok mağazaya önerildi, ana ifade yapma. listingde_var = mağazada zaten etiket. Kullanıcı isterse save_keywords ile koleksiyona kaydet."),
    }


def saved_keywords(ctx, a: dict) -> dict:
    v = discover.saved(ctx.db, ctx.shop, a.get("collection"))
    return {
        "koleksiyonlar": [{"ad": c["name"] or "Genel", "kelime_sayisi": c["count"]} for c in v.collections], "gosterilen": v.collection or "Genel",
        "kelimeler": [_item(i) for i in v.items[:100]], "toplam": v.total,
    }


def save_keywords(ctx, a: dict) -> dict:
    terms = [str(t) for t in (a.get("terms") or [])][:100]
    if not terms:
        return {"error": "Kaydedilecek kelimeler gerekli."}
    if a.get("remove"):
        return {"silinen": discover.unsave(ctx.db, ctx.shop, terms, a.get("collection"))}
    added = discover.save(ctx.db, ctx.shop, ctx.user_id, terms, a.get("collection"))
    return {"eklenen": added, "not": "Zaten kayıtlı olanlar atlanır. Ölçümü olmayan kelimeler birazdan havuza işlenir."}


TOOLS: list[dict] = [
    {
        "name": "research_keywords",
        "description": (
            "Kelime araştırması (Keşfet ekranının aynısı): bir tohum kelime için öneriler, Google'daki talep bandı (düşük/orta/yüksek), alıcı niyeti, kalabalık işareti ve "
            "mağazada zaten kullanılıp kullanılmadığı. Önce ortak havuza bakar; yoksa araştırma kuyruğa girer (sonuç 1-2 dakikada hazır olur, 'hazirlaniyor' dönerse biraz sonra tekrar çağır). "
            "Kredi harcamaz; günlük yeni araştırma hakkı sınırlıdır. 'Bu kelime nasıl', 'ilgili kelimeler ne', 'ne aranıyor' soruları için. Tohum kelime İngilizce olmalı."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "seed": {"type": "string", "description": "Araştırılacak kelime/ifade (İngilizce, en fazla 10 kelime)"},
                "etsy_competition": {"type": "boolean", "description": "true ise en çok aranan ilk 15 kelime için Etsy'deki aktif ilan sayısını da ölçer (gerçek Etsy rekabeti; yalnızca kullanıcı rekabeti/fırsatı sorarsa)"},
            },
            "required": ["seed"],
        },
    },
    {
        "name": "saved_keywords",
        "description": "Kullanıcının Keşfet'te kaydettiği kelimeler ve koleksiyonları (talep bandıyla). 'Kaydettiğim kelimeler', 'koleksiyonlarım' için. collection verilmezse ilk koleksiyon.",
        "input_schema": {"type": "object", "properties": {"collection": {"type": "string", "description": "Koleksiyon adı (boş = Genel)"}}, "required": []},
    },
    {
        "name": "save_keywords",
        "description": "Kelimeleri Keşfet koleksiyonuna kaydeder (ya da remove=true ile çıkarır). Kullanıcı kaydetmeyi isterse çağır; kendiliğinden kaydetme. Koleksiyon adı verilmezse Genel.",
        "input_schema": {
            "type": "object",
            "properties": {
                "terms": {"type": "array", "items": {"type": "string"}, "description": "Kaydedilecek kelimeler (en fazla 100)"},
                "collection": {"type": "string", "description": "Koleksiyon adı (boş = Genel)"},
                "remove": {"type": "boolean", "description": "true ise kelimeleri koleksiyondan çıkarır"},
            },
            "required": ["terms"],
        },
    },
]
EXECUTORS = {"research_keywords": research_keywords, "saved_keywords": saved_keywords, "save_keywords": save_keywords}
LABELS = {"research_keywords": "Kelimeleri araştırıyor", "saved_keywords": "Kayıtlı kelimelere bakıyor", "save_keywords": "Kelimeleri kaydediyor"}
LABELS_EN = {"research_keywords": "Researching keywords", "saved_keywords": "Looking at saved keywords", "save_keywords": "Saving keywords"}
