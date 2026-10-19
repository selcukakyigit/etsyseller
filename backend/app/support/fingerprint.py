"""Hata metninden kararlı parmak izi: sayılar, kimlikler ve saatler atılır ki aynı hatanın tekrarları aynı grupta toplansın."""
import hashlib
import re

_TIME = re.compile(r"^\d{2}:\d{2}:\d{2}\s+")
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
_HEX = re.compile(r"\b[0-9a-f]{12,}\b", re.I)
_NUM = re.compile(r"\d+")


def fingerprint(message: str) -> str:
    text = _TIME.sub("", message.strip().lower())
    text = _NUM.sub("#", _HEX.sub("#", _UUID.sub("#", text)))
    return hashlib.sha1(re.sub(r"\s+", " ", text)[:300].encode()).hexdigest()[:16]
