import type { Metadata } from "next";
import { COPY } from "@/components/site/landing/copy";
import { Data, SitePage } from "@/components/site/landing/sections";
import { getLang } from "@/lib/i18n-server";
import { BRAND } from "@/lib/legal";

export async function generateMetadata(): Promise<Metadata> {
  const [title, description] = COPY[await getLang()].meta.data;
  return { title: `${title} | ${BRAND}`, description, openGraph: { title: `${title} | ${BRAND}`, description, type: "website" } };
}

export default async function DataPage() {
  const lang = await getLang();
  const c = COPY[lang];
  return (
    <SitePage lang={lang} c={c} active="data">
      <Data c={c} standalone />
    </SitePage>
  );
}
