import { redirect } from "next/navigation";

/** Modeller bir menü grubu; eski /admin/models bağlantıları kataloğa gider. */
export default function Page() {
  redirect("/admin/models/catalog");
}
