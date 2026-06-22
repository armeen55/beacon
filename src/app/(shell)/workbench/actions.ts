"use server";

/**
 * Workbench server actions (#6, 2026-06-22) — "Draft with AI".
 *
 * Runs the Page Surgeon LLM judge ON DEMAND for the locked page: it assembles
 * the same evidence packet the Workbench renders, then calls the analysis model
 * to draft the exact change (title/meta/answer-block/etc.) with reasoning. The
 * heavy `runPageSurgeonBrief` already gates to operators, caches by evidence
 * hash (so re-clicking the same unchanged page doesn't re-spend), and falls
 * SOFT to the deterministic decision when there's no OPENAI_API_KEY. This is
 * the only place the Workbench spends the model; it NEVER publishes.
 */

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadPageSurgeonContext } from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import type { PageAtomicDecision } from "@/domains/recommendation-intelligence/page-surgeon/page-decision";
import { runPageSurgeonBrief } from "@/app/(shell)/diagnostics/page-surgeon/actions";
import { resolveCanonFromPath } from "./workbench-data";

export type DraftWithAiResult =
  | { ok: true; decision: PageAtomicDecision }
  | { ok: false; error: string };

/**
 * Draft (or re-draft) the change plan for a Workbench page with the analysis
 * model. `path` is the same normalized page path the Workbench route uses, so
 * the packet matches exactly what the operator is looking at.
 */
export async function draftWorkbenchPageWithAi(path: string): Promise<DraftWithAiResult> {
  if (!isOperatorModeServer()) {
    return { ok: false, error: "Operator only." };
  }
  const tenantId = await currentTenantId();
  let ctx;
  try {
    ctx = await loadPageSurgeonContext(tenantId);
  } catch {
    return {
      ok: false,
      error: "Couldn't load this page's data — try Refresh my data, then retry.",
    };
  }
  const canon = resolveCanonFromPath(ctx, path);
  if (!canon) {
    return {
      ok: false,
      error: "No crawl or Search data for this page yet — run a website scan first.",
    };
  }
  // runPageSurgeonBrief: operator-gated + evidence-hash cached + LLM judge with
  // a deterministic fallback. Reused verbatim so the Workbench and the
  // Page-Surgeon diagnostics surface produce the identical brief for a page.
  return runPageSurgeonBrief(canon);
}
