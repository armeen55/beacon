import { SettingsTabsClient } from "./settings-tabs-client";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl">
      <SettingsTabsClient>{children}</SettingsTabsClient>
    </div>
  );
}
