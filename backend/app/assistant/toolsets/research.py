"""Keşfet (kelime araştırması) araçları: ekranla AYNI işlevleri çağırır (research/discover.py), ikinci bir uygulama yoktur. Sağlayıcıya istek atılmaz:
havuzda olmayan ya da eskimiş aramalar kuyruğa girer, sonuç genellikle bir iki dakikada hazır olur. Kullanıcıya ham arama sayısı gösterilmez, yalnızca bant."""
from app.research import budget, discover, etsy_top, overview

_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]

_DEMAND = {"low": "düşük", "medium": "orta", "high": "yüksek", None: "henüz ölçülmedi"}
_INTENT = {"informational": "bilgi arıyor", "commercial": "karşılaştırıyor", "transactional": "satın almaya yakın", "navigational": "belirli bir yer arıyor", None: None}
_REFUSED = {
    "budget": "Araştırma bütçesi doldu; havuzda zaten olan veriler gösterilir.",
    "shop_daily": "Bugünkü araştırma hakkı doldu; yarın yeniden dene.",
    "shop_searches": "Bugünlük yeni kelime araştırması sınırına ulaşıldı (daha önce araştırılmış kelimeler sınırsız); yarın yeniden dene.",
    "shop_month": "Bu ayki yeni kelime araştırması hakkı doldu (daha önce araştırılmış kelimeler sınırsız); gelecek ay yenilenir.",
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
    if i.difficulty is not None:
        out["seo_zorlugu_0_100"] = i.difficulty  # Google organik arama zorluğu; reklam rekabeti ve Etsy rekabeti değil
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


def _season_out(season: dict | None) -> dict | None:
    """Mevsimsellik profilini model için biçimlendirir (hazır / aylık arama çok az); hazırlanıyorsa ya da yoksa None."""
    if season and season["monthly"]:
        return {
            "mevsimsel": season["seasonal"], "zirve_aylar": [_MONTHS[m - 1] for m in season["peak_months"]],
            "aylik_ilgi_0_100": dict(zip(_MONTHS, season["monthly"])),
            "not": "Google Trends'ten 5 yıllık takvim ayı profili (zirve = 100); satış zirvesinden 1-2 ay ÖNCE listing hazır olmalı. Hacim değil, yıllık şekildir.",
        }
    if season and season.get("too_rare"):
        return {"not": f"Aylık arama {season['min_volume']}'in altında olduğu için mevsimsellik hesaplanmadı (Google Trends bu kadar az aramada güvenilir desen vermez); mevsimsellik hakkında tahmin yürütme."}
    return None


def research_keywords(ctx, a: dict) -> dict:
    seed = " ".join(str(a.get("seed", "")).split())
    if not seed:
        return {"error": "Araştırılacak kelime gerekli (İngilizce, ör. 'metal farm sign')."}
    r = discover.search(ctx.db, ctx.shop, seed, "questions" if a.get("questions") else "all", bool(a.get("refresh")))
    allow = budget.search_allowance(ctx.db, ctx.shop.id)
    left = {"kalan_yeni_arama_hakki_bu_ay": max(0, allow["month_limit"] - allow["month_used"])}  # yeni araştırma hakkı; havuzdaki kelimeler sayılmaz
    if r.status == "invalid":
        return {"error": "Kelime çok uzun ya da boş (en fazla 10 kelime / 80 karakter)."}
    if r.status == "pending":
        return {"arama": r.seed, "durum": "hazirlaniyor", **left, "not": "Bu kelime ilk kez araştırılıyor; sonuç genellikle 1-2 dakikada hazır olur. Kullanıcıya söyle, biraz sonra aynı aramayı tekrar çağır."}
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
    season = _season_out(r.season)
    return {
        "arama": r.seed, "durum": "hazir", **left, **({"mevsimsellik": season} if season else {}), "tohum": _item(r.seed_item) if r.seed_item else None, "oneriler": items,
        "toplam_oneri": len(r.items), "toplam_aylik_arama": r.total_volume, **({"etsy_not": etsy_note} if a.get("etsy_competition") and etsy_note else {}),
        "not": ("google_aylik_arama = Google'daki aylık arama (Etsy arama hacmi DEĞİL; söylerken Google olduğunu belirt). reklam_rekabeti Google Ads reklam rekabetidir, Etsy rekabeti değil. "
                "etsy_ilan_sayisi (varsa) = Etsy'de o aramada kaç aktif ilan var: gerçek Etsy rekabeti; arama ÷ ilan oranı yüksekse fırsattır. "
                "kalabalik = son günlerde birçok mağazaya önerildi, ana ifade yapma. listingde_var = mağazada zaten etiket. Kullanıcı isterse save_keywords ile koleksiyona kaydet."),
    }


def _month_labels(last_month: str | None, count: int) -> list[str]:
    """Serinin son ayından ("YYYY-AA") geriye ardışık ay adları ("Eki 2025"); son ay bilinmiyorsa sıra numarası."""
    try:
        year, month = (int(x) for x in (last_month or "").split("-"))
    except ValueError:
        return [str(i + 1) for i in range(count)]
    end = year * 12 + month - 1
    return [f"{_MONTHS[(end - (count - 1 - i)) % 12]} {(end - (count - 1 - i)) // 12}" for i in range(count)]


def keyword_detail(ctx, a: dict) -> dict:
    term = " ".join(str(a.get("term", "")).split())
    if not term:
        return {"error": "Kelime gerekli (İngilizce)."}
    found = discover.detail(ctx.db, ctx.shop, term)
    if found is None:
        return {"kelime": term, "durum": "olculmemis", "not": "Bu kelime havuzda ölçülmemiş. Önce research_keywords ile araştır (kelime öneri listesinde çıkar ya da tohum olarak ara), sonra tekrar çağır."}
    item, season = found
    out = {**_item(item), "kelime": item.term}
    if item.monthly:
        out["aylik_arama_son_12_ay"] = dict(zip(_month_labels(item.last_month, len(item.monthly)), item.monthly))
    formatted = _season_out(season)
    if formatted:
        out["mevsimsellik"] = formatted
    elif season and season["pending"]:
        out["mevsimsellik"] = {"durum": "hazirlaniyor", "not": "Mevsimsellik ilk kez isteniyor (1-2 dakika); kullanıcıya söyle, biraz sonra aynı kelimeyle tekrar çağır."}
    else:
        out["mevsimsellik"] = {"not": "Mevsimsellik bu kelime için çıkarılamadı (Google Trends yeterli veri vermiyor); tahmin yürütme."}
    out["not"] = "Google verisidir (Etsy arama hacmi değil). aylik_arama_son_12_ay: ay ay Google aramaları; mevsimsellik ise 5 yıllık takvim ayı profilidir."
    return out


def upcoming_seasons(ctx, a: dict) -> dict:
    """Mağazanın en sık etiketlerinden önümüzdeki 3 ayda zirve yapacaklar (Keşfet ana ekranındaki "Yaklaşan sezon" ile aynı fonksiyon)."""
    view = discover.home(ctx.db, ctx.shop, getattr(ctx, "today", None))
    rows = [
        {
            "kelime": u["term"], "zirve_aylar": [_MONTHS[m - 1] for m in u["peak_months"]], "kac_ay_sonra": u["in_months"],
            **({"google_aylik_arama": u["volume"]} if u["volume"] is not None else {}),
        }
        for u in view.upcoming
    ]
    out = {"yaklasan_sezon": rows, "incelenen_etiket": len(view.tags)}
    if view.preparing:
        out["hazirlaniyor"] = True
    out["not"] = (
        "kac_ay_sonra: 0 = bu ay zirvede. Alıcılar zirveden 1-2 ay ÖNCE aramaya başlar; listing'i yayına hazır tut. Mevsimsellik Google Trends'ten (5 yıl) gelir, Etsy verisi değildir. "
        + ("Bazı etiketlerin mevsimselliği şu an hesaplanıyor; kullanıcıya söyle, 1-2 dakika sonra aynı aracı tekrar çağır. " if view.preparing else "")
        + ("Önümüzdeki 3 ayda zirve yapan etiket görünmüyor (ya da aylık araması çok düşük etiketlerin mevsimselliği hesaplanmaz); mevsim uydurma. " if not rows else "")
        + "Başka bir kelimenin ayrıntısı için keyword_detail."
    )
    return out


def discover_overview(ctx, a: dict) -> dict:
    """Keşfet ana ekranının kartları (sezon takvimi, yükselenler/düşenler, fırsatlar, ülkelere göre Google talebi, müşteri ülkeleri); ekranla AYNI işlev (research/overview.py)."""
    view = overview.overview(ctx.db, ctx.shop, getattr(ctx, "today", None))
    pulse = view.pulse
    out: dict = {
        "ozet": {
            "etiket_sayisi": pulse["tags"], "olculen_etiket": pulse["measured"], "etiketlerin_toplam_google_aylik_aramasi": pulse["monthly_searches"],
            "en_cok_arayan_ulke_kodu": pulse["top_market"],
            **({"siradaki_zirve": {"kelime": pulse["next_peak"]["term"], "kac_ay_sonra": pulse["next_peak"]["in_months"], "zirve_aylar": [_MONTHS[m - 1] for m in pulse["next_peak"]["peak_months"]]}} if pulse["next_peak"] else {}),
        },
        "sezon_takvimi": [
            {"kelime": c["term"], "zirve_aylar": [_MONTHS[m - 1] for m in c["peak_months"]], **({"kac_ay_sonra": c["in_months"]} if c["in_months"] is not None else {})}
            for c in view.calendar
        ],
        "yukselenler": [{"kelime": m["term"], "google_aylik_arama": m["volume"], "son3ay_ilk3ay_yuzde": m["trend_pct"], "mevsimsel": m["seasonal"]} for m in view.movers["rising"]],
        "dusenler": [{"kelime": m["term"], "google_aylik_arama": m["volume"], "son3ay_ilk3ay_yuzde": m["trend_pct"], "mevsimsel": m["seasonal"]} for m in view.movers["falling"]],
        "firsatlar": [_item(discover.Item(**o)) for o in view.opportunities],
        "musteri_ulkeleri": {"son_gun": view.customers["days"], "siparis": view.customers["orders"], "ulkeler": [{"kod": r["country"], "siparis": r["orders"], "yuzde": r["share"]} for r in view.customers["rows"][:15]]},
    }
    c = view.countries
    out["ulke_talebi"] = {
        "olculen_pazarlar": [
            {"kod": r["market"], "google_aylik_arama_toplam": r["volume"], "yuzde": r["share"], "olculen_etiket": r["measured"], **({"en_cok_aranan": r["top_term"]} if r["top_term"] else {})}
            for r in c["rows"]
        ],
        "etiket_sayisi": c["tags"],
        **({"hazirlaniyor": True} if c["preparing"] else {}),
    }
    out["not"] = (
        "ulke_talebi: mağaza etiketlerinin her pazarda İNGİLİZCE Google aramalarının toplamıdır (Etsy satışı ya da Etsy arama hacmi DEĞİL); yalnızca ölçülen pazarlar vardır, listede olmayan ülke 'arama yok' demek değildir. "
        "Ülke ölçümü haftalık hazırlanır: hazirlaniyor=true ise eksik olabilir, sayıları kesin sunma. musteri_ulkeleri mağazanın GERÇEK siparişleridir (son yıl, iptaller hariç). "
        "yukselenler/dusenler: son 3 ayın ortalaması, 12 aylık serinin ilk 3 ayına göre; mevsimsel=true ise yön sezondan olabilir. firsatlar: mağazanın kullanmadığı, çok aranan, kalabalık olmayan öneriler; Etsy rekabetini ölçmez (etsy_top_results ile bak). "
        "Boş bölümü uydurma; boş ise ölçüm henüz yok ya da veri yetersiz de."
    )
    return out


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


def etsy_top_results(ctx, a: dict) -> dict:
    term = " ".join(str(a.get("term", "")).split())
    if not term:
        return {"error": "Aranacak ifade gerekli (İngilizce, ör. 'metal wall art')."}
    try:
        out = etsy_top.fetch(ctx.shop.id, term)
    except Exception as exc:  # noqa: BLE001 - Etsy erişilemezse kullanıcıya düz hata
        return {"error": f"Etsy aramasına ulaşılamadı: {str(exc)[:160]}"}
    if out is None:
        return {"durum": "sinir", "not": "Etsy ölçüm hakkı geçici doldu; birkaç dakika sonra dene."}
    if not out or not out["sample"]:
        return {"arama": term, "toplam_ilan": (out or {}).get("total", 0), "not": "Sonuç yok; daha genel bir ifade dene."}
    return {
        "arama": out["term"], "etsy_toplam_ilan": out["total"], "ilk_20_icinde_kanitlanmis_ilan": out["proven"], "cok_guclu_ilan": out["strong"],
        "en_yuksek_favori": out["favorites"]["max"], "yeni_ilan_payi": out["new_share"],
        "fiyat_bandi": {"para_birimi": out["currency"], **out["price"]}, "en_sik_etiketler": [f"{t['tag']} ({t['count']}/20)" for t in out["top_tags"][:10]],
        "not": ("Bu ETSY verisi (Google değil) ama alıcının gördüğü 'ilk 20' DEĞİL: Etsy API'sinin skor sırasından bir ÖRNEKTİR (sitedeki sıralamadan farklıdır; yeni ve favorisi az ilanlar önde çıkar). "
                "Bu yüzden 'rekabet düşük/yüksek' hükmü verme, sıra söyleme. Toplam ilan sayısı sıralamadan bağımsızdır ve güvenilirdir. Fiyat bandı ve etiketler örnek niteliğindedir; "
                "etiketlerden ilham al, kopyalama."),
    }


TOOLS: list[dict] = [
    {
        "name": "etsy_top_results",
        "description": (
            "Bir aramanın ETSY'deki toplam ilan sayısı ve Etsy API'sinden 20 ilanlık ÖRNEK (sitedeki ilk sayfa değildir): fiyat bandı, yeni giriş payı, kaç ilan 10+ favorili, rakiplerin sık etiketleri. "
            "'Bu kelimede kaç ilan var', 'rakipler hangi etiketleri kullanıyor' için. Rekabet gücü hükmü verme, sıra söyleme. Etsy verisidir; Google hacmiyle karıştırma. Kredi harcamaz; ölçüm hakkı sınırlıdır."
        ),
        "input_schema": {"type": "object", "properties": {"term": {"type": "string", "description": "Aranacak ifade (İngilizce)"}}, "required": ["term"]},
    },
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
                "questions": {"type": "boolean", "description": "true ise yalnızca soru kalıpları (how/what/why…): müşteri soruları, SSS ve açıklama fikirleri için"},
                "refresh": {"type": "boolean", "description": "true ise havuzdaki sonucu beklemeden yeniden araştırır (ekrandaki 'Yeniden araştır'); yalnızca kullanıcı güncel veri isterse. Günlük yeni araştırma hakkından düşer"},
                "etsy_competition": {"type": "boolean", "description": "true ise en çok aranan ilk 15 kelime için Etsy'deki aktif ilan sayısını da ölçer (gerçek Etsy rekabeti; yalnızca kullanıcı rekabeti/fırsatı sorarsa)"},
            },
            "required": ["seed"],
        },
    },
    {
        "name": "keyword_detail",
        "description": (
            "Tek bir kelimenin ayrıntısı (Keşfet'te kelimeye tıklayınca açılan pencere): son 12 ayın ay ay Google araması, mevsimsellik (hangi aylar zirve), CPC, reklam rekabeti, niyet. "
            "'Bu kelime hangi ay zirve yapıyor', 'mevsimsel mi', 'son aylarda arama nasıl' soruları için. Kelime daha önce research_keywords ile havuza girmiş olmalı; yoksa 'olculmemis' döner. "
            "Kredi harcamaz; mevsimsellik ilk kez isteniyorsa 1-2 dakikada hazır olur. Aylık araması çok düşük kelimede mevsimsellik hesaplanmaz."
        ),
        "input_schema": {"type": "object", "properties": {"term": {"type": "string", "description": "Kelime/ifade (İngilizce)"}}, "required": ["term"]},
    },
    {
        "name": "upcoming_seasons",
        "description": (
            "Mağazanın en sık kullandığı etiketlerden ÖNÜMÜZDEKİ 3 AYDA arama zirvesi yapacak olanlar (Keşfet ana ekranındaki 'Yaklaşan sezon'). "
            "'Yaklaşan sezonda neye hazırlanmalıyım', 'hangi ürünüm yakında zirve yapar', 'bu ay/önümüzdeki aylarda ne satar' soruları için. Kredi harcamaz; hesaplanmamış mevsimsellikler arka planda hazırlanır."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "discover_overview",
        "description": (
            "Keşfet ana ekranının tüm kartları tek seferde: etiketlerin SEZON TAKVİMİ, yükselen ve düşen kelimeler, fırsat kelimeler (mağazanın kullanmadığı, çok aranan, kalabalık olmayan), "
            "ÜLKELERE GÖRE Google talebi (hangi ülkeler bu etiketleri arıyor) ve MÜŞTERİ ÜLKELERİ (mağazanın gerçek siparişleri). "
            "'Hangi ülkeler arıyor', 'müşterilerim nereden', 'hangi kelimelerim yükseliyor/düşüyor', 'fırsat kelime var mı', 'sezon takvimim' soruları için. Kredi harcamaz; yalnızca ortak havuzu ve mağazanın siparişlerini okur."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
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
EXECUTORS = {"upcoming_seasons": upcoming_seasons, "discover_overview": discover_overview, "keyword_detail": keyword_detail, "research_keywords": research_keywords, "saved_keywords": saved_keywords, "save_keywords": save_keywords, "etsy_top_results": etsy_top_results}
LABELS = {"upcoming_seasons": "Yaklaşan sezonlara bakıyor", "discover_overview": "Kelime panosuna bakıyor", "keyword_detail": "Kelimenin ayrıntısına bakıyor", "etsy_top_results": "Etsy'deki rakiplere bakıyor", "research_keywords": "Kelimeleri araştırıyor", "saved_keywords": "Kayıtlı kelimelere bakıyor", "save_keywords": "Kelimeleri kaydediyor"}
LABELS_EN = {"upcoming_seasons": "Checking upcoming seasons", "discover_overview": "Looking at the keyword dashboard", "keyword_detail": "Looking at the keyword details", "etsy_top_results": "Looking at Etsy competitors", "research_keywords": "Researching keywords", "saved_keywords": "Looking at saved keywords", "save_keywords": "Saving keywords"}
