/**
 * Sprint 6A.1 Phase 6 (2026-04-24) — Page element persistence.
 *
 * Wraps the pure-output of `extractAllElements` with the DB-layer fields
 * required by `page_element_inventory` (id / tenant_id / page_id / url /
 * observed_at / source_snapshot_id) and dual-writes the resulting rows.
 *
 * Two entry points:
 *
 *   - `buildPageElementRows({ snapshot, html, tenantId, ... })` — pure.
 *     Used by both the scan CLI (where dual-write happens later in
 *     orchestrate-scan after the CLI exits) and the in-process verify
 *     action.
 *
 *   - `persistPageElements({ snapshot, html, tenantId, ... })` —
 *     in-process variant that also calls `syncPageElementInventory(rows)`
 *     for the dual-write. Wraps the whole flow in try/catch so an
 *     extractor failure NEVER blocks the snapshot persistence path
 *     upstream of this call.
 *
 * The `id` column is deterministic — `${snapshot.id}__${element_key}` —
 * so re-running with the same inputs produces the same id and the
 * Postgres unique-index upsert on `(source_snapshot_id, element_key)`
 * stays idempotent.
 *
 * No generators. No LLM. No UI. Phase 6A.1.6 wires the inventory-only
 * path; recommended_edits + evidence packets are later phases.
 */

import "server-only";

import { log } from "@/lib/logger";
import { syncPageElementInventory } from "@/lib/persistence/dual-write";
import type { PageSnapshot } from "../types";
import { extractAllElements } from "./dispatcher";
import type { ElementType } from "./registry";
import type { ExtractedElement, ExtractorContext } from "./types";

/**
 * One row in the `page_element_inventory` table. Shape mirrors the
 * migration's column list exactly — Phase 6A.1.1 schema test asserts
 * the column set, so any drift here will surface there too.
 */
export type PageElementInventoryRow = {
  id: string;
  tenant_id: string;
  page_id: string;
  url: string;
  element_type: ElementType;
  element_key: string;
  display_label: string;
  element_text: string | null;
  element_metadata: Record<string, unknown>;
  extractor_version: number;
  observed_at: string;
  source_snapshot_id: string;
};

/**
 * Inputs to the per-snapshot extract+wrap step.
 *
 * Dictionaries are passed in by the caller — the helper does NOT reach
 * for `getBusinessConfig()` itself. This keeps the function pure +
 * tenant-agnostic + safe to import from the scan CLI without dragging
 * server-only config readers into the child process.
 */
export type BuildPageElementRowsArgs = {
  snapshot: PageSnapshot;
  html: string;
  tenantId: string;
  cityDictionary?: string[];
  serviceDictionary?: string[];
  /** Reserved for Sprint 6A.2 — entity_mention extractor. */
  entityDictionary?: string[];
  /** Reserved for Sprint 6A.2 — competitor_mention extractor. */
  competitorDictionary?: string[];
};

/**
 * Pure: extract every active element type for the given snapshot+html
 * and wrap each ExtractedElement with DB-layer fields ready to upsert
 * to `page_element_inventory`.
 *
 * `id` is deterministic (`${snapshot.id}__${element_key}`) so repeated
 * calls produce the same rows.
 */
export function buildPageElementRows(
  args: BuildPageElementRowsArgs,
): PageElementInventoryRow[] {
  const {
    snapshot,
    html,
    tenantId,
    cityDictionary,
    serviceDictionary,
    entityDictionary,
    competitorDictionary,
  } = args;

  const ctx: ExtractorContext = {
    pageUrl: snapshot.url,
    cityDictionary,
    serviceDictionary,
    entityDictionary,
    competitorDictionary,
  };

  const extracted: ExtractedElement[] = extractAllElements(snapshot, html, ctx);
  const observedAt = snapshot.fetched_at;

  return extracted.map((el) => ({
    id: `${snapshot.id}__${el.elementKey}`,
    tenant_id: tenantId,
    page_id: snapshot.page_id,
    url: snapshot.url,
    element_type: el.elementType,
    element_key: el.elementKey,
    display_label: el.displayLabel,
    element_text: el.elementText,
    element_metadata: el.elementMetadata,
    extractor_version: el.extractorVersion,
    observed_at: observedAt,
    source_snapshot_id: snapshot.id,
  }));
}

/**
 * In-process variant: builds rows + dual-writes to Supabase. Returns
 * the rows for caller-side persistence (e.g. file write) or assertions.
 *
 * Try/catch around the whole flow — a thrown extractor or a Supabase
 * outage MUST NOT block the snapshot-persistence path that wraps this
 * call (verify-action.ts already calls `syncPageSnapshots` BEFORE this
 * helper, so the snapshot is already durable by the time we run).
 *
 * Intentionally returns `[]` on failure rather than re-throwing.
 */
export async function persistPageElements(
  args: BuildPageElementRowsArgs,
): Promise<PageElementInventoryRow[]> {
  try {
    const rows = buildPageElementRows(args);
    await syncPageElementInventory(rows, args.tenantId);
    return rows;
  } catch (err) {
    log.error("Page element persist failed", {
      url: args.snapshot.url,
      snapshotId: args.snapshot.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
