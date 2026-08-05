/**
 * native-intel - all that is left of the legacy projection reader: how to tell a raw
 * prompt_answer_observations row's RETRIEVAL MODE from its metadata. The report it used to build (recurring
 * domains and pages, the presence matrix, the questions inside answers) is gone, because it was a second and
 * weaker AI truth: it read a capped projection with no fan-outs and no analyses beside the canonical record
 * the account already paid for. The snapshot now derives all of that from ai_observations itself.
 *
 * PURE (no I/O, no server-only). One live consumer: product/url-citation-history.ts.
 */

import type { ObservationMode } from "@/domains/evidence/funnel/research-evidence";

/** Slice 6I - a raw row's retrieval mode. `observationMode` is authoritative; `scraper` true is
 *  the consumer look. NEITHER marker = legacy (null), counted exactly as before 6I: pre-6I rows
 *  wrote `scraper: false` on every standardized ask, so scraper false alone must NEVER reclassify
 *  history as auxiliary (that would silently drop every historical ChatGPT citation from presence
 *  and proof windows). */
export function observationModeOf(metadata: Record<string, unknown> | null | undefined): ObservationMode | null {
  const explicit = metadata?.["observationMode"];
  if (explicit === "consumer_search" || explicit === "standardized_response") return explicit;
  return metadata?.["scraper"] === true ? "consumer_search" : null;
}
