"use client";

import { useCallback, useEffect, useState } from "react";
import { api, API_URL, BannerImage, BannerStyle, Listing } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import ListingPicker from "@/components/banners/ListingPicker";
import { useT } from "@/lib/i18n-client";
import { useCached } from "@/lib/pageCache";
import { PageSpinner, Spinner } from "@/components/ui/Spinner";

type StyleMeta = { key: BannerStyle; tr: string; en: string; descTr: string; descEn: string; size: string; min: number; max: number; aspect: string };

// Ölçüler backend'deki banners/styles.py ile aynı (Etsy minimumlarının üstünde).
const STYLES: StyleMeta[] = [
  { key: "carousel", tr: "Carousel", en: "Carousel", descTr: "1–4 görsel sırayla döner", descEn: "1–4 images rotate", size: "3360×840", min: 1, max: 4, aspect: "aspect-[4/1]" },
  { key: "collage", tr: "Kolaj", en: "Collage", descTr: "2–4 kare yan yana", descEn: "2–4 squares side by side", size: "1200×1200", min: 2, max: 4, aspect: "aspect-square" },
  { key: "big", tr: "Büyük banner", en: "Big banner", descTr: "Tek, geniş görsel", descEn: "One wide image", size: "3360×840", min: 1, max: 1, aspect: "aspect-[4/1]" },
  { key: "mini", tr: "Mini banner", en: "Mini banner", descTr: "İnce bir şerit", descEn: "A slim strip", size: "2400×320", min: 1, max: 1, aspect: "aspect-[15/2]" },
];

// Anahtarlar backend'deki SEASONS ile aynı (modele giden tarif orada).
const SEASONS: [string, string, string][] = [
  ["christmas", "Yılbaşı / Noel", "Christmas"],
  ["new_year", "Yeni yıl", "New Year"],
  ["valentines", "Sevgililer Günü", "Valentine's Day"],
  ["mothers_day", "Anneler Günü", "Mother's Day"],
  ["fathers_day", "Babalar Günü", "Father's Day"],
  ["spring", "İlkbahar", "Spring"],
  ["summer", "Yaz", "Summer"],
  ["autumn", "Sonbahar", "Autumn"],
  ["halloween", "Cadılar Bayramı", "Halloween"],
  ["thanksgiving", "Şükran Günü", "Thanksgiving"],
  ["black_friday", "Black Friday", "Black Friday"],
];

const MAX_LISTINGS = 10;
type Slot = { status: "idle" | "busy" | "done" | "error"; image?: BannerImage; error?: string };

const card = "rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 sm:p-5";
const label = "mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-100";
const input =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500";
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-medium transition ${
    on
      ? "border-[#D97757] bg-[#D97757]/10 text-[#B4553A] dark:text-[#E89A7F]"
      : "border-neutral-200 text-neutral-700 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500"
  }`;

const imgSrc = (img: BannerImage) => `${API_URL}${img.url}`;
const downloadHref = (img: BannerImage) => `${API_URL}${img.url}?download=1`;

export default function BannersPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t, locale } = useT();
  const shopId = activeShop?.id;
  const [listings, setListings] = useCached<Listing[]>(shopId !== undefined ? `listings:${shopId}` : null);
  const [recent, setRecent] = useCached<BannerImage[]>(shopId !== undefined ? `banners:${shopId}` : null);

  const [style, setStyle] = useState<BannerStyle>("carousel");
  const [count, setCount] = useState(3);
  const [picked, setPicked] = useState<number[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [season, setSeason] = useState<string | null>(null);
  const [scene, setScene] = useState("");
  const [headline, setHeadline] = useState("");
  const [subline, setSubline] = useState("");
  const [collageAi, setCollageAi] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);

  const meta = STYLES.find((s) => s.key === style) ?? STYLES[0];
  const slotCount = meta.min === meta.max ? meta.min : Math.min(Math.max(count, meta.min), meta.max);
  const usesAi = style !== "collage" || collageAi;
  const busy = slots.some((s) => s.status === "busy");

  useEffect(() => {
    if (shopId === undefined) return;
    api.listings.list(shopId).then(setListings).catch(() => undefined);
  }, [shopId, setListings]);

  const loadRecent = useCallback(() => {
    if (shopId === undefined) return;
    api.banners.recent(shopId).then(setRecent).catch(() => undefined);
  }, [shopId, setRecent]);
  useEffect(loadRecent, [loadRecent]);

  function chooseStyle(next: StyleMeta) {
    setStyle(next.key);
    setCount(next.key === "carousel" ? 3 : next.key === "collage" ? 4 : 1);
    setSlots([]);
    setError(null);
  }

  /** Tek bir yuvayı üretir (carousel'de her slayt ayrı istek: ilerleme ve tekrar üretme yuva yuva). */
  async function runSlot(i: number) {
    if (shopId === undefined) return;
    setSlots((prev) => prev.map((s, j) => (j === i ? { status: "busy" } : s)));
    try {
      const image =
        style === "collage" && !collageAi
          ? await api.banners.crop(shopId, picked[i], i)
          : await api.banners.generate(shopId, { style, slot: i, slots: slotCount, listing_ids: picked, season, scene, headline, subline });
      setSlots((prev) => prev.map((s, j) => (j === i ? { status: "done", image } : s)));
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : t("Üretilemedi, tekrar dene.", "Could not generate, try again.");
      setSlots((prev) => prev.map((s, j) => (j === i ? { status: "error", error: msg } : s)));
    }
  }

  async function runAll() {
    setError(null);
    if (style === "collage" && picked.length < slotCount) {
      setError(t(`Kolaj için en az ${slotCount} ilan seç (her kare bir ilan).`, `Pick at least ${slotCount} listings for the collage (one per square).`));
      return;
    }
    if (usesAi && picked.length === 0 && !season && !scene.trim()) {
      setError(t("En az bir ilan seç ya da bir tema / tarif gir.", "Pick at least one listing or choose a theme / enter a description."));
      return;
    }
    setSlots(Array.from({ length: slotCount }, () => ({ status: "busy" as const })));
    for (let i = 0; i < slotCount; i++) await runSlot(i); // sırayla: oran sınırı ve ilerleme göstergesi için
    loadRecent();
  }

  async function downloadAll() {
    for (const s of slots) {
      if (!s.image) continue;
      const a = document.createElement("a");
      a.href = downloadHref(s.image);
      a.click();
      await new Promise((r) => setTimeout(r, 400)); // tarayıcılar art arda indirmeleri engellemesin
    }
  }

  const pickedListings = picked.map((id) => listings?.find((l) => l.listing_id === id)).filter((l): l is Listing => !!l);
  const done = slots.filter((s) => s.status === "done").length;

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/banners">
      <div className="mx-auto max-w-4xl space-y-4 px-3 py-4 sm:px-6 sm:py-8">
        {!user && !bootError && <PageSpinner />}
        {bootError && <p className="text-sm text-red-600 dark:text-red-400">{bootError}</p>}

        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("Banner oluşturucu", "Banner maker")}</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {t(
              "Mağaza sayfanın üstündeki banner'ı kendi ürünlerinle üret. Etsy API'si banner yüklemeye izin vermediği için görselleri indirip Etsy'de kendin yüklersin.",
              "Create the banner at the top of your shop page with your own products. Etsy's API does not allow uploading banners, so you download the images and upload them on Etsy yourself.",
            )}
          </p>
        </div>

        {activeShop && (
          <>
            <section className={card}>
              <span className={label}>{t("1. Stil", "1. Style")}</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {STYLES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => chooseStyle(s)}
                    aria-pressed={style === s.key}
                    className={`rounded-xl border-2 p-3 text-left transition ${
                      style === s.key ? "border-[#D97757] bg-[#D97757]/5" : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700"
                    }`}
                  >
                    <span className={`mb-2 block w-full rounded bg-neutral-200 dark:bg-neutral-700 ${s.key === "collage" ? "h-5" : s.aspect}`}>
                      {s.key === "collage" && <span className="grid h-full grid-cols-4 gap-0.5">{[0, 1, 2, 3].map((i) => <span key={i} className="rounded-sm bg-neutral-300 dark:bg-neutral-600" />)}</span>}
                    </span>
                    <span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t(s.tr, s.en)}</span>
                    <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">{t(s.descTr, s.descEn)}</span>
                    <span className="block text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">{s.size}</span>
                  </button>
                ))}
              </div>
              {meta.min !== meta.max && (
                <div className="mt-3 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                  {style === "carousel" ? t("Slayt sayısı", "Slides") : t("Kare sayısı", "Squares")}
                  {Array.from({ length: meta.max - meta.min + 1 }, (_, k) => meta.min + k).map((n) => (
                    <button key={n} type="button" onClick={() => setCount(n)} className={`${chip(slotCount === n)} w-9 tabular-nums`}>
                      {n}
                    </button>
                  ))}
                </div>
              )}
              {style === "collage" && (
                <label className="mt-3 flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                  <input type="checkbox" checked={collageAi} onChange={(e) => setCollageAi(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#D97757]" />
                  <span>
                    {t("Yapay zekâ ile sahne oluştur", "Create a scene with AI")}
                    <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                      {t("Kapalıyken ilan fotoğrafları kareye kırpılır: anında ve kredi harcamaz.", "When off, listing photos are cropped to squares: instant and uses no credits.")}
                    </span>
                  </span>
                </label>
              )}
            </section>

            <section className={card}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {t("2. Ürünler", "2. Products")} <span className="font-normal text-neutral-400 dark:text-neutral-500">({picked.length}/{MAX_LISTINGS})</span>
                </span>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  disabled={!listings}
                  className="rounded-full border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  {picked.length ? t("Değiştir", "Change") : t("İlan seç", "Pick listings")}
                </button>
              </div>
              {pickedListings.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {pickedListings.map((l, i) => (
                    <div key={l.listing_id} className="relative" title={l.title}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={l.image_url ?? ""} alt="" className="h-14 w-14 rounded-lg border border-neutral-200 object-cover dark:border-neutral-700" />
                      <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#D97757] text-[10px] font-semibold text-white">{i + 1}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {t(
                    "Banner'da görünecek ilanları seç; her birinin ilk fotoğrafı kullanılır. Kolajda sıra önemli: 1. seçilen 1. kareye gelir.",
                    "Pick the listings to show in the banner; the first photo of each is used. In a collage the order matters: the 1st pick goes in the 1st square.",
                  )}
                </p>
              )}
            </section>

            {usesAi && (
              <section className={`${card} space-y-4`}>
                <div>
                  <span className={label}>{t("3. Tema", "3. Theme")}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setSeason(null)} className={chip(season === null)}>
                      {t("Temasız", "No theme")}
                    </button>
                    {SEASONS.map(([key, tr, en]) => (
                      <button key={key} type="button" onClick={() => setSeason(key)} className={chip(season === key)}>
                        {t(tr, en)}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={scene}
                    onChange={(e) => setScene(e.target.value.slice(0, 500))}
                    rows={2}
                    placeholder={t("İsteğe bağlı tarif: ör. rustik ahşap duvar, sıcak akşam ışığı", "Optional description: e.g. rustic wooden wall, warm evening light")}
                    className={`${input} mt-3 resize-none`}
                  />
                </div>
                {style !== "collage" && (
                  <div>
                    <span className={label}>{t("Yazı (isteğe bağlı)", "Text (optional)")}</span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input value={headline} onChange={(e) => setHeadline(e.target.value.slice(0, 80))} placeholder={t("Başlık: ör. Personalized Metal Signs", "Headline: e.g. Personalized Metal Signs")} className={input} />
                      <input value={subline} onChange={(e) => setSubline(e.target.value.slice(0, 80))} placeholder={t("Alt yazı: ör. Handmade to last", "Subline: e.g. Handmade to last")} className={input} disabled={!headline.trim()} />
                    </div>
                    <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                      {t(
                        "Boş bırakırsan banner yazısız olur. Yazıyı mağazanın dilinde yaz; yapay zekâ başka yazı eklemez.",
                        "Leave it empty for a banner without text. Write it in your shop's language; the AI adds no other text.",
                      )}
                    </p>
                  </div>
                )}
              </section>
            )}

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="button"
              onClick={() => void runAll()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#D97757] px-4 py-3 text-sm font-semibold text-white hover:bg-[#C6613F] disabled:opacity-60"
            >
              {busy && <Spinner size={16} />}
              {busy
                ? t(`Üretiliyor… (${done}/${slotCount})`, `Generating… (${done}/${slotCount})`)
                : usesAi
                  ? t(`Banner'ı üret (${slotCount} görsel)`, `Generate banner (${slotCount} images)`)
                  : t("Kolajı hazırla", "Prepare the collage")}
            </button>
            {usesAi && (
              <p className="-mt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
                {t("Her görsel yaklaşık 15-30 saniye sürer ve yapay zekâ kredisi harcar.", "Each image takes about 15-30 seconds and uses AI credits.")}
              </p>
            )}

            {slots.length > 0 && (
              <section className={`${card} space-y-3`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Sonuç", "Result")}</span>
                  {done > 0 && !busy && (
                    <button type="button" onClick={() => void downloadAll()} className="rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300">
                      {t("Hepsini indir", "Download all")}
                    </button>
                  )}
                </div>
                <div className={style === "collage" ? `grid gap-2 ${["", "", "grid-cols-2", "grid-cols-3", "grid-cols-4"][slotCount]}` : "space-y-3"}>
                  {slots.map((s, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className={`relative overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800 ${meta.aspect}`}>
                        {s.status === "done" && s.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imgSrc(s.image)} alt="" className="h-full w-full object-cover" />
                        )}
                        {s.status === "busy" && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Spinner size={22} />
                          </div>
                        )}
                        {s.status === "error" && <p className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-red-600 dark:text-red-400">{s.error}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {slotCount > 1 && <span className="text-neutral-400 dark:text-neutral-500">#{i + 1}</span>}
                        {(s.status === "done" || s.status === "error") && (
                          <button type="button" onClick={() => void runSlot(i).then(loadRecent)} disabled={busy} className="font-medium text-[#B4553A] hover:underline disabled:opacity-50 dark:text-[#E89A7F]">
                            {t("Tekrar üret", "Regenerate")}
                          </button>
                        )}
                        {s.image && (
                          <a href={downloadHref(s.image)} className="font-medium text-neutral-700 hover:underline dark:text-neutral-200">
                            {t("İndir", "Download")} <span className="tabular-nums text-neutral-400 dark:text-neutral-500">{s.image.width}×{s.image.height}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
                  <b className="text-neutral-800 dark:text-neutral-100">{t("Etsy'ye yükleme", "Uploading to Etsy")}</b>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                    <li>{t("Etsy'de Shop Manager → mağazanın yanındaki kalem simgesi (Edit shop).", "On Etsy, open Shop Manager → the pencil icon next to your shop (Edit shop).")}</li>
                    <li>{t(`Banner bölümünde "${t(meta.tr, meta.en)}" stilini seç.`, `In the banner area, choose the "${meta.en}" style.`)}</li>
                    <li>{t("İndirdiğin görselleri sırayla yükle ve kaydet.", "Upload the images you downloaded, in order, and save.")}</li>
                  </ol>
                </div>
              </section>
            )}

            {recent && recent.length > 0 && (
              <section className={card}>
                <span className={label}>{t("Son üretilenler", "Recent")}</span>
                <p className="-mt-1 mb-3 text-xs text-neutral-500 dark:text-neutral-400">{t("Görseller 30 gün saklanır.", "Images are kept for 30 days.")}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {recent.map((img) => (
                    <a key={img.id} href={downloadHref(img)} title={t("İndir", "Download")} className="group block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imgSrc(img)} alt="" loading="lazy" className="w-full rounded-lg border border-neutral-200 object-cover group-hover:opacity-90 dark:border-neutral-800" />
                      <span className="mt-1 block text-[11px] text-neutral-500 dark:text-neutral-400">
                        {t(STYLES.find((s) => s.key === img.style)?.tr ?? img.style, STYLES.find((s) => s.key === img.style)?.en ?? img.style)} ·{" "}
                        {new Date(img.created_at + "Z").toLocaleDateString(locale, { day: "numeric", month: "short" })}
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {pickerOpen && listings && (
        <ListingPicker
          listings={listings}
          initial={picked}
          max={MAX_LISTINGS}
          onClose={() => setPickerOpen(false)}
          onDone={(ids) => {
            setPicked(ids);
            setPickerOpen(false);
          }}
        />
      )}
    </AppShell>
  );
}
