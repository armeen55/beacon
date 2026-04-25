/**
 * Sprint 6A.1 Phase 5 (2026-04-24) — Extractor dispatcher.
 *
 * Iterates EXTRACTOR_REGISTRY, runs only extractors whose
 * `active: true`, returns the concatenated ExtractedElement[]. Per-
 * extractor errors are caught + logged so one bad block doesn't kill
 * the whole snapshot's inventory.
 *
 * No DB writes. The DB upsert path is Phase 6A.1.6 — that phase
 * wraps each ExtractedElement with tenant_id / page_id / observed_at /
 * source_snapshot_id / id and calls the dual-write helper.
 */

import { log } from "@/lib/logger";
import {
  EXTRACTOR_REGISTRY,
  ELEMENT_TYPES,
  type ElementType,
} from "./registry";
import type { PageSnapshot } from "../types";
import type { ExtractedElement, ExtractorContext } from "./types";
import { EXTRACTORS } from "./extractors";

/**
 * Run every active extractor against a page's snapshot + raw HTML.
 * Returns the flat list of extracted elements.
 *
 * Pure orchestration — no I/O of its own. Per-extractor exceptions
 * are caught and logged; failed extractors contribute zero rows
 * rather than failing the whole snapshot.
 */
export function extractAllElements(
  snapshot: PageSnapshot,
  html: string,
  ctx: ExtractorContext,
): ExtractedElement[] {
  const out: ExtractedElement[] = [];
  for (const elementType of ELEMENT_TYPES) {
    const spec = EXTRACTOR_REGISTRY[elementType];
    if (!spec.active) continue;
    const extractor = EXTRACTORS[elementType as ElementType];
    if (!extractor) continue; // shouldn't happen — EXTRACTORS is total
    try {
      const rows = extractor(snapshot, html, ctx);
      out.push(...rows);
    } catch (err) {
      log.error("Extractor failed", {
        elementType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/**
 * Variant: run a SINGLE extractor by ElementType. Useful for unit
 * tests + future debugging dashboards. Respects `active: false`
 * (returns []).
 */
export function extractSingle(
  elementType: ElementType,
  snapshot: PageSnapshot,
  html: string,
  ctx: ExtractorContext,
): ExtractedElement[] {
  const spec = EXTRACTOR_REGISTRY[elementType];
  if (!spec.active) return [];
  try {
    return EXTRACTORS[elementType](snapshot, html, ctx);
  } catch (err) {
    log.error("Extractor failed", {
      elementType,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
