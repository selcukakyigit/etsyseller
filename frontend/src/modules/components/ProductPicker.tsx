"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/listing-editor/Modal";
import { BlockSpinner } from "@/components/ui/Spinner";
import { api as appApi } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";
import { EntityApi, ListingOption, ListingSection } from "../core/api";
import { badge, btnLink, btnOutline, input, muted } from "../core/ui";

export interface PickedProduct {
  shop_id: number;
  listing_id: number;
  /** Listing içindeki seçenek (ebat/varyasyon); "" = tüm ürün. */
  variant: string;
  title: string;
  price: number;
}

/** Ekranda ürün adı: başlık + seçenek. */
export const productName = (title: string, variant: string) => (variant ? `${title} — ${variant}` : title);

type Page = { items: ListingOption[]; more: boolean };

/** Çalışma alanının mağazaları (henüz gelmediyse null). Yalnızca üye için çalışır; sonuç önbelleğe alınır, her bileşen aynısını paylaşır. */
function useShops(api: EntityApi, entityId: number) {
  const { data } = useApiData(`modkit-shops:${api.base}:${entityId}`, () => api.shops(entityId));
  return data?.items ?? null;
}

/** Çalışma alanının mağazaları ve seçili mağaza (tek mağaza varsa kendiliğinden o). */
export function useShopChoice(api: EntityApi, entityId: number) {
  const shops = useShops(api, entityId);
  const [chosen, setChosen] = useState<number | null>(null);
  return { shops, shopId: chosen ?? shops?.[0]?.id ?? null, setShopId: setChosen };
}

/** Birden fazla mağaza varsa mağaza seçici; tek mağazada hiçbir şey çizmez. */
export function ShopSelect({ shops, shopId, onChange }: { shops: { id: number; name: string }[] | null; shopId: number | null; onChange: (id: number) => void }) {
  const { t } = useT();
  if (!shops || shops.length < 2) return null;
  return (
    <select value={shopId ?? ""} onChange={(e) => onChange(Number(e.target.value))} className={input} aria-label={t("Mağaza", "Shop")}>
      {shops.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

const OPTION = "block w-full rounded-md px-3 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-200/60 dark:text-neutral-200 dark:hover:bg-neutral-800";
const NEUTRAL_BADGE = `${badge} bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300`;
const SAVED_BADGE = `${badge} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300`;

/** Listing fotoğrafı (küçük); yoksa boş kutu. */
function Thumb({ src }: { src: string }) {
  return (
    <span className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
      )}
    </span>
  );
}

/** Ürün seçici: alanı tıklayınca bir pencere açılır. Önce mağaza bölümleri görünür (ürün sayısıyla); bölüme tıklayınca ürünleri
 * fotoğraf ve adla gelir (sayfa sayfa, "Daha fazla göster"), liste kalabalık olmaz ve gereksiz yüklenmez. Üstteki kutuya yazınca (ad
 * ya da listing no) tüm bölümlerde aranır. Bu kayıtta ölçüsü girilmiş ürünler "kayıtlı" etiketli ve başta gelir. Seçeneği (ebat)
 * olmayan ürüne tıklayınca hemen seçilir; olanda satır altında açılır ve istenen ebat seçilir; ebatlar aynıysa (yalnızca renk farkı
 * gibi) "Tüm ürün" düğmesi seçeneği açmadan eşler. Ürün kimliği listing + seçenektir. Seçim bitince `onPick` çağrılır ve pencere
 * kapanır. Modüllerin ortak parçası. */
export default function ProductPicker({
  api,
  entityId,
  shopId,
  onPick,
  disabled,
  asButton,
}: {
  api: EntityApi;
  entityId: number;
  shopId: number | null;
  onPick: (p: PickedProduct) => void;
  disabled?: boolean;
  /** Açılır kutu yerine "+ Ürün ekle" düğmesi (ürün eklenen yerlerde; bir alanı doldurmadığı için kutu gibi görünmesin). */
  asButton?: boolean;
}) {
  const { t } = useT();
  const shops = useShops(api, entityId);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sections, setSections] = useState<ListingSection[] | null>(null); // null: yükleniyor
  const [openSection, setOpenSection] = useState<number | null>(null);
  const [pages, setPages] = useState<Record<number, Page>>({}); // bölüm no → şimdiye dek yüklenen ürünler
  const [found, setFound] = useState<Page | null>(null); // arama sonucu (yazılan metin varken)
  const [moreBusy, setMoreBusy] = useState(false);
  const [expanded, setExpanded] = useState<{ listing: ListingOption; options: string[] | null } | null>(null); // seçenekleri açılmış ürün
  const searching = q.trim() !== "";
  // Tek bölümlü mağazada bölüm satırı göstermeden doğrudan ürünler açılır.
  const activeSection = openSection ?? (sections?.length === 1 ? sections[0].id : null);

  function close() {
    setOpen(false);
    setQ("");
    setSections(null);
    setOpenSection(null);
    setPages({});
    setFound(null);
    setExpanded(null);
  }

  function finish(r: ListingOption, variant: string) {
    if (!shopId) return;
    onPick({ shop_id: shopId, listing_id: r.listing_id, title: r.title, price: r.price, variant });
    close();
  }

  /** Seçeneği olan ürüne tıklanınca seçenekleri altında açılır (ikinci tıklama kapatır). */
  function choose(r: ListingOption) {
    if (expanded?.listing.listing_id === r.listing_id) {
      setExpanded(null);
      return;
    }
    if (!shopId) return;
    setExpanded({ listing: r, options: null });
    api
      .variants(entityId, shopId, r.listing_id)
      .then((v) => v.items.map((i) => i.key))
      .catch(() => [] as string[])
      .then((options) => (options.length === 0 ? finish(r, "") : setExpanded((cur) => (cur?.listing.listing_id === r.listing_id ? { listing: r, options } : cur))));
  }

  // Pencere açılınca bölümler (yalnızca birkaç satır) gelir; ürünler bölüm açılınca ayrıca istenir.
  useEffect(() => {
    if (!open || !shopId) return;
    let alive = true;
    api
      .listingSections(entityId, shopId)
      .then((r) => alive && setSections(r.items))
      .catch(() => alive && setSections([]));
    return () => {
      alive = false;
    };
  }, [api, entityId, shopId, open]);

  // Açılan bölümün ilk sayfası (bir kez yüklenir).
  const sectionLoaded = activeSection !== null && pages[activeSection] !== undefined;
  useEffect(() => {
    if (!open || !shopId || activeSection === null || sectionLoaded) return;
    let alive = true;
    api
      .listings(entityId, shopId, "", activeSection, 0)
      .then((r) => alive && setPages((p) => ({ ...p, [activeSection]: r })))
      .catch(() => alive && setPages((p) => ({ ...p, [activeSection]: { items: [], more: false } })));
    return () => {
      alive = false;
    };
  }, [api, entityId, shopId, open, activeSection, sectionLoaded]);

  // Yazılan metinle tüm bölümlerde arama.
  useEffect(() => {
    if (!open || !shopId || !searching) return;
    let alive = true;
    const timer = setTimeout(() => {
      api
        .listings(entityId, shopId, q.trim(), undefined, 0)
        .then((r) => alive && setFound(r))
        .catch(() => alive && setFound({ items: [], more: false }));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api, entityId, shopId, q, open, searching]);

  function loadMore() {
    if (!shopId) return;
    setMoreBusy(true);
    if (searching && found) {
      api
        .listings(entityId, shopId, q.trim(), undefined, found.items.length)
        .then((r) => setFound((cur) => (cur ? { items: [...cur.items, ...r.items], more: r.more } : r)))
        .finally(() => setMoreBusy(false));
    } else if (activeSection !== null && pages[activeSection]) {
      const cur = pages[activeSection];
      api
        .listings(entityId, shopId, "", activeSection, cur.items.length)
        .then((r) => setPages((p) => ({ ...p, [activeSection]: { items: [...cur.items, ...r.items], more: r.more } })))
        .finally(() => setMoreBusy(false));
    }
  }

  // Ürünler bağlı Etsy mağazasından gelir; mağaza yoksa alan boş kalıp sessiz durmasın, sebebi ve çözümü söylensin.
  if (shops !== null && shops.length === 0) {
    return (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-600 dark:text-neutral-300 sm:max-w-md">
        <span>{t("Ürün seçmek için bağlı bir Etsy mağazan olmalı.", "You need a connected Etsy shop to pick products.")}</span>
        <a href={appApi.shops.connectUrl()} className="font-medium text-[#C6613F] hover:underline dark:text-[#E8A48C]">
          {t("Etsy'ye Bağlan", "Connect Etsy")}
        </a>
      </div>
    );
  }

  /** Ürün satırları: fotoğraf, ad, listing no, etiketler; seçeneği olanda altta ebatlar açılır. */
  const rows = (items: ListingOption[]) =>
    items.map((r) => {
      const isOpen = expanded?.listing.listing_id === r.listing_id;
      return (
        <li key={r.listing_id}>
          <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
            <button
              type="button"
              onClick={() => (r.variants > 0 ? choose(r) : finish(r, ""))}
              aria-expanded={r.variants > 0 ? isOpen : undefined}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <Thumb src={r.image} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-sm font-medium text-neutral-900 dark:text-neutral-100">{r.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400">
                  #{r.listing_id}
                  {r.used && <span className={SAVED_BADGE}>{t("kayıtlı", "saved")}</span>}
                  {r.variants > 0 && <span className={NEUTRAL_BADGE}>{t(`${r.variants} seçenek`, `${r.variants} options`)}</span>}
                </span>
              </span>
              {r.variants > 0 && (
                <span aria-hidden className={`shrink-0 text-lg leading-none text-neutral-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>
                  ›
                </span>
              )}
            </button>
            {r.variants > 0 && (
              <button type="button" onClick={() => finish(r, "")} className={`${btnOutline} shrink-0 !px-3 !py-1 text-xs`} title={t("Seçenek seçmeden tüm ürünü eşle", "Match the whole product without choosing an option")}>
                {t("Tüm ürün", "Whole product")}
              </button>
            )}
          </div>
          {isOpen && (
            <div className="bg-neutral-50 py-1.5 pl-[92px] pr-4 dark:bg-neutral-950">
              {expanded.options === null ? (
                <p className={`${muted} px-3 py-2`}>{t("Seçenekler yükleniyor…", "Loading options…")}</p>
              ) : (
                <>
                  {expanded.options.map((o) => (
                    <button key={o} type="button" onClick={() => finish(r, o)} className={OPTION}>
                      {o}
                    </button>
                  ))}
                  <p className={`${muted} px-3 py-1.5`}>{t("Ölçü ve maliyet seçtiğin ebat için ayrı tutulur.", "Measures and cost are kept separately for the option you pick.")}</p>
                </>
              )}
            </div>
          )}
        </li>
      );
    });

  const moreButton = (more: boolean) =>
    more && (
      <li className="px-4 py-3 text-center">
        <button type="button" disabled={moreBusy} onClick={loadMore} className={`${btnOutline} text-xs`}>
          {moreBusy ? t("Yükleniyor…", "Loading…") : t("Daha fazla göster", "Show more")}
        </button>
      </li>
    );

  const empty = <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">{t("Sonuç yok. Ürün mağaza listende (Listing'ler) olmalı.", "No results. The product must be in your shop's listings.")}</p>;
  const loading = (
    <li>
      <BlockSpinner />
    </li>
  );

  return (
    <div className={asButton ? "" : "min-w-0 flex-1 sm:max-w-sm"}>
      {asButton ? (
        <button type="button" disabled={disabled || !shopId} onClick={() => setOpen(true)} className={btnOutline}>
          + {t("Ürün ekle", "Add product")}
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled || !shopId}
          onClick={() => setOpen(true)}
          className={`${input} flex w-full items-center justify-between gap-2 text-left text-neutral-500 disabled:opacity-50 dark:text-neutral-400`}
        >
          <span className="truncate">{t("Ürün seç…", "Choose a product…")}</span>
          <span aria-hidden className="text-neutral-400">▾</span>
        </button>
      )}

      {open && (
        <Modal
          title={t("Ürün seç", "Choose a product")}
          widthClass="max-w-2xl"
          z={80}
          onClose={close}
          footer={
            <button type="button" onClick={close} className={btnLink}>
              {t("Kapat", "Close")}
            </button>
          }
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setExpanded(null);
              if (!e.target.value.trim()) setFound(null);
            }}
            placeholder={t("Tüm bölümlerde ara: ürün adı ya da listing no…", "Search all sections: product name or listing id…")}
            className={`${input} mb-3 w-full`}
          />
          {searching ? (
            found === null ? (
              <BlockSpinner />
            ) : found.items.length === 0 ? (
              empty
            ) : (
              <ul className="-mx-4 divide-y divide-neutral-100 dark:divide-neutral-800">
                {rows(found.items)}
                {moreButton(found.more)}
              </ul>
            )
          ) : sections === null ? (
            <BlockSpinner />
          ) : sections.length === 0 ? (
            empty
          ) : sections.length === 1 ? (
            <ul className="-mx-4 divide-y divide-neutral-100 dark:divide-neutral-800">
              {pages[sections[0].id] ? rows(pages[sections[0].id].items) : loading}
              {pages[sections[0].id] && moreButton(pages[sections[0].id].more)}
            </ul>
          ) : (
            <ul className="-mx-4 divide-y divide-neutral-100 dark:divide-neutral-800">
              {sections.map((sec) => {
                const isOpen = activeSection === sec.id;
                const page = pages[sec.id];
                return (
                  <li key={sec.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setExpanded(null);
                        setOpenSection(isOpen ? null : sec.id);
                      }}
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                    >
                      <span aria-hidden className={`shrink-0 text-lg leading-none text-neutral-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>
                        ›
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{sec.title || t("Bölümsüz ürünler", "Products without a section")}</span>
                      {sec.used > 0 && <span className={SAVED_BADGE}>{t(`${sec.used} kayıtlı`, `${sec.used} saved`)}</span>}
                      <span className={NEUTRAL_BADGE}>{t(`${sec.count} ürün`, `${sec.count} products`)}</span>
                    </button>
                    {isOpen && (
                      <ul className="divide-y divide-neutral-100 border-t border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
                        {page ? rows(page.items) : loading}
                        {page && moreButton(page.more)}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}
