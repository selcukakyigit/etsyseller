"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, btnGhost, btnPrimary } from "./Modal";

const BOX_MAX = 420; // kırpma alanının en büyük kenarı (px)
const OUT_MAX = 2000; // çıktı görselin en uzun kenarı (px)

const RATIOS: { key: string; label: string; value: number | null }[] = [
  { key: "1:1", label: "Kare", value: 1 },
  { key: "4:3", label: "Yatay 4:3", value: 4 / 3 },
  { key: "3:4", label: "Dikey 3:4", value: 3 / 4 },
  { key: "orig", label: "Orijinal oran", value: null },
];

/**
 * Görseli tarayıcıda (canvas) kırpar; sonucu yeni bir dosya olarak döner. Kırpılan görsel
 * taslağa yeni fotoğraf olarak eklenir — küçük resim (thumbnail) Etsy'de öne çıkan fotoğraftan üretilir.
 */
export default function ImageCropper({
  src,
  onCancel,
  onApply,
}: {
  src: string; // fetch edilebilir URL (kimlikli); Etsy CDN'i CORS vermediği için backend'den alınır
  onCancel: () => void;
  onApply: (blob: Blob) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratioKey, setRatioKey] = useState("1:1");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null); // null = ortalanmış
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(src, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`Görsel alınamadı (${r.status})`);
        return r.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => !cancelled && setImg(image);
        image.onerror = () => !cancelled && setError("Görsel açılamadı.");
        image.src = objectUrl;
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Görsel alınamadı."));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  const ratio = RATIOS.find((r) => r.key === ratioKey)?.value ?? (img ? img.naturalWidth / img.naturalHeight : 1);
  const boxW = ratio >= 1 ? BOX_MAX : Math.round(BOX_MAX * ratio);
  const boxH = ratio >= 1 ? Math.round(BOX_MAX / ratio) : BOX_MAX;

  // Görselin kutuyu tam kapladığı temel ölçek; zoom bunun katı.
  const cover = img ? Math.max(boxW / img.naturalWidth, boxH / img.naturalHeight) : 1;
  const scale = cover * zoom;
  const drawW = img ? img.naturalWidth * scale : 0;
  const drawH = img ? img.naturalHeight * scale : 0;

  const clamp = (x: number, y: number) => ({
    x: Math.min(0, Math.max(boxW - drawW, x)),
    y: Math.min(0, Math.max(boxH - drawH, y)),
  });
  // Görselin kutuya göre sol-üst konumu: hiç sürüklenmediyse ortada, aksi halde sınırlanmış.
  const pos = offset ? clamp(offset.x, offset.y) : { x: (boxW - drawW) / 2, y: (boxH - drawH) / 2 };

  function render(maxSide: number): HTMLCanvasElement | null {
    if (!img) return null;
    const sw = boxW / scale;
    const sh = boxH / scale;
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * k));
    canvas.height = Math.max(1, Math.round(sh * k));
    canvas.getContext("2d")?.drawImage(img, -pos.x / scale, -pos.y / scale, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // "Alıcılar bunu görecek" önizlemesi için küçük bir kopya.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const previewUrl = useMemo(() => render(500)?.toDataURL("image/jpeg", 0.8) ?? null, [img, pos.x, pos.y, zoom, ratioKey]);

  function apply() {
    const c = render(OUT_MAX);
    if (!c) return;
    setBusy(true);
    c.toBlob(
      (blob) => {
        setBusy(false);
        if (blob) onApply(blob);
        else setError("Görsel oluşturulamadı.");
      },
      "image/jpeg",
      0.92
    );
  }

  return (
    <Modal
      z={90}
      widthClass="max-w-[41rem]"
      title="Küçük resmi kırp"
      footer={
        <>
          <button onClick={onCancel} className={btnGhost}>
            Vazgeç
          </button>
          <button onClick={apply} disabled={!img || busy} className={btnPrimary}>
            {busy ? "Hazırlanıyor…" : "Uygula"}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
        Konuyu net ve ortada tutacak şekilde konumlandır. Kırpılan görsel taslağa yeni fotoğraf olarak eklenir.
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {!img && !error && <p className="text-sm text-neutral-400">Görsel yükleniyor…</p>}

      {img && (
        <div className="flex min-w-0 flex-col gap-5 lg:flex-row">
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              {RATIOS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => {
                    setRatioKey(r.key);
                    setOffset(null);
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    ratioKey === r.key
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div
              className="relative touch-none select-none overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800"
              style={{ width: boxW, height: boxH, cursor: "grab" }}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                drag.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                setOffset(clamp(drag.current.ox + e.clientX - drag.current.px, drag.current.oy + e.clientY - drag.current.py));
              }}
              onPointerUp={() => (drag.current = null)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={{ width: drawW, height: drawH, left: pos.x, top: pos.y }}
              />
            </div>

            <div className="mt-3 flex items-center gap-3" style={{ width: boxW }}>
              <span className="text-xs text-neutral-500">−</span>
              <input
                type="range"
                min={1}
                max={4}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                aria-label="Yakınlaştır"
                className="flex-1 accent-neutral-900 dark:accent-neutral-100"
              />
              <span className="text-xs text-neutral-500">+</span>
            </div>
          </div>

          <div
            className="w-full shrink-0 self-start rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50 lg:w-36"
          >
            <p className="mb-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">Alıcılar bunu görecek</p>
            <div className="flex flex-col items-center gap-2">
              {[
                { label: "Kare", w: 84, h: 84 },
                { label: "Dikey", w: 72, h: 96 },
                { label: "Yatay", w: 112, h: 84 },
              ].map((t) => (
                <figure key={t.label}>
                  <div
                    className="rounded-md border border-neutral-200 bg-cover bg-center dark:border-neutral-700"
                    style={{ width: t.w, height: t.h, backgroundImage: previewUrl ? `url(${previewUrl})` : undefined }}
                  />
                  <figcaption className="mt-1 text-center text-[11px] text-neutral-500">{t.label}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
