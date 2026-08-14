"use server";

import { revalidatePath } from "next/cache";

import { setResearchPaused } from "@/domains/runtime";
import { currentTenantId } from "@/lib/tenant-context";
import { log } from "@/lib/logger";

/**
 * Pause or resume this account's daily research (2026-08-02).
 *
 * The scheduler decides what runs each day; this is the operator's one switch over it. Pausing stops FUTURE
 * rounds only: nothing already gathered is touched, and resuming does not go back and fill in the days that
 * were skipped. The action never throws, so a failed press reports itself in the control instead of crashing
 * Settings. THE WRITE ANSWERS FOR ITSELF: setResearchPaused returns false rather than throwing whenever the
 * row did not match or the value did not read back, so a flat success here would flip the switch on screen
 * over a database that never took the request.
 */
export async function setResearchPausedNow(paused: boolean): Promise<{ ok: boolean }> {
  try {
    if (!(await setResearchPaused(await currentTenantId(), paused))) return { ok: false };
    revalidatePath("/settings");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    log.error("Action failed", { action: "setResearchPausedNow", paused, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
    return { ok: false };
  }
}
