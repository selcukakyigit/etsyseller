import datetime as dt


def iso(value: dt.datetime | None) -> str | None:
    """Veritabanındaki saatler UTC ve saat dilimsizdir; ön yüz yerel saate doğru çevirsin diye "Z" eklenir."""
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return value.isoformat() + "Z"
