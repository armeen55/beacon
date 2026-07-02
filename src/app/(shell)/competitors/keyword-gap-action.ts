"use server";

import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { produceKeywordGaps } from "@/domains/serp/keyword-gap-producer";

/**
 * findCompetitorKeywordGapsAction (2026-07-02, master plan item 16) - the operator
 * trigger behind "Find what competitors rank for". Operator-gated; fires only on
 * an explicit click; the bounded batch + full money gauntlet (30d cache, dry-run
 * default, shared monthly cap fail-closed) live inside produceKeywordGaps. Returns
 * an honest receipt with the real spend. NO cron wiring.
 */
export type KeywordGapActionResponse =
  | { ok: false; reason: string }
  | {
      ok: true;
      status: "ok" | "dry_run" | "disabled" | "capped" | "no_competitors" | "error";
      message: string;
      gapsFound: number;
      spentUsd: number;
      competitors: string[];
    };

export async function findCompetitorKeywordGapsAction(): Promise<KeywordGapActionResponse> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator only." };
  const tenantId = await currentTenantId();
  const r = await produceKeywordGaps(tenantId);
  if (r.status === "ok") {
    // New gaps feed the New Pages board (Today + /worklist) and this page.
    revalidatePath("/competitors");
    revalidatePath("/worklist");
    revalidatePath("/");
  }
  return {
    ok: true,
    status: r.status,
    message: r.message,
    gapsFound: r.gapsFound,
    spentUsd: r.spentUsd,
    competitors: r.competitors,
  };
}
