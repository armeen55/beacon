"use server";

import { revalidatePath } from "next/cache";
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
  const normalized = entries.map((e) =>
    ensureConfiguredCompetitorId({
      ...e,
      display_name: e.display_name?.trim() ?? "",
      domain: e.domain?.trim() ?? "",
      status: e.status === "inactive" ? "inactive" : "active",
    })
  );
  const r = saveCompetitorUniverseToDisk(normalized, new Date().toISOString());
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/competitors");
  revalidatePath("/");
  revalidatePath("/settings/history");
  revalidatePath("/competitors");
  revalidatePath("/observations", "layout");
  return { ok: true, universe_version: r.universe_version };
}
