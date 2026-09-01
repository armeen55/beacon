/**
 * change-family — the pure diff-in-diff family taxonomy + contamination helpers
 * the measurement path uses. Relocated from the retired experiments domain
 * (CORE 100K, 2026-07-22): the daily-experiment eligibility engine was removed,
 * but its family classifier and active-treatment set are load-bearing for
 * measurement (verdict scheduling, pooled verdicts, ledger contamination) and
 * for move-routing. No I/O, no LLM — deterministic from the ledger.
 */

/** Action FAMILY — coarser than action_type. Same-family re-tests collide; title and meta
 *  are DISTINCT families so a meta-vs-title comparison is a legitimate cross-page design. */
export type ExperimentFamily =
  | "title"
  | "meta"
  | "title_meta"
  | "h1"
  | "answer"
  | "link"
  | "schema"
  | "content"
  | "new_page"
  | "full_rewrite"
  | "other";

export function actionFamilyOf(actionType: string): ExperimentFamily {
  const a = (actionType || "").toLowerCase();
  if (/full_rewrite/.test(a)) return "full_rewrite";
  const hasTitle = /title/.test(a);
  const hasMeta = /meta|description/.test(a);
  if (hasTitle && hasMeta) return "title_meta";
  if (hasTitle) return "title";
  if (hasMeta) return "meta";
  if (/\bh1\b|heading/.test(a)) return "h1";
  if (/answer|faq|snippet/.test(a)) return "answer";
  if (/link/.test(a)) return "link";
  if (/schema|json.?ld|structured/.test(a)) return "schema";
  if (/create_page|new_page|create_tool|create_calculator|create_collection|build_/.test(a)) return "new_page";
  if (/edit_page|content|section|rewrite|expand|paragraph|body|add_image|image_alt|correction|factual|source_update|entity_expansion|table_or_list/.test(a)) return "content";
  return "other";
}

