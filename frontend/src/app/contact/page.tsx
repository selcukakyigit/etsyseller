import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/site/ContactForm";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { serif } from "@/components/site/fonts";
import { getLang } from "@/lib/i18n-server";
import { BRAND, COMPANY } from "@/lib/legal";

export const metadata: Metadata = { title: `Contact | ${BRAND}` };

const COPY = {
  en: {
    title: "Talk to us",
    lead: "Questions about Ulagg, your Etsy connection or your data? Send a message and we will answer by email. For something quick, WhatsApp is fine too.",
    find: "Where to find us",
    whatsapp: "WhatsApp",
    emailLabel: "Email",
    privacy: "Privacy and data requests",
    privacyText: "To use your rights over personal data (access, correction, deletion), write to",
    privacySelf: "You can also delete your account and data yourself in Settings, Account and data.",
    security: "Security issues",
    securityText: "Found a vulnerability? Email us and give us time to fix it before sharing it publicly.",
    map: "Show on a larger map",
    mapNote: "The map comes from OpenStreetMap. Loading it shares your IP address with them; it sets no cookies.",
  },
  tr: {
    title: "Bize ulaş",
    lead: "Ulagg, Etsy bağlantın ya da verilerinle ilgili sorular için mesaj bırak, e-postayla cevaplayalım. Hızlı bir şey için WhatsApp da olur.",
    find: "Bizi nerede bulursun",
    whatsapp: "WhatsApp",
    emailLabel: "E-posta",
    privacy: "Gizlilik ve veri talepleri",
    privacyText: "Kişisel verilerinle ilgili haklarını (erişim, düzeltme, silme) kullanmak için şuraya yaz:",
    privacySelf: "Hesabını ve verilerini Ayarlar, Hesap ve Veriler ekranından kendin de silebilirsin.",
    security: "Güvenlik sorunları",
    securityText: "Bir güvenlik açığı mı buldun? Bize yaz, herkese açık paylaşmadan önce düzeltmemiz için süre tanı.",
    map: "Daha büyük haritada gör",
    mapNote: "Harita OpenStreetMap'ten gelir. Yüklenmesi IP adresini onlarla paylaşır; çerez bırakmaz.",
  },
};

export default async function ContactPage() {
  const lang = await getLang();
  const c = COPY[lang];
  const d = 0.005;
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${COMPANY.lon - d * 1.6},${COMPANY.lat - d},${COMPANY.lon + d * 1.6},${COMPANY.lat + d}&layer=mapnik&marker=${COMPANY.lat},${COMPANY.lon}`;
  const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${COMPANY.name} ${COMPANY.address}`)}`;

  return (
    <div className="flex-1 bg-[#FBF9F6] text-neutral-800 dark:bg-[#0E0D0C] dark:text-neutral-200">
      <SiteHeader lang={lang} />
      <main className="mx-auto max-w-6xl px-6 py-14">
        <h1 className={`${serif.className} text-5xl text-neutral-900 dark:text-neutral-50`}>{c.title}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-300">{c.lead}</p>

        <div className="mt-12 grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-8 text-sm">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A9502F] dark:text-[#F48771]">{c.find}</h2>
              <p className="mt-3 font-medium text-neutral-900 dark:text-neutral-100">{COMPANY.name}</p>
              <address className="mt-1 not-italic leading-relaxed text-neutral-600 dark:text-neutral-300">
                {COMPANY.addressLines.map((l) => (
                  <span key={l} className="block">{l}</span>
                ))}
              </address>
              <p className="mt-3 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                {COMPANY.tax}
                <br />
                MERSİS {COMPANY.mersis} · {lang === "tr" ? "Ticaret Sicil No" : "Trade registry no."} {COMPANY.tradeRegistry}
              </p>
            </div>

            <dl className="space-y-4">
              <div>
                <dt className="text-neutral-500 dark:text-neutral-400">{c.whatsapp}</dt>
                <dd className="mt-0.5">
                  <a className="font-medium text-neutral-900 underline underline-offset-4 dark:text-neutral-100" href={`https://wa.me/${COMPANY.whatsapp}`} target="_blank" rel="noopener noreferrer">
                    {COMPANY.whatsappDisplay}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500 dark:text-neutral-400">{c.emailLabel}</dt>
                <dd className="mt-0.5">
                  <a className="font-medium text-neutral-900 underline underline-offset-4 dark:text-neutral-100" href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
                </dd>
              </div>
            </dl>

            <div>
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{c.privacy}</h3>
              <p className="mt-1 leading-relaxed text-neutral-600 dark:text-neutral-300">
                {c.privacyText}{" "}
                <a className="underline underline-offset-4" href={`mailto:${COMPANY.kvkkEmail}`}>{COMPANY.kvkkEmail}</a>. {c.privacySelf}{" "}
                <Link className="underline underline-offset-4" href="/privacy">{lang === "tr" ? "Gizlilik Politikası" : "Privacy Policy"}</Link>
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{c.security}</h3>
              <p className="mt-1 leading-relaxed text-neutral-600 dark:text-neutral-300">{c.securityText}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-[#131110] sm:p-8">
            <ContactForm lang={lang} />
          </div>
        </div>

        <section className="mt-14">
          <div className="overflow-hidden rounded-2xl border border-black/10 dark:border-white/10">
            <iframe
              title="Map"
              src={embed}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="block h-[340px] w-full border-0 dark:opacity-90 dark:[filter:invert(0.92)_hue-rotate(180deg)]"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <p>{c.mapNote}</p>
            <a className="font-medium text-neutral-800 underline underline-offset-4 dark:text-neutral-200" href={mapsLink} target="_blank" rel="noopener noreferrer">
              {c.map}
            </a>
          </div>
        </section>
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
