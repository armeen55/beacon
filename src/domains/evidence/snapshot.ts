/**
 * EvidenceSnapshot kernel (2026-07-22) — the ONE normalized evidence contract
 * every Decision (recommendations / rec-intel / drafts) and every surface
 * (Today / Changes / Results) consumes. It collapses the six mandatory sources
 * into a single per-tenant/site object so downstream code never again reaches
 * into demand-graph, serp, pages, ai-visibility, research, scanning, provenance,
 * profound-coverage, or prompt-answer-observations directly.
 *
 * The six mandatory sources normalize in here:
 *   GSC        → owned-page search metrics (clicks/impressions/ctr/position) + query demand
 *   GA4        → owned-page engagement + real revenue $
 *   Wix/crawl  → owned-page CONTENT (title/h1/outline/schema/faq/word count/internal links)
 *   Clarity    → owned-page friction (rage/dead/quickback/script errors)
 *   DataForSEO → keyword/volume demand
 *   native AI  → AI-answer questions + citations (owned + competitor)  [may be dormant]
 *
 * This module is PURE and deterministic (no I/O, no LLM, no Date.now beyond the
 * caller-supplied `builtAt`). The I/O edge that reuses the existing cached
 * connector readers lives in `snapshot-loader.ts`. Every source is represented
 * in `sources[]` with an HONEST freshness/failure state so a dormant native-AI
 * adapter or a failed GA4 read is visible, never silently zeroed.
 *
 * Build-pass note: this is ADDITIVE. The old per-move EvidencePacket /
 * ResearchDossier engines still exist; the destructive cutover that rewires
 * consumers onto this contract and deletes those engines is a later sequenced
 * pass. See snapshot.test.ts for the pinned outcomes.
 */

import { createHash } from "node:crypto";

import { domainOf, internalLinkRelevance, scoreTopicMatch, topicTokens } from "./relevance-gate";
import type { FunnelResearchEvidence } from "./funnel/research-evidence";

// ── source identity + freshness ──────────────────────────────────────────────

/** The six mandatory sources. `native_ai` may fail soft / stay dormant when
 *  creds/config are absent, but its slot is ALWAYS present so its absence is
 *  honest and visible rather than a silent gap. */
export type EvidenceSourceKind = "gsc" | "ga4" | "wix" | "clarity" | "dataforseo" | "native_ai";

export const MANDATORY_SOURCES: readonly EvidenceSourceKind[] = [
  "gsc",
  "ga4",
  "wix",
  "clarity",
  "dataforseo",
  "native_ai",
] as const;

/**
 * fresh   — data present and within its freshness window.
 * stale   — data present but older than its window (usable, flagged).
 * empty   — reader ran clean but returned nothing (no rows yet).
 * failed  — reader threw / errored (a real failure, NOT the same as empty).
 * dormant — source intentionally not configured (native AI with no creds).
 */
export type SourceStatus = "fresh" | "stale" | "empty" | "failed" | "dormant";

export type SourceFreshness = {
  source: EvidenceSourceKind;
  status: SourceStatus;
  /** ISO of the newest row this source contributed, or null. */
  lastSyncedAt: string | null;
  /** How many rows this source contributed (coverage/honesty line). */
  rowsSeen: number;
  /** One plain sentence for a customer-facing "why is this blank" line. */
  note: string;
};

// ── per-owned-page evidence (GSC + GA4 + Wix + Clarity + AI joined by URL) ────

export type OwnedQuerySignal = {
  query: string;
  impressions: number;
  clicks: number;
  position: number | null;
};

export type OwnedPageContent = {
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  h2: string[];
  /** h2 + h3 in document order — the comparable outline. */
  outline: string[];
  schemaTypes: string[];
  hasFaq: boolean;
  faqCount: number;
  wordCount: number;
  internalLinks: { href: string; anchorText: string }[];
  fetchedAt: string | null;
};

export type OwnedPageSearch = {
  clicks90d: number;
  impressions90d: number;
  ctr90d: number;
  position90d: number;
  topQueries: OwnedQuerySignal[];
};

export type OwnedPageEngagement = {
  sessions28d: number;
  engaged28d: number;
  conversions28d: number;
  /** Real GA4 revenue $, or null when unknown (never 0-for-unknown). */
  revenueUsd: number | null;
};

export type OwnedPageFriction = {
  sessions: number;
  rageClicks: number;
  deadClicks: number;
  quickbacks: number;
  scriptErrors: number;
  /** Composite friction score (rage + dead + 2×scriptErrors), for ranking. */
  frictionScore: number;
};

export type OwnedPageEvidence = {
  /** Canonicalized owned page URL (the join key). */
  url: string;
  content: OwnedPageContent | null;
  search: OwnedPageSearch | null;
  engagement: OwnedPageEngagement | null;
  friction: OwnedPageFriction | null;
  /** AI citations of THIS owned page (native-AI presence). */
  aiCitations: { count: number; distinctPrompts: number; engines: string[] };
};

// ── competitor evidence (native AI + SERP citations) ─────────────────────────

export type CompetitorEvidence = {
  url: string;
  domain: string;
  citationCount: number;
  distinctPrompts: number;
  engines: string[];
  examplePrompts: string[];
};

// ── demand: keyword volume + AI-answer questions ─────────────────────────────

export type KeywordDemandSignal = {
  query: string;
  /** Monthly search volume, or null when unknown (never guessed). */
  searchVolume: number | null;
  /** Where the demand number came from. */
  source: "gsc" | "dataforseo" | "ai_ask" | "mixed";
  /** 0..1 paid competition, or null. */
  competition: number | null;
  competitionLevel: "low" | "medium" | "high" | null;
  /** GSC impressions when this query is a real owned/served term, else null. */
  gscImpressions: number | null;
};

export type QuestionDemandSignal = {
  question: string;
  /** Distinct (prompt, engine) pairs that produced this question — the weight. */
  weight: number;
  sourcePrompts: string[];
  source: "native_ai";
  /** Whether an owned page already answers it (best-effort topic match). */
  coverageStatus: "answered" | "unanswered" | "unknown";
};

// ── derived intelligence (normalized ONCE, not per source) ───────────────────

export type IntentCluster = {
  key: string;
  label: string;
  /** Coarse intent bucket derived deterministically from the label tokens. */
  intent: "informational" | "commercial" | "navigational" | "transactional";
  queries: string[];
};

export type CannibalizationGroup = {
  query: string;
  /** Two+ owned URLs Google serves for the same query — self-competition. */
  competingUrls: string[];
  note: string;
};

export type ContentGapKind =
  | "missing_page"
  | "unanswered_question"
  | "missing_schema"
  | "missing_faq"
  | "thin_vs_competitor";

export type ContentGap = {
  kind: ContentGapKind;
  topic: string;
  detail: string;
  ownedUrl: string | null;
  competitorUrl: string | null;
};

export type InternalLinkOpportunity = {
  fromUrl: string;
  toUrl: string;
  /** Suggested anchor (the target's topic label). */
  anchor: string;
  reason: string;
};

export type NewPageOpportunity = {
  topic: string;
  /** Fused demand weight (volume + AI-ask breadth). */
  demandWeight: number;
  basis: "search_volume" | "ai_attention" | "mixed";
  competitorUrls: string[];
  fanoutSeeds: string[];
  confidence: "high" | "medium" | "low";
};

// ── the snapshot ─────────────────────────────────────────────────────────────

export type EvidenceSnapshotScope = {
  tenantId: string;
  /** Site host (e.g. "iranopedia.com"), or null for a tenant-wide snapshot. */
  site: string | null;
  builtAt: string;
};

export type EvidenceSnapshot = {
  scope: EvidenceSnapshotScope;
  /** ALL six sources, always present, with honest freshness/failure state. */
  sources: SourceFreshness[];
  ownedPages: OwnedPageEvidence[];
  competitors: CompetitorEvidence[];
  keywordDemand: KeywordDemandSignal[];
  questionDemand: QuestionDemandSignal[];
  intentClusters: IntentCluster[];
  cannibalization: CannibalizationGroup[];
  contentGaps: ContentGap[];
  internalLinkOpportunities: InternalLinkOpportunity[];
  newPageOpportunities: NewPageOpportunity[];
  aiCitations: {
    ownedCited: number;
    competitorCited: number;
    engines: string[];
    rowsScanned: number;
  };
  /** The research funnel's basis-scoped evidence, carried verbatim: retained
   *  keyword metrics with intent, exact AI prompt/engine observations, per-query
   *  SERP evidence, winning pages with true provenance, and the funnel receipt. */
  research: FunnelResearchEvidence;
  /** Stable over timestamps; changes only when material evidence changes. */
  evidenceHash: string;
};

// ── pure assembler input (already-loaded, fail-soft per source) ──────────────

/** One loaded source payload wrapped with its honest status. `payload` is the
 *  source's already-normalized rows; a failed/dormant/empty source carries an
 *  empty payload but STILL occupies its slot in the snapshot. */
export type LoadedSource<T> = {
  status: SourceStatus;
  lastSyncedAt: string | null;
  note?: string;
  payload: T;
};

export type EvidenceSnapshotInput = {
  scope: EvidenceSnapshotScope;
  /** GSC: per-owned-page search metrics keyed by canonical URL. */
  gsc: LoadedSource<{ url: string; clicks90d: number; impressions90d: number; ctr90d: number; position90d: number; topQueries: OwnedQuerySignal[] }[]>;
  /** GA4: per-owned-page engagement + revenue keyed by canonical URL. */
  ga4: LoadedSource<{ url: string; sessions28d: number; engaged28d: number; conversions28d: number; revenueUsd: number | null }[]>;
  /** Wix/crawl: per-owned-page CONTENT keyed by canonical URL. */
  wix: LoadedSource<({ url: string } & OwnedPageContent)[]>;
  /** Clarity: per-owned-page friction keyed by canonical URL. */
  clarity: LoadedSource<({ url: string } & OwnedPageFriction)[]>;
  /** DataForSEO: keyword volume rows. */
  dataforseo: LoadedSource<{ query: string; searchVolume: number | null; competition: number | null; competitionLevel: "low" | "medium" | "high" | null }[]>;
  /** Research funnel: retained keywords WITH intent, exact AI observations,
   *  per-query SERP evidence, winning pages with true provenance, + the receipt. */
  research: LoadedSource<FunnelResearchEvidence>;
  /** native AI: cited pages (owned + competitor) + surfaced questions. */
  nativeAi: LoadedSource<{
    citedPages: {
      url: string;
      isOwned: boolean;
      citationCount: number;
      distinctPrompts: number;
      engines: string[];
      examplePrompts: string[];
    }[];
    questions: { text: string; weight: number; sourcePrompts: string[] }[];
    rowsScanned: number;
    enginesSeen: string[];
  }>;
};

// ── pure helpers ─────────────────────────────────────────────────────────────

export function canonicalUrlKey(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
    return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${
      parsed.pathname.replace(/\/+$/, "") || "/"
    }`;
  } catch {
    return value
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

const norm = (s: string): string => s.trim().toLocaleLowerCase("en-US");

const COMMERCIAL = /\b(buy|price|cost|cheap|deal|discount|hire|near me|for sale|book|order|shop)\b/i;
const TRANSACTIONAL = /\b(download|sign ?up|subscribe|checkout|apply|register|quote)\b/i;
const NAVIGATIONAL = /\b(login|log in|contact|about|homepage|official site|dashboard)\b/i;

function classifyIntent(label: string): IntentCluster["intent"] {
  if (TRANSACTIONAL.test(label)) return "transactional";
  if (NAVIGATIONAL.test(label)) return "navigational";
  if (COMMERCIAL.test(label)) return "commercial";
  return "informational";
}

/** Deterministic freshness row for a source, derived from its LoadedSource. */
function freshnessOf(source: EvidenceSourceKind, loaded: LoadedSource<unknown>, rowsSeen: number): SourceFreshness {
  const defaultNote: Record<SourceStatus, string> = {
    fresh: `I have current ${source.toUpperCase()} data (${rowsSeen} rows).`,
    stale: `My ${source.toUpperCase()} data is older than its window; still using it, flagged.`,
    empty: `I connected to ${source.toUpperCase()} but there is nothing recorded yet.`,
    failed: `I could not read ${source.toUpperCase()} this run.`,
    dormant: `${source.toUpperCase()} is not connected, so I am running without it for now.`,
  };
  return {
    source,
    status: loaded.status,
    lastSyncedAt: loaded.lastSyncedAt,
    rowsSeen,
    note: loaded.note ?? defaultNote[loaded.status],
  };
}

// ── the pure assembler ───────────────────────────────────────────────────────

/**
 * Normalize the six loaded sources into ONE EvidenceSnapshot. PURE: same input
 * → same output (the only clock is scope.builtAt, supplied by the caller). Joins
 * owned pages by canonical URL, derives intent/clustering, cannibalization,
 * content gaps, internal-link + new-page opportunities, and a stable
 * evidenceHash. Every source occupies a freshness slot even when empty/failed/
 * dormant, so the snapshot never hides a missing source.
 */
export function buildEvidenceSnapshot(input: EvidenceSnapshotInput): EvidenceSnapshot {
  const { scope } = input;

  // ── join owned pages by canonical URL ──
  const ownedByUrl = new Map<string, OwnedPageEvidence>();
  const ensure = (rawUrl: string): OwnedPageEvidence | null => {
    const url = canonicalUrlKey(rawUrl);
    if (!url) return null;
    let row = ownedByUrl.get(url);
    if (!row) {
      row = {
        url,
        content: null,
        search: null,
        engagement: null,
        friction: null,
        aiCitations: { count: 0, distinctPrompts: 0, engines: [] },
      };
      ownedByUrl.set(url, row);
    }
    return row;
  };

  for (const r of input.gsc.payload) {
    const row = ensure(r.url);
    if (row)
      row.search = {
        clicks90d: r.clicks90d,
        impressions90d: r.impressions90d,
        ctr90d: r.ctr90d,
        position90d: r.position90d,
        topQueries: [...r.topQueries].sort((a, b) => b.impressions - a.impressions).slice(0, 12),
      };
  }
  for (const r of input.ga4.payload) {
    const row = ensure(r.url);
    if (row)
      row.engagement = {
        sessions28d: r.sessions28d,
        engaged28d: r.engaged28d,
        conversions28d: r.conversions28d,
        revenueUsd: r.revenueUsd,
      };
  }
  for (const r of input.wix.payload) {
    const row = ensure(r.url);
    if (row) {
      const { url: _url, ...content } = r;
      void _url;
      row.content = content;
    }
  }
  for (const r of input.clarity.payload) {
    const row = ensure(r.url);
    if (row) {
      const { url: _url, ...friction } = r;
      void _url;
      row.friction = friction;
    }
  }

  // ── native AI: split cited pages into owned (attach) vs competitor ──
  const competitorByUrl = new Map<string, CompetitorEvidence>();
  for (const cited of input.nativeAi.payload.citedPages) {
    if (cited.isOwned) {
      const row = ensure(cited.url);
      if (row)
        row.aiCitations = {
          count: cited.citationCount,
          distinctPrompts: cited.distinctPrompts,
          engines: [...new Set(cited.engines)].sort(),
        };
    } else {
      const url = canonicalUrlKey(cited.url);
      if (!url) continue;
      competitorByUrl.set(url, {
        url,
        domain: domainOf(cited.url),
        citationCount: cited.citationCount,
        distinctPrompts: cited.distinctPrompts,
        engines: [...new Set(cited.engines)].sort(),
        examplePrompts: cited.examplePrompts.slice(0, 5),
      });
    }
  }

  const ownedPages = [...ownedByUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
  const competitors = [...competitorByUrl.values()].sort(
    (a, b) => b.citationCount - a.citationCount || a.url.localeCompare(b.url),
  );

  // ── keyword demand: GSC served queries ∪ DataForSEO volume ──
  const kwByQuery = new Map<string, KeywordDemandSignal>();
  // GSC-served queries first (real, owned demand).
  const gscImpressionsByQuery = new Map<string, number>();
  for (const p of ownedPages) {
    for (const q of p.search?.topQueries ?? []) {
      const key = norm(q.query);
      if (!key) continue;
      gscImpressionsByQuery.set(key, (gscImpressionsByQuery.get(key) ?? 0) + q.impressions);
    }
  }
  for (const [key, impressions] of gscImpressionsByQuery) {
    kwByQuery.set(key, {
      query: key,
      searchVolume: null,
      source: "gsc",
      competition: null,
      competitionLevel: null,
      gscImpressions: impressions,
    });
  }
  for (const kw of input.dataforseo.payload) {
    const key = norm(kw.query);
    if (!key) continue;
    const existing = kwByQuery.get(key);
    if (existing) {
      existing.searchVolume = kw.searchVolume;
      existing.competition = kw.competition;
      existing.competitionLevel = kw.competitionLevel;
      existing.source = existing.gscImpressions != null ? "mixed" : "dataforseo";
    } else {
      kwByQuery.set(key, {
        query: key,
        searchVolume: kw.searchVolume,
        source: "dataforseo",
        competition: kw.competition,
        competitionLevel: kw.competitionLevel,
        gscImpressions: null,
      });
    }
  }
  const keywordDemand = [...kwByQuery.values()].sort(
    (a, b) =>
      (b.searchVolume ?? 0) - (a.searchVolume ?? 0) ||
      (b.gscImpressions ?? 0) - (a.gscImpressions ?? 0) ||
      a.query.localeCompare(b.query),
  );

  // ── AI-answer questions + owned coverage best-effort ──
  const ownedContentText = ownedPages.map((p) =>
    [p.content?.title, p.content?.h1, ...(p.content?.outline ?? [])].filter(Boolean).join(" "),
  );
  const questionDemand: QuestionDemandSignal[] = input.nativeAi.payload.questions
    .map((q) => {
      const covered = ownedContentText.some((text) => scoreTopicMatch(q.text, text).relevant);
      const coverageStatus: QuestionDemandSignal["coverageStatus"] =
        ownedContentText.length === 0 ? "unknown" : covered ? "answered" : "unanswered";
      return {
        question: q.text,
        weight: q.weight,
        sourcePrompts: q.sourcePrompts.slice(0, 8),
        source: "native_ai" as const,
        coverageStatus,
      };
    })
    .sort((a, b) => b.weight - a.weight || a.question.localeCompare(b.question));

  // ── intent clusters from owned served queries + AI questions ──
  const clusterByTopic = new Map<string, IntentCluster>();
  const clusterKey = (label: string): string => {
    const tokens = topicTokens(label);
    return tokens.slice(0, 3).sort().join("-") || norm(label);
  };
  const addToCluster = (label: string) => {
    const key = clusterKey(label);
    if (!key) return;
    let c = clusterByTopic.get(key);
    if (!c) {
      c = { key, label, intent: classifyIntent(label), queries: [] };
      clusterByTopic.set(key, c);
    }
    if (!c.queries.some((q) => norm(q) === norm(label))) c.queries.push(label);
  };
  for (const kw of keywordDemand) addToCluster(kw.query);
  for (const q of questionDemand) addToCluster(q.question);
  const intentClusters = [...clusterByTopic.values()]
    .map((c) => ({ ...c, queries: c.queries.slice(0, 12) }))
    .sort((a, b) => b.queries.length - a.queries.length || a.key.localeCompare(b.key));

  // ── cannibalization: 2+ owned URLs serving the same query ──
  const urlsByQuery = new Map<string, Set<string>>();
  for (const p of ownedPages) {
    for (const q of p.search?.topQueries ?? []) {
      const key = norm(q.query);
      if (!key) continue;
      if (!urlsByQuery.has(key)) urlsByQuery.set(key, new Set());
      urlsByQuery.get(key)!.add(p.url);
    }
  }
  const cannibalization: CannibalizationGroup[] = [...urlsByQuery.entries()]
    .filter(([, urls]) => urls.size >= 2)
    .map(([query, urls]) => ({
      query,
      competingUrls: [...urls].sort(),
      note: `${urls.size} of your pages compete for "${query}" — pick one owner and point the rest at it.`,
    }))
    .sort((a, b) => b.competingUrls.length - a.competingUrls.length || a.query.localeCompare(b.query));

  // ── content gaps: unanswered AI questions + owned-vs-competitor structure ──
  const contentGaps: ContentGap[] = [];
  for (const q of questionDemand) {
    if (q.coverageStatus === "unanswered") {
      contentGaps.push({
        kind: "unanswered_question",
        topic: q.question,
        detail: `AI keeps getting asked "${q.question}" (${q.weight} prompts) and none of your pages answer it.`,
        ownedUrl: null,
        competitorUrl: null,
      });
    }
  }
  // new-page gap: a competitor is cited for a topic no owned page covers.
  for (const comp of competitors) {
    const topic = comp.examplePrompts[0] ?? comp.domain;
    const covered = ownedContentText.some((text) => scoreTopicMatch(topic, text).relevant);
    if (!covered && comp.examplePrompts.length > 0) {
      contentGaps.push({
        kind: "missing_page",
        topic,
        detail: `AI cites ${comp.domain} for "${topic}" (${comp.citationCount}×) and you have no page on it.`,
        ownedUrl: null,
        competitorUrl: comp.url,
      });
    }
  }

  // ── internal-link opportunities: owned page A on-topic for owned page B ──
  const internalLinkOpportunities: InternalLinkOpportunity[] = [];
  for (const from of ownedPages) {
    const fromLinks = new Set((from.content?.internalLinks ?? []).map((l) => canonicalUrlKey(l.href)));
    for (const to of ownedPages) {
      if (from.url === to.url) continue;
      if (fromLinks.has(to.url)) continue;
      const toLabel = to.content?.h1 ?? to.content?.title;
      const fromText = [from.content?.title, from.content?.h1, ...(from.content?.outline ?? [])]
        .filter(Boolean)
        .join(" ");
      if (!toLabel || !fromText) continue;
      const verdict = internalLinkRelevance(fromText, toLabel);
      if (verdict.relevant) {
        internalLinkOpportunities.push({
          fromUrl: from.url,
          toUrl: to.url,
          anchor: toLabel,
          reason: `"${from.url}" is on-topic for "${toLabel}" but does not link to it yet.`,
        });
      }
    }
  }
  internalLinkOpportunities.sort(
    (a, b) => a.fromUrl.localeCompare(b.fromUrl) || a.toUrl.localeCompare(b.toUrl),
  );

  // ── new-page opportunities: competitor-cited or high-demand topics with no owned page ──
  const newPageOpportunities: NewPageOpportunity[] = [];
  for (const comp of competitors) {
    const topic = comp.examplePrompts[0] ?? comp.domain;
    const covered = ownedContentText.some((text) => scoreTopicMatch(topic, text).relevant);
    if (covered || comp.examplePrompts.length === 0) continue;
    const kw = keywordDemand.find((k) => norm(k.query) === norm(topic));
    const volume = kw?.searchVolume ?? null;
    newPageOpportunities.push({
      topic,
      demandWeight: (volume ?? 0) + comp.citationCount * comp.distinctPrompts,
      basis: volume != null ? "mixed" : "ai_attention",
      competitorUrls: [comp.url],
      fanoutSeeds: comp.examplePrompts.slice(0, 6),
      confidence: comp.distinctPrompts >= 3 ? "medium" : "low",
    });
  }
  newPageOpportunities.sort(
    (a, b) => b.demandWeight - a.demandWeight || a.topic.localeCompare(b.topic),
  );

  // ── AI citation rollup ──
  const ownedCited = ownedPages.filter((p) => p.aiCitations.count > 0).length;
  const aiEngines = [
    ...new Set([
      ...input.nativeAi.payload.enginesSeen,
      ...competitors.flatMap((c) => c.engines),
    ]),
  ].sort();

  // ── freshness for all six sources ──
  const sources: SourceFreshness[] = [
    freshnessOf("gsc", input.gsc, input.gsc.payload.length),
    freshnessOf("ga4", input.ga4, input.ga4.payload.length),
    freshnessOf("wix", input.wix, input.wix.payload.length),
    freshnessOf("clarity", input.clarity, input.clarity.payload.length),
    freshnessOf("dataforseo", input.dataforseo, input.dataforseo.payload.length),
    freshnessOf("native_ai", input.nativeAi, input.nativeAi.payload.citedPages.length),
  ];

  const snapshot: Omit<EvidenceSnapshot, "evidenceHash"> = {
    scope,
    sources,
    ownedPages,
    competitors,
    keywordDemand,
    questionDemand,
    intentClusters,
    cannibalization,
    contentGaps,
    internalLinkOpportunities,
    newPageOpportunities,
    aiCitations: {
      ownedCited,
      competitorCited: competitors.length,
      engines: aiEngines,
      rowsScanned: input.nativeAi.payload.rowsScanned,
    },
    research: input.research.payload,
  };

  return { ...snapshot, evidenceHash: hashSnapshot(snapshot) };
}

/**
 * Stable evidence hash over the MATERIAL evidence (not timestamps or the
 * per-source freshness/lastSyncedAt clock). Two runs with the same underlying
 * evidence produce the same hash even if built at different times.
 */
export function hashSnapshot(snapshot: Omit<EvidenceSnapshot, "evidenceHash">): string {
  const stable = {
    t: snapshot.scope.tenantId,
    site: snapshot.scope.site,
    src: snapshot.sources.map((s) => [s.source, s.status, s.rowsSeen]),
    op: snapshot.ownedPages.map((p) => [
      p.url,
      p.content ? [p.content.title, p.content.wordCount, p.content.schemaTypes] : null,
      p.search ? [p.search.clicks90d, p.search.impressions90d, p.search.position90d] : null,
      p.engagement ? [p.engagement.conversions28d, p.engagement.revenueUsd] : null,
      p.friction ? [p.friction.frictionScore] : null,
      p.aiCitations.count,
    ]),
    comp: snapshot.competitors.map((c) => [c.url, c.citationCount, c.distinctPrompts]),
    kw: snapshot.keywordDemand.map((k) => [k.query, k.searchVolume, k.source, k.gscImpressions]),
    q: snapshot.questionDemand.map((q) => [q.question, q.weight, q.coverageStatus]),
    gap: snapshot.contentGaps.map((g) => [g.kind, g.topic]),
    npo: snapshot.newPageOpportunities.map((n) => [n.topic, n.demandWeight, n.basis]),
    ilo: snapshot.internalLinkOpportunities.map((l) => [l.fromUrl, l.toUrl]),
    can: snapshot.cannibalization.map((c) => [c.query, c.competingUrls]),
    res: [snapshot.research.receipt.researched, snapshot.research.receipt.retained, snapshot.research.aiObservations.length, snapshot.research.serpEvidence.length, snapshot.research.winningPages.map((w) => [w.url, w.appearances.length])],
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}
