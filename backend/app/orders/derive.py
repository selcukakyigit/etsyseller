"""Etsy makbuzundan (receipt) sorgulanabilir sütunlar türetir. Filtre/arama/sayfalama SQL'de yapılabilsin diye
her senkronizasyonda ve migration'da aynı fonksiyon kullanılır."""

import html


def derive(receipt: dict) -> dict:
    txs = receipt.get("transactions") or []
    personalized = False
    parts = [receipt.get("name") or "", str(receipt.get("receipt_id", "")), receipt.get("city") or ""]
    for t in txs:
        parts += [html.unescape(t.get("title") or ""), t.get("sku") or ""]
        for v in t.get("variations") or []:
            name = (v.get("formatted_name") or "").strip().lower()
            if name == "personalization" or v.get("question_id"):
                personalized = True
            parts.append(html.unescape(v.get("formatted_value") or ""))
    status = (receipt.get("status") or "").lower()
    return {
        "country_iso": receipt.get("country_iso") or "",
        "channel": "pattern" if receipt.get("receipt_type") == 1 else "etsy",
        "is_gift": bool(receipt.get("is_gift")),
        "has_note": bool(receipt.get("message_from_buyer")),
        "has_personalization": personalized,
        "has_upgrade": any(t.get("shipping_upgrade") for t in txs),
        "is_canceled": status in ("canceled", "fully refunded"),
        "search_text": " ".join(parts).lower(),
    }
