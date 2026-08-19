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
import { readAiObservations } from "@/domains/evidence";
import { PROMPT_TAGS } from "@/domains/runtime";

type TodayV2GateData = {
  isDemoMode: boolean;
  firstReading: import("@/domains/account/onboarding/first-reading-state").FirstReadingDetection;
  /** TRUE when the reads that decide the two answers above could not be taken. Not being able to look is not
   *  proof the account is empty, so Today says it is having trouble rather than sending them to connect. */
  unreadable?: boolean;
};

export async function loadTodayV2GateData(): Promise<TodayV2GateData> {
  // "Demo mode" (→ the connect-prompt) ONLY when the tenant has NO CSV import
  // AND no real data source connected. A GSC- (or GA4/Clarity-) connected
  // tenant is operating on its own live data, so it sees its real command
  // center — never the connect-prompt — even before its first CSV import or
  // first reading. Mirrors the shell's hasRealConnector gate
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
  // CONNECTING GOOGLE IS NOT THE PRICE OF ENTRY. An account with approved questions and research Beacon paid
  // for was sent to the connect prompt purely for connecting nothing. "Demo" now means it holds nothing.
  const noOwnSource = !activeExperiment && !connectedDataSource;
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
    const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
    const [recentObs, prompts] = await Promise.all([
      // observationCount only feeds `observationCount > 0` below, so ONE lean stamp row off the canonical
      // ai_observations store answers it. The legacy prompt_answer_observations projection this used to count
      // was a parallel copy of the same answers and is deleted (2026-08-19): one AI record, one gate read.
      readAiObservations(tenantId, { fromDay: day(Date.now() - 7 * 86_400_000), toDay: day(Date.now()), limit: 1, projection: "stamp" }).catch(() => []),
      repo.getTrackedPrompts(),
    ]);
    observationCount = recentObs.length;
    // Count ONLY the rows research actually checks (active AND core-tagged). A
    // legacy seed row is active but invisible to the funnel, so counting it made
    // this gate claim questions were tracked while research had nothing to do.
    activePromptCount = prompts.filter(
      (p) => p.is_active && (p.tags as string[] | null)?.includes(PROMPT_TAGS.core),
    ).length;
  } catch (err) {
    // A READ I COULD NOT TAKE IS NOT AN EMPTY ACCOUNT: the connector answer alone sent a connector-free
    // account to the connect prompt on a transient blip, the one screen that tells them they have nothing.
    console.error("[today-v2] gate cheap reads failed:", err);
    return { isDemoMode: false, unreadable: true, firstReading: { isFirstReading: false } };
  }
  // Questions this account approved, or a reading already taken, are its own data whoever paid for it.
  const isDemoMode = noOwnSource && activePromptCount === 0 && observationCount === 0;

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
