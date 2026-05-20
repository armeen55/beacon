/**
 * 2026-05-19 — Slice 4.5.B.α₁ trigger predicate:
 * `title_h1_mismatch`.
 *
 * Fires when both `snapshot.title` and `snapshot.h1` are non-empty
 * AND the stopword-aware Jaccard similarity over their lowercased
 * token sets falls below 0.3. Emits BOTH an `edit_title` AND a
 * `change_h1` candidate (distinct dedupe_keys via different
 * action_type) so the operator sees both halves of the mismatch
 * in the diagnostic table.
 *
 * Tokenization: lowercase → split on `/[^a-z0-9]+/` → keep tokens
 * with `length >= 2` AND NOT in UNIVERSAL_STRIP_WORDS. Numeric
 * tokens are kept so a year / zip / phone fragment counts as
 * alignment.
 *
 * Stopword set is inlined here (copied from
 * `src/domains/product/section-analyzer.ts:44`) so the predicate
 * stays pure with no transitive deps. Tenant-specific
 * `BusinessConfig.stripWords` is NOT merged — those are operator-
 * side theme-classification strip targets, not language stopwords,
 * and mixing them would over-strip brand-name overlaps.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type {
  CandidateEvidenceRef,
  RecommendationCandidateRow,
} from "../emitter/candidate-row";
import { titleH1MismatchCopy } from "../customer-copy-templates";

export type TitleH1MismatchInput = {
  tenantId: string;
  snapshot: PageSnapshot;
};

const MISMATCH_THRESHOLD = 0.3;

/** Universal article / preposition / filler stopwords. Mirrors
 *  `UNIVERSAL_STRIP_WORDS` from `section-analyzer.ts:44`. */
const UNIVERSAL_STRIP_WORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "in",
  "for",
  "of",
  "and",
  "or",
  "your",
  "our",
  "my",
  "best",
  "top",
  "premier",
  "leading",
  "trusted",
]);

function tokenize(value: string): Set<string> {
  const out = new Set<string>();
  for (const part of value.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length < 2) continue;
    if (UNIVERSAL_STRIP_WORDS.has(part)) continue;
    out.add(part);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function titleH1Mismatch(
  input: TitleH1MismatchInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot } = input;
  const title = snapshot.title;
  const h1 = snapshot.h1;
  if (title == null || title.trim().length === 0) return [];
  if (h1 == null || h1.trim().length === 0) return [];

  const titleTokens = tokenize(title);
  const h1Tokens = tokenize(h1);
  // Defensive: if either tokenization yields empty (all
  // stopwords / no alphanumerics), suppress — there's no honest
  // signal either way.
  if (titleTokens.size === 0 || h1Tokens.size === 0) return [];

  const similarity = jaccard(titleTokens, h1Tokens);
  if (similarity >= MISMATCH_THRESHOLD) return [];

  const targetUrl = snapshot.url;
  const topicClusterLabel = "Title and H1 alignment";
  const sharedTokens = [...titleTokens].filter((t) => h1Tokens.has(t)).length;
  const operatorEvidence =
    "title=" +
    JSON.stringify(title) +
    " h1=" +
    JSON.stringify(h1) +
    " jaccard=" +
    similarity.toFixed(3) +
    " shared=" +
    String(sharedTokens) +
    " title_tokens=" +
    String(titleTokens.size) +
    " h1_tokens=" +
    String(h1Tokens.size);
  const evidenceRefs: ReadonlyArray<CandidateEvidenceRef> = [
    {
      kind: "page_snapshot",
      ref: targetUrl,
      detail:
        "title and h1 share " +
        String(sharedTokens) +
        " of " +
        String(titleTokens.size + h1Tokens.size - sharedTokens) +
        " unique tokens (Jaccard " +
        similarity.toFixed(2) +
        ")",
    },
  ];

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "title_h1_mismatch",
      action_type: "edit_title",
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: evidenceRefs,
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: titleH1MismatchCopy(),
      operator_evidence: operatorEvidence,
      dedupe_key: dedupeKey({
        tenantId,
        actionType: "edit_title",
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({
        tenantId,
        actionType: "edit_title",
        targetUrl,
      }),
      created_from_signal_at: snapshot.fetched_at,
      safety_flags: [],
    },
    {
      tenant_id: tenantId,
      trigger_signal: "title_h1_mismatch",
      action_type: "change_h1",
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: evidenceRefs,
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: titleH1MismatchCopy(),
      operator_evidence: operatorEvidence,
      dedupe_key: dedupeKey({
        tenantId,
        actionType: "change_h1",
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({
        tenantId,
        actionType: "change_h1",
        targetUrl,
      }),
      created_from_signal_at: snapshot.fetched_at,
      safety_flags: [],
    },
  ];
}
