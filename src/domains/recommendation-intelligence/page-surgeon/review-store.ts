/**
 * Page Surgeon REVIEW-decision store (server-only). Persists the operator's
 * Approve / Needs-edit / Reject verdict on a page's composed plan, tied to the
 * evidence_hash reviewed. Append-only (full decision trail). PUBLISHING IS NOT
 * PART OF THIS MODULE — recording a verdict never pushes content live. Uses the
 * service-role client (bypasses RLS); operator-substrate only.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

export type ReviewVerdict = "approve" | "reject" | "needs_edit";
export type ReviewDecisionRow = {
  verdict: ReviewVerdict;
  evidence_hash: string;
  created_at: string;
  /** Operator's free-text feedback (esp. for "needs_edit" / reject reasons). */
  note: string | null;
};

/** Append one review verdict (+ optional note). Fail-soft → false (never throws). */
export async function recordReviewDecisionRow(
  tenantId: string,
  pageUrl: string,
  verdict: ReviewVerdict,
  evidenceHash: string,
  note?: string | null,
): Promise<boolean> {
  try {
    const sb = getSupabaseAdmin();
    const trimmed = (note ?? "").trim();
    const { error } = await sb.from("page_surgeon_review_decisions").insert({
      tenant_id: tenantId,
      page_url: pageUrl,
      verdict,
      evidence_hash: evidenceHash || null,
      note: trimmed.length > 0 ? trimmed.slice(0, 2000) : null,
    });
    if (error) {
      log.warn("[page-surgeon-review] record failed", { tenantId, pageUrl, error: error.message });
      return false;
    }
    return true;
  } catch (e) {
    log.warn("[page-surgeon-review] record threw", {
      tenantId,
      pageUrl,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/** Latest verdict per page for a tenant (for list badges). Fail-soft → empty. */
export async function getLatestReviewDecisions(
  tenantId: string,
  limit = 400,
): Promise<Map<string, ReviewDecisionRow>> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_surgeon_review_decisions")
      .select("page_url, verdict, evidence_hash, created_at, note")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return new Map();
    const latest = new Map<string, ReviewDecisionRow>();
    for (const r of data) {
      const pageUrl = r.page_url as string;
      if (latest.has(pageUrl)) continue; // first seen = newest (desc order)
      latest.set(pageUrl, {
        verdict: r.verdict as ReviewVerdict,
        evidence_hash: (r.evidence_hash as string) ?? "",
        created_at: r.created_at as string,
        note: (r.note as string | null) ?? null,
      });
    }
    return latest;
  } catch (e) {
    log.warn("[page-surgeon-review] read failed", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return new Map();
  }
}
