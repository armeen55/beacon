/**
 * Runtime kernel - public facade.
 *
 * Owns operational plumbing: the visit-driven Research Run (schedule + durable
 * status), source refresh recording, the refresh-runs store, and free-surface
 * cache warming. This index is the ONLY surface `src/app` and `src/components`
 * may import for VALUE imports. Internal files stay private.
 */

// Visit-driven Research Run - schedule on visit + the durable Today status.
export { ensureResearchRunOnVisit } from "./ops/on-visit-refresh";
export { researchRunStatus, type ResearchRunStatusView } from "./research-run";

// Source refresh recording
export { recordSourceRefresh } from "./ops/record-source-refresh";

// Refresh-runs store (connector-sync history)
export {
  listRecentRefreshRuns,
  latestRefreshBySource,
  type RefreshRunRow,
  type RefreshSource,
} from "./ops/refresh-runs-store";

// Cache warming (used by the connectors "Update data" action + the publish phase)
export { warmFreeSurfaces } from "./ops/warm-caches";
