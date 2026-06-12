/**
 * Keyword-gap slice (2026-06-12) — cross-page trigger:
 * `semrush_keyword_gap`. "Missing" keywords (a competitor ranks
 * top-10; the tenant doesn't rank at all) are new-content territory —
 * the Semrush gap-analysis guide's play: filter to competitors' top-10
 * results and KD 0–49 for smaller domains, then weigh volume.
 *
 * Emits create_page candidates at OPERATOR-REVIEW tier (new-content
 * briefs commit real authoring effort — human judgment gates them; no
 * deterministic draft pretends to write the page).
 *
 * ORIGINALITY GUARD (audit #13, 2026-06-12 night shift): when the gap
 * keyword topically matches a page the tenant ALREADY has (every
 * meaningful keyword token present in that page's title+h1), a new
 * page would be self-duplication — the exact pattern the helpful-
 * content guidance penalizes and the cannibalization detector exists
 * to catch. The play flips to EXPANDING the matched page
 * (add_h2_section on its URL) — Semrush's own gap guide: improve the
 * existing page rather than spin up a duplicate. Tokenization mirrors
 * thin-content-overlap (≥4 chars incl. Persian range, stopword set)
 * so "topic match" means the same thing across the engine.
 *
 * @no-classifier-required — cross-page advisory derived from rank
 * data + pre-extracted title/h1 strings; no snapshot classification.
 *
 * PURE — gap rows and existing pages are pre-loaded inputs.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import {
  keywordGapCopy,
  keywordGapExpandCopy,
} from "../customer-copy-templates";

export type KeywordGapExistingPage = {
  url: string;
  title: string | null;
  h1: string | null;
};

export type KeywordGapInput = {
  tenantId: string;
  /** The tenant's site root (queue rules forbid the needs_new_page
   *  sentinel at the candidate layer; the new-page intent lives in
   *  the keyword label + copy + operator evidence). */
  siteRootUrl: string;
  gaps: ReadonlyArray<{
    keyword: string;
    competitor_domain: string;
    competitor_position: number;
    volume: number;
    difficulty: number | null;
  }>;
  signalAt: string;
  maxEmissions?: number;
  /** Originality guard input — the tenant's current pages. Optional:
   *  without it every gap stays a create_page brief (pre-guard
   *  behavior). */
  existingPages?: ReadonlyArray<KeywordGapExistingPage>;
};

// Mirrors thin-content-overlap's tokenization so "topical match"
// means one thing across the engine.
const GENERIC_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "your", "this", "that", "what",
  "when", "where", "how", "why", "are", "was", "were", "will", "can",
  "about", "into", "near", "best", "guide", "page", "home",
]);

function meaningfulTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9؀-ۿ]+/)) {
    if (raw.length >= 4 && !GENERIC_STOPWORDS.has(raw)) out.push(raw);
  }
  return out;
}

/**
 * The existing page already covering this keyword's topic, or null.
 * Containment test: EVERY meaningful keyword token appears in the
 * page's title+h1 token set — conservative on purpose (partial
 * overlap still earns a new page; only a full topical match flips
 * the play to expansion).
 */
export function findTopicalDuplicate(
  keyword: string,
  pages: ReadonlyArray<KeywordGapExistingPage>,
): KeywordGapExistingPage | null {
  const kw = meaningfulTokens(keyword);
  if (kw.length === 0) return null;
  for (const p of pages) {
    const pageTokens = new Set(
      meaningfulTokens(`${p.title ?? ""} ${p.h1 ?? ""}`),
    );
    if (pageTokens.size === 0) continue;
    if (kw.every((t) => pageTokens.has(t))) return p;
  }
  return null;
}

/** Guide thresholds: competitor top-10; KD 0–49 for smaller domains;
 *  volume floor mirrors the striking-distance small-site floor. */
const MAX_COMPETITOR_POSITION = 10;
const MAX_DIFFICULTY = 49;
const MIN_VOLUME = 10;
const DEFAULT_MAX_EMISSIONS = 3;

export function semrushKeywordGap(
  input: KeywordGapInput,
): RecommendationCandidateRow[] {
  const { tenantId, gaps, signalAt, siteRootUrl } = input;
  const max = input.maxEmissions ?? DEFAULT_MAX_EMISSIONS;
  const eligible = gaps
    .filter(
      (g) =>
        g.competitor_position <= MAX_COMPETITOR_POSITION &&
        g.volume >= MIN_VOLUME &&
        (g.difficulty == null || g.difficulty <= MAX_DIFFICULTY),
    )
    .sort((a, b) => b.volume - a.volume)
    .slice(0, max);

  return eligible.map((g) => {
    // Originality guard (audit #13): a full topical match flips the
    // play from create_page to expanding the matched page.
    const duplicate = findTopicalDuplicate(g.keyword, input.existingPages ?? []);
    if (duplicate != null) {
      const actionType = "add_h2_section" as const;
      const targetUrl = duplicate.url;
      const topicClusterLabel = g.keyword;
      return {
        tenant_id: tenantId,
        trigger_signal: "semrush_keyword_gap",
        action_type: actionType,
        generator_kind: "deterministic",
        target_url: targetUrl,
        topic_cluster_label: topicClusterLabel,
        evidence: [
          {
            kind: "page_snapshot",
            ref: duplicate.url,
            detail:
              "keyword_gap keyword=" +
              g.keyword +
              "; competitor=" +
              g.competitor_domain +
              " (#" +
              g.competitor_position +
              "); volume_per_month=" +
              g.volume +
              "; difficulty=" +
              (g.difficulty ?? "n/a") +
              "; play=expand_existing_page; matched_page=" +
              duplicate.url,
          },
        ],
        confidence: "medium" as const,
        impact_estimate: "medium" as const,
        customer_copy: keywordGapExpandCopy(g.keyword, g.volume),
        operator_evidence:
          "signal=semrush_keyword_gap; keyword=" +
          g.keyword +
          "; competitor=" +
          g.competitor_domain +
          " (#" +
          g.competitor_position +
          "); volume=" +
          g.volume +
          "; kd=" +
          (g.difficulty ?? "null") +
          "; play=expand_existing_page (originality guard: topic already covered by " +
          duplicate.url +
          " — a new page would self-duplicate/cannibalize)",
        dedupe_key: dedupeKey({
          tenantId,
          actionType,
          targetUrl,
          topicClusterLabel,
        }),
        cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
        created_from_signal_at: signalAt,
        safety_flags: [],
      };
    }

    const actionType = "create_page" as const;
    const targetUrl = siteRootUrl;
    const topicClusterLabel = g.keyword;
    return {
      tenant_id: tenantId,
      trigger_signal: "semrush_keyword_gap",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: g.competitor_domain,
          detail:
            "keyword_gap keyword=" +
            g.keyword +
            "; competitor=" +
            g.competitor_domain +
            " (#" +
            g.competitor_position +
            "); volume_per_month=" +
            g.volume +
            "; difficulty=" +
            (g.difficulty ?? "n/a"),
        },
      ],
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: keywordGapCopy(g.keyword, g.volume),
      operator_evidence:
        "signal=semrush_keyword_gap; keyword=" +
        g.keyword +
        "; competitor=" +
        g.competitor_domain +
        " (#" +
        g.competitor_position +
        "); volume=" +
        g.volume +
        "; kd=" +
        (g.difficulty ?? "null") +
        "; play=new_content_brief",
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl: topicClusterLabel, // gap cards are keyword-keyed
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({
        tenantId,
        actionType,
        targetUrl: topicClusterLabel,
      }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    };
  });
}
