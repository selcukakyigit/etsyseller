"use client";

import { useEffect, useState } from "react";
import { api, ReturnPolicy, ShippingProfile } from "@/lib/api";

export default function ShippingAndReturns({
  shopId,
  shippingProfileId,
  returnPolicyId,
  onChange,
}: {
  shopId: number;
  shippingProfileId: number | null;
  returnPolicyId: number | null;
  onChange: (patch: { shipping_profile_id?: number; return_policy_id?: number }) => void;
}) {
  const [profiles, setProfiles] = useState<ShippingProfile[] | null>(null);
  const [policies, setPolicies] = useState<ReturnPolicy[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.shops
      .shippingProfiles(shopId)
      .then(setProfiles)
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
    api.shops
      .returnPolicies(shopId)
      .then(setPolicies)
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
  }, [shopId]);

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-neutral-900 mb-1">Kargo &amp; İade</h2>
      <p className="text-xs text-neutral-400 mb-4">
        Etsy&apos;de zaten oluşturduğun profillerden seçim yapılır — yeni profil
        oluşturma/düzenleme Etsy&apos;nin kendi panelinden yapılmaya devam ediyor.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Kargo profili</label>
          <select
            value={shippingProfileId ?? ""}
            onChange={(e) => onChange({ shipping_profile_id: Number(e.target.value) })}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
          >
            <option value="" disabled>
              Seç…
            </option>
            {profiles?.map((p) => (
              <option key={p.shipping_profile_id} value={p.shipping_profile_id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">İade politikası</label>
          <select
            value={returnPolicyId ?? ""}
            onChange={(e) => onChange({ return_policy_id: Number(e.target.value) })}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
          >
            <option value="" disabled>
              Seç…
            </option>
            {policies?.map((p) => (
              <option key={p.return_policy_id} value={p.return_policy_id}>
                {p.accepts_returns ? `İade kabul (${p.return_deadline ?? "-"} gün)` : "İade yok"} — #
                {p.return_policy_id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </section>
  );
}
