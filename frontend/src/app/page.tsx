import type { Metadata } from "next";
import { COPY } from "@/components/site/landing/copy";
import { Hero, Highlights, Problem, SitePage } from "@/components/site/landing/sections";
import { getLang } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const c = COPY[await getLang()];
  return { title: c.title, description: c.description, openGraph: { title: c.title, description: c.description, type: "website" } };
}

export default async function LandingPage() {
  const lang = await getLang();
  const c = COPY[lang];
  return (
    <SitePage lang={lang} c={c}>
      <Hero lang={lang} c={c} />
      <Problem c={c} />
      <Highlights c={c} />
    </SitePage>
  );
}
