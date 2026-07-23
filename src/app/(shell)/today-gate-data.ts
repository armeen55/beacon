/**
 * Today gate loader (extracted verbatim 2026-07-21, CORE 100K Lane S,
 * from the retired today-v2-data.ts).
 *
 * Demo-mode + first-reading checks that decide whether `/` renders the
 * demo / waiting view INSTEAD of the live layout. The page awaits this
 * FIRST and short-circuits when needed, so every read here must stay
 * small and index-fast.
 */

import "server-only";

import { currentTenantId } from "@/lib/tenant-context";
import { hasActiveExperiment } from "@/lib/seed-data.server";
import { hasAnyConnectedDataSource } from "@/lib/connector-store";
import { getRepository } from "@/lib/persistence/repositories";

export type TodayV2GateData = {
  isDemoMode: boolean;
  firstReading: import("@/domains/account/onboarding/first-reading-state").FirstReadingDetection;
};

export async function loadTodayV2GateData(): Promise<TodayV2GateData> {
  // "Demo mode" (→ the connect-prompt) ONLY when the tenant has NO CSV import
  // AND no real data source connected. A GSC- (or GA4/SEMrush/Clarity/Profound/
  // Wix-) connected tenant is operating on its own live data, so it sees its
  // real command center — never the connect-prompt — even before its first CSV
  // import or first reading. Mirrors the shell's hasRealConnector gate
  // (layout.tsx) so the two never disagree. (2026-06-15 fix: GSC-connected
  // tenants were wrongly shown "Connect your data sources".)
  // These three reads are independent. This gate blocks Today's first useful
  // paint, so serializing them made a slow connector lookup wait behind the
  // import check before the narrow tenant data reads could even start.
  const [activeExperiment, connectedDataSource, tenantId] = await Promise.all([
    hasActiveExperiment(),
    hasAnyConnectedDataSource(),
    currentTenantId(),
  ]);
  const isDemoMode = !activeExperiment && !connectedDataSource;
  // Phase 1 (2026-05-12): the gate used to call `loadCachedFreshCanonical`
  // (60d obs pull) just to inspect observationCount > 0 and active prompt
  // count. Now we read a narrow 7d obs window + tracked_prompts directly
  // from the tenant repo — both ~indexed, tenant-scoped, small reads.
  //
  // Inference rules are unchanged:
  //   - any observation in the last 7d → definitely not first reading
  //   - no active prompts at all → not first reading (no work pending)
  //   - else (active prompts but no recent obs) → cold-tenant path
  let observationCount = 0;
  let activePromptCount = 0;
  try {
    const repo = getRepository().forTenant(tenantId);
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [recentObs, prompts] = await Promise.all([
      // observationCount only feeds `observationCount > 0` below — we never
      // read the row bodies here, so project the lean `observed_at` column.
      // The full-row pull dragged the heavy `metadata` JSONB across the wire
      // and statement-timed-out for a data-rich tenant; since this gate is
      // awaited FIRST (before any section streams), that timeout hung the
      // whole V2 page. Lean projection keeps the gate index-fast.
      repo.getPromptAnswerObservations({ since, columns: "observed_at" }),
      repo.getTrackedPrompts(),
    ]);
    observationCount = recentObs.length;
    activePromptCount = prompts.filter((p) => p.is_active).length;
  } catch (err) {
    // Defensive: if anything throws (e.g. repo init error during cold
    // tenant context), short-circuit to "not first reading" — the
    // section streams will still render normally and the page won't
    // block on the gate.
    console.error("[today-v2] gate cheap reads failed:", err);
    return { isDemoMode, firstReading: { isFirstReading: false } };
  }

  if (observationCount > 0 || activePromptCount === 0) {
    return { isDemoMode, firstReading: { isFirstReading: false } };
  }
  // Cold-tenant path — need the tenant record to decide. Mirror the
  // resolveFirstReadingState fallback (returns false on any error).
  try {
    const { currentTenant } = await import("@/lib/tenant-context");
    const { detectFirstReadingState } = await import(
      "@/domains/account/onboarding/first-reading-state"
    );
    const tenant = await currentTenant();
    return {
      isDemoMode,
      firstReading: detectFirstReadingState({
        tenant,
        activePromptCount,
        observationCount,
      }),
    };
  } catch {
    return { isDemoMode, firstReading: { isFirstReading: false } };
  }
}
