/**
 * Runtime kernel — public facade.
 *
 * Owns operational plumbing: on-visit autonomous refresh scheduling, source
 * refresh recording, the refresh-runs store, and free-surface cache warming.
 * This index is the ONLY surface `src/app` and `src/components` may import for
 * VALUE imports. Internal files stay private.
 */

// On-visit autonomous refresh
export { scheduleAutonomousRefreshOnVisit } from "./ops/on-visit-refresh";

// Source refresh recording
export { recordSourceRefresh } from "./ops/record-source-refresh";

// Refresh-runs store
export {
  listRecentRefreshRuns,
  latestRefreshBySource,
  type RefreshRunRow,
  type RefreshSource,
} from "./ops/refresh-runs-store";

// Cache warming
export { warmFreeSurfaces } from "./ops/warm-caches";
