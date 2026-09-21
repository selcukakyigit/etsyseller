"use client";

import { useState } from "react";

const W = 720;
const H = 230;
const PAD = { l: 8, r: 8, t: 12, b: 26 };

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}${ym.slice(2, 4) !== "" ? " " + ym.slice(2, 4) : ""}`;

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function Frame({ max, children, fmt }: { max: number; children: React.ReactNode; fmt: (n: number) => string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {[0, 0.5, 1].map((f) => {
        const y = PAD.t + (H - PAD.t - PAD.b) * (1 - f);
        return (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="stroke-neutral-200 dark:stroke-neutral-800" strokeDasharray={f ? "3 4" : undefined} />
            {f > 0 && (
              <text x={PAD.l + 2} y={y - 3} className="fill-neutral-400" fontSize="10">
                {fmt(max * f)}
              </text>
            )}
          </g>
        );
      })}
      {children}
    </svg>
  );
}

export interface Legend {
  name: string;
  color: string;
}

export function LegendRow({ items }: { items: Legend[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

/** Aylık gruplu çubuklar: 2-3 dönem yan yana (eskiden yeniye; her dönemin adı ve rengi `series` ile verilir). */
export function CompareBars({
  data,
  series,
  fmt,
}: {
  data: { label: string; values: number[] }[];
  series: Legend[];
  fmt: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.flatMap((d) => d.values), 0));
  const innerW = W - PAD.l - PAD.r;
  const slot = innerW / Math.max(1, data.length);
  const n = Math.max(1, series.length);
  const bw = Math.min(22, (slot * 0.8) / n);
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  return (
    <div className="relative">
      <LegendRow items={series} />
      <Frame max={max} fmt={fmt}>
        {data.map((d, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const x0 = cx - (bw * n + (n - 1)) / 2;
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
              {d.values.map((v, k) => (
                <rect key={k} x={x0 + k * (bw + 1)} y={y(v)} width={bw} height={H - PAD.b - y(v)} rx="2" fill={series[k].color} opacity={hover === null || hover === i ? 1 : 0.5} />
              ))}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" className="fill-neutral-500">
                {d.label}
              </text>
            </g>
          );
        })}
      </Frame>
      {hover !== null && (
        <div className="pointer-events-none absolute right-2 top-6 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-1 font-semibold">{data[hover].label}</div>
          {series.map((sr, k) => (
            <div key={sr.name} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: sr.color }} />
              {sr.name}: {fmt(data[hover].values[k])}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Aylık yığılmış çubuklar: satışın nereye gittiği (net kâr, ürün maliyeti, ücretler, giderler). */
export function StackedBars({
  data,
  legend,
  fmt,
}: {
  data: { label: string; parts: number[] }[];
  legend: Legend[];
  fmt: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Zarar (negatif net kâr) çubuğu sıfırın altına taşmasın: negatif parçalar 0 kabul edilir, tooltip'te gerçek değer görünür.
  const totals = data.map((d) => d.parts.reduce((a, v) => a + Math.max(0, v), 0));
  const max = niceMax(Math.max(...totals, 0));
  const slot = (W - PAD.l - PAD.r) / Math.max(1, data.length);
  const bw = Math.min(34, slot * 0.6);
  const scale = (H - PAD.t - PAD.b) / max;
  return (
    <div className="relative">
      <LegendRow items={legend} />
      <Frame max={max} fmt={fmt}>
        {data.map((d, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          let acc = 0;
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
              {d.parts.map((v, k) => {
                const h = Math.max(0, v) * scale;
                acc += h;
                return <rect key={k} x={cx - bw / 2} y={H - PAD.b - acc} width={bw} height={h} fill={legend[k].color} opacity={hover === null || hover === i ? 1 : 0.5} />;
              })}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" className="fill-neutral-500">
                {d.label}
              </text>
            </g>
          );
        })}
      </Frame>
      {hover !== null && (
        <div className="pointer-events-none absolute right-2 top-6 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-1 font-semibold">{data[hover].label}</div>
          {legend.map((l, k) => (
            <div key={l.name} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: l.color }} />
              {l.name}: {fmt(data[hover].parts[k])}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
