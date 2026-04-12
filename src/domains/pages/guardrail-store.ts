import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { GuardrailAlert } from "./guardrails";

/** Always reads `.data/page-guardrails.json` from disk (no import-time cache). */
export function getGuardrailAlerts(): GuardrailAlert[] {
  return readDotDataJson<GuardrailAlert[]>("page-guardrails") ?? [];
}
