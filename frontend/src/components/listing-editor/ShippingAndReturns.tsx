"use client";

import { useEffect, useMemo, useState } from "react";
import { api, Inventory, ReadinessStateDefinition, ReturnPolicy, ShippingProfile } from "@/lib/api";
import { Modal, btnGhost } from "./Modal";

const PAGE_SIZE = 5;

const money = (n: number, currency: string) => new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(n);
const amount = (m: { amount: number; divisor: number } | null | undefined) => (m ? m.amount / m.divisor : null);

const regionNames = new Intl.DisplayNames(["tr"], { type: "region" });
function destinationName(d: { destination_country_iso?: string | null; destination_region?: string | null }): string {
  if (d.destination_country_iso) {
    try {
      return regionNames.of(d.destination_country_iso) ?? d.destination_country_iso;
    } catch {
      return d.destination_country_iso;
    }
  }
  if (d.destination_region === "eu") return "Avrupa Birliği";
  if (d.destination_region === "non_eu") return "AB dışı Avrupa";
  return "Diğer tüm ülkeler";
}

function processingTitle(d: ReadinessStateDefinition): string {
  return d.readiness_state === "made_to_order" ? "Sipariş üzerine üretim" : "Kargoya hazır";
}

function returnTitle(p: ReturnPolicy): string {
  if (!p.accepts_returns && !p.accepts_exchanges) return "İade ve değişim kabul edilmiyor";
  return p.accepts_returns && p.accepts_exchanges ? "İade ve değişim" : p.accepts_returns ? "İade" : "Değişim";
}

type PickItem = { id: number; title: string; badge?: string; lines: string[] };

function PickCard({
  item,
  applied,
  onPick,
}: {
  item: PickItem;
  applied: boolean;
  onPick: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
        applied ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {item.title}
          {item.badge && (
            <span className="ml-2 rounded-full border border-neutral-400 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:text-neutral-300">
              {item.badge}
            </span>
          )}
        </p>
        {item.lines.map((l) => (
          <p key={l} className="text-xs text-neutral-500 dark:text-neutral-400">
            {l}
          </p>
        ))}
      </div>
      {applied ? (
        <span className="shrink-0 text-sm font-semibold text-green-700 dark:text-green-400">✓ Uygulandı</span>
      ) : (
        <button
          type="button"
          onClick={onPick}
          className="shrink-0 rounded-full bg-neutral-200 px-4 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-100"
        >
          Uygula
        </button>
      )}
    </div>
  );
}

/** Etsy'nin "Your … profiles" penceresi: uygulanan öğe üstte, diğerleri sayfalı listede "Uygula" düğmesiyle. */
function PickerModal({
  title,
  subtitle,
  items,
  selectedId,
  onApply,
  onClose,
}: {
  title: string;
  subtitle: string;
  items: PickItem[];
  selectedId: number | null;
  onApply: (id: number) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const current = items.find((i) => i.id === selectedId) ?? null;
  const others = items.filter((i) => i.id !== selectedId);
  const pages = Math.max(1, Math.ceil(others.length / PAGE_SIZE));
  const visible = others.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Modal
      z={95}
      widthClass="max-w-lg"
      title={title}
      footer={
        <button type="button" onClick={onClose} className={btnGhost}>
          Vazgeç
        </button>
      }
    >
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">{subtitle}</p>
      {current && (
        <div className="mb-5">
          <PickCard item={current} applied onPick={() => undefined} />
        </div>
      )}
      {others.length > 0 && (
        <>
          <p className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Diğer profiller</p>
          <div className="space-y-2">
            {visible.map((item) => (
              <PickCard
                key={item.id}
                item={item}
                applied={false}
                onPick={() => {
                  onApply(item.id);
                  onClose();
                }}
              />
            ))}
          </div>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-full px-3 py-1.5 text-sm disabled:opacity-30">
                ←
              </button>
              {Array.from({ length: pages }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPage(i)}
                  className={`h-8 w-10 rounded-full text-sm ${i === page ? "border border-neutral-900 dark:border-neutral-100" : "bg-neutral-100 dark:bg-neutral-800"}`}
                >
                  {i + 1}
                </button>
              ))}
              <button type="button" disabled={page === pages - 1} onClick={() => setPage(page + 1)} className="rounded-full px-3 py-1.5 text-sm disabled:opacity-30">
                →
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

const cardCls = "flex items-center justify-between gap-4 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800";
const changeBtn =
  "shrink-0 rounded-full bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700";
const heading = "mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100";

/** Etsy'nin "Shipping, processing, and returns" bölümü: işlem profili, kargo seçeneği ve iade politikası kartları. */
export default function ShippingAndReturns({
  shopId,
  shippingProfileId,
  returnPolicyId,
  inventory,
  onChange,
}: {
  shopId: number;
  shippingProfileId: number | null;
  returnPolicyId: number | null;
  inventory: Inventory;
  onChange: (patch: { shipping_profile_id?: number; return_policy_id?: number; inventory?: Inventory }) => void;
}) {
  const [profiles, setProfiles] = useState<ShippingProfile[] | null>(null);
  const [policies, setPolicies] = useState<ReturnPolicy[] | null>(null);
  const [states, setStates] = useState<ReadinessStateDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"processing" | "shipping" | "returns" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    api.shops.shippingProfiles(shopId).then(setProfiles).catch(fail);
    api.shops.returnPolicies(shopId).then(setPolicies).catch(fail);
    api.shops.readinessStateDefinitions(shopId).then(setStates).catch(() => setStates([]));
  }, [shopId]);

  const profile = profiles?.find((p) => p.shipping_profile_id === shippingProfileId) ?? null;
  const policy = policies?.find((p) => p.return_policy_id === returnPolicyId) ?? null;

  // İşlem profili envanterdeki tekliflerde tutulur. Varyasyona göre değişiyorsa tek kart anlamsız; tablodan düzenlenir.
  const readinessVaries = (inventory.readiness_state_on_property ?? []).length > 0;
  const offerings = inventory.products.flatMap((p) => p.offerings);
  const currentReadinessId = offerings[0]?.readiness_state_id ?? null;
  const readiness = states?.find((s) => s.readiness_state_id === currentReadinessId) ?? null;

  function applyReadiness(id: number) {
    onChange({
      inventory: {
        ...inventory,
        products: inventory.products.map((p) => ({
          ...p,
          offerings: p.offerings.map((o) => ({ ...o, readiness_state_id: id })),
        })),
      },
    });
  }

  const processingItems: PickItem[] = useMemo(
    () =>
      (states ?? []).map((d) => ({
        id: d.readiness_state_id,
        title: processingTitle(d),
        lines: [d.processing_days_display_label],
      })),
    [states]
  );
  const shippingItems: PickItem[] = useMemo(
    () =>
      (profiles ?? []).map((p) => ({
        id: p.shipping_profile_id,
        title: p.title,
        badge: p.profile_type === "calculated" ? "Hesaplanan" : "Sabit",
        lines: [
          p.origin_postal_code ? `${p.origin_postal_code} çıkışlı` : (p.origin_country_iso ?? ""),
          `${p.active_listings_count ?? 0} listing kullanıyor`,
        ].filter(Boolean),
      })),
    [profiles]
  );
  const returnItems: PickItem[] = useMemo(
    () =>
      (policies ?? []).map((p) => ({
        id: p.return_policy_id,
        title: returnTitle(p),
        lines: [p.return_deadline ? `${p.return_deadline} gün içinde` : "Süre belirtilmemiş"],
      })),
    [policies]
  );

  const destinations = profile?.shipping_profile_destinations ?? [];

  return (
    <section className="space-y-6 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Kargo, işlem süresi ve iade</h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Etsy&apos;de oluşturduğun profillerden seçim yapılır. Profillerin kendisini (ülkeler, ücretler) düzenlemek mağazadaki tüm
          listing&apos;leri etkilediği için Etsy&apos;nin kendi panelinden yapılır.
        </p>
      </div>

      <div>
        <p className={heading}>İşlem profili</p>
        <div className={cardCls}>
          {readinessVaries ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              İşlem profili varyasyona göre değişiyor. Varyasyon tablosundan düzenle.
            </p>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {readiness ? processingTitle(readiness) : states === null ? "Yükleniyor…" : "Seçilmemiş"}
                </p>
                {readiness && <p className="text-xs text-neutral-500">{readiness.processing_days_display_label}</p>}
              </div>
              <button type="button" onClick={() => setPicker("processing")} className={changeBtn}>
                Profili değiştir
              </button>
            </>
          )}
        </div>
      </div>

      <div>
        <p className={heading}>Kargo seçeneği</p>
        <div className={cardCls}>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {profile ? profile.title : profiles === null ? "Yükleniyor…" : "Seçilmemiş"}
              {profile && (
                <span className="ml-2 rounded-full border border-neutral-400 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:text-neutral-300">
                  {profile.profile_type === "calculated" ? "Hesaplanan" : "Sabit"}
                </span>
              )}
            </p>
            {profile && (
              <p className="text-xs text-neutral-500">
                {profile.origin_postal_code ? `${profile.origin_postal_code} çıkışlı` : profile.origin_country_iso} ·{" "}
                {profile.active_listings_count ?? 0} listing kullanıyor
              </p>
            )}
          </div>
          <button type="button" onClick={() => setPicker("shipping")} className={changeBtn}>
            Değiştir
          </button>
        </div>

        {destinations.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className="text-sm font-semibold text-neutral-800 dark:text-neutral-100"
              aria-expanded={previewOpen}
            >
              Kargo ücreti önizlemesi {previewOpen ? "▴" : "▾"}
            </button>
            {previewOpen && (
              <div className="mt-2 overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-neutral-500">
                      <th className="px-3 py-2">Hedef</th>
                      <th className="px-3 py-2">Ücret (1 ürün)</th>
                      <th className="px-3 py-2">Ek ürün</th>
                      <th className="px-3 py-2">Teslimat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {destinations.map((d, i) => {
                      const one = amount(d.primary_cost);
                      const more = amount(d.secondary_cost);
                      const cur = d.primary_cost?.currency_code ?? "USD";
                      return (
                        <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                          <td className="px-3 py-2">{destinationName(d)}</td>
                          <td className="px-3 py-2">{one === null ? "—" : one === 0 ? "Ücretsiz" : money(one, cur)}</td>
                          <td className="px-3 py-2">{more === null ? "—" : more === 0 ? "Ücretsiz" : money(more, cur)}</td>
                          <td className="px-3 py-2">
                            {d.min_delivery_days != null && d.max_delivery_days != null
                              ? `${d.min_delivery_days}–${d.max_delivery_days} iş günü`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <p className={heading}>İade ve değişim</p>
        <div className={cardCls}>
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {policy ? returnTitle(policy) : policies === null ? "Yükleniyor…" : "Seçilmemiş"}
              {policy?.return_deadline ? ` · ${policy.return_deadline} gün` : ""}
            </p>
          </div>
          <button type="button" onClick={() => setPicker("returns")} className={changeBtn}>
            Politikayı değiştir
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {picker === "processing" && (
        <PickerModal
          title="İşlem profillerin"
          subtitle="Bir profil seç."
          items={processingItems}
          selectedId={currentReadinessId}
          onApply={applyReadiness}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "shipping" && (
        <PickerModal
          title="Kargo seçenekleri"
          subtitle="Bir kargo profili seç."
          items={shippingItems}
          selectedId={shippingProfileId}
          onApply={(id) => onChange({ shipping_profile_id: id })}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "returns" && (
        <PickerModal
          title="İade ve değişim politikaların"
          subtitle="Bir politika seç."
          items={returnItems}
          selectedId={returnPolicyId}
          onApply={(id) => onChange({ return_policy_id: id })}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}
