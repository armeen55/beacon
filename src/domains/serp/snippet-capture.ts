/**
 * snippet-capture (2026-07-03, BEACON_500 R11 / N29 - featured-snippet capture
 * with format-matched steal moves).
 *
 * PURE / no I/O / no LLM. EXTENDS the shipped feature-steal engine
 * (feature-steal.ts reads the same dataforseo_serp_history rows and powers the
 * worklist columns + nightly spike hints): where a captured Google reading
 * shows the answer box owned by someone else AND the tenant ranks 2-10 for
 * that query, this emits a FORMAT-MATCHED steal candidate through the existing
 * deterministic trigger pipeline (load-trigger-candidates-for-tenant.ts), the
 * same lane snippet_promise_gap (N18) rides.
 *
 * Format-matched means the directive names the shape Google chose and the
 * shape our page currently answers in: "Google shows a numbered list from
 * britannica.com; your page answers in prose. Match the list format to
 * compete for that box." The own-page shape is classified from the page's
 * STORED early body text only (a page with no stored text gets the honest
 * "add the format" phrasing, never a claimed current shape).
 *
 * HONESTY: a strong owner (Wikipedia/Britannica/major news, the feature-steal
 * authority list) is never sold as an easy win - the candidate says so and
 * carries low confidence. Capped at MAX_SNIPPET_CAPTURE_CANDIDATES per run,
 * closest rank first, and deduped against the existing steal-lane cards by
 * query so the same opportunity never appears twice in the worklist.
 */

import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import { dedupeKey } from "@/domains/recommendation-intelligence/emitter/dedupe-key";
import { cooldownKey } from "@/domains/recommendation-intelligence/emitter/cooldown-key";
import { snippetCaptureCopy } from "@/domains/recommendation-intelligence/customer-copy-templates";

import { isMajorAuthorityDomain, type FeatureStealHistoryRow, type OwnerStrength } from "./feature-steal";
import { rootDomain } from "./serp-provider";

export const MAX_SNIPPET_CAPTURE_CANDIDATES = 5;
/** N29 window: rank 2-10 (wider than feature-steal's 2-8 hint lane; a #9-10
 *  page still loses the box to a format gap, not a relevance gap). */
export const MIN_CAPTURE_RANK = 2;
export const MAX_CAPTURE_RANK = 10;

export type SnippetFormat = "paragraph" | "list" | "table";
export type OwnAnswerStyle = "prose" | "list" | "table" | "unknown";

export type SnippetCaptureOpportunity = {
  query: string;
  capturedAt: string;
  ownRank: number;
  /** The tenant page that ranks for the query (the edit target). */
  ownUrl: string;
  ownerDomain: string;
  ownerStrength: OwnerStrength;
  format: SnippetFormat;
  ownAnswerStyle: OwnAnswerStyle;
  /** The format-matched, first-person, dash-free steal directive. */
  directive: string;
};

const FORMAT_PHRASE: Record<SnippetFormat, string> = {
  paragraph: "a short paragraph answer",
  list: "a numbered list",
  table: "a table",
};

/** What to build, matched to the box's format. */
const MATCH_INSTRUCTION: Record<SnippetFormat, string> = {
  paragraph: "Lead with a two sentence direct answer high on the page",
  list: "Match the list format with a tight numbered list high on the page",
  table: "Match the table format with a compact table high on the page",
};

const STYLE_PLAIN: Record<Exclude<OwnAnswerStyle, "unknown">, string> = {
  prose: "answers in prose",
  list: "already answers with a list",
  table: "already answers with a table",
};

/**
 * Classify how OUR page currently answers, from its stored early body text.
 * Deterministic and conservative: list/table shapes need 2+ marker lines;
 * empty/missing text is honestly "unknown", never a claimed shape.
 */
export function classifyOwnAnswerStyle(earlyText: string | null | undefined): OwnAnswerStyle {
  const text = (earlyText ?? "").trim();
  if (!text) return "unknown";
  const lines = text.split(/\n+/);
  const listLines = lines.filter((l) => /^\s*(\d+[.)]\s|[-*•]\s)/.test(l)).length;
  if (listLines >= 2) return "list";
  const tableLines = lines.filter((l) => /\|.+\|/.test(l)).length;
  if (tableLines >= 2) return "table";
  return "prose";
}

/** PURE: rank 2-10 inclusive qualifies for a capture attempt. */
export function qualifiesForCapture(ownRank: number | null): ownRank is number {
  return (
    typeof ownRank === "number" &&
    Number.isFinite(ownRank) &&
    ownRank >= MIN_CAPTURE_RANK &&
    ownRank <= MAX_CAPTURE_RANK
  );
}

function ownsSnippet(ownerDomain: string, tenantDomain: string | null | undefined): boolean {
  const t = rootDomain((tenantDomain ?? "").trim());
  if (!t) return false;
  const d = ownerDomain.toLowerCase();
  return d === t || d.endsWith(`.${t}`);
}

const normQuery = (q: string) => q.trim().toLowerCase();

/** The already-format-matched case: our page answers in the box's own shape,
 *  so the gap is not format and this trigger stays silent for it. */
function alreadyMatchesFormat(format: SnippetFormat, style: OwnAnswerStyle): boolean {
  return (format === "list" && style === "list") || (format === "table" && style === "table");
}

function buildDirective(o: Omit<SnippetCaptureOpportunity, "directive">): string {
  const shown = `Google shows ${FORMAT_PHRASE[o.format]} from ${o.ownerDomain} in the answer box above your #${o.ownRank} spot for "${o.query}".`;
  const ourShape = o.ownAnswerStyle === "unknown" ? "" : ` Your page ${STYLE_PLAIN[o.ownAnswerStyle as Exclude<OwnAnswerStyle, "unknown">]}.`;
  const match = `${MATCH_INSTRUCTION[o.format]} to compete for that box.`;
  const strength =
    o.ownerStrength === "strong" ? " That owner is a strong site, so this is a long shot, but the format gap is real." : "";
  return `${shown}${ourShape} ${match}${strength}`;
}

/**
 * PURE: reduce the tenant's SERP history rows to snippet-capture opportunities,
 * one per query from its MOST RECENT capture (same latest-row convention as
 * computeFeatureSteals). Skips: unqualified ranks, our own box, rows with no
 * ranked own URL (no page to edit), queries the existing steal lane already
 * carries a card for (`stealLaneQueries`), and pages that already answer in
 * the box's format. Closest rank first, then query.
 */
export function findSnippetCaptures(
  rows: readonly FeatureStealHistoryRow[],
  tenantDomain: string | null | undefined,
  opts: {
    stealLaneQueries?: ReadonlySet<string>;
    /** Stored early body text per own URL (lowercased key), for the
     *  format-matched "your page answers in prose" clause. */
    earlyTextByUrl?: ReadonlyMap<string, string | null>;
  } = {},
): SnippetCaptureOpportunity[] {
  const byQuery = new Map<string, FeatureStealHistoryRow[]>();
  for (const r of rows) {
    const list = byQuery.get(r.query) ?? [];
    list.push(r);
    byQuery.set(r.query, list);
  }

  const out: SnippetCaptureOpportunity[] = [];
  for (const list of byQuery.values()) {
    const latest = [...list].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt)).at(-1);
    if (!latest) continue;
    if (!qualifiesForCapture(latest.ownRank)) continue;
    if (!latest.snippetOwner || !latest.ownUrl) continue;
    if (ownsSnippet(latest.snippetOwner.ownerDomain, tenantDomain)) continue;
    if (opts.stealLaneQueries?.has(normQuery(latest.query))) continue;

    const format = latest.snippetOwner.format;
    const ownAnswerStyle = classifyOwnAnswerStyle(opts.earlyTextByUrl?.get(latest.ownUrl.toLowerCase()));
    if (alreadyMatchesFormat(format, ownAnswerStyle)) continue;

    const base = {
      query: latest.query,
      capturedAt: latest.capturedAt,
      ownRank: latest.ownRank,
      ownUrl: latest.ownUrl,
      ownerDomain: latest.snippetOwner.ownerDomain,
      ownerStrength: (isMajorAuthorityDomain(latest.snippetOwner.ownerDomain) ? "strong" : "weak") as OwnerStrength,
      format,
      ownAnswerStyle,
    };
    out.push({ ...base, directive: buildDirective(base) });
  }

  return out.sort((a, b) => a.ownRank - b.ownRank || a.query.localeCompare(b.query));
}

/**
 * The deterministic trigger: shape the top opportunities as candidate rows for
 * the existing pipeline. `add_answer_block` is the play (build the answer in
 * the box's own format high on the page). Capped at
 * MAX_SNIPPET_CAPTURE_CANDIDATES, one per query, weak owners medium
 * confidence, strong owners low (an honest long shot, routed diagnostic-only
 * by the queue rules). Pure over pre-computed opportunities.
 */
export function snippetCaptureCandidates(args: {
  tenantId: string;
  opportunities: readonly SnippetCaptureOpportunity[];
  signalAt: string;
  maxCandidates?: number;
}): RecommendationCandidateRow[] {
  const max = args.maxCandidates ?? MAX_SNIPPET_CAPTURE_CANDIDATES;
  const actionType = "add_answer_block" as const;
  const seen = new Set<string>();
  const rows: RecommendationCandidateRow[] = [];

  for (const o of args.opportunities) {
    if (rows.length >= max) break;
    const qKey = normQuery(o.query);
    if (!qKey || seen.has(qKey)) continue;
    seen.add(qKey);
    const topicClusterLabel = `featured_snippet:${qKey}`;
    rows.push({
      tenant_id: args.tenantId,
      trigger_signal: "featured_snippet_capture",
      action_type: actionType,
      generator_kind: "deterministic" as const,
      target_url: o.ownUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot" as const,
          ref: o.ownUrl,
          detail:
            "featured_snippet_capture query=" +
            o.query +
            "; owner=" +
            o.ownerDomain +
            "; owner_strength=" +
            o.ownerStrength +
            "; format=" +
            o.format +
            "; own_rank=" +
            o.ownRank +
            "; own_answer_style=" +
            o.ownAnswerStyle +
            "; captured_at=" +
            o.capturedAt,
        },
      ],
      confidence: o.ownerStrength === "weak" ? ("medium" as const) : ("low" as const),
      impact_estimate: "medium" as const,
      customer_copy: snippetCaptureCopy(
        o.query,
        o.ownerDomain,
        FORMAT_PHRASE[o.format],
        o.ownRank,
        MATCH_INSTRUCTION[o.format],
      ),
      operator_evidence: o.directive,
      dedupe_key: dedupeKey({ tenantId: args.tenantId, actionType, targetUrl: o.ownUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId: args.tenantId, actionType, targetUrl: o.ownUrl }),
      created_from_signal_at: o.capturedAt || args.signalAt,
      safety_flags: [],
    });
  }

  return rows;
}
