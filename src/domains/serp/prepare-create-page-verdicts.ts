import "server-only";

import { log } from "@/lib/logger";
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";
import { runSerpQuery } from "./dataforseo-serp";
import { validateCreatePage } from "./serp-validation";
import { rootDomain } from "./serp-provider";
import { draftCreatePageStructured } from "@/domains/llm/structured-drafter";
import { getLatestMoveDrafts } from "@/domains/demand-graph/move-draft-store";
import { readAllCachedKeywordDemand } from "./dataforseo-keywords";
import { matchKeywordDemand } from "@/domains/demand/keyword-match";

/**
 * prepare-create-page-verdicts (2026-06-25, Phase 4-auto) — the "prepared, not a
 * chore" precompute. Instead of the operator clicking "Validate with live SERP"
 * on each New Pages card, this runs the top-N create-page candidates through
 * DataForSEO once and PERSISTS the verdict (via move_drafts, kind=serp_verdict),
 * so the board arrives "Google checked: BUILD/WAIT/SKIP" with zero clicks.
 *
 * Capped (default 25/run), cache-first (the runner serves a 14d SERP cache for
 * free), fail-soft per candidate. Dry-run/capped candidates are skipped (no
 * fake verdict persisted). Tenant-agnostic.
 */

export type PreparedSerpVerdict = {
  verdict: "build" | "wait" | "reject";
  confidence: "high" | "medium" | "low";
  intent: string;
  contentDomainCount: number;
  marketplaceUgcCount: number;
  profoundOverlapCount: number;
  ownAlreadyRanks: boolean;
  topDomains: string[];
  reason: string;
  generatedAt: string;
  costUsd: number;
};

export type PrepareSummary = {
  validated: number;
  cached: number;
  skipped: number;
  /** Structured page briefs (title/meta/opening/outline/FAQ/schema) drafted + persisted. */
  briefs: number;
  costUsd: number;
  /** LLM spend for the page briefs (separate from SERP costUsd). */
  briefCostUsd: number;
  capped: boolean;
};

function deriveOwnDomain(pageNodes: ReadonlyArray<{ url: string }>): string {
  const counts = new Map<string, number>();
  for (const p of pageNodes) {
    const d = rootDomain(p.url);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

export async function prepareCreatePageVerdicts(
  tenantId: string,
  opts: {
    maxValidations?: number;
    now?: () => Date;
    /** Only validate create-page candidates with a strong/exact cached keyword-volume
     *  match, ranked by volume (the "spend SERP on volume-backed topics" path). */
    onlyKeywordMatched?: boolean;
    /** SERP verdict only — skip the (separately-budgeted) LLM brief generation. */
    skipBriefs?: boolean;
    /** Skip candidates that already carry a fresh (<14d) serp_verdict. */
    skipFreshVerdict?: boolean;
  } = {},
): Promise<PrepareSummary> {
  const max = opts.maxValidations ?? 25;
  const now = opts.now ?? (() => new Date());
  const summary: PrepareSummary = { validated: 0, cached: 0, skipped: 0, briefs: 0, costUsd: 0, briefCostUsd: 0, capped: false };

  let graph;
  try {
    graph = (await loadDemandGraphForTenant(tenantId)).graph;
  } catch (e) {
    log.warn("[prepare-verdicts] graph load failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return summary;
  }

  const ownDomain = deriveOwnDomain(graph.pageNodes);
  let createMoves = graph.moves.filter((m) => m.gap === "create_page");

  // Optional: skip candidates that already have a fresh serp_verdict (re-validate only
  // missing/stale) and/or restrict to strong/exact keyword-volume matches, volume-first.
  if (opts.onlyKeywordMatched || opts.skipFreshVerdict) {
    const FRESH_MS = 14 * 24 * 60 * 60 * 1000;
    const nowMs = now().getTime();
    const drafts = await getLatestMoveDrafts(tenantId).catch(() => new Map());
    const keywords = opts.onlyKeywordMatched ? await readAllCachedKeywordDemand().catch(() => []) : [];
    const isFresh = (demandKey: string): boolean => {
      const raw = drafts.get(`${demandKey}::serp_verdict`)?.content;
      if (!raw) return false;
      try {
        const v = JSON.parse(raw) as PreparedSerpVerdict;
        return !!v.generatedAt && nowMs - Date.parse(v.generatedAt) < FRESH_MS;
      } catch {
        return false;
      }
    };
    const scored = createMoves
      .map((m) => ({
        m,
        match: opts.onlyKeywordMatched
          ? matchKeywordDemand(m.label, m.aeoEvidence?.prompts?.[0] ?? null, keywords)
          : null,
      }))
      .filter(({ m }) => !(opts.skipFreshVerdict && isFresh(m.demandKey)))
      .filter(({ match }) => !opts.onlyKeywordMatched || match!.confidence === "strong" || match!.confidence === "exact")
      .sort((a, b) => (b.match?.searchVolume ?? 0) - (a.match?.searchVolume ?? 0) || b.m.components.demand - a.m.components.demand);
    createMoves = scored.map((s) => s.m);
  } else {
    createMoves = createMoves.sort((a, b) => b.components.demand - a.components.demand);
  }
  const creates = createMoves.slice(0, max);

  for (const m of creates) {
    const profoundDomains = [...new Set(m.competitorUrls.map((u) => rootDomain(u)).filter(Boolean))];
    let r;
    try {
      r = await runSerpQuery(m.label, { depth: 10 });
    } catch {
      summary.skipped += 1;
      continue;
    }
    // Only persist a verdict from a REAL SERP read (ok or cache hit) — never a
    // dry-run/capped/disabled placeholder.
    if (r.status !== "ok" && r.status !== "cache_hit") {
      summary.skipped += 1;
      if (r.status === "capped") summary.capped = true;
      continue;
    }
    if (r.status === "cache_hit") summary.cached += 1;
    else summary.validated += 1;
    summary.costUsd += r.costUsd;

    const v = validateCreatePage({ snapshot: r.snapshot, ownDomain, profoundDomains, searchVolume: null });
    const compact: PreparedSerpVerdict = {
      verdict: v.verdict,
      confidence: v.confidence,
      intent: v.intent,
      contentDomainCount: v.contentDomainCount,
      marketplaceUgcCount: v.marketplaceUgcCount,
      profoundOverlapCount: v.profoundOverlapCount,
      ownAlreadyRanks: v.ownAlreadyRanks,
      topDomains: v.topDomains.slice(0, 5),
      reason: v.reasons[0] ?? "",
      generatedAt: now().toISOString(),
      costUsd: r.costUsd,
    };
    await saveMoveDraft(tenantId, m.demandKey, "serp_verdict", JSON.stringify(compact)).catch(() => false);

    // Also draft the full structured page brief (title/meta/opening/outline/FAQ/
    // schema) for BUILD/WAIT pages, so the New Pages card arrives WRITTEN, not just
    // verdicted. SKIP pages get no brief (don't spend LLM on a page we advise
    // against). Best-effort + budget-gated inside the drafter; fail-soft.
    if (v.verdict !== "reject" && !opts.skipBriefs) {
      try {
        const brief = await draftCreatePageStructured({
          query: m.label,
          pageLabel: m.demandKey,
          competitorPages: [...new Set(m.competitorUrls)].slice(0, 6),
          fanoutQueries: m.aeoEvidence?.fanoutQueries ?? [],
          evidenceHints: [
            v.profoundOverlapCount > 0 ? "Google and AI cite the same competitors for this topic" : "",
            `${v.contentDomainCount} of 10 SERP results are beatable content pages`,
          ].filter(Boolean),
        });
        if (brief.status === "drafted") {
          summary.briefs += 1;
          summary.briefCostUsd += brief.costUsd;
          await saveMoveDraft(tenantId, m.demandKey, "create_page_brief", JSON.stringify(brief.value)).catch(() => false);
        } else if (brief.status === "validation_failed") {
          summary.briefCostUsd += brief.costUsd;
        }
      } catch {
        /* brief is best-effort; the verdict already persisted */
      }
    }
  }

  log.info("[prepare-verdicts] done", { tenantId, ...summary });
  return summary;
}

/** Parse a persisted serp_verdict draft back into a verdict (null on bad JSON). */
export function parsePreparedVerdict(content: string | null | undefined): PreparedSerpVerdict | null {
  if (!content) return null;
  try {
    const o = JSON.parse(content) as PreparedSerpVerdict;
    return o && typeof o.verdict === "string" ? o : null;
  } catch {
    return null;
  }
}
