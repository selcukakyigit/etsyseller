"use client";

import { useEffect, useState } from "react";
import { api, ProductionPartner, ShopSection } from "@/lib/api";

export default function ListingSettings({
  shopId,
  shopSectionId,
  featuredRank,
  shouldAutoRenew,
  productionPartnerIds,
  onChange,
}: {
  shopId: number;
  shopSectionId: number | null;
  featuredRank: number | null;
  shouldAutoRenew: boolean;
  productionPartnerIds: number[];
  onChange: (patch: {
    shop_section_id?: number | null;
    featured_rank?: number | null;
    should_auto_renew?: boolean;
    production_partner_ids?: number[];
  }) => void;
}) {
  const [sections, setSections] = useState<ShopSection[] | null>(null);
  const [partners, setPartners] = useState<ProductionPartner[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.shops.sections(shopId).then(setSections).catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
    api.shops
      .productionPartners(shopId)
      .then(setPartners)
      .catch(() => setPartners([])); // shops_r yoksa ya da hiç ortak yoksa sessizce boş bırak
  }, [shopId]);

  function togglePartner(id: number) {
    const next = productionPartnerIds.includes(id)
      ? productionPartnerIds.filter((p) => p !== id)
      : [...productionPartnerIds, id];
    onChange({ production_partner_ids: next });
  }

  return (
    <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Ayarlar</h2>

      <div>
        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
          Mağaza bölümü
        </label>
        <select
          value={shopSectionId ?? ""}
          onChange={(e) => onChange({ shop_section_id: e.target.value ? Number(e.target.value) : null })}
          className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
        >
          <option value="">Yok</option>
          {sections?.map((s) => (
            <option key={s.shop_section_id} value={s.shop_section_id}>
              {s.title}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center justify-between gap-3 text-sm text-neutral-700 dark:text-neutral-300">
        <span>
          Bu listing&apos;i öne çıkar
          <span className="block text-xs text-neutral-400 dark:text-neutral-500">
            Mağaza ana sayfasında en solda görünür
          </span>
        </span>
        <input
          type="checkbox"
          checked={featuredRank !== null && featuredRank > 0}
          onChange={(e) => onChange({ featured_rank: e.target.checked ? 1 : null })}
          className="w-4 h-4"
        />
      </label>

      <label className="flex items-center justify-between gap-3 text-sm text-neutral-700 dark:text-neutral-300">
        <span>
          Otomatik yenile
          <span className="block text-xs text-neutral-400 dark:text-neutral-500">
            Süresi dolunca 4 ay için otomatik yenilenir
          </span>
        </span>
        <input
          type="checkbox"
          checked={shouldAutoRenew}
          onChange={(e) => onChange({ should_auto_renew: e.target.checked })}
          className="w-4 h-4"
        />
      </label>

      {partners && partners.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">
            Üretim ortakları
          </label>
          <div className="space-y-1.5">
            {partners.map((p) => (
              <label
                key={p.production_partner_id}
                className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300"
              >
                <input
                  type="checkbox"
                  checked={productionPartnerIds.includes(p.production_partner_id)}
                  onChange={() => togglePartner(p.production_partner_id)}
                  className="w-4 h-4"
                />
                {p.partner_name} <span className="text-neutral-400 dark:text-neutral-500">— {p.location}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
