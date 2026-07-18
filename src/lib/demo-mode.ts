/**
 * Shared demo-data predicate.
 *
 * 2026-07-18: before this module, two call sites answered "is this
 * fabricated fixture content?" with two DIFFERENT rules:
 *   - seed-data.server.ts served the founder's hardcoded fixture rows
 *     (actual_value 18.5, invented opportunities/competitors/briefs)
 *     whenever import_runs was empty for the founder tenant, with NO
 *     check for a connected real source.
 *   - layout.tsx's "Sample data" banner hid itself the moment ANY real
 *     connector (Wix or GSC) was connected, regardless of whether
 *     fixtures were still rendering underneath.
 *
 * Production result: tenant-ritz-founder had GSC connected and zero
 * import runs, so it got the full fixture dataset AND no banner, a
 * customer looking at invented numbers presented as real, with nothing
 * telling them so.
 *
 * `shouldServeDemoData` is the single predicate both call sites now
 * share. Fixture data may render ONLY when this returns true, and the
 * "Sample data" banner may render ONLY when this returns true. A
 * connected real source means no fixture data, ever: the invariant is
 * "fixtures render => banner visible" and "no fixtures => no banner".
 */

import * as seed from "./seed-data";

/**
 * The seed (`./seed-data`) is the FOUNDER's demo dataset, every row is
 * `tenant_id: "tenant-ritz-founder"` (a builder). It may only be served
 * as the empty-state fallback for the tenant that OWNS it. Derived from
 * the seed itself so it tracks the data, not a hardcoded literal.
 *
 * Moved here (out of seed-data.server.ts) 2026-07-18 so the plain
 * `layout.tsx` server component and any test can import the constant
 * and the predicate without pulling in seed-data.server.ts's
 * "server-only" + repository/tenant-context dependency graph.
 */
export const SEED_OWNER_TENANT_ID: string =
  seed.changelogEntries[0]?.tenant_id ??
  seed.results[0]?.tenant_id ??
  "tenant-ritz-founder";

export type ShouldServeDemoDataParams = {
  /** The tenant being served for this request. */
  tenantId: string;
  /** Count of recorded import runs for this tenant (0 = never imported). */
  importRunsCount: number;
  /** True when a real data source (Wix, GSC, ...) is connected for this tenant. */
  hasRealConnector: boolean;
};

/**
 * True ONLY when the tenant is the seed owner (founder), has never
 * recorded an import run, AND has no real connector wired up. Every
 * other combination gets, and shows, the honest empty state, never
 * fabricated fixture numbers.
 */
export function shouldServeDemoData({
  tenantId,
  importRunsCount,
  hasRealConnector,
}: ShouldServeDemoDataParams): boolean {
  return (
    tenantId === SEED_OWNER_TENANT_ID &&
    importRunsCount === 0 &&
    !hasRealConnector
  );
}
