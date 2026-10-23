"use client";

import JobsPanel from "./JobsPanel";
import SettingsPanel from "./SettingsPanel";

/** Veri işlemleri: iş kuyruğu, sağlayıcı çağrıları, politika/bütçe ve kimlik bilgisi. */
export default function OperationsSection() {
  return (
    <div className="space-y-6">
      <JobsPanel />
      <SettingsPanel />
    </div>
  );
}
