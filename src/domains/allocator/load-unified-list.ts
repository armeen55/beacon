import "server-only";

/**
 * load-unified-list (DREAM SITE V1, item D4 = N1, 2026-07-02) - the I/O boundary that fetches
 * the lanes buildCanonicalChanges() cannot see (D2 AEO gap verdicts, D3 SERP steal briefs,
 * undercovered keyword-library demand), fuses them with an already-built worklist CanonicalChange
 * list, and hands back ONE ranked CanonicalChange[] through unified-list.ts's pure normalize/
 * fuse/rank. READ-ONLY: every source here already exists, this file computes no new
 * recommendation and writes nothing.
 *
 * Takes the worklist's CanonicalChange[] as an INPUT (rather than rebuilding it) so there is
 * exactly one place in the codebase that assembles lane (a) - changes-data.ts's
 * loadChangesView(), the sole caller. That keeps the allocator from ever silently drifting from
 * what /changes's ActionPack pipeline already decided.
 *
 * Lanes fetched here:
 *   (b) D2 native AEO gap verdicts - native-teardown-runner.ts's loadGapVerdictsForTenant.
 *   (c) D3 SERP steal briefs - serp-steal-lane.ts's loadStealBriefsForTenant.
 *   (d) keyword-library gaps not already covered by (a)/(b)/(c) - research/keyword-library.ts's
 *       loadKeywordLibrary, filtered by selectKeywordLibraryGaps.
 *
 * Every lane is fail-soft so one source outage narrows the fused set, it never blanks the list.
 *
 * N2 EXTENSION (2026-07-02): lane (d) used only its own narrower per-query owner lookup
 * (`KeywordLibraryRow.ownerPage`), which missed cases the ownership registry (src/domains/
 * ownership/registry.ts) already resolves from GSC-rank or SERP-cluster evidence, so a
 * keyword-library row could pitch an already-owned topic as missing (e.g. "name iran").
 * This reads the SAME cached registry loader `load-graph.ts`/`prepare-create-page-verdicts.ts`
 * already use (`loadOwnershipRegistryForTenantCached`, React `cache()`-deduped - no new I/O
 * when another engine already loaded it this render) and hands it to
 * `normalizeKeywordLibraryEntryWithRegistry`, which reclassifies a registry-owned row to an
 * edit entry instead of dropping it. Fail-soft: a registry load failure falls back to `null`,
 * which the normalizer treats as a no-op superset (byte-identical to the un-extended lane).
 */
import type { CanonicalChange } from "@/domains/changes/canonical-change";
import { loadGapVerdictsForTenant } from "@/domains/demand-graph/native-teardown-runner";
import { loadStealBriefsForTenant } from "@/domains/serp/serp-steal-lane";
import { loadKeywordLibrary } from "@/domains/research/keyword-library";
import { loadOwnershipRegistryForTenantCached } from "@/domains/ownership/registry-loader";
import {
  normalizeWorklistEntry,
  normalizeGapVerdictEntry,
  normalizeStealBriefEntry,
  normalizeKeywordLibraryEntryWithRegistry,
  selectKeywordLibraryGaps,
  buildUnifiedList,
  unifiedEntryToCanonicalChange,
  mergeSourcesOntoChange,
  type UnifiedEntry,
} from "./unified-list";

export type UnifiedListResult = {
  changes: CanonicalChange[];
  laneCounts: Record<"worklist" | "aeo_gap" | "serp_steal" | "keyword_library", number>;
};

/**
 * Fuse an already-built worklist CanonicalChange[] with the D2/D3/keyword-library lanes, and
 * return ONE ranked CanonicalChange[] through the SAME shape /changes already renders (no new
 * UI needed - ChangesListClient reads CanonicalChange[] generically). "Skipped" rows are excluded
 * from ranking input (operator-dismissed, not a ranking signal) and appended back unranked at the
 * tail so the caller's total count stays honest.
 */
export async function fuseUnifiedList(tenantId: string, worklistChanges: readonly CanonicalChange[]): Promise<UnifiedListResult> {
  const [gapVerdicts, stealBriefs, keywordLibrary, ownershipRegistry] = await Promise.all([
    loadGapVerdictsForTenant(tenantId).catch(() => []),
    loadStealBriefsForTenant(tenantId).catch(() => []),
    loadKeywordLibrary().catch(() => ({ rows: [], volumeCoverage: 0, total: 0, bySource: {} as never })),
    loadOwnershipRegistryForTenantCached(tenantId).catch(() => null),
  ]);

  const worklistEntries = worklistChanges.filter((c) => c.status !== "skipped").map(normalizeWorklistEntry);
  const gapEntries = gapVerdicts.map((v) => normalizeGapVerdictEntry(tenantId, v)).filter((e): e is UnifiedEntry => e !== null);
  const stealEntries = stealBriefs.map((b) => normalizeStealBriefEntry(tenantId, b)).filter((e): e is UnifiedEntry => e !== null);

  // A page already carrying a worklist/AEO-gap/SERP-steal entry has real coverage; the
  // keyword-library lane exists to surface DEMAND WITH NO COVERAGE AT ALL, so it must not
  // duplicate a page the other three lanes already ranked.
  const alreadyCoveredPaths = new Set<string>(
    [...worklistEntries, ...gapEntries, ...stealEntries].map((e) => e.page).filter((p): p is string => !!p),
  );
  const keywordEntries = selectKeywordLibraryGaps(keywordLibrary.rows, alreadyCoveredPaths).map((r) =>
    normalizeKeywordLibraryEntryWithRegistry(tenantId, r, ownershipRegistry),
  );

  const unifiedEntries = buildUnifiedList([...worklistEntries, ...gapEntries, ...stealEntries, ...keywordEntries]);
  const skippedChanges = worklistChanges.filter((c) => c.status === "skipped");

  const changes: CanonicalChange[] = [
    ...unifiedEntries.map((e) => (e.sourceChange ? mergeSourcesOntoChange(e) : unifiedEntryToCanonicalChange(tenantId, e))),
    ...skippedChanges,
  ];

  return {
    changes,
    laneCounts: {
      worklist: worklistEntries.length,
      aeo_gap: gapEntries.length,
      serp_steal: stealEntries.length,
      keyword_library: keywordEntries.length,
    },
  };
}
