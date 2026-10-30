"use client";

import AdminShell from "@/components/admin/AdminShell";
import { PageTabs } from "@/components/admin/ui";
import AnnouncementsSection from "./AnnouncementsSection";
import EmailsSection from "./EmailsSection";

const SECTIONS = {
  banners: { href: "/admin/announcement", tr: "Duyurular", en: "Announcements", Component: AnnouncementsSection },
  emails: { href: "/admin/announcement/emails", tr: "E-postalar", en: "Emails", Component: EmailsSection },
} as const;

const TABS = Object.values(SECTIONS);

/** Yönetim > Duyuru: uygulama içi duyuru bantları ve toplu hizmet e-postaları; ikisi de liste + "yeni" penceresi. Her sekme ayrı adrestir. */
export default function AnnouncementsPage({ section }: { section: keyof typeof SECTIONS }) {
  const { href, Component } = SECTIONS[section];
  return (
    <AdminShell current="/admin/announcement">
      <div className="space-y-6">
        <PageTabs tabs={TABS} current={href} />
        <Component />
      </div>
    </AdminShell>
  );
}
