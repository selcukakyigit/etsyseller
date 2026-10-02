"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";
import { useT } from "@/lib/i18n-client";

export default function SecuritySettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();

  const { t } = useT();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChangePassword() {
    setError(null);
    setSaved(false);

    if (newPassword !== confirmPassword) {
      setError(t("Yeni şifreler eşleşmiyor", "The new passwords do not match"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("Yeni şifre en az 8 karakter olmalı", "The new password must be at least 8 characters"));
      return;
    }

    setSaving(true);
    try {
      await api.account.changePassword(user!.email, currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSubpage user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} title={t("Güvenlik", "Security")}>
      {bootError && <p className="text-sm text-red-600">{bootError}</p>}

      {user && (
        <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Şifre Değiştir", "Change password")}</h2>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
              {t("Mevcut Şifre", "Current password")}
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
              {t("Yeni Şifre", "New password")}
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
            />
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">{t("En az 8 karakter", "At least 8 characters")}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
              {t("Yeni Şifre (tekrar)", "New password (again)")}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-sm outline-none focus:border-[#D97757]"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleChangePassword}
              disabled={saving || !currentPassword || !newPassword}
              className="text-sm font-medium px-3 py-1.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition disabled:opacity-50"
            >
              {saving ? t("Kaydediliyor…", "Saving…") : t("Şifreyi Değiştir", "Change password")}
            </button>
            {saved && <span className="text-xs text-green-600">{t("Şifre değiştirildi ✓", "Password changed ✓")}</span>}
          </div>
        </section>
      )}
    </SettingsSubpage>
  );
}
