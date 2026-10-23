import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/page?tab=orders", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });
w.matchMedia = (q) => ({ matches: q.includes("dark"), addEventListener() {}, removeEventListener() {} });

const React = await import("react");
const { act, createElement: h } = React;
const { createRoot } = await import("react-dom/client");
const { useTheme } = await import("../../src/lib/useTheme.ts");
const { useUrlTab } = await import("../../src/lib/useUrlTab.ts");
const { useRegenProgress } = await import("../../src/lib/useRegenProgress.ts");

const out = {};
function Probe({ hook, id }) { out[id] = hook(); return null; }
async function mount(id, hook) {
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(h(Probe, { hook, id })));
  return root;
}
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: beklenen ${b}, gelen ${a}`); };

await mount("t", useTheme);
eq(out.t.theme, "dark", "ilk tema sistem tercihi"); eq(document.documentElement.classList.contains("dark"), true, "html dark");
await act(async () => out.t.toggle());
eq(out.t.theme, "light", "toggle sonrası"); eq(localStorage.getItem("theme"), "light", "kalıcı"); eq(document.documentElement.classList.contains("light"), true, "html light");
await act(async () => out.t.toggle()); eq(out.t.theme, "dark", "ikinci toggle");
const realSet = w.Storage.prototype.setItem; w.Storage.prototype.setItem = () => { throw new Error("blocked"); };
await act(async () => out.t.toggle()); eq(out.t.theme, "light", "depolama engelliyken toggle");
w.Storage.prototype.setItem = realSet;
console.log("useTheme OK");

await mount("u", () => useUrlTab("tab", "overview", ["overview", "orders", "x"]));
eq(out.u[0], "orders", "URL'den sekme");
await act(async () => out.u[1]("x")); eq(out.u[0], "x", "setTab"); eq(w.location.search, "?tab=x", "URL güncellendi");
await act(async () => out.u[1]("overview")); eq(out.u[0], "overview", "varsayılana dön"); eq(w.location.search, "", "varsayılan URL'e yazılmaz");
w.history.replaceState(null, "", "/page?tab=orders"); await act(async () => { w.dispatchEvent(new w.Event("popstate")); }); eq(out.u[0], "orders", "popstate ile senkron");
w.history.replaceState(null, "", "/page?tab=bogus"); await act(async () => { w.dispatchEvent(new w.Event("popstate")); }); eq(out.u[0], "overview", "geçersiz sekme varsayılana düşer");
console.log("useUrlTab OK");

let job = { phase: "running", startedAt: Date.now() - 6000 };
const r = await mount("p", () => useRegenProgress(job));
await act(async () => { await new Promise((res) => setTimeout(res, 350)); });
if (!(out.p > 50 && out.p < 92)) throw new Error("ilerleme beklenen aralıkta değil: " + out.p);
job = { phase: "done", startedAt: job.startedAt };
await act(async () => r.render(h(Probe, { hook: () => useRegenProgress(job), id: "p" })));
eq(out.p, 0, "iş bitince ilerleme 0");
job = { phase: "running", startedAt: Date.now() };
await act(async () => r.render(h(Probe, { hook: () => useRegenProgress(job), id: "p" })));
if (out.p > 5) throw new Error("yeni iş eski değerle başlamamalı: " + out.p);
console.log("useRegenProgress OK");
process.exit(0);
