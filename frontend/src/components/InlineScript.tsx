/** İlk boyamadan önce çalışması gereken script'ler için (ör. tema flaşını önleme) — Next.js 16'nın önerdiği
 * yöntem: React render sırasında düz bir <script> etiketi görünce konsola uyarı basıyor ("Scripts inside React
 * components are never executed when rendering on the client"). type'ı sunucuda text/javascript, istemcide
 * text/plain yaparak React'e "bunu bir daha çalıştırma, DOM'daki hâli zaten doğru" demiş oluyoruz; script yine de
 * HTML ayrıştırılırken (React devreye girmeden) normal şekilde çalışıyor. Kaynak:
 * node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md */
export function InlineScript({ html }: { html: string }) {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}
