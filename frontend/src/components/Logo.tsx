import Image from "next/image";
import { BRAND } from "@/lib/legal";

const RATIO = 434 / 120; // wordmark en/boy oranı

/** Yazı logosu: açık temada koyu, koyu temada beyaz sürüm. Tema sınıfı <html>'e erken uygulandığı için yanıp sönmez. */
export default function Logo({ height = 24, className = "" }: { height?: number; className?: string }) {
  const width = Math.round(height * RATIO);
  return (
    <span className={`inline-flex items-center ${className}`}>
      <Image src="/brand/wordmark-dark.png" alt={BRAND} width={width} height={height} priority className="dark:hidden" style={{ height, width: "auto" }} />
      <Image src="/brand/wordmark-light.png" alt={BRAND} width={width} height={height} priority className="hidden dark:block" style={{ height, width: "auto" }} />
    </span>
  );
}
