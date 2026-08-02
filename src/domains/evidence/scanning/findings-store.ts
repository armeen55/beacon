import "server-only";

import { readStore } from "@/lib/persistence/json-store";
import type { Finding } from "./types";
import { FINDING_PRIORITY_ORDER } from "./types";

const STORE_NAME = "scan-findings";

function migrateOldFinding(f: Finding): Finding {
  return {
    ...f,
    priority: f.priority ?? "minor",
    priorityScore: f.priorityScore ?? 0,
    promotionStatus: f.promotionStatus ?? "none",
    resolutionNote: f.resolutionNote ?? null,
    suppressUntil: f.suppressUntil ?? null,
    citationCount: f.citationCount ?? 0,
    isHomepage: f.isHomepage ?? false,
    contradictsChangelog: f.contradictsChangelog ?? false,
  };
}

export async function getFindings(): Promise<Finding[]> {
  return (await readStore<Finding>(STORE_NAME)).map(migrateOldFinding);
}

export async function getPendingFindings(): Promise<Finding[]> {
  return (await getFindings())
    .filter((f) => f.status === "pending")
    .sort((a, b) => {
      const po = (FINDING_PRIORITY_ORDER[a.priority] ?? 3) - (FINDING_PRIORITY_ORDER[b.priority] ?? 3);
      if (po !== 0) return po;
      return b.priorityScore - a.priorityScore;
    });
}

// ---------------------------------------------------------------------------
// Phase 11: Signal quality enrichment
// ---------------------------------------------------------------------------

