"""Örnek mağazanın ürün görsellerini (10 adet, ilan başına 2) frontend/public/demo/ altına SVG olarak yazar.

Görseller elle çizilmiş basit vektör çizimlerdir: gerçek bir mağazanın fotoğrafı değildir, telif ve gizlilik sorunu yoktur.
Yeniden üretmek gerekirse: python scripts/make_demo_images.py (çıktı depoya eklenir, çalışma zamanında üretilmez).
"""
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo"

W = 1000


def svg(body: str, bg: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {W}" width="{W}" height="{W}">'
        f'<rect width="{W}" height="{W}" fill="{bg}"/>'
        f'<ellipse cx="500" cy="860" rx="330" ry="34" fill="#000" opacity=".08"/>{body}</svg>'
    )


def speckles(cx: int, cy: int, rx: int, ry: int, n: int, color: str, seed: int) -> str:
    out, s = [], seed
    for _ in range(n):
        s = (s * 1103515245 + 12345) % (2**31)
        a = (s % 628) / 100
        s = (s * 1103515245 + 12345) % (2**31)
        r = (s % 1000) / 1000
        x = cx + (rx * 0.9) * r * __import__("math").cos(a)
        y = cy + (ry * 0.9) * r * __import__("math").sin(a)
        out.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{2 + (s % 4)}" fill="{color}" opacity=".55"/>')
    return "".join(out)


IMAGES: dict[str, str] = {}

# 1. Mug — yandan görünüş ve üstten görünüş
IMAGES["mug-1"] = svg(
    '<path d="M300 300 H640 V700 Q640 800 540 800 H400 Q300 800 300 700 Z" fill="#E8DCC8"/>'
    '<path d="M640 380 Q780 380 780 500 Q780 620 640 620" fill="none" stroke="#E8DCC8" stroke-width="46" stroke-linecap="round"/>'
    '<ellipse cx="470" cy="300" rx="170" ry="34" fill="#D4C4A8"/><ellipse cx="470" cy="304" rx="146" ry="24" fill="#5A3B2A"/>'
    + speckles(470, 560, 160, 220, 70, "#7A5A3A", 11),
    "#F2EBDD",
)
IMAGES["mug-2"] = svg(
    '<circle cx="500" cy="500" r="330" fill="#E8DCC8"/><circle cx="500" cy="500" r="270" fill="#4A2F20"/>'
    '<circle cx="500" cy="500" r="230" fill="#6B4630"/>'
    '<path d="M820 430 Q930 430 930 500 Q930 570 820 570" fill="none" stroke="#E8DCC8" stroke-width="40" stroke-linecap="round"/>'
    + speckles(500, 500, 320, 320, 60, "#7A5A3A", 5),
    "#EADFCB",
)

# 2. Saksı — küçük saksı ve tabaklı büyük saksı
IMAGES["planter-1"] = svg(
    '<path d="M580 330 Q540 140 470 250 Q420 120 400 330 Q340 190 300 300 Q380 340 500 340 Z" fill="#5E8C61"/>'
    '<path d="M500 340 Q460 200 420 130" stroke="#4A7350" stroke-width="10" fill="none"/>'
    '<path d="M300 380 H700 L650 780 Q645 810 610 810 H390 Q355 810 350 780 Z" fill="#C97B5A"/>'
    '<rect x="285" y="350" width="430" height="60" rx="18" fill="#B86A4A"/>'
    '<ellipse cx="500" cy="840" rx="230" ry="26" fill="#A85C3E"/>',
    "#F4E9E1",
)
IMAGES["planter-2"] = svg(
    '<path d="M350 330 Q300 150 230 260 Q180 140 160 340 Z" fill="#6E9B6F"/>'
    '<path d="M250 380 H570 L535 720 Q530 750 500 750 H320 Q290 750 285 720 Z" fill="#E6D3BE"/>'
    '<rect x="238" y="352" width="344" height="50" rx="16" fill="#D9C4AB"/>'
    '<path d="M640 470 H900 L875 740 Q872 765 845 765 H695 Q668 765 665 740 Z" fill="#8FA89A"/>'
    '<rect x="615" y="445" width="310" height="46" rx="14" fill="#7E9889"/>'
    '<path d="M740 470 Q720 380 690 340 Q760 360 800 470 Z" fill="#6E9B6F"/>',
    "#EEF0E8",
)

# 3. Mum — kavanozlu mum ve kapağı
IMAGES["candle-1"] = svg(
    '<path d="M500 220 Q440 300 500 360 Q560 300 500 220 Z" fill="#F2A33A"/><path d="M500 270 Q470 310 500 345 Q530 310 500 270 Z" fill="#FFD27A"/>'
    '<rect x="496" y="340" width="8" height="46" fill="#3B2A1E"/>'
    '<path d="M300 400 H700 V740 Q700 800 640 800 H360 Q300 800 300 740 Z" fill="#DDE3D6"/>'
    '<rect x="300" y="400" width="400" height="60" fill="#CAD2C0"/><rect x="330" y="470" width="340" height="250" rx="14" fill="#F7F3EA"/>'
    '<text x="500" y="610" font-family="Georgia,serif" font-size="46" text-anchor="middle" fill="#6C7A62">SOY CANDLE</text>',
    "#EFF1EA",
)
IMAGES["candle-2"] = svg(
    '<ellipse cx="500" cy="540" rx="300" ry="250" fill="#DDE3D6"/><ellipse cx="500" cy="540" rx="250" ry="205" fill="#F7F3EA"/>'
    '<circle cx="500" cy="540" r="10" fill="#3B2A1E"/>'
    '<ellipse cx="840" cy="780" rx="80" ry="20" fill="#C9B79B"/><rect x="760" y="768" width="160" height="20" rx="6" fill="#B49A76"/>',
    "#E7EADF",
)

# 4. Kaseler — yan görünüş (3 iç içe) ve üstten
IMAGES["bowls-1"] = svg(
    '<path d="M180 460 H820 Q800 760 500 780 Q200 760 180 460 Z" fill="#9AB3B8"/>'
    '<path d="M260 560 H740 Q720 810 500 820 Q280 810 260 560 Z" fill="#C7D6D2"/>'
    '<path d="M330 640 H670 Q650 830 500 838 Q350 830 330 640 Z" fill="#E9EFEA"/>'
    '<ellipse cx="500" cy="460" rx="320" ry="52" fill="#86A0A6"/>',
    "#F0F3F1",
)
IMAGES["bowls-2"] = svg(
    '<circle cx="500" cy="500" r="360" fill="#9AB3B8"/><circle cx="500" cy="500" r="300" fill="#7F989E"/>'
    '<circle cx="500" cy="500" r="240" fill="#C7D6D2"/><circle cx="500" cy="500" r="190" fill="#B3C5C1"/>'
    '<circle cx="500" cy="500" r="130" fill="#E9EFEA"/><circle cx="500" cy="500" r="85" fill="#D6E0DC"/>',
    "#EAF0EE",
)

# 5. Yüzük tabağı — isimli ve yüzüklü
IMAGES["dish-1"] = svg(
    '<ellipse cx="500" cy="540" rx="320" ry="270" fill="#F1E7DC"/><ellipse cx="500" cy="540" rx="270" ry="220" fill="#FBF6EF"/>'
    '<text x="500" y="560" font-family="Georgia,serif" font-size="110" font-style="italic" text-anchor="middle" fill="#B98D6A">Emma</text>'
    '<path d="M360 650 Q500 700 640 650" stroke="#D9BFA6" stroke-width="6" fill="none"/>',
    "#F7EFE5",
)
IMAGES["dish-2"] = svg(
    '<ellipse cx="500" cy="560" rx="320" ry="260" fill="#F1E7DC"/><ellipse cx="500" cy="560" rx="270" ry="212" fill="#FBF6EF"/>'
    '<circle cx="470" cy="560" r="62" fill="none" stroke="#C9A24D" stroke-width="16"/><circle cx="470" cy="498" r="20" fill="#9FD3E6"/>'
    '<circle cx="610" cy="590" r="46" fill="none" stroke="#D9D9D9" stroke-width="12"/>',
    "#F4ECE2",
)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, content in IMAGES.items():
        (OUT / f"{name}.svg").write_text(content, encoding="utf-8")
    print(f"{len(IMAGES)} görsel yazıldı: {OUT}")


if __name__ == "__main__":
    main()
