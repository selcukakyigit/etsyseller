"""CAD çizim ölçümü (DXF): kesim uzunluğu, delme sayısı, boyut ve yüzey alanı. Algoritmik; yapay zekâ ve kredi gerekmez.

Lazer/plazma gibi kesim işlerinde süreyi belirleyen şey kesim uzunluğu ile delme (pierce) sayısıdır. Makine raporu bunu
plaka bazında verir; ürün bazında ancak çizimden ölçülür. İki kullanım:

- `measure_dxf`: dosyanın tamamını tek ölçü olarak verir (ürüne ait tek çizim).
- `analyze_sheet`: bütün plakanın çizimini konumlarına göre gruplara ayırır (her grup bir ürün ya da parça takımı) ve her
  grubu ayrı ölçer; kullanıcı grupları ürünlere atar. Önizleme için gruba ait SVG yolu da döner.

Ölçüm kuralları:
- Uzunluk: her çizgi/yay/daire/eğri (spline, polyline, elips) düzleştirilip toplanır; INSERT blokları açılır.
- Delme: kapalı her şekil bir delme; uçları birbirine değen açık parçalar tek zincir = tek delme.
- Yüzey alanı: kapalı konturların alanı, iç içe geçmişlik derinliğine göre (dış kontur eklenir, delik çıkarılır, delik içindeki parça
  yine eklenir). Uçları değen açık parçalar da zincirlenip kapalı kontur sayılır. Boyama/baskı gibi yüzey işleri bu alanı kullanır.
- Birim: dosyanın $INSUNITS değeri; yoksa milimetre varsayılır ve `units_assumed` işaretlenir.
"""
import math
import os
import tempfile
from dataclasses import asdict, dataclass

import ezdxf
from ezdxf import path as ezpath
from ezdxf.lldxf.const import DXFError

MAX_ENTITIES = 100_000
MAX_SHAPES_FOR_GROUPS = 5_000  # gruplama bunun üstünde yavaşlar; çok karmaşık çizim parçalara ayrılmaz
MAX_BLOCK_DEPTH = 8
MAX_LOOPS_FOR_AREA = 3_000  # iç içe geçmişlik taraması karesel büyür; bundan karmaşık çizimde alan hesaplanmaz (elle girilir)
FLATTEN_MM = 0.05  # eğriler bu hassasiyetle düzleştirilir
JOIN_MM = 0.05  # uç noktalar bu mesafede değiyorsa aynı zincirdir
DEFAULT_GAP_MM = 60.0  # bu mesafeden yakın şekiller aynı grup sayılır
PREVIEW_POINTS = 1500  # önizlemede çizimin uzun kenarına düşen yaklaşık nokta sayısı

# $INSUNITS kodu → milimetre çarpanı (0 = birimsiz, bilinmeyen kodlar da varsayılanı kullanır)
_MM_PER_UNIT = {1: 25.4, 2: 304.8, 4: 1.0, 5: 10.0, 6: 1000.0}
_MEASURED = {"LINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE", "LWPOLYLINE", "POLYLINE"}

Point = tuple[float, float]


class CadError(Exception):
    """Dosya okunamadı ya da ölçülemedi; mesaj kullanıcıya gösterilebilir (TR; backend EN sözlüğünde karşılığı var)."""


@dataclass
class CadMeasure:
    cut_length_mm: float
    pierce_count: int
    width_mm: float
    height_mm: float
    entities: int
    units_assumed: bool
    area_mm2: float | None  # net yüzey alanı; hesaplanamazsa (çok karmaşık, kapalı kontur yok) None

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class _Shape:
    pts: list[Point]  # milimetre
    length: float
    closed: bool

    @property
    def box(self) -> tuple[float, float, float, float]:
        xs, ys = [p[0] for p in self.pts], [p[1] for p in self.pts]
        return min(xs), min(ys), max(xs), max(ys)


# --------------------------------------------------------------- okuma ----

def _entities(layout, depth: int = 0):
    for e in layout:
        kind = e.dxftype()
        if kind in _MEASURED:
            yield e
        elif kind == "INSERT" and depth < MAX_BLOCK_DEPTH:
            try:
                yield from _entities(e.virtual_entities(), depth + 1)
            except (DXFError, ValueError):
                continue


def _read(content: bytes):
    # ezdxf kod sayfasını ve ikili DXF'i dosyadan okurken kendisi çözer; bu yüzden geçici dosya kullanılır.
    handle, name = tempfile.mkstemp(suffix=".dxf")
    try:
        with os.fdopen(handle, "wb") as f:
            f.write(content)
        return ezdxf.readfile(name)
    except Exception as exc:  # noqa: BLE001 — üçüncü taraf ayrıştırıcı; bozuk dosya her türlü hatayı verebilir
        raise CadError("Çizim dosyası okunamadı") from exc
    finally:
        os.unlink(name)


def _shapes(content: bytes) -> tuple[list[_Shape], bool]:
    """Çizimdeki ölçülebilir şekiller (milimetre cinsinden noktalar) ve birimin varsayılıp varsayılmadığı."""
    doc = _read(content)
    code = doc.header.get("$INSUNITS", 0)
    scale = _MM_PER_UNIT.get(code, 1.0)  # birim → mm
    shapes: list[_Shape] = []
    for count, ent in enumerate(_entities(doc.modelspace()), start=1):
        if count > MAX_ENTITIES:
            raise CadError("Çizim çok karmaşık")
        try:
            p = ezpath.make_path(ent)
            pts = [(v.x * scale, v.y * scale) for v in p.flattening(FLATTEN_MM / scale)]
            closed = bool(p.is_closed)
        except Exception:  # noqa: BLE001 — ölçülemeyen tek bir şekil tüm çizimi düşürmesin
            continue
        if len(pts) < 2:
            continue
        shapes.append(_Shape(pts, sum(math.dist(a, b) for a, b in zip(pts[:-1], pts[1:])), closed or math.dist(pts[0], pts[-1]) <= JOIN_MM))
    if not shapes:
        raise CadError("Çizimde ölçülecek şekil bulunamadı")
    return shapes, code not in _MM_PER_UNIT


# --------------------------------------------------------------- ölçüm ----

def _pierces(shapes: list[_Shape]) -> int:
    """Kapalı her şekil bir delme; uçları değen açık parçalar tek zincir (bağlı bileşen) = tek delme."""
    closed = sum(1 for s in shapes if s.closed)
    parent: dict[tuple[int, int], tuple[int, int]] = {}

    def key(p: Point) -> tuple[int, int]:
        return round(p[0] / JOIN_MM), round(p[1] / JOIN_MM)

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    ends = [(key(s.pts[0]), key(s.pts[-1])) for s in shapes if not s.closed]
    for a, b in ends:
        parent[find(a)] = find(b)
    return closed + len({find(a) for a, _ in ends})


def _ring_area(ring: list[Point]) -> float:
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def _contains(ring: list[Point], pt: Point) -> bool:
    """Işın atma: nokta halkanın içinde mi."""
    inside = False
    x, y = pt
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
    return inside


def _rings(shapes: list[_Shape]) -> list[list[Point]]:
    """Kapalı konturlar: kapalı şekiller olduğu gibi; açık parçalar uç uca zincirlenir, kapanan zincirler kontur olur."""
    rings = [s.pts for s in shapes if s.closed and len(s.pts) >= 3]
    open_shapes = [s for s in shapes if not s.closed]
    ends: dict[tuple[int, int], list[int]] = {}

    def key(p: Point) -> tuple[int, int]:
        return round(p[0] / JOIN_MM), round(p[1] / JOIN_MM)

    for i, s in enumerate(open_shapes):
        for p in (s.pts[0], s.pts[-1]):
            ends.setdefault(key(p), []).append(i)
    used: set[int] = set()
    for start in range(len(open_shapes)):
        if start in used:
            continue
        used.add(start)
        ring = list(open_shapes[start].pts)
        while math.dist(ring[0], ring[-1]) > JOIN_MM:
            nxt = next((j for j in ends.get(key(ring[-1]), []) if j not in used), None)
            if nxt is None:
                break
            used.add(nxt)
            pts = open_shapes[nxt].pts
            ring += pts[1:] if math.dist(ring[-1], pts[0]) <= JOIN_MM else pts[-2::-1]
        if math.dist(ring[0], ring[-1]) <= JOIN_MM and len(ring) >= 4:
            rings.append(ring)
    return rings


def _net_area(shapes: list[_Shape]) -> float | None:
    """Net yüzey alanı (mm²): dış konturlar eklenir, içlerindeki delikler çıkarılır (iç içe geçmişlik derinliği çiftse eklenir, tekse
    çıkarılır). Kapalı kontur yoksa ya da çizim çok karmaşıksa None."""
    rings = _rings(shapes)
    if not rings or len(rings) > MAX_LOOPS_FOR_AREA:
        return None
    sized = sorted(((_ring_area(r), r) for r in rings), key=lambda x: -x[0])
    boxes = [(min(p[0] for p in r), min(p[1] for p in r), max(p[0] for p in r), max(p[1] for p in r)) for _, r in sized]
    total = 0.0
    for i, (area, ring) in enumerate(sized):
        pt, box = ring[0], boxes[i]
        depth = sum(
            1 for j in range(i)
            if boxes[j][0] <= box[0] and boxes[j][1] <= box[1] and boxes[j][2] >= box[2] and boxes[j][3] >= box[3] and _contains(sized[j][1], pt)
        )
        total += area if depth % 2 == 0 else -area
    return max(total, 0.0)


def _summary(shapes: list[_Shape], assumed: bool, with_area: bool = True) -> CadMeasure:
    boxes = [s.box for s in shapes]
    return CadMeasure(
        cut_length_mm=round(sum(s.length for s in shapes), 1),
        pierce_count=_pierces(shapes),
        width_mm=round(max(b[2] for b in boxes) - min(b[0] for b in boxes), 1),
        height_mm=round(max(b[3] for b in boxes) - min(b[1] for b in boxes), 1),
        entities=len(shapes),
        units_assumed=assumed,
        area_mm2=round(a, 1) if with_area and (a := _net_area(shapes)) is not None else None,
    )


def measure_dxf(content: bytes) -> CadMeasure:
    shapes, assumed = _shapes(content)
    return _summary(shapes, assumed)


# --------------------------------------------------------------- plaka: gruplama ----

def _near(a: tuple[float, float, float, float], b: tuple[float, float, float, float], gap: float) -> bool:
    return not (a[2] + gap < b[0] or b[2] + gap < a[0] or a[3] + gap < b[1] or b[3] + gap < a[1])


def _cluster(shapes: list[_Shape], gap: float) -> list[list[_Shape]]:
    """Sınır kutuları `gap` içinde birbirine değen şekiller aynı grup (taramalı birleşim; çoğu çizimde doğrusala yakın)."""
    boxes = [s.box for s in shapes]
    order = sorted(range(len(shapes)), key=lambda i: boxes[i][0])
    parent = list(range(len(shapes)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for pos, i in enumerate(order):
        reach = boxes[i][2] + gap
        for j in order[pos + 1:]:
            if boxes[j][0] > reach:
                break
            if _near(boxes[i], boxes[j], gap):
                parent[find(i)] = find(j)
    groups: dict[int, list[_Shape]] = {}
    for i, s in enumerate(shapes):
        groups.setdefault(find(i), []).append(s)
    return list(groups.values())


def _preview_path(shapes: list[_Shape], spacing: float) -> str:
    """Grubun SVG yolu (y ekseni çevrilir); gereksiz sık noktalar atılır ki yük küçük kalsın."""
    parts = []
    for s in shapes:
        kept = [s.pts[0]]
        for p in s.pts[1:-1]:
            if math.dist(p, kept[-1]) >= spacing:
                kept.append(p)
        kept.append(s.pts[-1])
        parts.append("M" + "L".join(f"{x:.1f} {-y:.1f}" for x, y in kept))
    return "".join(parts)


def analyze_sheet(content: bytes, gap_mm: float = DEFAULT_GAP_MM) -> dict:
    """Plaka çizimini konumlarına göre gruplara ayırır. Dönen sözlük: toplam ölçü, her grubun ölçüsü + önizleme yolu,
    önizleme `viewbox`'ı. Hiçbir şey kaydedilmez; kullanıcı grupları ürünlere atayıp ölçüleri ürüne yazar."""
    shapes, assumed = _shapes(content)
    if len(shapes) > MAX_SHAPES_FOR_GROUPS:
        raise CadError("Çizim çok karmaşık")
    boxes = [s.box for s in shapes]
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    spacing = max(max(x1 - x0, y1 - y0) / PREVIEW_POINTS, FLATTEN_MM)
    groups = sorted(_cluster(shapes, gap_mm), key=lambda g: (round(min(s.box[0] for s in g)), -max(s.box[3] for s in g)))
    out = []
    for i, g in enumerate(groups, start=1):
        m = _summary(g, assumed)
        gb = [s.box for s in g]
        out.append({**m.as_dict(), "index": i, "shapes": len(g), "path": _preview_path(g, spacing),
                    "box": [round(min(b[0] for b in gb), 1), round(-max(b[3] for b in gb), 1), round(max(b[2] for b in gb), 1), round(-min(b[1] for b in gb), 1)]})
    pad = max(x1 - x0, y1 - y0) * 0.05  # grup numaraları çizimin üstüne yazılır; kenarda kırpılmasın
    return {"total": _summary(shapes, assumed, with_area=False).as_dict(), "gap_mm": gap_mm, "groups": out,
            "viewbox": [round(x0 - pad, 1), round(-y1 - pad, 1), round(x1 - x0 + 2 * pad, 1), round(y1 - y0 + 2 * pad, 1)]}
