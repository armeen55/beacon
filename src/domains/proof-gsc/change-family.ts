/**
 * change-family — the pure diff-in-diff family taxonomy + contamination helpers
 * the measurement path uses. Relocated from the retired experiments domain
 * (CORE 100K, 2026-07-22): the daily-experiment eligibility engine was removed,
 * but its family classifier and active-treatment set are load-bearing for
 * measurement (verdict scheduling, pooled verdicts, ledger contamination) and
 * for move-routing. No I/O, no LLM — deterministic from the ledger.
 */

import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { outcomeStateOf } from "@/domains/proof-gsc/measure-lifecycle";

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
  if (/edit_page|content|section|rewrite|expand|paragraph|body|add_image|image_alt/.test(a)) return "content";
  return "other";
}

/** Two families "collide" for contamination purposes. title and title_meta overlap;
 *  meta and title_meta overlap. */
export function familiesCollide(a: ExperimentFamily, b: ExperimentFamily): boolean {
  if (a === b) return true;
  const titleish = new Set<ExperimentFamily>(["title", "title_meta"]);
  const metaish = new Set<ExperimentFamily>(["meta", "title_meta"]);
  if (titleish.has(a) && titleish.has(b)) return true;
  if (metaish.has(a) && metaish.has(b)) return true;
  return false;
}

/** Days after ship that a 28-day window is DONE (final window + GSC finalization lag). */
export const FINAL_WINDOW_DAYS = 28;
export const GSC_LAG_DAYS = 3;

function pathOf(urlOrPath: string): string {
  return (urlOrPath.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "");
}

/** Paths that currently have an ACTIVE (measuring) treatment — the set a control must avoid
 *  to stay a clean comparison. Consumed by the ledger contamination guard. PURE. */
export function activeTreatmentPaths(records: ShippedChangeRecord[], now: Date = new Date()): Set<string> {
  const out = new Set<string>();
  for (const r of records) if (outcomeStateOf(r, now) === "measuring") out.add(pathOf(r.path));
  return out;
}
