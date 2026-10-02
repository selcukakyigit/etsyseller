"use client";

import { useEffect, useState } from "react";
import { api, ProductionPartner, ShopSection } from "@/lib/api";
import { tNow as t } from "@/lib/i18n";

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
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [creatingSection, setCreatingSection] = useState(false);

  useEffect(() => {
    api.shops.sections(shopId).then(setSections).catch((e) => setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error")));
    api.shops
      .productionPartners(shopId)
      .then(setPartners)
      .catch(() => setPartners([])); // shops_r yoksa ya da hiç ortak yoksa sessizce boş bırak
  }, [shopId]);

  async function createSection() {
    const title = newSectionTitle.trim();
    if (!title) return;
    setCreatingSection(true);
    setError(null);
    try {
      const created = await api.shops.createShopSection(shopId, title);
      setSections((prev) => [...(prev ?? []), created]);
      onChange({ shop_section_id: created.shop_section_id });
      setAddingSection(false);
      setNewSectionTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Bölüm oluşturulamadı", "Could not create the section"));
    } finally {
      setCreatingSection(false);
    }
  }

  function togglePartner(id: number) {
    const next = productionPartnerIds.includes(id)
      ? productionPartnerIds.filter((p) => p !== id)
      : [...productionPartnerIds, id];
    onChange({ production_partner_ids: next });
  }

  return (
    <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Ayarlar", "Settings")}</h2>

      <div>
        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
          {t("Mağaza bölümü", "Shop section")}
        </label>
        <select
          value={shopSectionId ?? ""}
          onChange={(e) => {
            if (e.target.value === "__new__") {
              setAddingSection(true);
              return;
            }
            onChange({ shop_section_id: e.target.value ? Number(e.target.value) : null });
          }}
          className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
        >
          <option value="">{t("Yok", "None")}</option>
          {sections?.map((s) => (
            <option key={s.shop_section_id} value={s.shop_section_id}>
              {s.title}
            </option>
          ))}
          <option value="__new__">{t("+ Yeni bölüm ekle…", "+ Add new section…")}</option>
        </select>
        {addingSection && (
          <div className="mt-2 flex gap-1.5">
            <input
              autoFocus
              value={newSectionTitle}
              onChange={(e) => setNewSectionTitle(e.target.value.slice(0, 24))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createSection();
                }
                if (e.key === "Escape") {
                  setAddingSection(false);
                  setNewSectionTitle("");
                }
              }}
              placeholder={t("Bölüm başlığı (en fazla 24 karakter)", "Section title (up to 24 characters)")}
              className="flex-1 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-1.5 text-sm outline-none focus:border-[#D97757]"
            />
            <button
              type="button"
              onClick={() => void createSection()}
              disabled={creatingSection || !newSectionTitle.trim()}
              className="rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {creatingSection ? t("Ekleniyor…", "Adding…") : t("Ekle", "Add")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingSection(false);
                setNewSectionTitle("");
              }}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
            >
              {t("Vazgeç", "Cancel")}
            </button>
          </div>
        )}
      </div>

      <label className="flex items-center justify-between gap-3 text-sm text-neutral-700 dark:text-neutral-300">
        <span>
          {t("Bu listing'i öne çıkar", "Feature this listing")}
          <span className="block text-xs text-neutral-400 dark:text-neutral-500">
            {t("Mağaza ana sayfasında en solda görünür", "Shows first on your shop home page")}
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
          {t("Otomatik yenile", "Auto-renew")}
          <span className="block text-xs text-neutral-400 dark:text-neutral-500">
            {t("Süresi dolunca 4 ay için otomatik yenilenir", "Renews automatically for 4 months when it expires")}
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
            {t("Üretim ortakları", "Production partners")}
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
