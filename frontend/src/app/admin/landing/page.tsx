"use client";

import { useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button, Field, Section, errorText, inputClass } from "@/components/admin/ui";
import { BlockSpinner } from "@/components/ui/Spinner";
import { AdminLandingSettings, LandingSocialKey, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useApiData } from "@/lib/useApiData";
import { toast } from "@/lib/toast";

const NETWORKS: { key: LandingSocialKey; label: string; placeholder: string }[] = [
  { key: "instagram", label: "Instagram", placeholder: "https://www.instagram.com/…" },
  { key: "youtube", label: "YouTube", placeholder: "https://www.youtube.com/@…" },
  { key: "linkedin", label: "LinkedIn", placeholder: "https://www.linkedin.com/company/…" },
  { key: "pinterest", label: "Pinterest", placeholder: "https://www.pinterest.com/…" },
];

export default function AdminLandingPage() {
  return (
    <AdminShell current="/admin/landing">
      <Social />
    </AdminShell>
  );
}

function Social() {
  const { t } = useT();
  const { data, setData, error } = useApiData("admin:landing", api.admin.landingSettings);
  const [draft, setDraft] = useState<AdminLandingSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const form = draft ?? data;

  if (error && !form) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!form) return <BlockSpinner />;

  const invalid = NETWORKS.filter((n) => {
    const url = form.social[n.key].trim();
    return url !== "" && !url.toLowerCase().startsWith("https://");
  });

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const saved = await api.admin.updateLandingSettings(form);
      setData(saved);
      setDraft(null);
      toast.success(t("Landing ayarları kaydedildi", "Landing settings saved"));
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title={t("Sosyal medya", "Social media")}
      action={
        <Button tone="primary" busy={saving} disabled={!draft || invalid.length > 0} onClick={() => void save()}>
          {t("Kaydet", "Save")}
        </Button>
      }
    >
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        {t(
          "Tanıtım sitesinin alt bilgisinde gösterilen hesaplar. Boş bıraktığın hesap sitede görünmez. Değişiklik siteye bir dakika içinde yansır.",
          "Accounts shown in the footer of the public site. Leave a field empty to hide it. Changes reach the site within a minute.",
        )}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {NETWORKS.map((n) => {
          const value = form.social[n.key];
          const bad = invalid.some((i) => i.key === n.key);
          return (
            <Field
              key={n.key}
              label={n.label}
              hint={bad ? <span className="text-red-600 dark:text-red-400">{t("https:// ile başlamalı", "Must start with https://")}</span> : undefined}
            >
              <input
                type="url"
                inputMode="url"
                className={inputClass}
                value={value}
                placeholder={n.placeholder}
                maxLength={300}
                onChange={(e) => setDraft({ social: { ...form.social, [n.key]: e.target.value } })}
              />
            </Field>
          );
        })}
      </div>
    </Section>
  );
}
