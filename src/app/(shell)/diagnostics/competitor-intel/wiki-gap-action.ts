"use server";

import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { produceWikiGaps } from "@/domains/wiki-gap/produce-wiki-gaps";

/**
 * findWikiGapsAction (2026-07-02, master plan item 23) - the operator trigger
 * behind "Check the Wikipedia pages AI prefers". Operator-gated; fires only on
 * an explicit click; the bounded batch (at most 20 Wikipedia lookups, free API,
 * 30-day cache) lives inside produceWikiGaps. Returns an honest receipt. NO
 * cron wiring.
 */
export type WikiGapActionResponse =
  | { ok: false; reason: string }
  | {
      ok: true;
      status: "ok" | "no_citations" | "error";
      message: string;
      articlesChecked: number;
      beatable: number;
    };

export async function findWikiGapsAction(): Promise<WikiGapActionResponse> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator only." };
  const tenantId = await currentTenantId();
  const r = await produceWikiGaps(tenantId);
  if (r.status === "ok") {
    // New gaps feed the New Pages board (Today + /changes), the AI questions
    // page's competitor section, and this diagnostic.
    revalidatePath("/diagnostics/competitor-intel");
    revalidatePath("/prompts");
    revalidatePath("/changes");
    revalidatePath("/");
  }
  return {
    ok: true,
    status: r.status,
    message: r.message,
    articlesChecked: r.articlesChecked,
    beatable: r.beatable,
  };
}
