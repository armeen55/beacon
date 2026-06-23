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
import {
  loadPageSurgeonContext,
  assemblePacketForUrl,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import type { PageAtomicDecision } from "@/domains/recommendation-intelligence/page-surgeon/page-decision";
import {
  generateSerpHypothesis,
  MAX_SERP_QUERIES,
  type SerpHypothesis,
} from "@/domains/recommendation-intelligence/page-surgeon/serp-hypothesis";
import { runPageSurgeonBrief } from "@/app/(shell)/diagnostics/page-surgeon/actions";
import { resolveCanonFromPath } from "./workbench-data";

export type DraftWithAiResult =
  | { ok: true; decision: PageAtomicDecision }
  | { ok: false; error: string };

export type ResolveSerpResult =
  | { ok: true; hypothesis: SerpHypothesis }
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

/**
 * TASK 2 — resolve "SERP unknown" for ONE locked Workbench page, ON DEMAND.
 * Generates a clearly-labeled SYNTHETIC SERP hypothesis (no live SERP fetch, no
 * paid API) over the page's top GSC queries (capped at MAX_SERP_QUERIES → one
 * bounded model call). Operator-gated; never publishes; the broad Opportunity
 * Map never calls this. Result is render-only for now (durable cache is a
 * documented follow-up); re-running re-spends one bounded call.
 */
export async function resolveSerpForWorkbenchPage(path: string): Promise<ResolveSerpResult> {
  if (!isOperatorModeServer()) {
    return { ok: false, error: "Operator only." };
  }
  const tenantId = await currentTenantId();
  let ctx;
  try {
    ctx = await loadPageSurgeonContext(tenantId);
  } catch {
    return { ok: false, error: "Couldn't load this page's data — try Refresh my data, then retry." };
  }
  const canon = resolveCanonFromPath(ctx, path);
  if (!canon) {
    return { ok: false, error: "No Search data for this page yet — run a website scan first." };
  }
  const packet = assemblePacketForUrl(ctx, canon);
  const topQueries = packet.gsc?.topQueries ?? [];
  if (topQueries.length === 0) {
    return {
      ok: false,
      error: "No Search queries for this page yet — connect or refresh Search Console first.",
    };
  }
  const queries = topQueries.slice(0, MAX_SERP_QUERIES).map((q) => ({
    query: q.query,
    position: q.position,
    impressions: q.impressions,
    ctr: q.ctr,
  }));
  // Generic page-type hint from the first path segment (no vertical hardcoding).
  const firstSeg = path.split("/").filter(Boolean)[0]?.replace(/-/g, " ") ?? null;
  const hyp = await generateSerpHypothesis({
    pagePath: path,
    pageType: firstSeg,
    currentTitle: packet.current.currentText ?? null,
    queries,
  });
  if (!hyp) {
    return {
      ok: false,
      error:
        "Couldn't generate a SERP hypothesis right now (model unavailable). You can still check the live SERP manually.",
    };
  }
  return { ok: true, hypothesis: { ...hyp, generatedAt: new Date().toISOString() } };
}
