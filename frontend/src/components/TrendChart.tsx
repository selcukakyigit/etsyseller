"use client";

import { useMemo, useRef, useState } from "react";

type Point = { date: string; value: number };
type EventMark = { date: string };

const WIDTH = 320;
const HEIGHT = 96;
const PAD_X = 8;
const PAD_TOP = 16;
const PAD_BOTTOM = 20;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
}

function formatValue(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}

export default function TrendChart({
  label,
  color,
  data,
  events = [],
}: {
  label: string;
  color: "views" | "favorites";
  data: Point[];
  events?: EventMark[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const colorVar = color === "views" ? "var(--chart-views)" : "var(--chart-favorites)";

  const points = useMemo(() => {
    if (data.length === 0) return [];
    const values = data.map((d) => d.value);
    const minV = Math.min(...values, 0);
    const maxV = Math.max(...values, 1);
    const innerW = WIDTH - PAD_X * 2;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    return data.map((d, i) => ({
      x: data.length === 1 ? PAD_X + innerW / 2 : PAD_X + (innerW * i) / (data.length - 1),
      y: PAD_TOP + innerH - ((d.value - minV) / (maxV - minV || 1)) * innerH,
      v: d,
    }));
  }, [data]);

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let closest = 0;
    let closestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - relX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setHoverIndex(closest);
  }

  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-400 dark:text-neutral-500">
        {label}: henüz veri yok (ilk günlük ölçüm bekleniyor)
      </div>
    );
  }

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${HEIGHT - PAD_BOTTOM} L ${points[0].x.toFixed(1)} ${HEIGHT - PAD_BOTTOM} Z`;
  const last = points[points.length - 1];
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3" style={{ background: "var(--chart-surface)" }}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium" style={{ color: "var(--chart-text-secondary)" }}>
          {label}
        </span>
        <span className="text-sm font-semibold" style={{ color: "var(--chart-text-primary)" }}>
          {formatValue(last.v.value)}
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-24 touch-none"
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <line
          x1={PAD_X}
          y1={HEIGHT - PAD_BOTTOM}
          x2={WIDTH - PAD_X}
          y2={HEIGHT - PAD_BOTTOM}
          stroke="var(--chart-baseline)"
          strokeWidth={1}
        />

        {events.map((ev, i) => {
          const idx = data.findIndex((d) => d.date.slice(0, 10) === ev.date.slice(0, 10));
          if (idx === -1) return null;
          const p = points[idx];
          return (
            <line
              key={i}
              x1={p.x}
              y1={PAD_TOP}
              x2={p.x}
              y2={HEIGHT - PAD_BOTTOM}
              stroke="var(--chart-text-muted)"
              strokeWidth={1}
              strokeDasharray="2,2"
            />
          );
        })}

        <path d={areaPath} fill={colorVar} opacity={0.1} stroke="none" />
        <path d={linePath} fill="none" stroke={colorVar} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last.x} cy={last.y} r={4} fill={colorVar} stroke="var(--chart-surface)" strokeWidth={2} />

        {hovered && (
          <>
            <line
              x1={hovered.x}
              y1={PAD_TOP}
              x2={hovered.x}
              y2={HEIGHT - PAD_BOTTOM}
              stroke="var(--chart-text-muted)"
              strokeWidth={1}
            />
            <circle cx={hovered.x} cy={hovered.y} r={4} fill={colorVar} stroke="var(--chart-surface)" strokeWidth={2} />
          </>
        )}
      </svg>

      {hovered && (
        <div className="flex justify-between text-xs mt-1" style={{ color: "var(--chart-text-secondary)" }}>
          <span>{formatDate(hovered.v.date)}</span>
          <span className="font-medium" style={{ color: "var(--chart-text-primary)" }}>
            {formatValue(hovered.v.value)}
          </span>
        </div>
      )}
    </div>
  );
}
