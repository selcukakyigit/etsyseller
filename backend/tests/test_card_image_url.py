"""Liste kartı küçük resmi: 570 px'lik sürüm; yoksa daha küçük ya da tam boy (170 px büyütülünce bulanık görünüyordu)."""
from app.listings import service


def test_card_uses_the_570_version_and_falls_back():
    full = {"url_170x135": "s", "url_570xN": "m", "url_fullxfull": "l"}
    assert service.card_image_url(full) == "m"
    assert service.card_image_url({"url_170x135": "s", "url_fullxfull": "l"}) == "l"
    assert service.card_image_url({"url_170x135": "s"}) == "s"
    assert service.card_image_url({}) is None
