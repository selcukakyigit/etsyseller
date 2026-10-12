import type { Metadata } from "next";
import { COPY } from "@/components/site/landing/copy";
import { Hero, Highlights, Pricing, Problem, SitePage } from "@/components/site/landing/sections";
import { getLang } from "@/lib/i18n-server";
import { loadPriceList } from "@/lib/pricing";

export async function generateMetadata(): Promise<Metadata> {
  const c = COPY[await getLang()];
  return { title: c.title, description: c.description, openGraph: { title: c.title, description: c.description, type: "website" } };
}

export default async function LandingPage() {
  const lang = await getLang();
  const c = COPY[lang];
  const pricing = await loadPriceList();
  return (
    <SitePage lang={lang} c={c}>
      <Hero lang={lang} c={c} />
      <Problem c={c} />
      <Highlights c={c} />
      <Pricing lang={lang} c={c} pricing={pricing} />
    </SitePage>
  );
}
