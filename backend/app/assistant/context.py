"""Modele giden sohbet geçmişi: token bütçesi ve araç özetleri.

- Geçmiş mesaj SAYISIYLA değil tahmini TOKEN bütçesiyle sınırlanır: en yeni mesajdan geriye doğru bütçe dolana kadar
  eklenir. Böylece bir isteğin maliyeti, kullanıcı ne kadar uzun metin yapıştırmış olursa olsun öngörülebilir kalır.
- Son RECENT_FULL mesajdan eskileri OLD_MESSAGE_CHARS'ta kısaltılır (ör. üç mesaj önce yapıştırılan tablo zaten işlendi).
- Asistan mesajlarına o turda çağrılan araçların tek satırlık özetleri eklenir; model konuşulan listing/sipariş
  kimliklerini ve rakamları unutmaz. Özetler her araç sonucundan aynı genel kuralla çıkarılır (araca özel kod yok)."""
import json

from app.assistant.models import ChatMessage

HISTORY_TOKEN_BUDGET = 8000
MAX_HISTORY_ROWS = 40  # veritabanından çekilen üst sınır; asıl sınır bütçedir
RECENT_FULL = 4
OLD_MESSAGE_CHARS = 1500
CHARS_PER_TOKEN = 3  # Türkçe/JSON için temkinli tahmin (gerçek sayım sağlayıcıdan gelir, bkz. AssistantUsage)

TOOL_LINE_CHARS = 350
TOOL_NOTES_CHARS = 1500
_NAME_KEYS = ("baslik", "title", "ad", "name", "alici", "urun")


def estimate_tokens(text: str) -> int:
    return len(text) // CHARS_PER_TOKEN + 1


# ------------------------------------------------------------------ araç özetleri


def _scalar(v) -> bool:
    return v is None or isinstance(v, (str, int, float, bool))


def _short(v, n: int = 60) -> str:
    s = " ".join(str(v).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _item_label(item: dict) -> str:
    """Bir liste ögesinin kimliği ve adı: `#123 "Farm sign"`."""
    ident = next((item[k] for k in item if (k == "id" or k.endswith("_id")) and _scalar(item[k])), None)
    name = next((item[k] for k in _NAME_KEYS if isinstance(item.get(k), str)), None)
    parts = [f"#{ident}" if ident is not None else "", f'"{_short(name, 40)}"' if name else ""]
    return " ".join(p for p in parts if p)


def _compact(value) -> str:
    if isinstance(value, dict):
        scalars = [f"{k}={_short(v)}" for k, v in value.items() if _scalar(v)]
        nested = []
        for k, v in value.items():
            if isinstance(v, list):
                labels = [_item_label(i) for i in v[:5] if isinstance(i, dict)]
                labels = [x for x in labels if x]
                nested.append(f"{k}=[{len(v)}{': ' + ', '.join(labels) if labels else ''}]")
            elif isinstance(v, dict):
                nested.append(f"{k}={{…}}")
        return ", ".join(scalars + nested)
    if isinstance(value, list):
        return f"[{len(value)}]"
    return _short(value, TOOL_LINE_CHARS)


def summarize_tool_call(name: str, args: dict, result) -> str:
    """Tek satır: `get_listing(listing_id=12) → listing_id=12, baslik=…, etiketler=[13]`."""
    arg_text = ", ".join(f"{k}={_short(v, 40)}" for k, v in (args or {}).items() if _scalar(v))
    line = f"{name}({arg_text}) → {_compact(result)}"
    return line if len(line) <= TOOL_LINE_CHARS else line[: TOOL_LINE_CHARS - 1] + "…"


def tool_notes(lines: list[str]) -> str | None:
    """Bir turun araç özetleri; toplam uzunluk sınırlı (en son çağrılanlar korunur)."""
    out: list[str] = []
    total = 0
    for line in reversed(lines):
        if total + len(line) > TOOL_NOTES_CHARS:
            break
        out.append(line)
        total += len(line) + 1
    return "\n".join(reversed(out)) or None


# ------------------------------------------------------------------ geçmiş


def _message_text(m: ChatMessage, full: bool) -> str:
    text = m.content or ""
    if not full and len(text) > OLD_MESSAGE_CHARS:
        text = text[:OLD_MESSAGE_CHARS] + " … [kısaltıldı]"
    if m.role == "user":
        n_files = len(json.loads(m.image_ids_json or "[]"))
        if n_files:
            text += f"\n[Bu mesaja {n_files} dosya/resim eklenmişti]"
    elif m.tool_notes:
        text += f"\n\n[Araç özeti — yalnızca bağlam, kullanıcıya gösterilmedi]\n{m.tool_notes}"
    return text


def build_history(rows: list[ChatMessage], budget: int = HISTORY_TOKEN_BUDGET) -> list[dict]:
    """rows: eskiden yeniye. Döner: bütçeye sığan en yeni mesajlar, eskiden yeniye; ilk mesaj her zaman kullanıcınındır
    (sağlayıcılar sohbetin kullanıcı mesajıyla başlamasını bekler)."""
    picked: list[dict] = []
    used = 0
    for age, m in enumerate(reversed(rows)):
        text = _message_text(m, full=age < RECENT_FULL)
        cost = estimate_tokens(text)
        if picked and used + cost > budget:
            break
        picked.append({"role": m.role, "content": text})
        used += cost
    picked.reverse()
    while picked and picked[0]["role"] != "user":
        picked.pop(0)
    return picked
