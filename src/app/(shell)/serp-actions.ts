"use server";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { runSerpQuery } from "@/domains/serp/dataforseo-serp";
import { validateCreatePage, type SerpValidation } from "@/domains/serp/serp-validation";

/**
 * validateCreatePageWithSerpAction (2026-06-25, Phase 4) — on-demand DataForSEO
 * validation of a create-page candidate. Operator-gated; fires only on an
 * explicit click. Runs ONE SERP query through the safe runner (dry-run/cap/cache
 * all enforced there — spends nothing while DATAFORSEO_DRY_RUN=true) and returns
 * the verdict (build / wait / reject + confidence + reasons). Honest when the
 * connector is off or capped: status is surfaced, verdict stays "wait"/low.
 */
export type SerpValidationResponse =
  | { ok: false; reason: string }
  | { ok: true; status: string; costUsd: number; validation: SerpValidation };

export async function validateCreatePageWithSerpAction(input: {
  topic: string;
  ownDomain: string;
  profoundDomains?: string[];
  searchVolume?: number | null;
}): Promise<SerpValidationResponse> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator only." };
  const topic = input.topic?.trim();
  if (!topic) return { ok: false, reason: "No topic." };

  const r = await runSerpQuery(topic, { depth: 10 });
  const validation = validateCreatePage({
    snapshot: r.snapshot,
    ownDomain: input.ownDomain,
    profoundDomains: input.profoundDomains,
    searchVolume: input.searchVolume ?? null,
  });
  return { ok: true, status: r.status, costUsd: r.costUsd, validation };
}
