"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, DescriptionTemplate } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { Spinner } from "@/components/ui/Spinner";
import { tNow as t } from "@/lib/i18n";
import { toast } from "@/lib/toast";

/** Açıklama alanının üstündeki "Şablon uygula" menüsü. Seçilen şablon sunucuda uygulanır (eski şablon metni çıkar,
 * yenisi ürün yazısının etrafına konur) ve dönen metin açıklamaya yazılır; taslağa her değişiklik gibi kaydolur. */
export default function DescriptionTemplatePicker({
  shopId,
  listing,
  onApply,
}: {
  shopId: number;
  listing: { description: string; title: string; materials: string[]; inventory: unknown };
  onApply: (description: string) => void;
}) {
  const [items, setItems] = useCached<DescriptionTemplate[]>(`desc-templates:${shopId}`);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.descriptionTemplates
      .list(shopId)
      .then((r) => setItems(r.templates))
      .catch(() => setItems([]));
  }, [shopId, setItems]);

  async function apply(id: number) {
    setBusy(true);
    try {
      const r = await api.descriptionTemplates.apply(shopId, id, listing);
      onApply(r.description);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("Şablon uygulanamadı", "Could not apply the template"));
    } finally {
      setBusy(false);
    }
  }

  if (items !== null && items.length === 0) {
    return (
      <Link href="/settings/templates" className="text-xs text-neutral-500 underline hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
        {t("Açıklama şablonu oluştur", "Create a description template")}
      </Link>
    );
  }
  return (
    <span className="flex items-center gap-2">
      {busy && <Spinner size={14} />}
      <select
        value=""
        disabled={busy || items === null}
        onChange={(e) => e.target.value && void apply(Number(e.target.value))}
        className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
      >
        <option value="">{t("Şablon uygula…", "Apply template…")}</option>
        {(items ?? []).map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
            {x.is_default ? ` (${t("varsayılan", "default")})` : ""}
          </option>
        ))}
      </select>
    </span>
  );
}
