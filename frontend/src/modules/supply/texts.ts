import type { T } from "@/lib/i18n-client";
import type { ActivityText } from "../components/ActivityFeed";
import { money } from "../core/units";
import type { JobStatus } from "./api";

export const STATUS: Record<JobStatus, { tr: string; en: string; cls: string }> = {
  draft: { tr: "Taslak", en: "Draft", cls: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" },
  submitted: { tr: "Onay bekliyor", en: "Waiting for approval", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  confirmed: { tr: "Onaylandı", en: "Confirmed", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  disputed: { tr: "İtiraz edildi", en: "Disputed", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

export const statusLabel = (s: JobStatus, t: T) => t(STATUS[s].tr, STATUS[s].en);

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const job = (d: Record<string, unknown>) => `#${s(d.number)}${d.title ? ` ${s(d.title)}` : ""}`;

/** Dış Tedarik olaylarının iki dilli metni (ortak olaylar ActivityFeed'de). */
export const SUPPLY_ACTIVITY: Record<string, ActivityText> = {
  job_created: (d, t) => t(`İş açıldı: ${job(d)}`, `Job created: ${job(d)}`),
  job_lines_changed: (d, t) => t(`İş #${s(d.number)} satırları değişti`, `Job #${s(d.number)} lines changed`),
  job_document_removed: (d, t) => t(`İş #${s(d.number)} belgesi kaldırıldı`, `Job #${s(d.number)} document removed`),
  job_document_item_removed: (d, t) => t(`İş #${s(d.number)} belgesinden bir kalem silindi`, `An item was removed from job #${s(d.number)}'s document`),
  job_updated: (d, t) => t(`İş #${s(d.number)} güncellendi`, `Job #${s(d.number)} updated`),
  job_deleted: (d, t) => t(`İş silindi: ${job(d)}`, `Job deleted: ${job(d)}`),
  job_submitted: (d, t) => t(`İş #${s(d.number)} onaya gönderildi`, `Job #${s(d.number)} sent for approval`),
  job_disputed: (d, t) => t(`İş #${s(d.number)} için itiraz: ${s(d.note) || "—"}`, `Job #${s(d.number)} disputed: ${s(d.note) || "—"}`),
  material_type_added: (d, t) => t(`Malzeme türü eklendi: ${s(d.name)}`, `Material type added: ${s(d.name)}`),
  material_type_deleted: (d, t) => t(`Malzeme türü silindi: ${s(d.name)} (${s(d.items)} kalem Diğer'e taşındı)`, `Material type deleted: ${s(d.name)} (${s(d.items)} items moved to Other)`),
  stock_skipped: (d, t) => t(`İş #${s(d.number)}: şu kalemler stoktan düşülemedi (birim çevrilemedi): ${s(d.items)}`, `Job #${s(d.number)}: these items could not be taken from stock (unit mismatch): ${s(d.items)}`),
  job_confirmed: (d, t, l) => t(`İş #${s(d.number)} onaylandı (${money(Number(d.amount), s(d.currency), l)})`, `Job #${s(d.number)} confirmed (${money(Number(d.amount), s(d.currency), l)})`),
  job_reopened: (d, t) => t(`İş #${s(d.number)} yeniden açıldı`, `Job #${s(d.number)} reopened`),
  plan_changed: (d, t) => t(`İş #${s(d.number)} için maliyet dağıtımı değişti`, `Cost split changed for job #${s(d.number)}`),
  unit_cost_reverted: (d, t) => t(`İş #${s(d.number)}: ${s(d.count)} ürünün birim maliyeti geri alındı`, `Job #${s(d.number)}: unit cost reverted for ${s(d.count)} product(s)`),
  unit_cost_applied: (d, t, l) => t(`"${s(d.title)}" birim maliyeti ${money(Number(d.unit_cost), s(d.currency), l)} yapıldı`, `"${s(d.title)}" unit cost set to ${money(Number(d.unit_cost), s(d.currency), l)}`),
};
