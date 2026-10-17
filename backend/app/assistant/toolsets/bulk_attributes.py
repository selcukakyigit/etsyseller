"""Toplu özellik düzenleme: bir kategori özelliğini (ör. Holiday = Christmas) birçok listing'e uygular.
Her listing kendi kategorisinin özellik tanımına göre doğrulanır: özelliği olmayan ya da değeri izin verilmeyen listing atlanır ve sayılır; varyasyonla
karşılanan özellik yazılmaz. Önce ÖNİZLEME (hiçbir şey yazılmaz), kullanıcı onaylayınca yalnızca YEREL TASLAK yazılır (Etsy'ye gitmez)."""
import copy
import html
import json
from collections import Counter

from sqlalchemy import select

from app.assistant import fields
from app.core.i18n import tr
from app.listings import bulk, drafts
from app.listings.models import ListingCache

MAX_LISTINGS = 300
SAMPLE = 8


def _rows(ctx, a: dict) -> list[ListingCache]:
    q = select(ListingCache).where(ListingCache.shop_id == ctx.shop.id)
    ids = [int(i) for i in a.get("listing_ids") or []]
    if ids:
        q = q.where(ListingCache.listing_id.in_(ids))
    if a.get("title_contains"):
        q = q.where(ListingCache.title.like(f"%{str(a['title_contains']).strip()}%"))
    rows = ctx.db.scalars(q.limit(MAX_LISTINGS * 3)).all()
    if not a.get("include_inactive"):
        rows = [r for r in rows if json.loads(r.raw_json).get("state") == "active"]
    return rows[:MAX_LISTINGS]


def bulk_set_attributes(ctx, a: dict) -> dict:
    from app.assistant.tools import _category_defs, _covered_by_variation

    items = [x for x in a.get("attributes") or [] if x.get("name") and x.get("values")]
    if not items:
        return {"error": "attributes ver: [{name: 'Holiday', values: ['Christmas']}]."}
    rows = _rows(ctx, a)
    if not rows:
        return {"error": "Eşleşen listing yok (listing_ids ya da title_contains ver; varsayılan yalnızca aktif listing'ler)."}
    confirm = bool(a.get("confirm"))
    defs_cache: dict[int, list[dict]] = {}
    reasons: Counter = Counter()
    changed_rows: list[tuple[ListingCache, dict, dict]] = []
    for row in rows:
        raw = json.loads(row.raw_json)
        tid = raw.get("taxonomy_id")
        if not tid:
            reasons["kategorisi yok"] += 1
            continue
        if tid not in defs_cache:
            try:
                defs_cache[tid] = _category_defs(int(tid))
            except Exception:  # noqa: BLE001
                defs_cache[tid] = []
        defs = defs_cache[tid]
        live = bulk.snapshot_cached(row)
        local = drafts._local_row(ctx.db, ctx.shop, row.listing_id)
        work = json.loads(local.data_json) if local else copy.deepcopy(live)
        usable = [x for x in items if not _covered_by_variation(work, str(x["name"]))]
        if not usable:
            reasons["renk/boyut zaten varyasyonda"] += 1
            continue
        before = json.dumps(work.get("properties"), sort_keys=True)
        changed, errors = fields.apply_attributes(work, defs, usable)
        if changed and json.dumps(work.get("properties"), sort_keys=True) == before:
            changed = []  # değerler zaten böyleydi
        if errors and not changed:
            reasons["özellik bu kategoride yok ya da değer izin verilenlerde değil"] += 1
            continue
        if not changed:
            reasons["zaten aynı"] += 1
            continue
        changed_rows.append((row, work, live))
    if confirm:
        for row, work, live in changed_rows:
            drafts.save_local(ctx.db, ctx.shop, row.listing_id, work, live)
    sample = [html.unescape(r.title or "")[:70] for r, _, _ in changed_rows[:SAMPLE]]
    ctx.cards.append({
        "type": "status", "title": tr("Toplu özellik", "Bulk attributes") + ("" if confirm else tr(" (önizleme)", " (preview)")),
        "rows": [
            {"label": tr("Uygulanan", "Applied") if confirm else tr("Uygulanacak", "Will apply"), "value": len(changed_rows)},
            {"label": tr("Atlanan", "Skipped"), "value": sum(reasons.values())}, {"label": tr("İncelenen", "Checked"), "value": len(rows)},
        ],
    })
    out = {
        "incelenen": len(rows), "uygulanan" if confirm else "uygulanacak": len(changed_rows), "atlanan_nedenleriyle": dict(reasons), "ornek_listingler": sample,
        "istenen": [{"ad": x["name"], "degerler": x["values"]} for x in items],
    }
    out["not"] = (
        "Yerel taslak olarak yazıldı, Etsy'ye gitmedi; kullanıcı Listing'ler sayfasından 'Yayınlanmamışları seç' → 'Seçilenleri Etsy'de yayınla' ile gönderir. Çok sayıda listing'e aynı anda dokunmak etki ölçümünü bulandırır, bunu söyle."
        if confirm else
        "ÖNİZLEME: hiçbir şey yazılmadı. Kullanıcıya kaç listing etkileneceğini, kaçının neden atlandığını ve örnek başlıkları söyle; AÇIK onay verirse aynı parametrelerle confirm=true ile tekrar çağır."
    )
    return out


TOOLS: list[dict] = [
    {
        "name": "bulk_set_attributes",
        "description": "Bir kategori özelliğini (ör. Holiday=Christmas, Occasion=Birthday) birçok listing'e TOPLU uygular. Her listing kendi kategorisine göre doğrulanır; özelliği olmayan/değeri izin verilmeyen/varyasyonla karşılanan listing atlanır. confirm VERMEDEN çağır: yalnızca önizleme (kaç listing etkilenir, kaçı atlanır, örnekler) döner; kullanıcı AÇIKÇA onaylayınca confirm=true ile tekrar çağır, yalnızca yerel taslak yazılır. Hedefi daralt: listing_ids ya da title_contains; hiçbiri verilmezse tüm aktif listing'ler (mantıklı mı diye kullanıcıya sor: ör. Christmas her ürüne uymaz).",
        "input_schema": {"type": "object", "properties": {
            "attributes": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "values": {"type": "array", "items": {"type": "string"}}}, "required": ["name", "values"]}},
            "listing_ids": {"type": "array", "items": {"type": "integer"}}, "title_contains": {"type": "string"},
            "include_inactive": {"type": "boolean", "description": "Yalnızca kullanıcı pasif/taslak listing'leri de istediyse true; varsayılan yalnızca aktif listing'ler"}, "confirm": {"type": "boolean"},
        }, "required": ["attributes"]},
    },
]
EXECUTORS = {"bulk_set_attributes": bulk_set_attributes}
LABELS = {"bulk_set_attributes": "Toplu özellik uyguluyor"}
LABELS_EN = {"bulk_set_attributes": "Applying attributes in bulk"}
