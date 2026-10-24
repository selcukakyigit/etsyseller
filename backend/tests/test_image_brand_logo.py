"""Görsel istemlerinde marka kuralı ve satıcının kendi logosu: başkasının markası yasak, logo verilirse birebir yerleştirilir."""
from app.ai import image_gen


def _capture(monkeypatch):
    seen = {}

    def fake_run(parts, *args, **kwargs):
        seen["parts"] = parts
        return b"img", "image/png"

    monkeypatch.setattr(image_gen, "_run", fake_run)
    return seen


def _text(parts) -> str:
    return " ".join(p.text for p in parts if getattr(p, "text", None))


def _images(parts) -> int:
    return sum(1 for p in parts if getattr(p, "inline_data", None) is not None)


def test_regenerate_without_logo_forbids_other_brands(monkeypatch):
    seen = _capture(monkeypatch)
    image_gen.regenerate_image(b"src", "image/png", "park scene")
    text = _text(seen["parts"])
    assert "MARKA KURALI" in text and "Stanley" in text
    assert "LOGO TALİMATI" not in text
    assert _images(seen["parts"]) == 1


def test_regenerate_with_logo_adds_second_image_and_directive(monkeypatch):
    seen = _capture(monkeypatch)
    image_gen.regenerate_image(b"src", "image/png", "put logo on the cap", logo=(b"logo", "image/png"))
    text = _text(seen["parts"])
    assert _images(seen["parts"]) == 2
    assert "LOGO TALİMATI" in text and "ikinci verilen görsel" in text


def test_logo_ordinal_follows_other_references(monkeypatch):
    seen = _capture(monkeypatch)
    image_gen.regenerate_image(b"src", "image/png", None, reference=(b"ref", "image/png"), logo=(b"logo", "image/png"))
    assert "üçüncü verilen görsel" in _text(seen["parts"])


def test_generate_from_text_with_logo(monkeypatch):
    seen = _capture(monkeypatch)
    image_gen.generate_from_text("white mug", reference=(b"design", "image/png"), logo=(b"logo", "image/png"))
    text = _text(seen["parts"])
    assert _images(seen["parts"]) == 2
    assert "üçüncü verilen görsel" not in text and "ikinci verilen görsel" in text
    assert "MARKA KURALI" in text
