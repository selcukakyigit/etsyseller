"use client";

import { useEffect, useState } from "react";
import { BlockSpinner } from "@/components/ui/Spinner";

type MapData = { paths: Record<string, string>; width: number; height: number };

let loaded: MapData | null = null;

/** Harita yolları (~50 KB) yalnızca ihtiyaç olunca, bir kez yüklenir; ilk sayfa yüküne girmez. */
async function loadMap(): Promise<MapData> {
  if (!loaded) {
    const m = await import("@/lib/worldMapPaths");
    loaded = { paths: m.WORLD_PATHS, width: m.WORLD_VIEWBOX.width, height: m.WORLD_VIEWBOX.height };
  }
  return loaded;
}

/** Değerli ülkeler marka renginde (değere göre koyuluk), diğerleri nötr. Ülkeye gelince/odaklanınca/dokununca `onActive` çağrılır; ipucu metnini üst bileşen gösterir
 * (dokunmatikte de çalışsın diye ayrı bir yüzen kutu yok). `values`: ülke kodu -> sayı; haritada olmayan küçük ülkeler listede yine görünür. */
export default function WorldMap({ values, active, onActive, describe, label }: {
  values: Record<string, number>;
  active: string | null;
  onActive: (code: string | null) => void;
  describe: (code: string, value: number) => string;
  label: string;
}) {
  const [map, setMap] = useState<MapData | null>(loaded);
  useEffect(() => {
    if (!map) void loadMap().then(setMap);
  }, [map]);

  if (!map) {
    return (
      <div className="grid w-full place-items-center" style={{ aspectRatio: "2000 / 879" }}>
        <BlockSpinner />
      </div>
    );
  }
  const max = Math.max(1, ...Object.values(values));
  return (
    <svg viewBox={`0 0 ${map.width} ${map.height}`} className="h-auto w-full" role="group" aria-label={label}>
      {Object.entries(map.paths).map(([code, d]) => {
        const value = values[code];
        if (!value) return <path key={code} d={d} fillRule="evenodd" className="fill-neutral-200 stroke-white dark:fill-neutral-800 dark:stroke-neutral-900" strokeWidth={0.8} />;
        const text = describe(code, value);
        return (
          <path
            key={code}
            d={d}
            fillRule="evenodd"
            tabIndex={0}
            role="img"
            aria-label={text}
            fill="#D97757"
            fillOpacity={0.2 + 0.8 * Math.sqrt(value / max)}
            className="cursor-pointer stroke-white outline-none dark:stroke-neutral-900"
            strokeWidth={0.8}
            onPointerEnter={() => onActive(code)}
            onPointerLeave={() => onActive(null)}
            onFocus={() => onActive(code)}
            onBlur={() => onActive(null)}
            onClick={() => onActive(active === code ? null : code)}
          />
        );
      })}
      {active && map.paths[active] && values[active] ? <path d={map.paths[active]} fillRule="evenodd" fill="none" stroke="#C6613F" strokeWidth={2.4} strokeLinejoin="round" pointerEvents="none" /> : null}
    </svg>
  );
}
