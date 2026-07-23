/**
 * first-scan-dispatch — North-star onboarding (2026-06-11).
 *
 * Launch-time first scan: the moment a stranger launches, dispatch the
 * daily-scan workflow scoped to ONLY their tenant (`only_tenant` input,
 * added the same day) so their first crawl lands in minutes instead of
 * waiting for the next nightly (≤24h).
 *
 * Safety contract:
 *   - INERT without `BEACON_GH_WORKFLOW_DISPATCH_PAT` (the operator's
 *     fine-grained PAT, already on the WAITING list for the watchdog):
 *     returns `skipped_pat_not_configured`, never fetches.
 *   - The tenant-scoped dispatch runs in its OWN concurrency group —
 *     it can never cancel the nightly fleet run (workflow change pinned
 *     by tests/architecture/scheduled-scan-cron.test.ts).
 *   - Crawl-only: the scan workflow makes zero paid API calls.
 *   - Failure-soft: any error returns a structured outcome; the caller
 *     (launch flow) logs and moves on — a failed dispatch never blocks
 *     or rolls back a launch (the nightly picks the tenant up anyway).
 */

const DEFAULT_OWNER = "armeen55";
const DEFAULT_REPO = "beacon";
const DEFAULT_REF = "main";
const SCAN_WORKFLOW_FILE = "daily-scan.yml";

export type FirstScanDispatchOutcome =
  | { status: "dispatched"; httpStatus: 204 }
  | { status: "skipped_pat_not_configured" }
  | { status: "dispatch_failed"; httpStatus: number; error: string };

export async function dispatchFirstScanForTenant(
  tenantId: string,
  deps: {
    fetchImpl?: typeof fetch;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<FirstScanDispatchOutcome> {
  const env = deps.env ?? process.env;
  const pat = env.BEACON_GH_WORKFLOW_DISPATCH_PAT;
  if (!pat) return { status: "skipped_pat_not_configured" };

  const fetchImpl = deps.fetchImpl ?? fetch;
  const owner = env.BEACON_GH_REPO_OWNER ?? DEFAULT_OWNER;
  const repo = env.BEACON_GH_REPO_NAME ?? DEFAULT_REPO;
  const ref = env.BEACON_GH_WORKFLOW_REF ?? DEFAULT_REF;

  try {
    const res = await fetchImpl(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${SCAN_WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref, inputs: { only_tenant: tenantId } }),
      },
    );
    if (res.status === 204) return { status: "dispatched", httpStatus: 204 };
    const body = await res.text().catch(() => "");
    return {
      status: "dispatch_failed",
      httpStatus: res.status,
      error: body.slice(0, 500),
    };
  } catch (err) {
    return {
      status: "dispatch_failed",
      httpStatus: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
