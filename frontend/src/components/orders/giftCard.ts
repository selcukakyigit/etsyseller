// Hediye kartı: 5 hazır tasarım, düzenlenebilir metin ve konumlandırma.
// Ön izleme ve yazdırma AYNI HTML'den üretilir (iframe srcDoc / yazdırma penceresi), böylece ekranda gördüğün basılan olur.

export type TemplateId =
  | "classic" | "floral" | "kraft" | "night" | "minimal"
  | "christmas" | "halloween" | "valentines" | "mothers" | "fathers" | "easter" | "thanksgiving" | "birthday" | "newyear" | "wedding";
export type CardSize = "a6" | "4x6" | "5x7";
export type FontId = "serif" | "script" | "sans" | "hand";
export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

export type GiftCardConfig = {
  template: TemplateId;
  size: CardSize;
  landscape: boolean;
  message: string;
  sender: string;
  recipient: string;
  showRecipient: boolean;
  showSender: boolean;
  font: FontId;
  fontSize: number; // pt
  color: string | null; // null = tasarımın kendi yazı rengi
  align: Align;
  vAlign: VAlign;
  offsetY: number; // -30..30 (% yükseklik) ince dikey kaydırma
};

export const SIZES: Record<CardSize, { label: string; w: number; h: number }> = {
  a6: { label: "A6 (105 × 148 mm)", w: 105, h: 148 },
  "4x6": { label: "4 × 6 inç (102 × 152 mm)", w: 101.6, h: 152.4 },
  "5x7": { label: "5 × 7 inç (127 × 178 mm)", w: 127, h: 177.8 },
};

export const FONTS: Record<FontId, { label: string; css: string }> = {
  serif: { label: "Klasik (serif)", css: "Georgia, 'Times New Roman', serif" },
  script: { label: "El yazısı (script)", css: "'Brush Script MT', 'Segoe Script', 'Snell Roundhand', cursive" },
  sans: { label: "Sade (sans)", css: "'Helvetica Neue', Arial, sans-serif" },
  hand: { label: "Kalem (handwritten)", css: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive" },
};

export type TemplateGroup = "Genel" | "Özel günler";

type Template = {
  id: TemplateId;
  label: string;
  group: TemplateGroup;
  /** Seçilince "Örnek mesaj" düğmesiyle eklenebilecek İngilizce örnek mesaj */
  sample?: string;
  /** Kart zemini (CSS background) */
  background: string;
  textColor: string;
  /** Kartın üstüne binen süsleme (CSS + isteğe bağlı köşe SVG'leri) */
  decor: string;
  css: string;
};

const corner = (color: string, extra = "") =>
  `<svg class="corner" viewBox="0 0 40 40" width="16mm" height="16mm" ${extra}><path d="M2 38 V14 Q2 2 14 2 H38" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/><circle cx="14" cy="14" r="2.2" fill="${color}"/></svg>`;

const flower = (x: number, y: number, s: number, petal: string, center: string) =>
  `<g transform="translate(${x} ${y}) scale(${s})">${[0, 72, 144, 216, 288]
    .map((a) => `<ellipse cx="0" cy="-9" rx="5" ry="9" fill="${petal}" transform="rotate(${a})"/>`)
    .join("")}<circle r="4.5" fill="${center}"/></g>`;

const stars = [
  [12, 10, 1.6], [30, 24, 1], [48, 8, 1.3], [66, 20, 0.9], [84, 12, 1.5], [92, 34, 1], [20, 50, 1.1], [74, 56, 0.8],
  [8, 78, 1.4], [40, 70, 0.9], [60, 90, 1.2], [88, 82, 1], [24, 108, 1.3], [52, 120, 0.9], [78, 112, 1.4], [14, 138, 1], [90, 140, 1.2],
]
  .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.5 + (r as number) / 4}"/>`)
  .join("");


const NS = 'xmlns="http://www.w3.org/2000/svg"';
const full = (inner: string, cls = "sky") =>
  `<svg class="${cls}" ${NS} viewBox="0 0 100 150" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">${inner}</svg>`;
const heart = (x: number, y: number, sc: number, c: string, o = 1) =>
  `<path transform="translate(${x} ${y}) scale(${sc})" d="M0 6 C-12 -3 -7 -12 0 -6 C7 -12 12 -3 0 6 Z" fill="${c}" opacity="${o}"/>`;
const snowflake = (x: number, y: number, sc: number, o = 0.9) =>
  `<g transform="translate(${x} ${y}) scale(${sc})" stroke="#fff" stroke-width="0.9" stroke-linecap="round" opacity="${o}"><path d="M0 -6V6M-5.2 -3L5.2 3M-5.2 3L5.2 -3"/></g>`;
const leaf = (x: number, y: number, rot: number, sc: number, c: string) =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${sc})"><path d="M0 0 C6 -7 15 -7 20 0 C15 7 6 7 0 0Z" fill="${c}"/><path d="M1 0 H19" stroke="rgba(0,0,0,.25)" stroke-width=".7"/></g>`;
const holly = (x: number, y: number, rot: number, sc: number) =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${sc})">${leaf(0, 0, -30, 1, "#1f7a3e")}${leaf(0, 0, 30, 1, "#2a9a4e")}<circle cx="3" cy="-1" r="2.4" fill="#d32f2f"/><circle cx="7" cy="2" r="2.4" fill="#c62828"/><circle cx="6" cy="-3" r="2.4" fill="#e53935"/></g>`;
const bat = (x: number, y: number, sc: number) =>
  `<path transform="translate(${x} ${y}) scale(${sc})" d="M0 0 C-4 -5 -10 -5 -16 -1 C-12 -1 -10 1 -8 4 C-6 1 -3 1 0 4 C3 1 6 1 8 4 C10 1 12 -1 16 -1 C10 -5 4 -5 0 0Z" fill="#0a0710"/>`;
const pumpkin = (x: number, y: number, sc: number) =>
  `<g transform="translate(${x} ${y}) scale(${sc})"><rect x="-1.5" y="-13" width="3" height="5" rx="1" fill="#3f6b2a"/><ellipse rx="12" ry="10" fill="#f28c1e"/><ellipse rx="6" ry="10" fill="#e26f0d"/><path d="M-6 -2 L-3 -6 L0 -2Z M0 -2 L3 -6 L6 -2Z M-6 3 Q0 9 6 3 Q0 6 -6 3Z" fill="#2a1408"/></g>`;
const web = `<svg class="web" ${NS} viewBox="0 0 40 40" width="30mm" height="30mm"><g stroke="#d9d2e6" stroke-width=".5" fill="none" opacity=".75"><path d="M0 0 L40 0 M0 0 L0 40 M0 0 L36 16 M0 0 L16 36 M0 0 L28 28"/><path d="M12 0 Q12 12 0 12 M24 0 Q24 24 0 24 M36 0 Q36 36 0 36"/></g></svg>`;
const egg = (x: number, y: number, sc: number, c: string, s2: string) =>
  `<g transform="translate(${x} ${y}) scale(${sc})"><ellipse rx="7" ry="9" fill="${c}"/><path d="M-7 0 Q-3.5 -3 0 0 T7 0" stroke="${s2}" stroke-width="1.6" fill="none"/><path d="M-6.5 4 Q-3 1 0 4 T6.5 4" stroke="${s2}" stroke-width="1" fill="none"/></g>`;
const sparkle = (x: number, y: number, sc: number, c: string, o = 1) =>
  `<path transform="translate(${x} ${y}) scale(${sc})" d="M0 -6 L1.5 -1.5 L6 0 L1.5 1.5 L0 6 L-1.5 1.5 L-6 0 L-1.5 -1.5Z" fill="${c}" opacity="${o}"/>`;
const CONFETTI: [number, number, string, number][] = [
  [8, 10, "#ef476f", 20], [22, 22, "#ffd166", -30], [40, 8, "#06d6a0", 45], [58, 18, "#118ab2", 10], [76, 9, "#ef476f", -20],
  [90, 24, "#ffd166", 35], [12, 46, "#118ab2", -45], [88, 52, "#06d6a0", 15], [6, 100, "#ffd166", 30], [94, 96, "#ef476f", -25],
  [16, 128, "#06d6a0", 40], [34, 140, "#118ab2", -10], [62, 136, "#ef476f", 25], [82, 142, "#ffd166", -35], [50, 126, "#06d6a0", 5],
];
const confetti = CONFETTI.map(([x, y, c, r]) => `<rect x="${x}" y="${y}" width="3.2" height="1.6" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`).join("") +
  CONFETTI.slice(0, 7).map(([x, y, c]) => `<circle cx="${x + 5}" cy="${y + 6}" r="1.1" fill="${c}"/>`).join("");

export const TEMPLATES: Template[] = [
  {
    id: "classic",
    group: "Genel",
    label: "Klasik",
    background: "#fbf6ea",
    textColor: "#3b2f1e",
    decor: `<div class="frame f1"></div><div class="frame f2"></div>${["tl", "tr", "bl", "br"].map((c) => `<div class="c ${c}">${corner("#b8923a")}</div>`).join("")}`,
    css: `.f1{position:absolute;inset:6mm;border:0.6mm solid #b8923a}.f2{position:absolute;inset:8.4mm;border:0.25mm solid #b8923a}
.c{position:absolute;width:16mm;height:16mm}.tl{top:4mm;left:4mm}.tr{top:4mm;right:4mm;transform:scaleX(-1)}.bl{bottom:4mm;left:4mm;transform:scaleY(-1)}.br{bottom:4mm;right:4mm;transform:scale(-1,-1)}`,
  },
  {
    id: "floral",
    group: "Genel",
    label: "Çiçek",
    background: "linear-gradient(135deg,#fff3f5 0%,#ffe2ea 100%)",
    textColor: "#5a2a3a",
    decor: `<svg class="fl tl" viewBox="0 0 60 60" width="34mm" height="34mm">${flower(20, 22, 1, "#f7a8bd", "#f4d27a")}${flower(40, 12, 0.6, "#f9c5d3", "#f4d27a")}${flower(10, 42, 0.55, "#f9c5d3", "#f4d27a")}<path d="M28 34 Q38 44 50 42" stroke="#7fb37f" stroke-width="2" fill="none"/></svg>
<svg class="fl br" viewBox="0 0 60 60" width="34mm" height="34mm">${flower(20, 22, 1, "#f7a8bd", "#f4d27a")}${flower(40, 12, 0.6, "#f9c5d3", "#f4d27a")}${flower(10, 42, 0.55, "#f9c5d3", "#f4d27a")}<path d="M28 34 Q38 44 50 42" stroke="#7fb37f" stroke-width="2" fill="none"/></svg>`,
    css: `.fl{position:absolute}.fl.tl{top:2mm;left:2mm}.fl.br{bottom:2mm;right:2mm;transform:rotate(180deg)}`,
  },
  {
    id: "kraft",
    group: "Genel",
    label: "Kraft kağıt",
    background: "#c8a26c",
    textColor: "#2d1f10",
    decor: `<svg class="noise" width="100%" height="100%"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0 0.1  0 0 0 0.35 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg><div class="stitch"></div>`,
    css: `.noise{position:absolute;inset:0}.stitch{position:absolute;inset:6mm;border:0.5mm dashed #fbf1dc;border-radius:2mm}`,
  },
  {
    id: "night",
    group: "Genel",
    label: "Gece",
    background: "linear-gradient(160deg,#0f1b3d 0%,#243b7a 100%)",
    textColor: "#f6f1de",
    decor: `<svg class="sky" viewBox="0 0 100 150" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">${stars}<circle cx="82" cy="20" r="7" fill="#f6e7a8"/><circle cx="85" cy="18" r="6" fill="#182757"/></svg>`,
    css: `.sky{position:absolute;inset:0}`,
  },
  {
    id: "minimal",
    group: "Genel",
    label: "Minimal",
    background: "#ffffff",
    textColor: "#222222",
    decor: `<div class="lt"></div><div class="lb"></div><div class="tri"></div>`,
    css: `.lt{position:absolute;top:10mm;left:50%;width:22mm;height:0.5mm;background:#b8923a;transform:translateX(-50%)}
.lb{position:absolute;bottom:10mm;left:50%;width:22mm;height:0.5mm;background:#b8923a;transform:translateX(-50%)}
.tri{position:absolute;top:0;right:0;width:0;height:0;border-style:solid;border-width:0 22mm 22mm 0;border-color:transparent #f1e3bf transparent transparent}`,
  },
  {
    id: "christmas",
    group: "Özel günler",
    label: "Noel / Yılbaşı",
    sample: "Merry Christmas! Wishing you a season full of warmth, joy and love.",
    background: "linear-gradient(160deg,#0b3d2e 0%,#15573f 100%)",
    textColor: "#fff8e7",
    decor: `<div class="cane"></div>${full(`${[[14, 22, 1.2], [80, 16, 1], [50, 8, 0.8], [93, 44, 0.7], [7, 46, 0.7], [72, 118, 1.1], [26, 128, 1], [90, 106, 0.6], [8, 112, 0.6], [50, 140, 0.7]].map(([x, y, sc]) => snowflake(x, y, sc)).join("")}${holly(10, 14, 20, 0.9)}${holly(92, 138, 200, 0.9)}`)}`,
    css: `.cane{position:absolute;inset:4mm;border:2.2mm solid transparent;border-image:repeating-linear-gradient(45deg,#c62828 0 3mm,#ffffff 3mm 6mm) 1}.sky{position:absolute;inset:0}`,
  },
  {
    id: "halloween",
    group: "Özel günler",
    label: "Cadılar Bayramı",
    sample: "Happy Halloween! Hope your day is full of treats and just the right amount of spooky.",
    background: "linear-gradient(170deg,#17111f 0%,#34204a 100%)",
    textColor: "#ffd9a0",
    decor: `${full(`<circle cx="76" cy="24" r="12" fill="#f6a33b" opacity=".95"/><circle cx="72" cy="21" r="12" fill="#2a1a3d"/>${bat(30, 22, 0.9)}${bat(60, 12, 0.6)}${bat(12, 42, 0.55)}${bat(88, 48, 0.7)}${pumpkin(18, 136, 1.2)}${pumpkin(84, 140, 0.8)}`)}${web}`,
    css: `.sky{position:absolute;inset:0}.web{position:absolute;top:0;left:0}`,
  },
  {
    id: "valentines",
    group: "Özel günler",
    label: "Sevgililer Günü",
    sample: "Happy Valentine's Day! Sending you lots of love.",
    background: "linear-gradient(150deg,#ffe3ea 0%,#ffb3c6 100%)",
    textColor: "#7a1230",
    decor: full(`${[[14, 16, 1.6, "#e63b62", 0.9], [34, 8, 0.9, "#ff7f9f", 0.9], [80, 20, 1.3, "#e63b62", 0.85], [92, 44, 0.8, "#ff7f9f", 0.9], [8, 62, 0.9, "#ff7f9f", 0.8], [88, 96, 1.2, "#ff5c85", 0.8], [12, 118, 1.4, "#e63b62", 0.85], [40, 138, 0.9, "#ff7f9f", 0.9], [72, 132, 1.5, "#e63b62", 0.9], [56, 12, 0.6, "#fff", 0.8], [26, 96, 0.6, "#fff", 0.8], [94, 128, 0.7, "#fff", 0.8]].map(([x, y, sc, c, o]) => heart(x as number, y as number, sc as number, c as string, o as number)).join("")}`),
    css: `.sky{position:absolute;inset:0}`,
  },
  {
    id: "mothers",
    group: "Özel günler",
    label: "Anneler Günü",
    sample: "Happy Mother's Day! Thank you for everything you do.",
    background: "linear-gradient(140deg,#fbf3ff 0%,#ffe9e1 100%)",
    textColor: "#54314f",
    decor: `<svg class="fl tl" ${NS} viewBox="0 0 60 60" width="36mm" height="36mm">${flower(20, 22, 1, "#c9a4ea", "#f7d774")}${flower(42, 12, 0.6, "#e6c8f7", "#f7d774")}${flower(10, 44, 0.6, "#f6b6c8", "#f7d774")}<path d="M26 32 Q38 42 50 40" stroke="#7fb37f" stroke-width="2" fill="none"/></svg><svg class="fl br" ${NS} viewBox="0 0 60 60" width="36mm" height="36mm">${flower(20, 22, 1, "#f6b6c8", "#f7d774")}${flower(42, 12, 0.6, "#c9a4ea", "#f7d774")}${flower(10, 44, 0.6, "#e6c8f7", "#f7d774")}<path d="M26 32 Q38 42 50 40" stroke="#7fb37f" stroke-width="2" fill="none"/></svg>`,
    css: `.fl{position:absolute}.fl.tl{top:2mm;left:2mm}.fl.br{bottom:2mm;right:2mm;transform:rotate(180deg)}`,
  },
  {
    id: "fathers",
    group: "Özel günler",
    label: "Babalar Günü",
    sample: "Happy Father's Day! Thanks for being the best.",
    background: "repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 2mm,transparent 2mm 8mm),repeating-linear-gradient(90deg,rgba(255,255,255,.07) 0 2mm,transparent 2mm 8mm),linear-gradient(160deg,#1f3a5f 0%,#2c5282 100%)",
    textColor: "#f4ead2",
    decor: `<div class="bd"></div>${full(sparkle(50, 12, 1.6, "#e3c27b") + sparkle(20, 138, 1, "#e3c27b", 0.8) + sparkle(82, 136, 1, "#e3c27b", 0.8))}`,
    css: `.bd{position:absolute;inset:6mm;border:0.6mm solid #e3c27b}.sky{position:absolute;inset:0}`,
  },
  {
    id: "easter",
    group: "Özel günler",
    label: "Paskalya",
    sample: "Happy Easter! Wishing you a spring full of joy.",
    background: "linear-gradient(160deg,#eefbe7 0%,#fff7d6 100%)",
    textColor: "#4b5b3a",
    decor: full(`${egg(16, 22, 1.2, "#f7b2c5", "#fff")}${egg(34, 12, 0.8, "#a9d8f0", "#fff")}${egg(84, 24, 1, "#ffe08a", "#f28ab2")}${egg(90, 130, 1.2, "#c8b6f0", "#fff")}${egg(66, 140, 0.8, "#f7b2c5", "#fff")}${egg(14, 128, 1, "#a9e2c0", "#fff")}<path d="M0 150 Q25 138 50 148 T100 146 V150Z" fill="#a9d99a"/>`),
    css: `.sky{position:absolute;inset:0}`,
  },
  {
    id: "thanksgiving",
    group: "Özel günler",
    label: "Şükran Günü",
    sample: "Happy Thanksgiving! Grateful for you.",
    background: "linear-gradient(160deg,#fbe8cf 0%,#f3c98f 100%)",
    textColor: "#4a2a10",
    decor: full(`${leaf(6, 14, 30, 1, "#c0392b")}${leaf(20, 6, 70, 0.8, "#e67e22")}${leaf(2, 34, 10, 0.7, "#d4a017")}${leaf(94, 138, 200, 1, "#c0392b")}${leaf(80, 146, 250, 0.8, "#e67e22")}${leaf(98, 118, 190, 0.7, "#d4a017")}${leaf(88, 10, 150, 0.6, "#b7472a")}${leaf(10, 132, 350, 0.6, "#b7472a")}`),
    css: `.sky{position:absolute;inset:0}`,
  },
  {
    id: "birthday",
    group: "Özel günler",
    label: "Doğum günü",
    sample: "Happy Birthday! Wishing you a day as wonderful as you are.",
    background: "linear-gradient(160deg,#fffdf3 0%,#fff1c9 100%)",
    textColor: "#3b3355",
    decor: full(confetti),
    css: `.sky{position:absolute;inset:0}`,
  },
  {
    id: "newyear",
    group: "Özel günler",
    label: "Yeni Yıl",
    sample: "Happy New Year! Here's to a bright and beautiful year ahead.",
    background: "radial-gradient(circle at 50% 30%,#1c1c2b 0%,#08080f 100%)",
    textColor: "#f5d76e",
    decor: full(`${[[20, 20, 2], [78, 14, 1.6], [50, 8, 1], [92, 44, 1], [8, 44, 1.1], [84, 122, 2], [18, 128, 1.6], [50, 143, 0.9], [34, 38, 0.7], [66, 116, 0.8]].map(([x, y, sc], i) => sparkle(x, y, sc, i % 2 ? "#f5d76e" : "#fff6c9", 0.9)).join("")}<g stroke="#f5d76e" stroke-width=".5" opacity=".6" stroke-linecap="round"><path d="M50 30 V18 M50 30 V42 M50 30 H38 M50 30 H62 M50 30 L41 21 M50 30 L59 39 M50 30 L59 21 M50 30 L41 39"/></g>`),
    css: `.sky{position:absolute;inset:0}`,
  },
  {
    id: "wedding",
    group: "Özel günler",
    label: "Düğün / Evlilik",
    sample: "Congratulations on your wedding! Wishing you a lifetime of love and happiness.",
    background: "#fbf8f1",
    textColor: "#4a4032",
    decor: `<div class="wb"></div>${full(`<circle cx="44" cy="20" r="6" fill="none" stroke="#c9a24d" stroke-width="1"/><circle cx="56" cy="20" r="6" fill="none" stroke="#b9bcc2" stroke-width="1"/><path d="M14 138 Q30 120 50 136 T86 134" stroke="#8fae8b" stroke-width="1" fill="none"/>${leaf(20, 130, -40, 0.5, "#a6c3a0")}${leaf(38, 128, -20, 0.5, "#a6c3a0")}${leaf(62, 132, -160, 0.5, "#a6c3a0")}${leaf(78, 128, -140, 0.5, "#a6c3a0")}`)}`,
    css: `.wb{position:absolute;inset:6mm;border:0.35mm solid #c9a24d}.sky{position:absolute;inset:0}`,
  },
];

export const DEFAULT_CONFIG: GiftCardConfig = {
  template: "classic",
  size: "4x6",
  landscape: false,
  message: "",
  sender: "",
  recipient: "",
  showRecipient: false,
  showSender: true,
  font: "script",
  fontSize: 20,
  color: null,
  align: "center",
  vAlign: "middle",
  offsetY: 0,
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function cardDims(cfg: GiftCardConfig): { w: number; h: number } {
  const { w, h } = SIZES[cfg.size];
  return cfg.landscape ? { w: h, h: w } : { w, h };
}

/** Tema CSS'inin her seçicisini `.t-<id>` ile kapsamlar; aynı belgede farklı temalar birbirini bozmasın. */
function scope(css: string, id: string): string {
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (_m, sel: string, body: string) =>
    `${sel.split(",").map((x) => `.t-${id} ${x.trim()}`).join(",")}{${body}}`
  );
}

/** Tek bir kartın (yalnızca .card öğesi) HTML'i ve CSS'i. */
function cardBody(cfg: GiftCardConfig, idx: number): { html: string; css: string } {
  const t = TEMPLATES.find((x) => x.id === cfg.template) ?? TEMPLATES[0];
  const { w, h } = cardDims(cfg);
  const color = cfg.color ?? t.textColor;
  const justify = cfg.vAlign === "top" ? "flex-start" : cfg.vAlign === "bottom" ? "flex-end" : "center";
  const lines = [
    cfg.showRecipient && cfg.recipient ? `<p class="to">${esc(cfg.recipient)},</p>` : "",
    `<p class="msg">${esc(cfg.message).replace(/\n/g, "<br>")}</p>`,
    cfg.showSender && cfg.sender ? `<p class="from">— ${esc(cfg.sender)}</p>` : "",
  ].join("");
  const k = `.k${idx}`; // kart başına benzersiz sınıf: farklı ayarlı kartlar tek belgede birbirini ezmesin
  const css = `${k}.card{position:relative;width:${w}mm;height:${h}mm;overflow:hidden;background:${t.background};page-break-after:always;break-after:page;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.card:last-child{page-break-after:auto;break-after:auto}
${scope(t.css, t.id)}
${k} .text{position:absolute;inset:16mm 14mm;display:flex;flex-direction:column;justify-content:${justify};text-align:${cfg.align};transform:translateY(${cfg.offsetY}%);color:${color};font-family:${FONTS[cfg.font].css}}
${k} .text p{margin:0}${k} .msg{font-size:${cfg.fontSize}pt;line-height:1.35;overflow-wrap:anywhere}
${k} .to{font-size:${Math.max(10, cfg.fontSize * 0.7)}pt;margin-bottom:3mm!important;opacity:.9}
${k} .from{font-size:${Math.max(10, cfg.fontSize * 0.7)}pt;margin-top:5mm!important;opacity:.9}`;
  return { html: `<div class="card t-${t.id} k${idx}">${t.decor}<div class="text">${lines}</div></div>`, css };
}

/** Bir ya da birden çok kartı içeren tam HTML belgesi (ön izleme ve yazdırma için). */
export function cardsDocument(cfgs: GiftCardConfig[], opts: { print?: boolean } = {}): string {
  const parts = cfgs.map((c, i) => cardBody(c, i));
  const { w, h } = cardDims(cfgs[0]);
  const css = [...new Set(parts.map((p) => p.css))].join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;padding:0;background:${opts.print ? "#fff" : "#e5e5e5"}}
@page{size:${w}mm ${h}mm;margin:0}
${css}
</style></head><body>${parts.map((p) => p.html).join("")}</body></html>`;
}

/** Kartları gizli bir iframe'de yazdırır (açılır pencere engelleyicilerinden etkilenmez). */
export function printCards(cfgs: GiftCardConfig[]): void {
  if (cfgs.length === 0) return;
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(cardsDocument(cfgs, { print: true }));
  doc.close();
  const run = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  // SVG filtrelerinin ve yazı tiplerinin oturması için kısa bekleme
  setTimeout(run, 250);
}

const KEY = (receiptId: number) => `giftcard:${receiptId}`;

export function loadConfig(receiptId: number, base: GiftCardConfig): GiftCardConfig {
  try {
    const raw = localStorage.getItem(KEY(receiptId));
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return base;
  }
}

export function saveConfig(receiptId: number, cfg: GiftCardConfig): void {
  try {
    localStorage.setItem(KEY(receiptId), JSON.stringify(cfg));
  } catch {
    // tarayıcı depolaması kapalıysa kalıcılık olmadan devam
  }
}
