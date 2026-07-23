import "server-only";
import { cache } from "react";

/**
 * lifecycle-counts-data (2026-07-02, FP3) - the ONE request-cached loader behind every
 * rendered lifecycle-stage count. Reads the canonical stores exactly once per request
 * (the proof ledger via the already-request-cached loadProofLedgerCached, and the
 * canonical Changes list for the backlog count) and runs the pure ONE-COUNT-RULE math
 * in src/domains/decision/changes/lifecycle-counts.ts.
 *
 * Consumers: Today (tiles + standup + measuring strip), the worklist Tonight chip,
 * and the Results header strip. Because loadProofLedgerCached and loadChangesView are
 * both react.cache()'d, calling this on a page that already loads them costs nothing
 * extra - the counts are computed from the SAME row objects those surfaces render.
 *
 * Fail-soft: any single store outage zeroes only its own counts, never throws into a
 * page render. The backlog read is deadline-bounded (it is the heaviest source; on
 * /changes it is free because the list itself already computed it this request).
 */
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedgerCached } from "@/domains/measurement";
import { computeLifecycleCounts, type LifecycleCounts } from "@/domains/decision";
import { loadChangesView } from "./changes-data";
import { valueWithDeadline } from "@/lib/load-with-deadline";

/** The backlog count is a nice-to-have on pages that don't render it (Today, Results);
 *  never let it hold the ledger/tonight counts hostage on a cold cache. Kept well
 *  under every caller's own outer deadline so a slow worklist build degrades ONLY
 *  toDo (to 0), never the measuring/decided/tonight numbers. On /changes the read
 *  is react.cache-shared with the list section itself, so it is usually instant,
 *  and a deadline here never cancels that shared computation. */
const BACKLOG_DEADLINE_MS = 3_500;

export const loadLifecycleCounts = cache(async (): Promise<LifecycleCounts> => {
  const tenantId = await currentTenantId();
  const [ledger, backlogToDo] = await Promise.all([
    loadProofLedgerCached(tenantId).catch(() => []),
    valueWithDeadline(
      loadChangesView().then((v) => v.summary.todo).catch(() => 0),
      0,
      BACKLOG_DEADLINE_MS,
    ),
  ]);
  // The daily-experiment plan was retired (Core 100K); tonight-picked/applied counts are gone, so
  // the plan inputs are null and lifecycle counts come from the proof ledger + backlog alone.
  return computeLifecycleCounts({ ledger, acceptedPlan: null, previewPlan: null, backlogToDo });
});
