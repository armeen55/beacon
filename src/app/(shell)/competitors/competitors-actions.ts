"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  saveCompetitorUniverseToDisk,
  ensureConfiguredCompetitorId,
} from "@/domains/competitors/universe-write";
import type { ConfiguredCompetitorEntry } from "@/domains/competitors/universe-types";

export async function saveConfiguredCompetitorUniverseAction(
  entries: ConfiguredCompetitorEntry[]
): Promise<
  | { ok: true; universe_version: number }
  | { ok: false; error: string }
> {
  const action = "saveConfiguredCompetitorUniverseAction";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { entryCount: entries.length },
  });
  const normalized = entries.map((e) =>
    ensureConfiguredCompetitorId({
      ...e,
      display_name: e.display_name?.trim() ?? "",
      domain: e.domain?.trim() ?? "",
      status: e.status === "inactive" ? "inactive" : "active",
    })
  );
  const r = saveCompetitorUniverseToDisk(normalized, new Date().toISOString());
  if (!r.ok) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: String(r.error).slice(0, 500),
    });
    return { ok: false, error: r.error };
  }
  revalidatePath("/competitors");
  revalidatePath("/");
  revalidatePath("/settings/history");
  revalidatePath("/competitors");
  revalidatePath("/observations", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { ok: true, universe_version: r.universe_version };
}
