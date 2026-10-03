"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ReadinessStateDefinition, ReturnPolicy, ShippingProfile } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import ProcessingProfilesSection from "@/components/shipping/ProcessingProfilesSection";
import ReturnPoliciesSection from "@/components/shipping/ReturnPoliciesSection";
import ShippingProfilesSection from "@/components/shipping/ShippingProfilesSection";
import { ReconnectNotice } from "@/components/shipping/shared";
import { useT } from "@/lib/i18n-client";
import { useCached } from "@/lib/pageCache";

export default function ShippingSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t } = useT();
  const sid = activeShop?.id;
  const [processing, setProcessing] = useCached<ReadinessStateDefinition[]>(sid !== undefined ? `processing:${sid}` : null);
  const [profiles, setProfiles] = useCached<ShippingProfile[]>(sid !== undefined ? `shipping-profiles:${sid}` : null);
  const [policies, setPolicies] = useCached<ReturnPolicy[]>(sid !== undefined ? `return-policies:${sid}` : null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shopId = activeShop?.id;

  const load = useCallback(() => {
    if (shopId === undefined) return;
    // Hata, istekler dönünce güncellenir (effect içinde eşzamanlı setState yok): başarılı yanıt eski hatayı temizler.
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error"));
    const ok = <V,>(set: (v: V) => void) => (v: V) => {
      setError(null);
      set(v);
    };
    api.shops.readinessStateDefinitions(shopId).then(ok(setProcessing)).catch(fail);
    api.shops.shippingProfiles(shopId).then(ok(setProfiles)).catch(fail);
    api.shops.returnPolicies(shopId).then(ok(setPolicies)).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, setProcessing, setProfiles, setPolicies]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/shipping">
      <div className="mx-auto max-w-4xl space-y-10 px-4 sm:px-6 py-6 sm:py-8">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("Kargo ayarları", "Shipping settings")}</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            {t(
              "Mağaza genelindeki işlem, kargo ve iade profilleri. Buradaki değişiklikler doğrudan Etsy'ye yazılır ve profili kullanan tüm listing'leri etkiler.",
              "Shop-wide processing, shipping and return profiles. Changes here are written directly to Etsy and affect every listing that uses the profile.",
            )}
          </p>
        </div>

        {(bootError || error) && (
          <p className="text-sm text-red-600">
            {bootError ?? error}{" "}
            <button type="button" onClick={load} className="font-medium underline">
              {t("Yeniden dene", "Try again")}
            </button>
          </p>
        )}
        {needsReconnect && <ReconnectNotice />}

        {activeShop ? (
          <>
            <ProcessingProfilesSection shopId={activeShop.id} profiles={processing} onChanged={load} onPermissionError={() => setNeedsReconnect(true)} />
            <ShippingProfilesSection shopId={activeShop.id} profiles={profiles} onChanged={load} onPermissionError={() => setNeedsReconnect(true)} />
            <ReturnPoliciesSection shopId={activeShop.id} policies={policies} onChanged={load} onPermissionError={() => setNeedsReconnect(true)} />
          </>
        ) : (
          user && shops !== null && <p className="text-sm text-neutral-500">{t("Önce Etsy mağazanı bağla.", "Connect your Etsy shop first.")}</p>
        )}

        <p className="text-xs text-neutral-500">
          {t(
            "Etsy'de olup burada olmayanlar: sipariş işleme takvimi, ABD ücretsiz kargo garantisi ve kargo yükseltmeleri (Upgrades). Bunlar Etsy panelinden yönetilir.",
            "Not available here (manage them on Etsy): the order processing schedule, the US free shipping guarantee and shipping upgrades.",
          )}
        </p>
      </div>
    </AppShell>
  );
}
