"""İndirme başlığı: dosyayı tarayıcıda açmak yerine indirtir. Ad UTF-8 olarak kodlanır (Türkçe karakterli ad bozulmaz); tek yerde durur."""
from urllib.parse import quote


def attachment(filename: str) -> dict[str, str]:
    """`Content-Disposition: attachment` başlığı, ör. headers.update(attachment("resim.png"))."""
    return {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}
