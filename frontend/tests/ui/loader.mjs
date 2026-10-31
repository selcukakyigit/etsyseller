// Arayüz testleri için küçük bir ESM yükleyici: "@/" takma adını çözer, .ts/.tsx dosyalarını `typescript` ile anında derler ve ağ/yönlendirme
// bağımlılıklarını (api, toast, i18n, next/link, next/navigation) sahte modüllerle değiştirir. Gerçek React + jsdom ile çalışır; tarayıcı gerekmez.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");
const MOCKS = { "@/lib/i18n-client": "tests/ui/mock-i18n.mjs", "@/lib/api": "tests/ui/mock-api.mjs", "@/lib/toast": "tests/ui/mock-toast.mjs", "next/link": "tests/ui/mock-link.mjs", "@/components/site/fonts": "tests/ui/mock-fonts.mjs", "next/navigation": "tests/ui/mock-nav.mjs" };
const EXT = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const find = (base) => EXT.map((e) => base + e).find((f) => fs.existsSync(f) && fs.statSync(f).isFile());

export async function resolve(specifier, context, next) {
  if (MOCKS[specifier]) return { url: pathToFileURL(path.join(ROOT, MOCKS[specifier])).href, shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const file = find(path.join(SRC, specifier.slice(2)));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const file = find(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (/\.(ts|tsx)$/.test(url) && url.includes("/src/")) {
    const file = fileURLToPath(url);
    const out = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      fileName: file, // .ts dosyası TSX gibi okunmasın (jenerik ok fonksiyonları `<T>(x) =>` JSX sanılır)
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    return { format: "module", source: out, shortCircuit: true };
  }
  return next(url, context);
}
