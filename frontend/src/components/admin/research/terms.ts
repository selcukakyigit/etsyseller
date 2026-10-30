const HEADER_WORDS = new Set(["term", "keyword", "kelime", "anahtar kelime"]);

/** Dosyadan (CSV ya da düz metin) kelime listesi: her satırın ilk sütunu; başlık satırı atlanır. Dışa aktarılan CSV doğrudan geri yüklenebilir. */
export function termsFromText(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const first = line.startsWith('"') ? (line.match(/^"((?:[^"]|"")*)"/)?.[1] ?? "").replace(/""/g, '"') : line.split(",")[0];
    const term = first.trim();
    if (term && !(out.length === 0 && HEADER_WORDS.has(term.toLowerCase()))) out.push(term);
  }
  return out;
}
