import type { Metadata } from "next";
import { COPY } from "@/components/site/landing/copy";
import { Pricing } from "@/components/site/landing/PricingSection";
import { SitePage } from "@/components/site/landing/sections";
import { getLang } from "@/lib/i18n-server";
import { BRAND } from "@/lib/legal";
import { loadPriceList } from "@/lib/pricing";

export async function generateMetadata(): Promise<Metadata> {
  const [title, description] = COPY[await getLang()].meta.pricing;
  return { title: `${title} | ${BRAND}`, description, openGraph: { title: `${title} | ${BRAND}`, description, type: "website" } };
}

export default async function PricingPage() {
  const lang = await getLang();
  const c = COPY[lang];
  const pricing = await loadPriceList();
  return (
    <SitePage lang={lang} c={c} active="pricing">
      <Pricing lang={lang} c={c} pricing={pricing} standalone />
    </SitePage>
  );
}
