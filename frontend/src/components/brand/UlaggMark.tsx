"use client";

import { useId } from "react";

// Logo tek bir şerit (sol sap → U → ortadaki sap → kemer → sağ sap) olarak çizilir; böylece animasyonda şerit baştan
// sona "çizilebilir". Kaynak: public/brand/icon.png. Koordinatlar 1254 px'lik orijinal görselin ölçüsündedir.
const PATH = "M270 470V788A192.5 192.5 0 0 0 655 788V446A166 166 0 0 1 987 446V1060";

/** Ulagg işareti. `animated`: "düşünüyor" göstergesi — şerit soluk bir izin üzerinde baştan sona çizilip silinir. */
export default function UlaggMark({ size = 24, animated = false, className = "" }: { size?: number; animated?: boolean; className?: string }) {
  const id = useId().replace(/:/g, "");
  const stroke = (paint: string, extra?: object) => (
    <path d={PATH} pathLength={100} stroke={paint} className={animated ? "ulagg-draw" : undefined} {...extra} />
  );
  return (
    <svg width={size} height={size} viewBox="120 120 1014 1014" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}g`} gradientUnits="userSpaceOnUse" x1="350" y1="180" x2="760" y2="1080">
          <stop offset="0" stopColor="#2EF2FF" />
          <stop offset=".5" stopColor="#00AEFF" />
          <stop offset="1" stopColor="#0030E6" />
        </linearGradient>
        <linearGradient id={`${id}f`} gradientUnits="userSpaceOnUse" x1="350" y1="1050" x2="750" y2="700">
          <stop offset="0" stopColor="#0A5CFF" />
          <stop offset="1" stopColor="#0638D8" />
        </linearGradient>
        {/* sağ sapın eğik ucu */}
        <clipPath id={`${id}c`}>
          <path d="M0 0H1254V820H1082C1080 950 1000 1035 893 1060V1254H0Z" />
        </clipPath>
        {/* U'nun altındaki koyu kıvrım */}
        <clipPath id={`${id}k`}>
          <path d="M300 1100C480 1010 630 870 748 680V1100Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`} fill="none" strokeWidth={192}>
        {animated && <path d={PATH} stroke={`url(#${id}g)`} opacity={0.18} />}
        {stroke(`url(#${id}g)`)}
        {stroke(`url(#${id}f)`, { clipPath: `url(#${id}k)` })}
      </g>
    </svg>
  );
}
