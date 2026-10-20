"""Listing çalışma kopyasındaki (düzenleyicinin `work` sözlüğü) alanları doğrulayarak yazan saf mantık.

Asistan araçları (tools.py) bunları kullanır; veritabanına ya da Etsy'ye dokunmaz, böylece her kural tek başına denenebilir.
Her fonksiyon (değişen alanlar, hatalar) döner: hata varsa o alan yazılmaz, diğerleri yazılır ve araç sonucu hatayı olduğu gibi
bildirir (model "yaptım" demeden önce neyin olmadığını görsün)."""
import re

WHO_MADE = ("i_did", "someone_else", "collective")
WHEN_MADE = (
    "made_to_order", "2020_2026", "2010_2019", "2007_2009", "before_2007", "2000_2006", "1990s", "1980s", "1970s", "1960s",
    "1950s", "1940s", "1930s", "1920s", "1910s", "1900s", "1800s", "1700s", "before_1700",
)
WEIGHT_UNITS = ("oz", "lb", "g", "kg")
DIMENSION_UNITS = ("in", "ft", "mm", "cm", "m", "yd", "inches")
QUESTION_TYPES = ("text_input", "dropdown", "unlabeled_upload", "labeled_upload")

MAX_MATERIALS = 13
MAX_STYLES = 2
MAX_STYLE_LEN = 45
MAX_QUESTIONS = 5  # Etsy "Custom options"
MAX_CHARACTERS = 1024
ECGT_LIMITS = {"ecgt_garan_brand": 25, "ecgt_garan_model": 20, "ecgt_garan_guarantee_details": 255}
ECGT_TEXT_LIMIT = 255  # diğer AB alanları
MAX_MULTI = 5  # Etsy çok değerli özelliklerde en fazla 5 seçim (düzenleyicideki PropertyFields ile aynı)
MAX_MULTI_BY_NAME = {"material features": 1}

_WORD_ONLY = re.compile(r"[^\w\s]|_", re.UNICODE)  # Etsy: malzeme/stil yalnızca harf, rakam ve boşluk içerir


def clean_words(values: list, limit: int, max_len: int | None = None) -> list[str]:
    out: list[str] = []
    for v in values:
        text = " ".join(_WORD_ONLY.sub(" ", re.sub(r"['’]", "", str(v))).split())  # "powder-coated" → "powder coated"; kesme işareti silinir
        if max_len:
            text = text[:max_len]
        if text and text.lower() not in {o.lower() for o in out}:
            out.append(text)
    return out[:limit]


def _norm_text(text) -> str:
    return " ".join(str(text or "").lower().split())


def _positive(value, name: str, errors: list[str]) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        errors.append(f"{name}: sayı olmalı.")
        return None
    if number <= 0:
        errors.append(f"{name}: 0'dan büyük olmalı.")
        return None
    return number


def _question(q: dict, errors: list[str]) -> dict | None:
    text = " ".join(str(q.get("question_text") or "").split())
    kind = q.get("question_type") or "text_input"
    if not text:
        errors.append("Kişiselleştirme sorusunun metni gerekli.")
        return None
    if kind not in QUESTION_TYPES:
        errors.append(f"Soru türü {', '.join(QUESTION_TYPES)} olmalı.")
        return None
    labels = [" ".join(str(o.get("label") if isinstance(o, dict) else o).split()) for o in (q.get("options") or []) if str(o.get("label") if isinstance(o, dict) else o).strip()]
    if kind == "dropdown" and len(labels) < 2:
        errors.append(f'"{text}" açılır liste sorusu için en az 2 seçenek gerekli.')
        return None
    max_chars = q.get("max_allowed_characters")
    if kind == "text_input":
        max_chars = int(max_chars) if max_chars else 256
        if not 1 <= max_chars <= MAX_CHARACTERS:
            errors.append(f"En fazla karakter 1 ile {MAX_CHARACTERS} arasında olmalı.")
            return None
    else:
        max_chars = None
    return {
        "question_id": None, "question_text": text, "instructions": str(q.get("instructions") or "")[:256], "question_type": kind,
        "required": bool(q.get("required")), "max_allowed_characters": max_chars,
        "max_allowed_files": 1 if kind in ("unlabeled_upload", "labeled_upload") else None,
        "options": [{"label": label, "option_id": None} for label in labels] if kind == "dropdown" else [], "add_on_price": None,
    }


def apply_fields(work: dict, f: dict, *, category_names: dict[int, str] | None = None, leaf_ids: set[int] | None = None) -> tuple[list[str], list[str]]:
    """`f` içindeki alanları doğrulayıp `work`'e yazar. Döner: (değişen alanlar, hatalar)."""
    changed: list[str] = []
    errors: list[str] = []

    def put(key: str, value, label: str | None = None) -> None:
        if work.get(key) != value:
            work[key] = value
            changed.append(label or key)

    if "materials" in f:
        put("materials", clean_words(f["materials"] or [], MAX_MATERIALS))
    if "style" in f:
        put("style", clean_words(f["style"] or [], MAX_STYLES, MAX_STYLE_LEN))
    for key, allowed in (("who_made", WHO_MADE), ("when_made", WHEN_MADE)):
        if key in f:
            if f[key] in allowed:
                put(key, f[key])
            else:
                errors.append(f"{key}: {', '.join(allowed)} değerlerinden biri olmalı.")
    for key in ("is_supply", "is_taxable"):
        if key in f:
            put(key, bool(f[key]))
    for key, name in (("weight", "item_weight"), ("length", "item_length"), ("width", "item_width"), ("height", "item_height")):
        if key in f:
            number = _positive(f[key], key, errors)
            if number is not None:
                put(name, number)
    for key, name, allowed in (("weight_unit", "item_weight_unit", WEIGHT_UNITS), ("dimensions_unit", "item_dimensions_unit", DIMENSION_UNITS)):
        if key in f:
            if f[key] in allowed:
                put(name, f[key])
            else:
                errors.append(f"{key}: {', '.join(allowed)} değerlerinden biri olmalı.")
    if "taxonomy_id" in f:
        tid = int(f["taxonomy_id"])
        if category_names is not None and tid not in category_names:
            errors.append("Kategori kimliği Etsy'de yok; find_category ile bul.")
        elif leaf_ids is not None and tid not in leaf_ids:
            errors.append(f"{category_names.get(tid, tid) if category_names else tid} alt kategorisi olan bir üst kategori; en alttaki bir kategori seç.")
        else:
            put("taxonomy_id", tid)
    if "sku" in f:
        products = work.get("inventory", {}).get("products", [])
        if len(products) == 1:
            if products[0].get("sku") != f["sku"]:
                products[0]["sku"] = str(f["sku"])[:32]
                changed.append("sku")
        else:
            errors.append("SKU yalnızca tek ürünlü (varyasyonsuz) listing'de ayarlanır; varyasyonlu listing'de her kombinasyonun SKU'su düzenleyiciden girilir.")
    if "personalization_questions" in f:
        raw = f["personalization_questions"] or []
        if len(raw) > MAX_QUESTIONS:
            errors.append(f"En fazla {MAX_QUESTIONS} kişiselleştirme sorusu olabilir.")
        else:
            questions = [q for q in (_question(q, errors) for q in raw) if q is not None]
            if len(questions) == len(raw):
                put("personalization", {"questions": questions}, "personalization_questions")
    if "add_personalization_questions" in f:  # mevcutlara ekler (ör. "daha önce kullanılanlar"dan seçilenler); aynı metinli soru atlanır
        existing = (work.get("personalization") or {}).get("questions", [])
        have = {_norm_text(q.get("question_text")) for q in existing}
        added = [q for q in (_question(q, errors) for q in f["add_personalization_questions"] or []) if q is not None and _norm_text(q["question_text"]) not in have]
        if len(existing) + len(added) > MAX_QUESTIONS:
            errors.append(f"En fazla {MAX_QUESTIONS} kişiselleştirme sorusu olabilir (şu an {len(existing)}).")
        elif added:
            put("personalization", {"questions": [*existing, *added]}, "personalization_questions")
    if "featured_rank" in f:
        rank = f["featured_rank"]
        if isinstance(rank, int) and rank >= 1:
            put("featured_rank", rank)
        else:
            errors.append("featured_rank 1 ya da daha büyük bir sayı olmalı.")
    for key in ("ecgt_garan_brand", "ecgt_garan_model", "ecgt_garan_guarantee_details", "ecgt_other_commercial_guarantee_details", "ecgt_after_sales_service_info", "ecgt_software_update_details"):
        if key in f:
            text = " ".join(str(f[key] or "").split())
            limit = ECGT_LIMITS.get(key, ECGT_TEXT_LIMIT)
            if len(text) > limit:
                errors.append(f"{key}: en fazla {limit} karakter.")
            else:
                put(key, text or None)
    if "ecgt_garan_years" in f:
        years = f["ecgt_garan_years"]
        if years is None or (isinstance(years, int) and 3 <= years <= 99):
            put("ecgt_garan_years", years)
        else:
            errors.append("ecgt_garan_years 3 ile 99 arasında bir tam sayı olmalı.")
    guarantee = ("ecgt_garan_brand", "ecgt_garan_model", "ecgt_garan_years", "ecgt_garan_guarantee_details")
    if any(k in f for k in guarantee) and any(work.get(k) for k in guarantee) and not all(work.get(k) for k in guarantee):
        errors.append("AB ticari garanti alanlarından biri doluysa dördü de (marka, model, yıl, ayrıntı) gerekli.")
    return changed, errors


def edit_question(work: dict, number: int, edits: dict) -> tuple[list[str], list[str]]:
    """Tek bir kişiselleştirme sorusunu sıra numarasıyla (1'den başlar) düzenler, siler ya da taşır; sorunun kimliği ve seçeneklerinin kimlikleri korunur
    (düzenleyicideki Düzenle / Sil / ↑↓ ile aynı). `edits`: delete, move_to, question_text, instructions, required, max_allowed_characters, options.
    Döner: (değişenler, hatalar)."""
    questions = (work.get("personalization") or {}).get("questions", [])
    if not 1 <= number <= len(questions):
        return [], [f"Kişiselleştirme sorusu bulunamadı; {len(questions)} soru var (1–{len(questions)})."]
    q = questions[number - 1]
    changed: list[str] = []
    errors: list[str] = []
    if edits.get("delete"):
        questions.pop(number - 1)
        work["personalization"] = {"questions": questions}
        return ["silindi"], []
    if edits.get("question_text") is not None:
        text = " ".join(str(edits["question_text"]).split())
        if not text:
            errors.append("Soru metni boş olamaz.")
        elif text != q.get("question_text"):
            q["question_text"] = text
            changed.append("question_text")
    if edits.get("instructions") is not None and str(edits["instructions"])[:256] != (q.get("instructions") or ""):
        q["instructions"] = str(edits["instructions"])[:256]
        changed.append("instructions")
    if edits.get("required") is not None and bool(edits["required"]) != bool(q.get("required")):
        q["required"] = bool(edits["required"])
        changed.append("required")
    if edits.get("max_allowed_characters") is not None:
        if q.get("question_type") != "text_input":
            errors.append("En fazla karakter yalnızca metin kutusu sorularında ayarlanır.")
        elif not 1 <= int(edits["max_allowed_characters"]) <= MAX_CHARACTERS:
            errors.append(f"En fazla karakter 1 ile {MAX_CHARACTERS} arasında olmalı.")
        elif int(edits["max_allowed_characters"]) != q.get("max_allowed_characters"):
            q["max_allowed_characters"] = int(edits["max_allowed_characters"])
            changed.append("max_allowed_characters")
    if edits.get("options") is not None:
        labels = [" ".join(str(o).split()) for o in edits["options"] if str(o).strip()]
        if q.get("question_type") != "dropdown":
            errors.append("Seçenekler yalnızca seçenek listesi (dropdown) sorularında ayarlanır.")
        elif len(labels) < 2:
            errors.append("Seçenek listesi için en az 2 seçenek gerekli.")
        else:
            known = {_norm_text(o.get("label")): o.get("option_id") for o in q.get("options") or [] if isinstance(o, dict)}
            new = [{"label": label, "option_id": known.get(_norm_text(label))} for label in labels]
            if [o["label"] for o in new] != [o.get("label") for o in q.get("options") or []]:
                q["options"] = new
                changed.append("options")
    if edits.get("move_to") is not None:
        to = int(edits["move_to"])
        if not 1 <= to <= len(questions):
            errors.append(f"Hedef sıra 1 ile {len(questions)} arasında olmalı.")
        elif to != number:
            questions.insert(to - 1, questions.pop(number - 1))
            changed.append("sira")
    work["personalization"] = {"questions": questions}
    return changed, errors


# ------------------------------------------------------------------ kategori özellikleri

def attribute_defs(defs: list[dict]) -> list[dict]:
    """Düzenleyicide (PropertyFields) gösterilen özellikler: değeri seçilebilir ya da birimli ölçü olanlar."""
    return [d for d in defs if d.get("supports_attributes") and (d.get("possible_values") or d.get("scales"))]


def _norm(text) -> str:
    return " ".join(str(text).lower().split())


def _is_dimension(d: dict) -> bool:
    return not d.get("possible_values") and bool(d.get("scales"))


def _max_values(d: dict) -> int:
    return MAX_MULTI_BY_NAME.get(_norm(d.get("display_name", "")), MAX_MULTI) if d.get("is_multivalued") else 1


def describe(defs: list[dict], work: dict, max_values: int = 40) -> dict:
    """Modelin görmesi için kategori özellikleri: zorunlu mu, izin verilen değerler, birimler ve şu anki seçim."""
    current = {p["property_id"]: p for p in work.get("properties", [])}
    rows = []
    for d in attribute_defs(defs):
        mine = current.get(d["property_id"])
        row = {"ad": d["display_name"], "zorunlu": bool(d.get("is_required")), "en_fazla_secim": _max_values(d), "secili": (mine or {}).get("values") or []}
        if _is_dimension(d):
            row["birimler"] = [s["display_name"] for s in d["scales"]]
            row["tur"] = "ölçü (sayı + birim)"
        else:
            names = [v["name"] for v in d["possible_values"]]
            row["izin_verilen_degerler"] = names[:max_values] + ([f"… (+{len(names) - max_values} daha)"] if len(names) > max_values else [])
            if d.get("scales") and any(v.get("scale_id") is not None for v in d["possible_values"]):  # ölçekli (beden): değerler ölçeğe göre gruplu
                by_scale: dict[str, list[str]] = {}
                for sc in d["scales"]:
                    by_scale[sc["display_name"]] = [v["name"] for v in d["possible_values"] if v.get("scale_id") == sc["scale_id"]][:12]
                row["olcekler"] = by_scale
                row["tur"] = "ölçekli (tek ölçek seç: değerler ölçeğe aittir)"
        rows.append(row)
    return {"ozellikler": rows, "eksik_zorunlu": [r["ad"] for r in rows if r["zorunlu"] and not r["secili"]]}


def _find_def(defs: list[dict], name: str) -> dict | None:
    key = _norm(name)
    exact = [d for d in defs if key in (_norm(d.get("display_name", "")), _norm(d.get("name", "")))]
    if len(exact) == 1:
        return exact[0]
    near = [d for d in defs if key and (key in _norm(d.get("display_name", "")) or _norm(d.get("display_name", "")) in key)]
    return near[0] if len(near) == 1 else None


def _find_value(d: dict, text: str) -> dict | None:
    key = _norm(text)
    values = d["possible_values"]
    exact = [v for v in values if _norm(v["name"]) == key]
    if exact:
        return exact[0]
    near = [v for v in values if key and (key in _norm(v["name"]) or _norm(v["name"]) in key)]
    return near[0] if len(near) == 1 else None


def apply_attributes(work: dict, defs: list[dict], items: list[dict]) -> tuple[list[str], list[str]]:
    """`items`: [{name, values: [...], unit}] özellik seçimlerini kategori tanımına göre doğrulayıp `work["properties"]`'e yazar.
    Boş `values` o özelliği kaldırır. İzin verilen listede olmayan değer yazılmaz (hata olarak döner)."""
    usable = attribute_defs(defs)
    properties = {p["property_id"]: p for p in work.get("properties", [])}
    managed = list(work.get("managed_property_ids", []))
    changed: list[str] = []
    errors: list[str] = []
    for item in items:
        d = _find_def(usable, str(item.get("name", "")))
        if d is None:
            errors.append(f'"{item.get("name")}" bu kategoride bir özellik değil. Mevcutlar: ' + ", ".join(x["display_name"] for x in usable))
            continue
        pid, label = d["property_id"], d["display_name"]
        values = [str(v) for v in (item.get("values") or []) if str(v).strip()]
        if pid not in managed:
            managed.append(pid)  # yayın yalnızca düzenleyicinin yönettiği özellikleri yazar (bkz. drafts.py managed_property_ids)
        if not values:
            if properties.pop(pid, None) is not None:
                changed.append(label)
            continue
        if _is_dimension(d):
            unit = next((s for s in d["scales"] if _norm(s["display_name"]) == _norm(item.get("unit") or "")), None)
            if unit is None:
                errors.append(f'{label}: birim gerekli ({", ".join(s["display_name"] for s in d["scales"])}).')
                continue
            try:
                number = float(values[0].replace(",", "."))
            except ValueError:
                errors.append(f"{label}: değer sayı olmalı.")
                continue
            properties[pid] = {"property_id": pid, "property_name": label, "scale_id": unit["scale_id"], "value_ids": [], "values": [f"{number:g}"]}
            changed.append(label)
            continue
        limit = _max_values(d)
        if len(values) > limit:
            errors.append(f"{label}: en fazla {limit} seçim yapılabilir.")
            continue
        matched = [_find_value(d, v) for v in values]
        unknown = [v for v, m in zip(values, matched) if m is None]
        if unknown:
            allowed = [v["name"] for v in d["possible_values"]]
            errors.append(f'{label}: "{", ".join(unknown)}" izin verilen değerlerde yok. İzin verilenler: ' + ", ".join(allowed[:30]) + (" …" if len(allowed) > 30 else ""))
            continue
        chosen = list({m["value_id"]: m for m in matched}.values())
        scale_ids = {m.get("scale_id") for m in chosen} - {None}
        if len(scale_ids) > 1:  # ölçekli özellik (Size): bir listing'de tek ölçek kullanılır
            scales = {s["scale_id"]: s.get("display_name", "") for s in d.get("scales", [])}
            errors.append(f'{label}: seçimler farklı ölçeklerde ({", ".join(sorted(str(scales.get(s, s)) for s in scale_ids))}); tek bir ölçekten seç.')
            continue
        properties[pid] = {"property_id": pid, "property_name": label, "scale_id": next(iter(scale_ids), None), "value_ids": [m["value_id"] for m in chosen], "values": [m["name"] for m in chosen]}
        changed.append(label)
    work["properties"] = list(properties.values())
    work["managed_property_ids"] = managed
    return changed, errors


def keep_applicable_properties(work: dict, defs: list[dict]) -> list[str]:
    """Kategori değişince yeni kategoride karşılığı olmayan özellikleri kaldırır; kaldırılanların adlarını döner."""
    valid = {d["property_id"] for d in attribute_defs(defs)}
    gone = [p for p in work.get("properties", []) if p["property_id"] not in valid]
    work["properties"] = [p for p in work.get("properties", []) if p["property_id"] in valid]
    # Yönetilen kimliklerde kalırlar: Etsy'deki listing'de yayınlanırken bu özellikler silinir.
    work["managed_property_ids"] = list(dict.fromkeys([*work.get("managed_property_ids", []), *(p["property_id"] for p in gone)]))
    return [p["property_name"] for p in gone]
