"use client";

import { errMsg } from "@/modules/core/errors";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { pageContainer } from "@/components/layout/pageContainer";
import { Modal } from "@/components/listing-editor/Modal";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import EntityFields, { EntityFieldValues, emptyEntityFields, parseEntityFields } from "@/modules/components/EntityFields";
import { IMAGE_ACCEPT, IMAGE_MAX_MB } from "@/modules/components/EntityImagePicker";
import EntityAvatar from "@/modules/components/EntityAvatar";
import { badge, btnDark, btnLink, btnOutline, btnPrimary, card, errorText, h2, label, muted } from "@/modules/core/ui";
import { MODULE_PATH, supplyApi } from "@/modules/supply/api";
import { supplyStore } from "@/modules/supply/store";

export default function SupplyIndexPage() {
  const { user, shops, activeShop, setActiveShopId } = useAuthAndShop();
  const { t } = useT();
  const { list, error } = supplyStore.useState(!!user);
  const [creating, setCreating] = useState(false);

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current={MODULE_PATH}>
      <div className={pageContainer("page")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("Dış Tedarik", "External suppliers")}</h1>
            <p className={`${muted} mt-1 max-w-2xl`}>
              {t(
                "İş yaptırdığın her firma (kesimci, boyacı, fırın…) için fiyat listesi tut, rapor ve faturalarını yükle; Ulagg tahmini maliyeti hesaplasın, gerçek tutarla karşılaştırsın ve ürünlerine yazsın. Firmayı davet edersen fiyatlarını kendisi güncel tutar.",
                "For every business you outsource to (laser cutter, painter, kiln…) keep a price list and upload their reports and invoices; Ulagg estimates the cost, compares it with the real amount and writes it to your products. Invite them and they keep their own prices up to date.",
              )}
            </p>
          </div>
          <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
            + {t("Yeni tedarikçi", "New supplier")}
          </button>
        </div>

        {creating && <CreateForm onClose={() => setCreating(false)} />}

        {!list && error ? (
          <div className={`${card} mt-5`}>
            <p className={errorText}>{error}</p>
            <button type="button" onClick={() => void supplyStore.refresh()} className={`${btnOutline} mt-3`}>
              {t("Tekrar dene", "Try again")}
            </button>
          </div>
        ) : !list ? (
          <PageSpinner />
        ) : (
          <div className="mt-5 space-y-6">
            <EntityGrid
              title={t("Tedarikçilerin", "Your suppliers")}
              empty={t("Henüz tedarikçi eklemedin.", "You have not added a supplier yet.")}
              items={list.own.map((e) => ({ id: e.id, name: e.name, label: e.label, image: e.image, sub: `${e.currency}${e.archived ? ` · ${t("arşivde", "archived")}` : ""}`, dim: e.archived }))}
            />
            {list.shared.length > 0 && (
              <EntityGrid
                title={t("Seninle paylaşılanlar", "Shared with you")}
                empty=""
                items={list.shared.map((e) => ({ id: e.id, name: e.name, label: e.label, image: e.image, sub: t("müşterinin kaydı", "a customer's record"), dim: false, shared: true }))}
              />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function EntityGrid({ title, empty, items }: { title: string; empty: string; items: { id: number; name: string; label: string; image: string | null; sub: string; dim: boolean; shared?: boolean }[] }) {
  const { t } = useT();
  return (
    <section>
      <h2 className={`${h2} mb-2`}>{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((e) => (
            <Link key={e.id} href={`${MODULE_PATH}/${e.id}`} className={`${card} block transition hover:border-[#D97757] ${e.dim ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-3">
                <EntityAvatar name={e.name} src={e.image ? supplyApi.imageUrl(e.id, e.image) : null} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 truncate font-semibold text-neutral-900 dark:text-neutral-100">{e.name}</div>
                    {e.shared && <span className={`${badge} bg-[#D97757]/15 text-[#C6613F] dark:bg-[#D97757]/20 dark:text-[#E8A48C]`}>{t("paylaşılan", "shared")}</span>}
                  </div>
                  {e.label && <div className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-300">{e.label}</div>}
                  <div className={`${muted} mt-1`}>{e.sub}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const [f, setF] = useState<EntityFieldValues>(emptyEntityFields);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seçilen logonun önizlemesi (tarayıcıda; kayıt açılınca sunucuya yüklenir).
  useEffect(() => {
    if (!logo) return;
    const url = URL.createObjectURL(logo);
    // Seçilen dosyanın geçici adresi yalnızca tarayıcıda üretilebilir.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  function chooseLogo(file: File | undefined) {
    if (file && file.size > IMAGE_MAX_MB * 1024 * 1024) {
      toast.error(t(`Dosya çok büyük (en fazla ${IMAGE_MAX_MB} MB)`, `File too large (max ${IMAGE_MAX_MB} MB)`));
      return;
    }
    setLogo(file ?? null);
    if (!file) setLogoPreview(null);
  }

  async function create() {
    const parsed = parseEntityFields(f, t);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    setBusy(true);
    try {
      const e = await supplyApi.create(parsed.value);
      if (logo) {
        // Kayıt açıldı; logo yüklenemese bile kayıt kalır, ayarlardan tekrar denenebilir.
        await supplyApi.uploadImage(e.id, logo).catch((err) => toast.error(errMsg(err, t("Resim yüklenemedi", "Could not upload the image"))));
      }
      await supplyStore.refresh();
      router.push(`${MODULE_PATH}/${e.id}?tab=prices`);
    } catch (e) {
      toast.error(errMsg(e, t("Oluşturulamadı", "Could not create")));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("Yeni tedarikçi", "New supplier")}
      widthClass="max-w-xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnLink}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button type="button" disabled={busy || !f.name.trim()} onClick={() => void create()} className={btnDark}>
            {t("Oluştur", "Create")}
          </button>
        </>
      }
    >
      <EntityFields
        value={f}
        onChange={setF}
        autoFocus
        namePlaceholder={t("Ör. ABC Lazer", "e.g. ABC Laser")}
        labelTitle={t("Ne iş yapıyor? (isteğe bağlı)", "What do they do? (optional)")}
        labelPlaceholder={t("Ör. Kesimci, Boyacı, Fırın", "e.g. Laser cutter, Painter, Kiln")}
      />
      <div className="mt-3">
        <label className={label}>{t("Logo / profil resmi (isteğe bağlı)", "Logo / profile image (optional)")}</label>
        <div className="flex flex-wrap items-center gap-3">
          <EntityAvatar name={f.name || "?"} src={logo ? logoPreview : null} size={44} />
          <label className={`${btnOutline} cursor-pointer`}>
            {logo ? t("Değiştir", "Change") : t("Resim seç", "Choose image")}
            <input type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={(e) => { chooseLogo(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {logo && (
            <>
              <span className={`${muted} max-w-[180px] truncate`}>{logo.name}</span>
              <button type="button" onClick={() => chooseLogo(undefined)} className={btnLink}>
                {t("Kaldır", "Remove")}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
