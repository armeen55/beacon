import "server-only";

import { runSingleFlight } from "@/lib/single-flight";
import { runWithTenant } from "@/lib/tenant-context";
import { rebuildChangesSurface } from "./changes-data";
import { refreshWorklistSurface } from "./moves/moves-data";
import { buildTodayCompositeFromChanges } from "./today-view-data";
import { buildNewPagesData } from "./today-newpages-data";
import { writeTodaySurface } from "./today-surface-store";
import { writeCustomerSurface, type CustomerSurface } from "./customer-surface-store";

/** Build all core customer state first, publish the one versioned release last. */
export async function refreshCustomerSurface(tenantId: string): Promise<CustomerSurface> {
  return runSingleFlight(`customer-surface:${tenantId}`, async () => runWithTenant(tenantId, async () => {
    // Prepared packs hydrate onto TodayMove inside the worklist builder. Refresh
    // that dependency first or a newly drafted top-five pack would not become
    // Ready in the release we are about to publish.
    await refreshWorklistSurface(tenantId);
    const changes = await rebuildChangesSurface(tenantId);
    const [today, newPages] = await Promise.all([
      buildTodayCompositeFromChanges(changes),
      buildNewPagesData(tenantId).catch(() => null),
    ]);
    const computedAt = new Date().toISOString();
    const releaseId = `${tenantId}:${computedAt}`;
    const surface: CustomerSurface = {
      schemaVersion: 1,
      releaseId,
      computedAt,
      tenantId,
      changes,
      today: { ...today, surfaceVersion: releaseId, surfaceComputedAt: computedAt },
      newPages,
    };
    // Keep the legacy Today snapshot warm for callers outside the customer path,
    // then atomically publish the shared release consumed by Today + Changes.
    await writeTodaySurface(surface.today, computedAt, tenantId);
    await writeCustomerSurface(surface);
    return surface;
  }));
}
