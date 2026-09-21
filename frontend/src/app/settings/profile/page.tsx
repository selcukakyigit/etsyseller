"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL, api } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import SettingsSubpage from "@/components/SettingsSubpage";

export default function ProfileSettingsPage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError, refreshUser } = useAuthAndShop();

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) setName(user.name ?? "");
  }, [user]);

  async function handleSaveProfile() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.account.updateProfile(name);
      refreshUser();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarUploading(true);
    setError(null);
    try {
      await api.account.uploadAvatar(file);
      refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setAvatarUploading(false);
    }
  }

  return (
    <SettingsSubpage
      user={user}
      shops={shops}
      activeShop={activeShop}
      onSwitchShop={setActiveShopId}
      title="Hesap Bilgileri"
    >
      {(bootError || error) && <p className="text-sm text-red-600">{bootError ?? error}</p>}

      {!user && !bootError && <p className="text-sm text-neutral-400 dark:text-neutral-500">Yükleniyor…</p>}

      {user && (
        <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
          <div className="flex items-center gap-4">
            {user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${API_URL}${user.avatar_url}`}
                alt=""
                className="w-16 h-16 rounded-full object-cover border border-neutral-100 dark:border-neutral-800"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-neutral-100 dark:bg-neutral-800" />
            )}
            <div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="text-sm font-medium px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition disabled:opacity-50"
              >
                {avatarUploading ? "Yükleniyor…" : "Fotoğraf Yükle"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatarSelected}
              />
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">PNG, JPG, WEBP veya GIF — maksimum 5MB</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">İsim</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-sm outline-none focus:border-[#F1641E]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">E-posta</label>
            <input
              value={user.email}
              disabled
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-sm bg-neutral-50 dark:bg-neutral-900 text-neutral-400 dark:text-neutral-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveProfile}
              disabled={saving}
              className="text-sm font-medium px-3 py-1.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition disabled:opacity-50"
            >
              {saving ? "Kaydediliyor…" : "Profili Kaydet"}
            </button>
            {saved && <span className="text-xs text-green-600">Kaydedildi ✓</span>}
          </div>
        </section>
      )}
    </SettingsSubpage>
  );
}
