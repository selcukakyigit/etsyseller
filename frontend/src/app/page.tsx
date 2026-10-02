import type { Metadata } from "next";
import Link from "next/link";
import ProductMock from "@/components/site/ProductMock";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { serif } from "@/components/site/fonts";
import { getLang } from "@/lib/i18n-server";
import { Lang } from "@/lib/i18n";
import { BRAND, ETSY_DISCLAIMER } from "@/lib/legal";

const COPY = {
  en: {
    title: `${BRAND} | Profit tracking and listing tools for Etsy sellers`,
    description:
      "Ulagg brings your Etsy listings, orders and costs into one place, shows what you really earn after fees, and helps you improve listings. Nothing changes in your shop until you approve it.",
    eyebrow: "For Etsy sellers",
    h1a: "See what your shop",
    h1b: "really earns,",
    h1c: "and fix what holds it back.",
    sub: "Ulagg keeps your listings, orders and costs in one place. It works out profit after Etsy fees, shipping and what each product costs you, and points to the listings worth your time. Nothing changes in your shop until you approve it.",
    cta: "Get started",
    cta2: "See how it works",
    micro: "Connects through Etsy's official sign-in. We never see your Etsy password.",
    featuresTitle: "What it does",
    features: [
      ["Profit, not just sales", "Etsy fees, shipping labels and your own product costs are taken off for you. You see profit per order, per listing and per month, so you know which products are worth making."],
      ["Drafts first, then publish", "Change titles, tags, descriptions and photos in a draft. Review the difference, then publish. Every version is kept, so you can go back to an earlier one."],
      ["Listings that need attention", "Each listing is compared with the rest of your shop. If one gets views but few favorites, or favorites but few sales, you see where it is stuck and what to look at."],
      ["Orders and shipping in one list", "See orders, mark them shipped with tracking, print gift notes, and keep shipping invoices matched to the orders they belong to."],
    ],
    howTitle: "How it works",
    steps: [
      ["Connect your shop", "Sign in with Etsy and choose what Ulagg can access. It takes about a minute."],
      ["Look at the numbers", "Your listings and orders sync in. Add what each product costs you once and profit fills in."],
      ["Publish what you approve", "Edit in a draft, check the changes, and publish them yourself. Nothing is sent to Etsy before that."],
    ],
    dataTitle: "Your shop, your data",
    dataLead: "You are trusting us with access to your shop. These are the rules we hold ourselves to.",
    data: [
      ["You approve every change", "Edits, including AI suggestions, stay in a draft until you press publish."],
      ["Tokens are encrypted", "The keys that let Ulagg talk to Etsy are stored encrypted, and you can disconnect at any time."],
      ["Delete it all yourself", "Account and data deletion is one screen in settings. Your Etsy shop is never touched."],
      ["No selling, no model training", "We don't sell your data and we don't use your Etsy data to train AI models."],
    ],
    dataLink: "Read the privacy policy",
    endTitle: "Try it on your own shop.",
    endSub: "Connect in a minute and see your first profit numbers.",
  },
  tr: {
    title: `${BRAND} | Etsy satıcıları için kâr takibi ve ilan araçları`,
    description:
      "Ulagg, Etsy ilanlarını, siparişlerini ve maliyetlerini tek yerde toplar, ücretlerden sonra gerçekte ne kazandığını gösterir ve ilanlarını geliştirmene yardım eder. Sen onaylamadan mağazanda hiçbir şey değişmez.",
    eyebrow: "Etsy satıcıları için",
    h1a: "Mağazan gerçekte",
    h1b: "ne kazanıyor, gör;",
    h1c: "seni geride tutanı düzelt.",
    sub: "Ulagg ilanlarını, siparişlerini ve maliyetlerini tek yerde tutar. Etsy ücretleri, kargo ve ürün maliyetinden sonra kârı hesaplar, hangi ilanlara zaman ayırman gerektiğini gösterir. Sen onaylamadan mağazanda hiçbir şey değişmez.",
    cta: "Başla",
    cta2: "Nasıl çalışır",
    micro: "Etsy'nin resmi girişiyle bağlanır. Etsy şifreni asla görmeyiz.",
    featuresTitle: "Neler yapar",
    features: [
      ["Sadece satış değil, kâr", "Etsy ücretleri, kargo etiketleri ve kendi ürün maliyetlerin senin yerine düşülür. Sipariş, ilan ve ay bazında kârı görürsün; hangi ürünün değdiğini bilirsin."],
      ["Önce taslak, sonra yayın", "Başlık, etiket, açıklama ve fotoğrafları taslakta değiştir. Farkı kontrol et, sonra yayınla. Her sürüm saklanır, istersen eskisine dönersin."],
      ["İlgi bekleyen ilanlar", "Her ilan mağazanın geri kalanıyla karşılaştırılır. Görüntülenme var ama favori azsa ya da favori var ama satış yoksa, nerede takıldığını ve neye bakman gerektiğini görürsün."],
      ["Sipariş ve kargo tek listede", "Siparişleri gör, takip numarasıyla kargolandı işaretle, hediye notu bas ve kargo faturalarını ait oldukları siparişlerle eşleştir."],
    ],
    howTitle: "Nasıl çalışır",
    steps: [
      ["Mağazanı bağla", "Etsy ile giriş yap ve Ulagg'ın nelere erişeceğini seç. Yaklaşık bir dakika sürer."],
      ["Rakamlara bak", "İlanların ve siparişlerin senkronlanır. Her ürünün maliyetini bir kez gir, kâr kendiliğinden dolar."],
      ["Onayladığını yayınla", "Taslakta düzenle, değişiklikleri kontrol et ve kendin yayınla. Ondan önce Etsy'ye hiçbir şey gitmez."],
    ],
    dataTitle: "Mağazan, verilerin",
    dataLead: "Mağazana erişim yetkisi veriyorsun. Kendimize koyduğumuz kurallar şunlar.",
    data: [
      ["Her değişikliği sen onaylarsın", "Yapay zekâ önerileri dahil tüm düzenlemeler, sen yayınla diyene kadar taslakta kalır."],
      ["Anahtarlar şifreli", "Ulagg'ın Etsy ile konuşmasını sağlayan anahtarlar şifreli saklanır, bağlantıyı istediğin an kesebilirsin."],
      ["Hepsini kendin silebilirsin", "Hesap ve veri silme ayarlarda tek ekrandır. Etsy mağazana hiç dokunulmaz."],
      ["Satış yok, model eğitimi yok", "Verilerini satmayız ve Etsy verilerini yapay zekâ modellerini eğitmek için kullanmayız."],
    ],
    dataLink: "Gizlilik politikasını oku",
    endTitle: "Kendi mağazanda dene.",
    endSub: "Bir dakikada bağlan, ilk kâr rakamlarını gör.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const c = COPY[await getLang()];
  return { title: c.title, description: c.description, openGraph: { title: c.title, description: c.description, type: "website" } };
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A9502F] dark:text-[#F48771]">{children}</p>;
}

export default async function LandingPage() {
  const lang: Lang = await getLang();
  const c = COPY[lang];
  const primary =
    "inline-flex items-center rounded-full bg-[#1F1B16] px-6 py-3 text-sm font-medium text-white transition hover:bg-black dark:bg-[#F3EFE9] dark:text-[#1F1B16] dark:hover:bg-white";
  const secondary =
    "inline-flex items-center rounded-full border border-black/15 px-6 py-3 text-sm font-medium text-neutral-800 transition hover:bg-black/5 dark:border-white/20 dark:text-neutral-100 dark:hover:bg-white/10";

  return (
    <div className="flex-1 overflow-x-clip bg-[#FBF9F6] text-neutral-800 dark:bg-[#0E0D0C] dark:text-neutral-200">
      <SiteHeader lang={lang} />

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-20 pt-16 md:pt-24 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="min-w-0">
            <Eyebrow>{c.eyebrow}</Eyebrow>
            <h1 className={`${serif.className} mt-5 text-5xl leading-[1.05] tracking-tight text-neutral-900 dark:text-neutral-50 md:text-6xl`}>
              {c.h1a} <em className="text-[#D97757] not-italic">{c.h1b}</em> {c.h1c}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-300">{c.sub}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/login?mode=register" className={primary}>
                {c.cta}
              </Link>
              <Link href="#how" className={secondary}>
                {c.cta2}
              </Link>
            </div>
            <p className="mt-5 text-sm text-neutral-500 dark:text-neutral-400">{c.micro}</p>
            {/* Etsy API Terms: bu cümle "belirgin bir yerde" olmalı (Commercial Access şartı); yalnızca footer'da kalmasın. */}
            <p className="mt-6 max-w-xl border-l-2 border-neutral-300 pl-3 text-xs leading-relaxed text-neutral-600 dark:border-neutral-600 dark:text-neutral-300">
              {ETSY_DISCLAIMER}
            </p>
          </div>
          <div className="flex min-w-0 justify-center lg:justify-end">
            <ProductMock lang={lang} />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-20 border-t border-black/5 dark:border-white/10">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className={`${serif.className} text-4xl text-neutral-900 dark:text-neutral-50`}>{c.featuresTitle}</h2>
            <div className="mt-12 grid gap-x-16 gap-y-12 md:grid-cols-2">
              {c.features.map(([title, text], i) => (
                <div key={title} className="border-t border-black/10 pt-5 dark:border-white/15">
                  <p className={`${serif.className} text-2xl text-[#D97757]`}>{String(i + 1).padStart(2, "0")}</p>
                  <h3 className="mt-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
                  <p className="mt-2 leading-relaxed text-neutral-600 dark:text-neutral-300">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 bg-[#F3EEE7] dark:bg-[#151311]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className={`${serif.className} text-4xl text-neutral-900 dark:text-neutral-50`}>{c.howTitle}</h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3">
              {c.steps.map(([title, text], i) => (
                <li key={title} className="flex gap-4">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-black/20 text-sm font-medium text-neutral-800 dark:border-white/25 dark:text-neutral-100">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
                    <p className="mt-1.5 leading-relaxed text-neutral-600 dark:text-neutral-300">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Data */}
        <section id="data" className="scroll-mt-20">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <h2 className={`${serif.className} text-4xl text-neutral-900 dark:text-neutral-50`}>{c.dataTitle}</h2>
              <p className="mt-4 max-w-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{c.dataLead}</p>
              <Link href="/privacy" className="mt-5 inline-block text-sm font-medium text-neutral-900 underline underline-offset-4 dark:text-neutral-100">
                {c.dataLink}
              </Link>
            </div>
            <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {c.data.map(([title, text]) => (
                <div key={title}>
                  <dt className="font-semibold text-neutral-900 dark:text-neutral-100">{title}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Closing */}
        <section className="px-6 pb-24">
          <div className="mx-auto max-w-6xl rounded-3xl bg-[#1F1B16] px-8 py-14 text-center dark:bg-[#1B1816] dark:ring-1 dark:ring-white/10">
            <h2 className={`${serif.className} text-4xl text-white md:text-5xl`}>{c.endTitle}</h2>
            <p className="mx-auto mt-3 max-w-md text-neutral-300">{c.endSub}</p>
            <Link
              href="/login?mode=register"
              className="mt-7 inline-flex items-center rounded-full bg-[#D97757] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#d9540f]"
            >
              {c.cta}
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter lang={lang} />
    </div>
  );
}
