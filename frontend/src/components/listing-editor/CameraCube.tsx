"use client";

import { useRef, useState } from "react";

/**
 * Sürüklenerek döndürülen küp — kamera açısını seçmenin arayüzü. Gerçek bir 3D render/önizleme YAPMAZ
 * (ürünün 3D modeli yok); yalnızca en yakın açı "kovasına" yuvarlanıp karşılığı olan hazır fotoğrafçılık
 * cümlesini (bkz. `cameraAnglePrompt`) üretir, bu cümle "Yeniden oluştur" promptunun başına eklenir.
 */

const AZIMUTH_STEPS = [
  { key: "front", deg: 0, label: "Ön" },
  { key: "front_right", deg: 45, label: "Ön-Sağ" },
  { key: "right", deg: 90, label: "Sağ" },
  { key: "back_right", deg: 135, label: "Arka-Sağ" },
  { key: "back", deg: 180, label: "Arka" },
  { key: "back_left", deg: 225, label: "Arka-Sol" },
  { key: "left", deg: 270, label: "Sol" },
  { key: "front_left", deg: 315, label: "Ön-Sol" },
] as const;

const ELEVATION_STEPS = [
  { key: "low", deg: -28, label: "Alçak" },
  { key: "eye", deg: 0, label: "Göz hizası" },
  { key: "high", deg: 28, label: "Yüksek" },
] as const;

const AZIMUTH_PHRASE: Record<string, string> = {
  front: "ürünü tam önden",
  front_right: "ürünü ön-sağ 3/4 açıdan",
  right: "ürünü tam sağ yandan (profilden)",
  back_right: "ürünü arka-sağ açıdan, arkaya yakın bir açıdan",
  back: "ürünü arkadan",
  back_left: "ürünü arka-sol açıdan, arkaya yakın bir açıdan",
  left: "ürünü tam sol yandan (profilden)",
  front_left: "ürünü ön-sol 3/4 açıdan",
};

const ELEVATION_PHRASE: Record<string, string> = {
  low: "alçak açıdan, aşağıdan yukarıya bakan bir kamerayla",
  eye: "göz hizasında, düz bir kamerayla",
  high: "yüksek açıdan, yukarıdan aşağıya bakan bir kamerayla",
};

export type CameraAngle = { azimuth: (typeof AZIMUTH_STEPS)[number]["key"]; elevation: (typeof ELEVATION_STEPS)[number]["key"] };

export function cameraAnglePrompt(a: CameraAngle): string {
  return `Kamera açısı: ${AZIMUTH_PHRASE[a.azimuth]}, ${ELEVATION_PHRASE[a.elevation]} çek.`;
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
const HALF = FACE_SIZE / 2;

// Her yüz farklı tonda — yalnızca rotateY/rotateX ile küpün "3D" olduğu anlaşılmıyor (bkz. ekran görüntüsü
// geri bildirimi), yüzler arasında belirgin ton/kenar farkı olunca bir küpe baktığın hissi oluşuyor.
const faceStyle = (transform: string, shade: string): React.CSSProperties => ({
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.5,
  color: "#fff",
  textShadow: "0 1px 2px rgba(0,0,0,0.35)",
  background: shade,
  border: "1px solid rgba(0,0,0,0.25)",
  transform,
  backfaceVisibility: "hidden" as const,
});

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

  // Yüze tıklayınca o yüzün ekseni doğrudan seçilir (sürüklemeye alternatif, daha hızlı); diğer eksen
  // (varsa seçili değerde, yoksa varsayılanda: önden/göz hizası) korunur.
  const selectAzimuth = (key: CameraAngle["azimuth"]) => {
    if (dragged.current) return;
    const elKey = value?.elevation ?? "eye";
    const az = AZIMUTH_STEPS.find((s) => s.key === key)!;
    const el = ELEVATION_STEPS.find((s) => s.key === elKey)!;
    setYaw(-az.deg);
    setPitch(el.deg);
    onChange({ azimuth: key, elevation: elKey });
  };
  const selectElevation = (key: CameraAngle["elevation"]) => {
    if (dragged.current) return;
    const azKey = value?.azimuth ?? "front";
    const az = AZIMUTH_STEPS.find((s) => s.key === azKey)!;
    const el = ELEVATION_STEPS.find((s) => s.key === key)!;
    setYaw(-az.deg);
    setPitch(el.deg);
    onChange({ azimuth: azKey, elevation: key });
  };

  const azLabel = value ? AZIMUTH_STEPS.find((s) => s.key === value.azimuth)?.label : null;
  const elLabel = value ? ELEVATION_STEPS.find((s) => s.key === value.elevation)?.label : null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">📐 Kamera açısı</p>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] font-medium text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            Temizle
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
            <div onClick={() => selectAzimuth("front")} style={{ ...faceStyle(`translateZ(${HALF}px)`, "#D97757"), cursor: "pointer" }}>ÖN</div>
            <div onClick={() => selectAzimuth("back")} style={{ ...faceStyle(`rotateY(180deg) translateZ(${HALF}px)`, "#8a3610"), cursor: "pointer" }}>ARKA</div>
            <div onClick={() => selectAzimuth("right")} style={{ ...faceStyle(`rotateY(90deg) translateZ(${HALF}px)`, "#c9540f"), cursor: "pointer" }}>SAĞ</div>
            <div onClick={() => selectAzimuth("left")} style={{ ...faceStyle(`rotateY(-90deg) translateZ(${HALF}px)`, "#a8460f"), cursor: "pointer" }}>SOL</div>
            <div onClick={() => selectElevation("high")} style={{ ...faceStyle(`rotateX(90deg) translateZ(${HALF}px)`, "#ff8a4c"), cursor: "pointer" }}>ÜST</div>
            <div onClick={() => selectElevation("low")} style={{ ...faceStyle(`rotateX(-90deg) translateZ(${HALF}px)`, "#7a2f0c"), cursor: "pointer" }}>ALT</div>
          </div>
        </div>
        <div className="min-w-0 flex-1 text-xs text-neutral-500 dark:text-neutral-400">
          {value ? (
            <p>
              Seçili: <b className="text-neutral-700 dark:text-neutral-200">{azLabel}</b> ·{" "}
              <b className="text-neutral-700 dark:text-neutral-200">{elLabel}</b>
            </p>
          ) : (
            <p>Küpü sürükleyerek çevir, bırakınca en yakın açıya yerleşir. Seçmezsen kamera açısı belirtilmez.</p>
          )}
        </div>
      </div>
    </div>
  );
}
