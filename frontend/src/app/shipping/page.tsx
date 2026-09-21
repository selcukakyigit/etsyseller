"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ReadinessStateDefinition, ReturnPolicy, ShippingProfile } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import ProcessingProfilesSection from "@/components/shipping/ProcessingProfilesSection";
import ReturnPoliciesSection from "@/components/shipping/ReturnPoliciesSection";
import ShippingProfilesSection from "@/components/shipping/ShippingProfilesSection";
import { ReconnectNotice } from "@/components/shipping/shared";

export default function ShippingSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const [processing, setProcessing] = useState<ReadinessStateDefinition[] | null>(null);
  const [profiles, setProfiles] = useState<ShippingProfile[] | null>(null);
  const [policies, setPolicies] = useState<ReturnPolicy[] | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shopId = activeShop?.id;

  const load = useCallback(() => {
    if (shopId === undefined) return;
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    api.shops.readinessStateDefinitions(shopId).then(setProcessing).catch(fail);
    api.shops.shippingProfiles(shopId).then(setProfiles).catch(fail);
    api.shops.returnPolicies(shopId).then(setPolicies).catch(fail);
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/shipping">
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-8">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Kargo ayarları</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            Mağaza genelindeki işlem, kargo ve iade profilleri. Buradaki değişiklikler doğrudan Etsy&apos;ye yazılır ve profili
            kullanan tüm listing&apos;leri etkiler.
          </p>
        </div>

        {(bootError || error) && <p className="text-sm text-red-600">{bootError ?? error}</p>}
        {needsReconnect && <ReconnectNotice />}

        {activeShop ? (
          <>
            <ProcessingProfilesSection shopId={activeShop.id} profiles={processing} onChanged={load} onPermissionError={() => setNeedsReconnect(true)} />
            <ShippingProfilesSection shopId={activeShop.id} profiles={profiles} onChanged={load} onPermissionError={() => setNeedsReconnect(true)} />
            <ReturnPoliciesSection shopId={activeShop.id} policies={policies} onChanged={load} onPermissionError={() => setNeedsReconnect(true)} />
          </>
        ) : (
          user && shops !== null && <p className="text-sm text-neutral-500">Önce Etsy mağazanı bağla.</p>
        )}

        <p className="text-xs text-neutral-500">
          Etsy&apos;de olup burada olmayanlar: sipariş işleme takvimi, ABD ücretsiz kargo garantisi ve kargo yükseltmeleri
          (Upgrades). Bunlar Etsy panelinden yönetilir.
        </p>
      </div>
    </AppShell>
  );
}
