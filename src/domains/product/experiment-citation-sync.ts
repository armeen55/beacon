/**
 * Post-import experiment citation sync — updates active experiments with
 * current citation counts from the citation evidence index and persists
 * changes. Previously ran during Today's server render (Phase 1C-2 moved it).
 */

import "server-only";

import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import {
  getActiveExperiments,
  updateExperimentCitations,
  persistExperiments,
} from "@/domains/product/experiment-store";

/**
 * For each active experiment with a `targetPageUrl`, look up the latest
 * citation count from the citation evidence index. If the count differs
 * from the stored value, update the experiment and persist.
 */
export async function runExperimentCitationSync(): Promise<{
  updated: number;
  total: number;
}> {
  const citMap = new Map<string, number>();
  if (citationEvidenceIndex) {
    for (const r of citationEvidenceIndex.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
    }
  }

  const activeExperiments = getActiveExperiments();
  let changed = false;
  let updated = 0;

  for (const exp of activeExperiments) {
    if (!exp.targetPageUrl) continue;
    const normUrl = exp.targetPageUrl.replace(/\/+$/, "").toLowerCase();
    const currentCit = citMap.get(normUrl) ?? 0;
    if (currentCit !== exp.latestCitations) {
      updateExperimentCitations(exp.id, currentCit);
      changed = true;
      updated++;
    }
  }

  if (changed) {
    await persistExperiments();
  }

  return { updated, total: activeExperiments.length };
}
