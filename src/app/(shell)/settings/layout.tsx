import { SettingsTabsClient } from "./settings-tabs-client";
import { ExitGatesSettingsHint } from "./exit-gates-settings-hint";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl">
      <ExitGatesSettingsHint />
      <SettingsTabsClient>{children}</SettingsTabsClient>
    </div>
  );
}
