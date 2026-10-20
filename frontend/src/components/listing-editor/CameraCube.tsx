"use client";

import { useRef, useState } from "react";
import { tNow as t } from "@/lib/i18n";

/**
 * Sürüklenerek döndürülen küp — kamera açısını seçmenin arayüzü. Gerçek bir 3D render/önizleme YAPMAZ
 * (ürünün 3D modeli yok); yalnızca en yakın açı "kovasına" yuvarlanıp karşılığı olan hazır fotoğrafçılık
 * cümlesini (bkz. `cameraAnglePrompt`) üretir, bu cümle "Yeniden oluştur" promptunun başına eklenir.
 */

const AZIMUTH_STEPS = [
  { key: "front", deg: 0, label: ["Ön", "Front"] },
  { key: "front_right", deg: 45, label: ["Ön-Sağ", "Front-right"] },
  { key: "right", deg: 90, label: ["Sağ", "Right"] },
  { key: "back_right", deg: 135, label: ["Arka-Sağ", "Back-right"] },
  { key: "back", deg: 180, label: ["Arka", "Back"] },
  { key: "back_left", deg: 225, label: ["Arka-Sol", "Back-left"] },
  { key: "left", deg: 270, label: ["Sol", "Left"] },
  { key: "front_left", deg: 315, label: ["Ön-Sol", "Front-left"] },
] as const;

const ELEVATION_STEPS = [
  { key: "low", deg: -28, label: ["Alçak", "Low"] },
  { key: "eye", deg: 0, label: ["Göz hizası", "Eye level"] },
  { key: "high", deg: 28, label: ["Yüksek", "High"] },
] as const;

// Kamera, sabit duran sahnenin/ürünün çevresinde hareket eder (ürün ya da nesneler döndürülmez). Yönler SAHNENİN/ÜRÜNÜN kendi yönüdür
// (izleyicinin sağı/solu değil): küpte "SAĞ" yüzü görünüyorsa kamera ürünün sağ tarafındadır. Model "sağdan" sözünü iki türlü
// okuyabildiği için kameranın konumu ve kaç derece döndüğü açıkça yazılır.
const AZIMUTH_PHRASE: Record<string, string> = {
  front: "kamera ürünün tam karşısında, ona dik bakar (0°)",
  front_right: "kamera ürünün önünden, ürünün kendi SAĞ tarafına doğru yaklaşık 45° kaymış ve ürüne çapraz bakar",
  right: "kamera ürünün kendi SAĞ tarafına 90° geçmiş, ona tam yandan bakar",
  back_right: "kamera ürünün kendi SAĞ tarafından arkasına doğru yaklaşık 135° dönmüş, çapraz arkadan bakar",
  back: "kamera ürünün tam arkasında (180°), arkadan bakar",
  back_left: "kamera ürünün kendi SOL tarafından arkasına doğru yaklaşık 135° dönmüş, çapraz arkadan bakar",
  left: "kamera ürünün kendi SOL tarafına 90° geçmiş, ona tam yandan bakar",
  front_left: "kamera ürünün önünden, ürünün kendi SOL tarafına doğru yaklaşık 45° kaymış ve ürüne çapraz bakar",
};

const ELEVATION_PHRASE: Record<string, string> = {
  low: "kamera ürünün biraz altında (yaklaşık 25° aşağıdan), yukarı doğru bakar",
  eye: "kamera ürünle aynı yükseklikte, yatay bakar",
  high: "kamera ürünün üstünde (yaklaşık 30° yukarıdan), aşağı doğru bakar",
};

export type CameraAngle = { azimuth: (typeof AZIMUTH_STEPS)[number]["key"]; elevation: (typeof ELEVATION_STEPS)[number]["key"] };

export function cameraAnglePrompt(a: CameraAngle): string {
  return `Kamera açısı: ${AZIMUTH_PHRASE[a.azimuth]}; ${ELEVATION_PHRASE[a.elevation]}. ("Sağ/sol" ürünün kendi yönüdür, izleyicinin değil.)`;
}

function nearestAzimuth(deg: number) {
  const norm = ((deg % 360) + 360) % 360;
  let best: (typeof AZIMUTH_STEPS)[number] = AZIMUTH_STEPS[0];
  let bestDiff = Infinity;
  for (const s of AZIMUTH_STEPS) {
    const diff = Math.min(Math.abs(norm - s.deg), 360 - Math.abs(norm - s.deg));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

function nearestElevation(deg: number) {
  let best: (typeof ELEVATION_STEPS)[number] = ELEVATION_STEPS[0];
  let bestDiff = Infinity;
  for (const s of ELEVATION_STEPS) {
    const diff = Math.abs(deg - s.deg);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

const FACE_SIZE = 92;
const H = FACE_SIZE / 2;
const CH = 13; // kırık kenar (pah) genişliği
const S = H - CH; // ana yüzün yarı kenarı

/**
 * Pahlı küp: 6 ana yüz + 12 kenar şeridi + 8 köşe üçgeni. Her parça CSS koordinatlarında (x sağ, y aşağı, z izleyiciye) bir
 * köşe noktası ve iki kenar vektörüyle tanımlanır, `matrix3d` ile yerleştirilir. Şerit ve köşeler iki yüzün ARASINDAKİ açıyı
 * (ör. ön-sağ 45°, ön-üst) temsil eder: tıklayınca o açı seçilir.
 */
type V3 = [number, number, number];
type Piece = { key: string; w: number; h: number; matrix: string; shade: string; dir: V3; tri: boolean; label?: [string, string] };

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3) => scale(a, 1 / len(a));

const LIGHT = unit([-0.45, -0.75, 0.5]); // sol-üst-önden ışık (y eksi = yukarı)
const BASE_RGB: V3 = [217, 119, 87]; // marka rengi

function piece(key: string, origin: V3, u0: V3, v0: V3, dir: V3, tri: boolean, label?: [string, string], fixedShade?: string): Piece {
  // Dışa bakan yüz görünür olsun: normal merkezden uzaklaşmıyorsa kenarlar yer değiştirir (üçgende aynı üçgen kalır).
  const mid = add(origin, scale(add(u0, v0), tri ? 1 / 3 : 1 / 2));
  const flip = dot(cross(u0, v0), mid) < 0;
  const u = flip ? v0 : u0;
  const v = flip ? u0 : v0;
  const eu = unit(u);
  const ev = unit(v);
  const n = cross(eu, ev);
  const light = 0.55 + 0.45 * Math.max(0, dot(n, LIGHT));
  const shade = fixedShade ?? `rgb(${BASE_RGB.map((c) => Math.min(255, Math.round(c * light * 1.12))).join(",")})`;
  const m = [...eu, 0, ...ev, 0, ...n, 0, ...origin, 1].map((x) => Number(x.toFixed(5)));
  return { key, w: len(u), h: len(v), matrix: `matrix3d(${m.join(",")})`, shade, dir, tri, label };
}

const point = (k: number, kv: number, i: number, iv: number, j: number, jv: number): V3 => {
  const p: V3 = [0, 0, 0];
  p[k] = kv;
  p[i] = iv;
  p[j] = jv;
  return p;
};

function buildPieces(): Piece[] {
  const out: Piece[] = [
    // Ana yüzler: okuma yönü dışarıdan bakınca soldan sağa olacak şekilde köşe ve kenarlar seçilmiştir.
    piece("front", [-S, -S, H], [2 * S, 0, 0], [0, 2 * S, 0], [0, 0, 1], false, ["ÖN", "FRONT"], "#D97757"),
    piece("back", [S, -S, -H], [-2 * S, 0, 0], [0, 2 * S, 0], [0, 0, -1], false, ["ARKA", "BACK"], "#8a3610"),
    piece("right", [H, -S, S], [0, 0, -2 * S], [0, 2 * S, 0], [1, 0, 0], false, ["SAĞ", "RIGHT"], "#c9540f"),
    piece("left", [-H, -S, -S], [0, 0, 2 * S], [0, 2 * S, 0], [-1, 0, 0], false, ["SOL", "LEFT"], "#a8460f"),
    piece("top", [-S, -H, -S], [2 * S, 0, 0], [0, 0, 2 * S], [0, -1, 0], false, ["ÜST", "TOP"], "#ff8a4c"),
    piece("bottom", [-S, H, S], [2 * S, 0, 0], [0, 0, -2 * S], [0, 1, 0], false, ["ALT", "BOTTOM"], "#7a2f0c"),
  ];
  // 12 kenar şeridi: iki yüzün arasında 45° eğimli.
  for (const [i, j, k] of [[0, 1, 2], [0, 2, 1], [1, 2, 0]] as const) {
    for (const si of [-1, 1]) {
      for (const sj of [-1, 1]) {
        const p1 = point(k, -S, i, si * H, j, sj * S);
        const p2 = point(k, S, i, si * H, j, sj * S);
        const p4 = point(k, -S, i, si * S, j, sj * H);
        const dir: V3 = [0, 0, 0];
        dir[i] = si;
        dir[j] = sj;
        out.push(piece(`edge-${i}${j}${si}${sj}`, p1, sub(p2, p1), sub(p4, p1), dir, false));
      }
    }
  }
  // 8 köşe üçgeni.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const a: V3 = [sx * S, sy * S, sz * H];
        const b: V3 = [sx * H, sy * S, sz * S];
        const c: V3 = [sx * S, sy * H, sz * S];
        out.push(piece(`corner-${sx}${sy}${sz}`, a, sub(b, a), sub(c, a), [sx, sy, sz], true));
      }
    }
  }
  return out;
}

const PIECES = buildPieces();

export default function CameraCube({ value, onChange }: { value: CameraAngle | null; onChange: (a: CameraAngle | null) => void }) {
  const [yaw, setYaw] = useState(-35);
  const [pitch, setPitch] = useState(-18);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const dragged = useRef(false); // sürükleme click'i bastırmak için — bkz. yüze tıklama

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, yaw, pitch };
    dragged.current = false;
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged.current = true;
    setYaw(start.current.yaw + dx * 0.6);
    setPitch(Math.max(-45, Math.min(45, start.current.pitch - dy * 0.6)));
  };
  const onPointerUp = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    if (!dragged.current) return; // sürüklenmediyse (salt tıklama) yüzün kendi onClick'i devreye girer
    const az = nearestAzimuth(-yaw);
    const el = nearestElevation(Math.max(-28, Math.min(28, pitch)));
    setYaw(-az.deg);
    setPitch(el.deg);
    onChange({ azimuth: az.key, elevation: el.key });
  };

  // Yüze, kenar şeridine ya da köşeye tıklayınca o yönün açısı seçilir (sürüklemeye alternatif, daha hızlı). Yön vektörü CSS
  // koordinatındadır (y aşağı); yatay bileşen yoksa (üst/alt yüz) seçili yön, dikey bileşen yoksa seçili yükseklik korunur.
  const pick = (d: V3) => {
    if (dragged.current) return;
    const [x, y, z] = d;
    const azKey = x !== 0 || z !== 0 ? nearestAzimuth((Math.atan2(x, z) * 180) / Math.PI).key : (value?.azimuth ?? "front");
    const elKey: CameraAngle["elevation"] = y < 0 ? "high" : y > 0 ? "low" : (value?.elevation ?? "eye");
    const azStep = AZIMUTH_STEPS.find((s) => s.key === azKey)!;
    const elStep = ELEVATION_STEPS.find((s) => s.key === elKey)!;
    setYaw(-azStep.deg);
    setPitch(elStep.deg);
    onChange({ azimuth: azKey, elevation: elKey });
  };

  const az = value ? AZIMUTH_STEPS.find((s) => s.key === value.azimuth)?.label : null;
  const el = value ? ELEVATION_STEPS.find((s) => s.key === value.elevation)?.label : null;
  const azLabel = az ? t(az[0], az[1]) : null;
  const elLabel = el ? t(el[0], el[1]) : null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">📐 {t("Kamera açısı", "Camera angle")}</p>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] font-medium text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            {t("Temizle", "Clear")}
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-4">
        <div style={{ perspective: 420, padding: 24 }} className="shrink-0">
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
              width: FACE_SIZE,
              height: FACE_SIZE,
              position: "relative",
              transformStyle: "preserve-3d",
              transform: `rotateX(${-pitch}deg) rotateY(${yaw}deg)`,
              transition: dragging ? "none" : "transform 0.25s ease-out",
              cursor: dragging ? "grabbing" : "grab",
              touchAction: "none",
            }}
            className="select-none"
          >
            {PIECES.map((p) => (
              <div
                key={p.key}
                onClick={() => pick(p.dir)}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: p.w,
                  height: p.h,
                  transformOrigin: "0 0",
                  transform: p.matrix,
                  background: p.shade,
                  clipPath: p.tri ? "polygon(0 0, 100% 0, 0 100%)" : undefined,
                  boxShadow: p.tri ? undefined : "inset 0 0 0 1px rgba(0,0,0,0.22)",
                  backfaceVisibility: "hidden",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  color: "#fff",
                  textShadow: "0 1px 2px rgba(0,0,0,0.35)",
                }}
              >
                {p.label ? t(p.label[0], p.label[1]) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0 flex-1 text-xs text-neutral-500 dark:text-neutral-400">
          {value ? (
            <p>
              {t("Seçili", "Selected")}: <b className="text-neutral-700 dark:text-neutral-200">{azLabel}</b> ·{" "}
              <b className="text-neutral-700 dark:text-neutral-200">{elLabel}</b>
            </p>
          ) : (
            <p>{t("Küpü sürükleyerek çevir, bırakınca en yakın açıya yerleşir. Seçmezsen kamera açısı belirtilmez.", "Drag the cube to rotate it; it snaps to the nearest angle when released. If you don't choose one, no camera angle is set.")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
