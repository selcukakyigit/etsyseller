"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/listing-editor/Modal";
import { onCreditRequired } from "@/lib/creditEvents";
import { useT } from "@/lib/i18n-client";

/** Bir AI isteği "kredi yetersiz" (402) dönünce açılır: kullanıcıyı kredi satın almaya yönlendirir. Tüm sayfalarda AppShell içinde durur. */
export default function CreditRequiredModal() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  useEffect(() => onCreditRequired(() => setOpen(true)), []);
  if (!open) return null;
  return (
    <Modal
      title={t("Krediniz bitti", "You are out of credits")}
      widthClass="max-w-md"
      onClose={() => setOpen(false)}
      footer={
        <>
          <button type="button" onClick={() => setOpen(false)} className="text-sm text-neutral-500 hover:underline dark:text-neutral-400">
            {t("Kapat", "Close")}
          </button>
          <Link href="/settings/billing" onClick={() => setOpen(false)} className="rounded-lg bg-[#D97757] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#C6613F]">
            {t("Kredi al", "Buy credits")}
          </Link>
        </>
      }
    >
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        {t(
          "Bu işlem için yeterli krediniz yok. Kredi satın alıp kaldığınız yerden devam edebilirsiniz; satın alınan krediler süresizdir.",
          "You do not have enough credits for this action. Buy credits to carry on where you left off; purchased credits never expire.",
        )}
      </p>
    </Modal>
  );
}
