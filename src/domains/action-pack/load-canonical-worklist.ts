/**
 * Canonical ActionPack worklist (2026-06-27, Core Consolidation Phase F.1).
 *
 * THE one product brain: a single ranked read model the product reads, with the
 * worklist split into the families the surfaces actually render, plus the parity
 * proof, source coverage, degraded-source visibility, and the legacy rows it
 * suppresses. It is a thin envelope over `loadActionPackWorklistForTenant` (the
 * adapter+dedupe) + `loadActionPackParityForTenant` (the proof) — NOT a new
 * scorer and NOT a new recommendation model.
 *
 * Contract:
 *  - ActionPack is the only normalized output shape.
 *  - cached/durable sources only — NEVER live Profound, NEVER live DataForSEO.
 *  - timebox expensive reads; fail VISIBLE (warnings + staleSources), never
 *    silently empty.
 *  - duplicates collapsed consistently (delegated to the dedupe in load.ts).
 *
 * Not yet wired to customer surfaces — prove it first (truth dump + diagnostic).
 */
import "server-only";
import { cache } from "react";

import { log } from "@/lib/logger";
import { isLegacyQuarantined } from "@/lib/legacy-flags";

import { loadActionPackWorklistForTenant } from "./load";
import { loadActionPackParityForTenant, type ActionPackParityReport } from "./parity";
import { actionFamily, type ActionPack, type ActionType, type EvidenceSource } from "./types";

export type CanonicalFamilies = {
  existingPageFixes: ActionPack[];
  newPages: ActionPack[];
  hubs: ActionPack[];
  internalLinks: ActionPack[];
  experienceFixes: ActionPack[];
  titleMetaFixes: ActionPack[];
  answerBlocks: ActionPack[];
  /** Count only — noise never becomes a pack (compiler-suppressed). */
  ignoredNoise: number;
};

export type CanonicalWorklist = {
  tenantId: string;
  generatedAt: string;
  packs: ActionPack[];
  families: CanonicalFamilies;
  sourceCoverage: Record<EvidenceSource, number>;
  parity: ActionPackParityReport | null;
  /** Sources that returned nothing where data was expected (degraded/absent). */
  staleSources: EvidenceSource[];
  /** Legacy rows the unified brain does NOT yet represent (risky gaps). */
  suppressedLegacyRows: string[];
  /** Human-readable degradation/quarantine notices — fail visible. */
  warnings: string[];
};

/** Split a single action type into the family bucket the surfaces render. */
export function familyBucketOf(a: ActionType): keyof Omit<CanonicalFamilies, "ignoredNoise"> {
  switch (a) {
    case "create_new_page":
      return "newPages";
    case "create_hub":
      return "hubs";
    case "add_internal_links":
    case "consolidate_pages":
      return "internalLinks";
    case "fix_conversion_friction":
      return "experienceFixes";
    case "fix_title_meta_ctr":
      return "titleMetaFixes";
    case "add_answer_block":
      return "answerBlocks";
    case "edit_existing_page":
    default:
      return "existingPageFixes";
  }
}

async function loadUncached(tenantId: string, now: string): Promise<CanonicalWorklist> {
  const warnings: string[] = [];

  // Parity is fail-soft + time-boxed internally; never let it sink the worklist.
  const [wl, parity] = await Promise.all([
    loadActionPackWorklistForTenant(tenantId),
    loadActionPackParityForTenant(tenantId).catch((e): null => {
      log.warn("[canonical-worklist] parity failed", { tenantId, error: String(e) });
      warnings.push("Parity proof unavailable this load (read failed) — coverage shown without the legacy comparison.");
      return null;
    }),
  ]);

  const packs = wl.packs;

  const families: CanonicalFamilies = {
    existingPageFixes: [],
    newPages: [],
    hubs: [],
    internalLinks: [],
    experienceFixes: [],
    titleMetaFixes: [],
    answerBlocks: [],
    ignoredNoise: wl.summary.ignoredNoise,
  };
  for (const p of packs) families[familyBucketOf(p.actionType)].push(p);

  // staleSources: any evidence source with zero coverage is either not wired or
  // degraded for this tenant. We surface it rather than silently rendering empty.
  const staleSources = (Object.keys(wl.summary.sourceCoverage) as EvidenceSource[]).filter(
    (s) => wl.summary.sourceCoverage[s] === 0,
  );

  // Fail VISIBLE — an empty worklist is a loud warning, not a blank screen.
  if (packs.length === 0) {
    warnings.push("Canonical worklist is EMPTY — the demand graph and cached coverage both produced no packs. Check connector freshness / sync before trusting this.");
  }
  if (wl.summary.sourceCoverage.gsc === 0) {
    warnings.push("GSC backs zero packs — the demand spine looks degraded (no Search Console signal).");
  }
  if (isLegacyQuarantined("semrush")) warnings.push("SEMrush is QUARANTINED (legacy kill-switch on) — its signals are excluded from this worklist.");

  const suppressedLegacyRows = parity?.legacyOnlySamples ?? [];

  return {
    tenantId,
    generatedAt: now,
    packs,
    families,
    sourceCoverage: wl.summary.sourceCoverage,
    parity,
    staleSources,
    suppressedLegacyRows,
    warnings,
  };
}

/**
 * Request-memoized canonical worklist. `generatedAt` is injected by the caller
 * (server component / script) because `Date.now()`/`new Date()` are unavailable
 * in some execution contexts and must not break memoization.
 */
export const loadCanonicalWorklistForTenant = cache(
  (tenantId: string, generatedAtIso: string): Promise<CanonicalWorklist> => loadUncached(tenantId, generatedAtIso),
);
