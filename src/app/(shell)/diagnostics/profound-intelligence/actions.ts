"use server";

/**
 * Profound Question Intelligence — server action: draft the structured AEO brief
 * for one prompt opportunity (slice 7 made usable from the diagnostics surface).
 * Operator-gated. Paid LLM call is capped + logged + firewalled inside
 * draftAeoPromptBrief (fail-closed on budget). On-demand only (one click).
 */
import { isOperatorModeServer } from "@/lib/operator-mode";
import { draftAeoPromptBrief } from "@/domains/llm/structured-drafter";
import type { AeoPromptBrief } from "@/domains/llm/schemas";

export type DraftAeoBriefInput = {
  prompt: string;
  fanoutQueries: string[];
  competitorPages: string[];
  ownCitedUrls: string[];
  recommendedMove: string;
  tags: string[];
};

export type DraftAeoBriefResult =
  | { ok: true; brief: AeoPromptBrief }
  | { ok: false; reason: string };

export async function draftAeoBriefAction(input: DraftAeoBriefInput): Promise<DraftAeoBriefResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };
  if (!input?.prompt || input.prompt.trim().length === 0) return { ok: false, reason: "no_prompt" };

  const res = await draftAeoPromptBrief({
    prompt: input.prompt,
    fanoutQueries: Array.isArray(input.fanoutQueries) ? input.fanoutQueries.slice(0, 12) : [],
    competitorPages: Array.isArray(input.competitorPages) ? input.competitorPages.slice(0, 10) : [],
    ownCitedUrls: Array.isArray(input.ownCitedUrls) ? input.ownCitedUrls.slice(0, 10) : [],
    recommendedMove: input.recommendedMove ?? "answer_block",
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 12) : [],
  });

  if (res.status === "drafted") return { ok: true, brief: res.value };
  const reason =
    res.status === "off"
      ? "AI drafting is off (set BEACON_LLM_PROVIDER=openai + OPENAI_API_KEY)."
      : res.status === "blocked_budget"
        ? "Monthly AI budget cap reached."
        : res.status === "validation_failed"
          ? `The model output didn't validate (${res.reason}).`
          : "Could not draft a brief right now.";
  return { ok: false, reason };
}
