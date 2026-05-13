/**
 * Today visibility read-model constants — client-safe.
 *
 * `visibility-read-model.ts` is marked `server-only` (the loader reads
 * Supabase + repo + seeds). The chart + visibility-group client need a
 * couple of small constants from the same conceptual module: the
 * All-Time window sentinel and the active-provider predicate. Putting
 * them in a separate file with no `server-only` marker keeps both
 * sides in lockstep without dragging server imports into the bundle.
 */

import { canonicalizePollPlatform } from "@/domains/observations/poll-platform-canonical";

/**
 * All-time sentinel. The chart's TimeRangeToggle uses this value to
 * mean "slice every available snapshot day". A single large finite
 * number flows through the existing window math without needing a
 * special case — `subtractDays(endDate, ALL_TIME_WINDOW - 1)` lands
 * far in the past; downstream iterators just yield whatever sampled
 * dates exist.
 */
export const ALL_TIME_WINDOW = 9999;

/**
 * Active-provider scope predicate. Delegates to
 * `canonicalizePollPlatform` (poll-health.ts:194) so the read model
 * and the chart both share the same source of truth: ChatGPT +
 * Perplexity today; "Google AI Overviews" is rejected as a
 * historical-only platform. If the active set expands (e.g. Claude
 * with web search), poll-health updates and both surfaces pick it up
 * automatically.
 */
export function isActiveSnapshotPlatform(platform: string): boolean {
  return canonicalizePollPlatform(platform) !== "unknown";
}
