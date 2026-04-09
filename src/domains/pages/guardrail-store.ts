import { getRepository } from "@/lib/persistence/repositories";
import type { GuardrailAlert } from "./guardrails";

const repo = getRepository();

export const guardrailAlerts: GuardrailAlert[] =
  await repo.getGuardrailAlerts();
