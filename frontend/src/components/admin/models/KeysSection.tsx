"use client";

import { useState } from "react";
import { Badge, Button, Section, errorText, inputClass } from "@/components/admin/ui";
import { AdminCatalog, api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { toast } from "@/lib/toast";
import { PROVIDER_NAMES } from "./catalog";

/** Sağlayıcı anahtarları (panelden girilen, yoksa .env) ve bağlantı denemeleri. */
export default function KeysSection({ data, onChanged }: { data: AdminCatalog; onChanged: () => void }) {
  const { t } = useT();
  const [testingEtsy, setTestingEtsy] = useState(false);

  async function testEtsy() {
    setTestingEtsy(true);
    try {
      const r = await api.admin.testEtsy();
      (r.ok ? toast.success : toast.error)(r.message);
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setTestingEtsy(false);
    }
  }

  return (
    <Section
      title={t("Sağlayıcı anahtarları", "Provider keys")}
      action={
        <Button busy={testingEtsy} onClick={() => void testEtsy()}>
          {t("Etsy bağlantısını dene", "Test Etsy connection")}
        </Button>
      }
    >
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        {t(
          "Anahtarlar veritabanında şifreli saklanır ve deploy'da kaybolmaz. Panelden anahtar girilmemişse sunucudaki ortam değişkeni (.env) kullanılır. Etsy anahtarı uygulama kimliğidir, yalnızca sunucu ortamından değişir.",
          "Keys are stored encrypted in the database and survive deploys. Without a key here, the server environment variable (.env) is used. The Etsy key is the app identity and only changes in the server environment.",
        )}
      </p>
      <ul className="space-y-3">
        {data.keys.map((k) => (
          <KeyRow key={k.provider} provider={k.provider} masked={k.masked} source={k.source} onChanged={onChanged} />
        ))}
      </ul>
    </Section>
  );
}

function KeyRow({ provider, masked, source, onChanged }: { provider: string; masked: string; source: string; onChanged: () => void }) {
  const { t } = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);

  async function run(kind: "save" | "test" | "clear") {
    setBusy(kind);
    try {
      if (kind === "test") {
        const r = await api.admin.testKey(provider, value.trim() || undefined);
        (r.ok ? toast.success : toast.error)(`${PROVIDER_NAMES[provider] ?? provider}: ${r.message}`);
        return;
      }
      if (kind === "save") {
        await api.admin.setKey(provider, value.trim());
        setValue("");
        toast.success(t("Anahtar kaydedildi", "Key saved"));
      } else {
        if (!window.confirm(t("Panelden girilen anahtar silinsin mi? Varsa .env'deki anahtar kullanılır.", "Remove the key entered here? The .env key is used if there is one."))) return;
        await api.admin.clearKey(provider);
      }
      onChanged();
    } catch (e) {
      if (errorText(e)) toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-lg border border-neutral-100 p-3 dark:border-neutral-800">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{PROVIDER_NAMES[provider] ?? provider}</span>
        {source === "db" && <Badge tone="good">{t("panelden", "from panel")}</Badge>}
        {source === "env" && <Badge tone="muted">.env</Badge>}
        {source === "" && <Badge tone="warn">{t("tanımlı değil", "not set")}</Badge>}
        {masked && <span className="font-mono text-xs text-neutral-400 dark:text-neutral-500">{masked}</span>}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("Yeni anahtar", "New key")}
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <div className="flex flex-shrink-0 gap-2">
          <Button tone="primary" busy={busy === "save"} disabled={value.trim().length < 8 || busy !== null} onClick={() => void run("save")}>
            {t("Kaydet", "Save")}
          </Button>
          <Button busy={busy === "test"} disabled={busy !== null} onClick={() => void run("test")}>
            {t("Dene", "Test")}
          </Button>
          {source === "db" && (
            <Button tone="danger" busy={busy === "clear"} disabled={busy !== null} onClick={() => void run("clear")}>
              {t("Kaldır", "Remove")}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
