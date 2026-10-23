import { redirect } from "next/navigation";

/** Araştırma bir menü grubu; /admin/research genel bakışa gider. */
export default function Page() {
  redirect("/admin/research/overview");
}
