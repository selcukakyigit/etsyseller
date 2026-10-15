"""HTTP bayt aralığı (Range) yanıtı. iOS Safari ve bazı tarayıcılar videoyu yalnızca aralık isteğini destekleyen sunucudan
oynatır; dosya zaten belleğe okunduğu için dilim alınıp 206 olarak döner."""
import re

from fastapi.responses import Response

_RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


def ranged(content: bytes, media_type: str, range_header: str, headers: dict[str, str]) -> Response:
    """Geçerli bir `Range: bytes=a-b` için 206, geçersizse 416, birden fazla aralıkta ya da tanınmayan biçimde tüm dosya (200)."""
    total = len(content)
    match = _RANGE.match(range_header.strip())
    if match is None:
        return Response(content, media_type=media_type, headers=headers)
    start_text, end_text = match.groups()
    if start_text == "" and end_text == "":
        return Response(content, media_type=media_type, headers=headers)
    if start_text == "":  # son N bayt
        start, end = max(0, total - int(end_text)), total - 1
    else:
        start, end = int(start_text), min(int(end_text) if end_text else total - 1, total - 1)
    if start >= total or start > end:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{total}"})
    return Response(content[start : end + 1], status_code=206, media_type=media_type, headers={**headers, "Content-Range": f"bytes {start}-{end}/{total}"})
