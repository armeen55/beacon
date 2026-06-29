import "server-only";
import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { getCompetitorAuditsForTenant, whatWins } from "@/domains/demand-graph/competitor-page-audit";
import { getLatestMoveDrafts, type MoveDraftRow } from "@/domains/demand-graph/move-draft-store";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { parsePreparedVerdict, type PreparedSerpVerdict } from "@/domains/serp/prepare-create-page-verdicts";
import { parsePreparedPack } from "@/domains/demand-graph/prepared-move-pack";
import type { CreatePageBrief } from "@/domains/llm/schemas";
import { evaluateCreatePageBriefQuality, evaluateDraftQuality, type DraftQualityResult } from "@/domains/drafts/draft-quality";
import { readAllCachedKeywordDemand, type KeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { matchKeywordDemand, topicDistinguishingTokens } from "@/domains/demand/keyword-match";
import { groupCreatePageCandidates } from "@/domains/demand/canonical-create-page";
import { cleanTopicLabel, isJunkTopic } from "@/domains/demand-graph/clean-topic-label";

/**
 * today-newpages-data (2026-06-24) — the loader behind the "New Pages to Build"
 * board: the demand-graph engine's create_page Moves (topics competitors own that
 * the tenant has no page for). These intentionally never enter the EDIT queue
 * (they're new pages, not edits) — this surface is their home. Read-only,
 * tenant-agnostic; empty → the section self-hides. Demand is an AI-attention proxy
 * (citation breadth × volume), NOT measured search volume, so it's shown as a
 * concrete "N competitor pages cited" + an honest interest tier, never a fake
 * search-volume number.
 */

export type NewPageOpportunity = {
  id: string;
  topic: string;
  competitorCount: number;
  topCompetitor: string | null;
  /** What the cited competitor page has (deterministic teardown), when audited. */
  whatWins: string | null;
  /** Real DataForSEO monthly search volume from the best cached keyword match (else
   *  null — never a fuzzy guess). Grounds the demand beyond the AI-attention proxy. */
  searchVolume: number | null;
  /** The matched cached keyword + how confident the topic↔keyword map is (2026-06-28
   *  deterministic matcher: exact/strong shown plainly, weak shown cautiously). Null
   *  when no DataForSEO keyword matched this topic. */
  keywordMatch?: { keyword: string; volume: number | null; confidence: "exact" | "strong" | "weak" } | null;
  /** Canonicalization (2026-06-29) — sibling topics this canonical card absorbed (the
   *  "Also covers: …" line), so the board shows ONE card per real opportunity. */
  alsoCovers?: string[];
  /** True when the displayed brief was inherited from a high-confidence sibling topic
   *  (the canonical had no passing brief of its own). */
  briefFromRelated?: boolean;
  tier: "hot" | "warm" | "emerging";
  score: number;
  /** Previously-generated + persisted AI opening (move_drafts), so it survives reload. */
  savedOpening: string | null;
  /** Competitor domains AI cites for this topic — fed to the live-SERP validation
   *  as the "does Google rank the same competitors?" overlap check. */
  competitorDomains: string[];
  /** Precomputed DataForSEO verdict (from "Prepare top N"), so the card arrives
   *  "Google checked" with no operator click. null until prepared. */
  preparedVerdict: PreparedSerpVerdict | null;
  /** Full structured page brief from "Prepare top 10" (create_page_brief) — title,
   *  meta, opening answer, H2 outline, FAQ, schema. Present once the move is prepared,
   *  so the card arrives with the page already written (no operator click). */
  preparedBrief: {
    title: string;
    meta: string;
    opening: string;
    outline: string[];
    faqQuestions: string[];
    schemaTypes: string[];
  } | null;
  /** Deterministic quality verdict for the prepared brief — drives honest readiness
   *  (copy hidden + reason shown for generic/thin/off-topic briefs). null = no brief. */
  briefQuality: DraftQualityResult | null;
  /** Quality verdict for the saved "Draft the opening" answer block (the generic
   *  "A gift is…" failure mode lives here). null when no opening drafted. */
  openingQuality: DraftQualityResult | null;
  /** Profound AEO receipt — present ONLY when the underlying Move already carries
   *  strong cached `aeoEvidence` (confidence ≠ low AND ≥1 cited competitor). Lets
   *  the card say "AI is already asked this and cites competitors", not just "a
   *  keyword idea". Read from the durable cached evidence on the Move — NO live
   *  Profound call, NO fresh matching here. Absent → no badge. */
  aeoReceipt: {
    topPrompt: string;
    fanoutCount: number;
    citedDomains: string[];
    ownAbsent: boolean;
    /** Cached evidence the AEO-brief drafter needs (NO live read at draft time). */
    fanoutQueries: string[];
    competitorPages: string[];
    ownCitedUrls: string[];
  } | null;
};

export type NewPagesData = {
  opportunities: NewPageOpportunity[];
  totalCandidates: number;
  /** The tenant's own domain (so the SERP validator can detect "you already rank"). */
  ownDomain: string;
};

function domainOf(url: string): string | null {
  if (!url) return null;
  // Competitor URLs from the citation graph are often scheme-less
  // ("theknot.com/content/persian-wedding") — new URL() throws on those, which
  // was silently dropping the competitor's name from every New Page card.
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    // Last-ditch: take the host token before the first slash.
    const host = url.replace(/^https?:\/\//i, "").split("/")[0]?.replace(/^www\./, "");
    return host && host.includes(".") ? host : null;
  }
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The tenant's own domain = the most common hostname across its owned pages. */
function deriveOwnDomain(pageNodes: ReadonlyArray<{ url: string }>): string {
  const counts = new Map<string, number>();
  for (const p of pageNodes) {
    const d = domainOf(p.url);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** Fail-fast guard so the heavy demand-graph compute can never hang the cockpit
 *  (the /today statement-timeout class) — on timeout the board self-hides. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Tenant-explicit builder — shared by the request-cached loader AND the nightly
 *  precompute (which has no request context to derive the tenant from). */
export async function buildNewPagesData(tenantId: string): Promise<NewPagesData> {
  let moves;
  let audits: Awaited<ReturnType<typeof getCompetitorAuditsForTenant>> = new Map();
  let savedDrafts = new Map<string, MoveDraftRow>();
  let ownDomain = "";
  let kwDemandRows: KeywordDemand[] = [];
  try {
    const [graphRes, auditRes, draftRes, kwDemand] = await Promise.all([
      withTimeout<Awaited<ReturnType<typeof loadDemandGraphForTenantCached>> | null>(
        loadDemandGraphForTenantCached(tenantId),
        // Was 8s — too tight for a cold graph, which made the whole New Pages board
        // silently vanish on first load. The graph is cached (the cockpit builds it
        // first), so this only guards a genuine stall now. Don't disappear.
        30000,
        null,
      ),
      getCompetitorAuditsForTenant().catch(() => new Map()),
      // Persisted AI openings (degrade-safe: empty map if the table isn't migrated).
      withTimeout(getLatestMoveDrafts(tenantId), 4000, new Map<string, MoveDraftRow>()),
      // Connectedness (2026-06-28) — real DataForSEO search volume from the cached
      // keyword-demand store (the same cache that powers /worklist). Replaces the
      // permanently-null searchVolume left after SEMrush was removed. Degrade-safe.
      withTimeout(readAllCachedKeywordDemand(), 4000, [] as Awaited<ReturnType<typeof readAllCachedKeywordDemand>>),
    ]);
    kwDemandRows = kwDemand;
    if (!graphRes) return { opportunities: [], totalCandidates: 0, ownDomain: "" };
    moves = graphRes.graph.moves;
    ownDomain = deriveOwnDomain(graphRes.graph.pageNodes);
    audits = auditRes;
    savedDrafts = draftRes;
  } catch {
    return { opportunities: [], totalCandidates: 0, ownDomain: "" };
  }

  // Find a teardown audit by URL so a create_page opportunity can show what the
  // cited competitor page actually has (when we've torn it down).
  const canonLower = (u: string) => (canonicalizeCitationUrl(u) ?? u).toLowerCase();
  const findAudit = (url: string) => {
    const target = canonLower(url);
    for (const a of audits.values()) if (canonLower(a.url) === target) return a;
    return undefined;
  };

  const createMoves = moves
    .filter((m) => m.gap === "create_page")
    // New Pages quality gate (2026-06-28): drop scraped news/security fragments,
    // slug garbage, and too-generic one-word topics before they reach the board.
    .filter((m) => !isJunkTopic(m.label));

  // Match each candidate to cached DataForSEO keyword volume (deterministic, $0) +
  // read its SERP verdict, then RANK by demand with a bounded +15% lift when the page
  // is BUILD-validated AND has a strong/exact keyword match (operator: BUILD + strong
  // demand rises; WAIT/SKIP + weak are NOT boosted — mirrors the ±15% learned prior).
  const enriched = createMoves
    .map((m) => {
      const kwMatch = matchKeywordDemand(m.label, m.aeoEvidence?.prompts?.[0] ?? null, kwDemandRows);
      const verdict = parsePreparedVerdict(savedDrafts.get(`${m.demandKey}::serp_verdict`)?.content);
      const strong = kwMatch.confidence === "exact" || kwMatch.confidence === "strong";
      const boost = verdict?.verdict === "build" && strong ? 1.15 : 1;
      return { m, kwMatch, verdict, sortKey: m.components.demand * boost };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

  // Canonicalize (2026-06-29): collapse near-duplicate create-page candidates (the 3
  // nowruz labels, persian/iranian wedding) into ONE card per real opportunity so the
  // board stops splitting demand — and a high-volume canonical inherits a sibling's
  // passing brief. Pure + conservative (same matched keyword OR identical core tokens).
  const briefPasses = (dk: string): boolean => {
    const raw = savedDrafts.get(`${dk}::create_page_brief`)?.content;
    if (!raw) return false;
    try {
      const b = JSON.parse(raw);
      return evaluateCreatePageBriefQuality({
        title: b.proposedTitle, meta: b.metaDescription, opening: b.openingAnswer,
        outline: b.outline, faqQuestions: b.faqQuestions, schemaTypes: b.schemaTypes,
        hasSerpVerdict: !!savedDrafts.get(`${dk}::serp_verdict`),
      }).copyAllowed;
    } catch {
      return false;
    }
  };
  const canonGroups = groupCreatePageCandidates(
    enriched.map(({ m, kwMatch, verdict }) => ({
      demandKey: m.demandKey,
      label: cleanTopicLabel(m.label),
      distinctTokens: topicDistinguishingTokens(m.label),
      // Any matched keyword anchors grouping (the matcher already required a shared
      // distinguishing token); strong/exact gates HIGH-confidence brief inheritance.
      keyword: kwMatch.confidence !== "none" ? kwMatch.keyword : null,
      strongKeyword: kwMatch.confidence === "exact" || kwMatch.confidence === "strong",
      volume: kwMatch.searchVolume ?? 0,
      verdict: verdict?.verdict ?? null,
      hasPassingBrief: briefPasses(m.demandKey),
    })),
  );
  const absorbed = new Set<string>();
  const canonMeta = new Map<string, { alsoCovers: string[]; inheritBriefFrom: string | null }>();
  for (const g of canonGroups) {
    for (const s of g.siblings) absorbed.add(s.demandKey);
    // Only inherit a brief from a HIGH-confidence (same-keyword) sibling group.
    canonMeta.set(g.canonical.demandKey, {
      alsoCovers: g.siblings.map((s) => s.label),
      inheritBriefFrom: g.confidence === "high" ? g.inheritBriefFrom : null,
    });
  }

  // Tier by rank within this tenant's own create-page set (relative, honest —
  // the underlying number is a proxy, so we bucket rather than print it).
  const opportunities: NewPageOpportunity[] = enriched
    .filter(({ m }) => !absorbed.has(m.demandKey))
    .slice(0, 9)
    .map(({ m, kwMatch, verdict }, i) => {
      const meta = canonMeta.get(m.demandKey);
      const briefSourceKey = meta?.inheritBriefFrom ?? m.demandKey;
    const topUrl = m.competitorUrls[0] ?? null;
    const audit = topUrl ? findAudit(topUrl) : undefined;
    const ww = audit && audit.fetchStatus === "ok" && audit.facts ? whatWins(audit.facts) : null;
    // AEO receipt: read the Move's ALREADY-ATTACHED cached evidence (no live call,
    // no fresh matching). Eligible only when confident AND a competitor is cited.
    const e = m.aeoEvidence;
    const aeoReceipt =
      e && e.confidence !== "low" && e.topCitedDomains.length > 0 && (e.prompts[0] ?? "").length > 0
        ? {
            topPrompt: e.prompts[0]!,
            fanoutCount: e.fanoutQueries.length,
            citedDomains: e.topCitedDomains.slice(0, 3).map((d) => d.hostname),
            ownAbsent: e.ownCitationCount === 0,
            fanoutQueries: e.fanoutQueries.slice(0, 12),
            competitorPages: e.topCitedPages.filter((p) => !p.isOwned).map((p) => p.url).slice(0, 10),
            ownCitedUrls: e.topCitedPages.filter((p) => p.isOwned).map((p) => p.url).slice(0, 10),
          }
        : null;
    // Full structured page brief from "Prepare" (create_page_brief), if prepared.
    // Primary: the standalone brief the New Pages prepare persists; fallback: the
    // worklist prepare's prepared_pack (if a create_page move ever ranks top-N there).
    // Read the brief from the canonical's OWN key, or — when it has none — inherit a
    // high-confidence sibling's passing brief (briefSourceKey).
    let briefVal: CreatePageBrief | undefined;
    const briefRaw = savedDrafts.get(`${briefSourceKey}::create_page_brief`)?.content;
    if (briefRaw) {
      try {
        briefVal = JSON.parse(briefRaw) as CreatePageBrief;
      } catch {
        /* ignore malformed */
      }
    }
    if (!briefVal) {
      const sd = parsePreparedPack(savedDrafts.get(`${briefSourceKey}::prepared_pack`)?.content)?.structuredDraft;
      if (sd && sd.kind === "create_page_brief") briefVal = sd.value as CreatePageBrief | undefined;
    }
    const briefFromRelated = briefSourceKey !== m.demandKey && !!briefVal;
    const preparedBrief =
      briefVal && briefVal.proposedTitle
        ? {
            title: briefVal.proposedTitle,
            meta: briefVal.metaDescription,
            opening: briefVal.openingAnswer,
            outline: Array.isArray(briefVal.outline) ? briefVal.outline.slice(0, 16) : [],
            faqQuestions: Array.isArray(briefVal.faqQuestions) ? briefVal.faqQuestions.slice(0, 8) : [],
            schemaTypes: Array.isArray(briefVal.schemaTypes) ? briefVal.schemaTypes.slice(0, 8) : [],
          }
        : null;
    // Deterministic quality verdict (only when a brief exists). hasSerpVerdict is true
    // when DataForSEO has been run for this topic (verdict persisted alongside).
    const briefQuality = briefVal
      ? evaluateCreatePageBriefQuality({
          title: briefVal.proposedTitle,
          meta: briefVal.metaDescription,
          opening: briefVal.openingAnswer,
          outline: briefVal.outline,
          faqQuestions: briefVal.faqQuestions,
          schemaTypes: briefVal.schemaTypes,
          hasSerpVerdict: !!savedDrafts.get(`${briefSourceKey}::serp_verdict`),
        })
      : null;
    // Quality of the saved "Draft the opening" answer block (raw text or {answer}).
    const savedOpening = savedDrafts.get(`${m.demandKey}::answer_block`)?.content ?? null;
    let openingQuality: DraftQualityResult | null = null;
    if (savedOpening) {
      let answerText = savedOpening;
      try {
        const p = JSON.parse(savedOpening) as { answer?: unknown };
        if (p && typeof p.answer === "string") answerText = p.answer;
      } catch {
        /* raw text — use as-is */
      }
      openingQuality = evaluateDraftQuality({ answer: answerText, evidenceRefs: 0 });
    }
    return {
      id: m.demandKey,
      topic: cleanTopicLabel(m.label),
      competitorCount: m.competitorUrls.length,
      topCompetitor: topUrl ? domainOf(topUrl) : null,
      whatWins: ww && ww !== "—" ? ww : null,
      // Real DataForSEO volume via the deterministic matcher (null when no match — honest).
      searchVolume: kwMatch.confidence === "none" ? null : kwMatch.searchVolume,
      keywordMatch:
        kwMatch.confidence === "none" || !kwMatch.keyword
          ? null
          : { keyword: kwMatch.keyword, volume: kwMatch.searchVolume, confidence: kwMatch.confidence },
      tier: i < 3 ? "hot" : i < 6 ? "warm" : "emerging",
      score: Math.round(m.score),
      savedOpening,
      competitorDomains: [...new Set(m.competitorUrls.map((u) => domainOf(u)).filter((d): d is string => !!d))].slice(0, 6),
      preparedVerdict: verdict,
      preparedBrief,
      briefQuality,
      openingQuality,
      aeoReceipt,
      alsoCovers: meta?.alsoCovers ?? [],
      briefFromRelated,
    };
  });

  return { opportunities, totalCandidates: createMoves.length, ownDomain };
}

export const loadNewPagesData = cache(
  async (): Promise<NewPagesData> => buildNewPagesData(await currentTenantId()),
);
