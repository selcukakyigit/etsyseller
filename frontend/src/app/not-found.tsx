import StatusPage from "@/components/site/StatusPage";
import { getLang } from "@/lib/i18n-server";

export default async function NotFound() {
  return <StatusPage code={404} lang={await getLang()} />;
}
