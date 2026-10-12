import type { Metadata } from "next";
import { COPY } from "@/components/site/landing/copy";
import { How, SitePage } from "@/components/site/landing/sections";
import { getLang } from "@/lib/i18n-server";
import { BRAND } from "@/lib/legal";

export async function generateMetadata(): Promise<Metadata> {
  const [title, description] = COPY[await getLang()].meta.how;
  return { title: `${title} | ${BRAND}`, description, openGraph: { title: `${title} | ${BRAND}`, description, type: "website" } };
}

export default async function HowPage() {
  const lang = await getLang();
  const c = COPY[lang];
  return (
    <SitePage lang={lang} c={c} active="how">
      <How c={c} standalone />
    </SitePage>
  );
}
