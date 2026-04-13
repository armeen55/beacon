import { readExitGates } from "@/lib/exit-gates-store";
import { ExitGatesSettingsHintClient } from "./exit-gates-settings-hint-client";

export async function ExitGatesSettingsHint() {
  const gates = readExitGates();
  if (gates.every((g) => g.status === "passed")) return null;
  return <ExitGatesSettingsHintClient gates={gates} />;
}
