"use server";

import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { buildRetrievalIndex } from "@/domains/retrieval-twin/build-index";
import { buildCitationLikelihoodReport } from "@/domains/retrieval-twin/citation-likelihood";

/**
 * checkAnswerRaceAction (2026-07-02, master plan item 50) - the operator trigger behind
 * "Check who wins the answer race". Operator-gated; fires only on an explicit click; the
 * bounded index build (top ~150 owned pages by demand + all cached competitor teardowns,
 * budgeted + cached embeddings) lives inside buildRetrievalIndex. Returns an honest receipt
 * with the real spend. NO cron wiring - this cycle is operator-triggered only.
 *
 * After indexing, runs ONE representative citation-likelihood report (the top-indexed owned
 * page) so the receipt can show a real example ranking, not just a chunk count.
 */
export type AnswerRaceActionResponse =
  | { ok: false; reason: string }
  | {
      ok: true;
      status: "ok" | "no_content" | "error";
      message: string;
      chunksEmbedded: number;
      cacheHits: number;
      spentUsd: number;
      exampleSentence: string | null;
    };

export async function checkAnswerRaceAction(): Promise<AnswerRaceActionResponse> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator only." };
  const tenantId = await currentTenantId();
  const indexResult = await buildRetrievalIndex(tenantId);

  let exampleSentence: string | null = null;
  if (indexResult.status === "ok" && indexResult.chunksEmbedded > 0) {
    // Best-effort: name a page from the index and show its first question's ranking. Never
    // blocks the receipt - a report failure just means no example sentence this time.
    try {
      const { getCompetitorAuditsForTenant } = await import("@/domains/demand-graph/competitor-page-audit");
      const audits = await getCompetitorAuditsForTenant();
      const anyCompetitorUrl = [...audits.values()].find((a) => a.fetchStatus === "ok")?.url;
      if (anyCompetitorUrl) {
        // Use the demand graph to find an owned page in the same tenant to report on.
        const { loadDemandGraphForTenantCached } = await import("@/domains/demand-graph/load-graph");
        const { graph } = await loadDemandGraphForTenantCached(tenantId);
        const ownedUrl = graph.pageNodes.find((p) => p.isOwned)?.url;
        if (ownedUrl) {
          const report = await buildCitationLikelihoodReport(tenantId, ownedUrl);
          exampleSentence = report.questions[0]?.sentence ?? null;
        }
      }
    } catch {
      exampleSentence = null;
    }
  }

  if (indexResult.status === "ok") {
    revalidatePath("/diagnostics/competitor-intel");
    revalidatePath("/prompts");
    revalidatePath("/worklist");
    revalidatePath("/");
  }

  return {
    ok: true,
    status: indexResult.status,
    message: indexResult.message,
    chunksEmbedded: indexResult.chunksEmbedded,
    cacheHits: indexResult.cacheHits,
    spentUsd: indexResult.spentUsd,
    exampleSentence,
  };
}
