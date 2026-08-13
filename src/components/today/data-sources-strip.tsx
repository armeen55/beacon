import {
  getConnectorHealth,
  type ConnectorProvider,
} from "@/lib/connector-store";
import { CONNECTOR_REGISTRY } from "@/lib/connectors/registry";

/**
 * Connected-data-source count (Phase 4D, 2026-07-21).
 *
 * The old "Your data sources" strip that rendered per-source health on Today was
 * removed: the connectors page (`/settings/connectors`) already shows every
 * source's health card AND a "Recent activity" list (recent-upkeep.tsx), so a
 * second freshness widget on Today was a redundant view of the same numbers.
 *
 * What survives is the ONE number the page header's "Update data" button needs:
 * how many read data sources are connected. Kept here (fail-soft, one read per
 * source in parallel) so the header and any future caller share a single derive.
 */

/**
 * The read sources, derived from the ONE connector registry (the same set
 * `REAL_DATA_SOURCE_PROVIDERS` uses to define a "real, non-demo" tenant), so this
 * count and the demo gate agree by construction. Every live connector reads.
 */
const DATA_SOURCES: readonly ConnectorProvider[] = CONNECTOR_REGISTRY.map((c) => c.id);

/**
 * UX4 item 6 - the header's "Update data" button reads this shared connected-source
 * count so it never disagrees with any other derive. The rule for what COUNTS is
 * decided once, on the health verdict itself (`countsAsConnected` in
 * connector-store): a stale-but-serving source counts, a source whose check
 * failed does not. Fail-soft per provider: a read error counts as not connected.
 */
export async function countConnectedDataSources(tenantId?: string): Promise<number> {
  const now = Date.now();
  const counted = await Promise.all(
    DATA_SOURCES.map(async (provider) => {
      try {
        return (await getConnectorHealth(provider, tenantId, now)).countsAsConnected;
      } catch {
        return false;
      }
    }),
  );
  return counted.filter(Boolean).length;
}
