import "server-only";

/**
 * warm-caches - the surface-release warm build.
 *
 * The one job here: rebuild the shared demand-graph snapshot, then rebuild and
 * publish the Today + Changes surface release, so the first render after fresh
 * data is instant AND complete. Zero business logic lives here (composition
 * only): each step calls the EXISTING loader/builder.
 *
 * Why it exists (2026-07-08): the manual "Update data" refresh pulls fresh data
 * and then repaints via `revalidatePath("/")`. Without this, that repaint pays
 * the full ~6s cold demand-graph build right when the operator is watching, and
 * the deadline-raced Today sections fall back to "here on your next visit".
 * Warming here (build-then-write always rebuilds from the just-pulled data) makes
 * the post-refresh repaint instant and complete.
 *
 * Money posture: the graph/changes/today loaders are cached/durable reads only
 * ($0). Fail-soft per step: a failed build keeps the previous snapshot.
 */

/**
 * refreshCustomerSurface runs the decision-kernel fuse-then-compose and
 * publishes the shared Today + Changes release in a single pass.
 */
async function refreshSurface(tenantId: string): Promise<void> {
  const { refreshCustomerSurface } = await import("@/app/(shell)/surface-release");
  await refreshCustomerSurface(tenantId);
}

/**
 * Rebuild the fused Today + Changes surface release, fail-soft. Safe to call
 * synchronously from a request-context server action.
 */
export async function warmFreeSurfaces(tenantId: string): Promise<void> {
  await refreshSurface(tenantId).catch(() => {});
}
