import "server-only";

/**
 * warm-caches - the surface-release warm build. The one job: settle who the competition actually is, rebuild the shared demand-graph snapshot, then rebuild
 * and publish the Today + Changes surface release, so the first render after fresh data is instant AND complete. Composition only: each step calls the
 * EXISTING loader/builder, and the one piece of judgment below exists because Evidence may not reach a provider and this is the pass that pays for one.
 *
 * WHY IT EXISTS: the manual "Update data" refresh pulls fresh data and then repaints via `revalidatePath("/")`, and without this that repaint pays the full
 * ~6s cold demand-graph build right when the operator is watching while the deadline-raced Today sections fall back to "here on your next visit". Warming here
 * (build-then-write always rebuilds from the just-pulled data) makes the post-refresh repaint instant and complete. MONEY POSTURE: the graph, changes and today
 * loaders are cached or durable reads only ($0), and the competitor inspection is capped, cached against the exact evidence it was decided on, and asks nobody
 * anything while that evidence has not moved. FAILURE POSTURE (Slice 4 truth boundary): this PROPAGATES a build failure, because the Research Run
 * publish_surface phase may set surfacePublished:true only after a real publish resolved and must pause rather than advance when it fails. Callers that want
 * fail-soft warming (the connectors "Update data" action) own an explicit .catch at their call site.
 */

import { z } from "zod";

import { competitorLandscape, type CompetitorKind } from "@/domains/evidence";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { loadBusinessProfile } from "@/domains/account";
import { recordSpend } from "@/domains/decision/llm/adjudicator-budget";
import { openAIStructuredResponse } from "@/domains/decision/llm/gateway";
import { PROMPT_REGISTRY } from "@/domains/decision/llm/prompt-registry";

const OVERLAP = z.object({ verdict: z.enum(["same_business", "not_a_business"]), reason: z.string().min(1).max(280) });
const OVERLAP_MODEL = "gpt-5-mini";
/** Registered in Decision; `action` is what the error ledger and every log line key on. */
const OVERLAP_PROMPT = "competitor.overlap_adjudication" as const;

/** IS THIS DOMAIN A BUSINESS COMPETING WITH THIS ACCOUNT: one bounded structured verdict, judged ONLY off
 *  pages the research run already read, through the one OpenAI egress. It lives in Runtime because Evidence
 *  may not reach a provider; the landscape caches the verdict against the exact evidence it was decided on,
 *  so unchanged evidence never asks again. Fail-soft everywhere: unresolved, never a guessed rival. */
async function askOverlap(tenantId: string, input: { domain: string; pages: string[]; site: string | null; ownedPages: string[] }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const out = await openAIStructuredResponse({
    promptId: OVERLAP_PROMPT, promptVersion: PROMPT_REGISTRY[OVERLAP_PROMPT], action: "competitor-overlap",
    apiKey, model: OVERLAP_MODEL, tenantId, schemaName: "competitor_overlap", zodSchema: OVERLAP,
    instructions: "Decide one thing about one website: does it sell a comparable product or service to the same customers as the business described. Judge only from the page evidence given to you. A publication, encyclopedia, forum, directory, marketplace or public body is not_a_business however often it ranks. Answer same_business only when the offering and the audience plainly both overlap. Give one short plain reason. Invent nothing.",
    input: `The business: ${input.site ?? "unknown"}\nIts own pages:\n${input.ownedPages.join("\n")}\n\nThe domain to judge: ${input.domain}\nPages I have already read there:\n${input.pages.join("\n")}`,
    maxOutputTokens: 400, timeoutMs: 90_000, budget: { mode: "gateway_check", projectedCostUsd: 0.01 },
  }).catch(() => null);
  if (out?.kind !== "ok") return null;
  if (out.provenance.costUsd) await recordSpend(out.provenance.costUsd, { tenantId }).catch(() => {});
  const parsed = OVERLAP.safeParse(out.value);
  return parsed.success ? { ...parsed.data, model: out.provenance.servedModel ?? OVERLAP_MODEL } : null;
}

/**
 * Rebuild the fused Today + Changes surface release and publish it. Throws on a
 * build/publish failure so the caller can decide whether to fail soft.
 */
export async function warmFreeSurfaces(tenantId: string): Promise<void> {
  // Settle who the competition is BEFORE the release is built, so the surface reads decided verdicts, not
  // nominations. The operator's overrides ride along: an excluded domain is never inspected and a pinned one
  // never buys a verdict, exactly as the display promises. Fail-soft: unsettled is honest, never a hold.
  const profile = await loadBusinessProfile(tenantId).catch(() => null);
  const overrides = (profile?.competitors.value ?? []).filter((c) => !!c.domain)
    .map((c) => ({ domain: c.domain!, action: c.action ?? ("pin" as const), kind: c.kind as CompetitorKind | undefined }));
  await competitorLandscape(await loadEvidenceSnapshot(tenantId), overrides, (input) => askOverlap(tenantId, input)).catch(() => []);
  const { refreshCustomerSurface } = await import("@/app/(shell)/surface-release");
  await refreshCustomerSurface(tenantId);
}
