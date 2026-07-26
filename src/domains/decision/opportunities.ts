/**
 * decision/opportunities (CORE 100K cutover, 2026-07-22) — the ONE adapter that
 * maps an `EvidenceSnapshot` (the six normalized sources) onto the Decision
 * kernel's `EvidenceInput[]`. This is the seam that replaced the old demand-graph
 * EvidencePacket / gap-compiler / move-router / allocator hierarchy: instead of
 * a dozen engines each re-reading connectors and shaping their own opportunity
 * rows, the snapshot is assembled once and this pure function turns it into the
 * exact list of opportunities the kernel drafts and ranks.
 *
 * Two opportunity families come out, matching the kernel's two proposal paths:
 *   - existing_edit : an owned page with real demand + a current title/meta to
 *     sharpen (one input per field worth improving).
 *   - new_page      : a topic AI/Google is asked about that no owned page covers
 *     (from newPageOpportunities + unanswered-question content gaps).
 *
 * PURE + deterministic. No I/O, no LLM. Bounded so a huge snapshot can never
 * queue an unbounded number of drafts.
 */

import type {
  EvidenceSnapshot,
  OwnedPageEvidence,
  NewPageOpportunity,
} from "@/domains/evidence/snapshot";
import { scoreTopicMatch } from "@/domains/evidence/relevance-gate";
import type { EvidenceInput, ProposalKind } from "./contracts";

/** Caps so a large tenant never queues an unbounded number of cold drafts. */
export const MAX_EXISTING_EDIT_OPPORTUNITIES = 40;
export const MAX_NEW_PAGE_OPPORTUNITIES = 15;

/** A page needs at least this many 90d impressions for its query to be a real
 *  demand signal worth an edit (below this it is noise, not an opportunity). */
const MIN_PAGE_IMPRESSIONS = 20;

/** Coarse searcher-intent bucket from the query tokens (feeds the drafter's
 *  intent directive). Deterministic; never fabricates. */
function intentOf(query: string): string | undefined {
  const q = query.toLowerCase();
  if (/\b(when|hours?|open|today|time)\b/.test(q)) return "when";
  if (/\b(cost|price|how much|cheap|fee)\b/.test(q)) return "cost";
  if (/\b(how|guide|tutorial|steps?)\b/.test(q)) return "how";
  if (/\b(where|near me|location|address|directions?)\b/.test(q)) return "where";
  if (/\b(who|best|top|review)\b/.test(q)) return "who";
  if (/\b(list|examples?|ideas?)\b/.test(q)) return "list";
  if (/\b(vs|versus|compare|difference)\b/.test(q)) return "compare";
  return undefined;
}

/** One honest plain-English demand fact for a page's top query. Never a raw
 *  slug or a fabricated figure. */
function pageDemandHints(page: OwnedPageEvidence, query: string): string[] {
  const hints: string[] = [];
  const s = page.search;
  if (s) {
    const pos = s.position90d > 0 ? ` at about position ${Math.round(s.position90d)}` : "";
    hints.push(
      `Over the last 90 days this page had ${s.impressions90d.toLocaleString()} impressions and ${s.clicks90d.toLocaleString()} clicks for "${query}"${pos} on Google.`,
    );
  }
  if (page.aiCitations.count > 0) {
    hints.push(`AI answers cite this page ${page.aiCitations.count} times across ${page.aiCitations.engines.join(", ") || "AI engines"}.`);
  }
  return hints;
}

/** The most valuable served query for a page (highest impressions). */
function topQueryFor(page: OwnedPageEvidence): { query: string; impressions: number; position: number | null } | null {
  const q = (page.search?.topQueries ?? [])[0];
  if (!q) return null;
  return { query: q.query, impressions: q.impressions, position: q.position };
}

/** Build one existing-page edit input for a given field, or null when there is
 *  no current value to improve. */
function existingEditInput(
  snapshot: EvidenceSnapshot,
  page: OwnedPageEvidence,
  field: "title" | "meta",
  query: string,
): EvidenceInput | null {
  const content = page.content;
  const currentValue = field === "title" ? content?.title ?? null : content?.metaDescription ?? null;
  // Nothing to rewrite if there is no current value AND no body context to ground a fresh one.
  if (!currentValue && !content) return null;

  const s = page.search;
  const impactScore = s ? s.impressions90d + (s.position90d > 0 ? Math.max(0, 100 - s.position90d) * 10 : 0) : null;

  return {
    tenantId: snapshot.scope.tenantId,
    page: {
      path: pathOf(page.url),
      url: absoluteUrl(page.url),
      label: content?.h1 ?? content?.title ?? page.url,
    },
    opportunity: {
      query,
      kind: "existing_edit",
      opportunityType: field === "title" ? "Sharpen the title for search + AI" : "Sharpen the description for search + AI",
      field,
      currentValue,
      intent: intentOf(query),
    },
    evidence: {
      hints: pageDemandHints(page, query),
      pageBodyText: null,
      outline: content?.outline ?? [],
    },
    sizing: {
      impactScore,
      upsidePerMonth: null,
      hasSerpVerdict: false,
    },
  };
}

/** The headline claim for a new page, matched to the receipts behind it. Never
 *  says both sources when only one produced evidence: an AI-attention topic has
 *  no measured search volume, and a volume-only topic has no AI question. */
function newPageLabel(basis: NewPageOpportunity["basis"]): string {
  if (basis === "ai_attention") return "Build a page AI keeps asking about";
  if (basis === "search_volume") return "Build a page people search for";
  return "Build a page people search for and AI asks about";
}

/** The one demand fact behind a new page, from the same basis as its label. */
function newPageHint(opp: NewPageOpportunity): string {
  if (opp.basis === "ai_attention") {
    return `AI answers keep surfacing "${opp.topic}" and competitors get cited for it while you have no page on it.`;
  }
  if (opp.basis === "search_volume") {
    return `There is real search demand for "${opp.topic}" and you have no page that answers it directly.`;
  }
  return `People search for "${opp.topic}" and AI gets asked about it too, and you have no page that answers it.`;
}

/** Build one new-page input from a NewPageOpportunity. */
function newPageInput(snapshot: EvidenceSnapshot, opp: NewPageOpportunity): EvidenceInput {
  return {
    tenantId: snapshot.scope.tenantId,
    page: { path: null, url: null, label: opp.topic },
    opportunity: {
      query: opp.topic,
      kind: "new_page",
      opportunityType: newPageLabel(opp.basis),
      intent: intentOf(opp.topic),
    },
    evidence: {
      hints: [newPageHint(opp)],
      competitorPages: opp.competitorUrls,
      fanoutQueries: opp.fanoutSeeds,
    },
    sizing: {
      impactScore: opp.demandWeight,
      upsidePerMonth: null,
      hasSerpVerdict: opp.basis === "mixed",
    },
  };
}

function pathOf(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).pathname || "/";
  } catch {
    return url.startsWith("/") ? url : null;
  }
}

function absoluteUrl(url: string): string | null {
  if (!url) return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

/**
 * Map an EvidenceSnapshot onto the ranked-by-value list of opportunities the
 * Decision kernel drafts. Existing-page edits come first (a real page with real
 * demand is the safest, highest-confidence move), new pages after. Deterministic
 * + bounded.
 */
export function snapshotToEvidenceInputs(snapshot: EvidenceSnapshot): EvidenceInput[] {
  const existing: EvidenceInput[] = [];

  // Owned pages with real demand → title + meta edits, ranked by impressions.
  const pagesByDemand = [...snapshot.ownedPages]
    .filter((p) => (p.search?.impressions90d ?? 0) >= MIN_PAGE_IMPRESSIONS)
    .sort((a, b) => (b.search?.impressions90d ?? 0) - (a.search?.impressions90d ?? 0));

  for (const page of pagesByDemand) {
    const top = topQueryFor(page);
    const query = top?.query ?? page.content?.h1 ?? page.content?.title ?? page.url;
    if (!query) continue;
    // Title is the highest-leverage field; meta second. Emit both when a value exists.
    const titleInput = existingEditInput(snapshot, page, "title", query);
    if (titleInput) existing.push(titleInput);
    const metaInput = existingEditInput(snapshot, page, "meta", query);
    if (metaInput) existing.push(metaInput);
    if (existing.length >= MAX_EXISTING_EDIT_OPPORTUNITIES) break;
  }

  // Never propose building a page the tenant already owns. A topic that matches an
  // owned page's own words is that page's job: the existing-page path above already
  // covers it, and emitting a new_page as well would recommend competing with
  // yourself for the same searches. Same relevance rule the rest of the product uses.
  const ownedTopicText = snapshot.ownedPages
    .map((p) => [p.content?.title, p.content?.h1].filter(Boolean).join(" ").trim())
    .filter((t) => t.length > 0);
  // Threshold, not bare relevance: one shared token ("nowruz", "tehran") must not
  // let a single owned page silently kill every adjacent topic. Suppress only when
  // MOST of the topic's own distinguishing tokens are covered by the owned page.
  const alreadyOwned = (topic: string) =>
    ownedTopicText.some((text) => {
      const v = scoreTopicMatch(topic, text);
      return v.relevant && v.score >= 0.6;
    });

  const newPages = [...snapshot.newPageOpportunities]
    .filter((opp) => !alreadyOwned(opp.topic))
    .sort((a, b) => b.demandWeight - a.demandWeight)
    .slice(0, MAX_NEW_PAGE_OPPORTUNITIES)
    .map((opp) => newPageInput(snapshot, opp));

  return [...existing.slice(0, MAX_EXISTING_EDIT_OPPORTUNITIES), ...newPages];
}

/** Which proposal path an input routes to (re-export for callers/logging). */
export function inputKind(input: EvidenceInput): ProposalKind {
  return input.opportunity.kind;
}
