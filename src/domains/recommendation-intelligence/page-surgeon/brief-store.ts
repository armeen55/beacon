/**
 * Page Surgeon brief cache (server-only). One row per (tenant, page) keyed by
 * an evidence hash so a reload / re-run with UNCHANGED evidence never spends
 * OpenAI again. service-role client (bypasses RLS); operator-substrate only.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import type { PageAtomicDecision } from "./page-decision";

export type CachedBrief = {
  evidence_hash: string;
  decision: PageAtomicDecision;
  created_at: string;
};

/** All cached briefs for a tenant, keyed by page_url. Fail-soft → empty map. */
export async function getCachedBriefs(
  tenantId: string,
): Promise<Map<string, CachedBrief>> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_surgeon_briefs")
      .select("page_url, evidence_hash, decision, created_at")
      .eq("tenant_id", tenantId);
    if (error || !data) return new Map();
    return new Map(
      data.map((r) => [
        r.page_url as string,
        {
          evidence_hash: r.evidence_hash as string,
          decision: r.decision as PageAtomicDecision,
          created_at: r.created_at as string,
        },
      ]),
    );
  } catch (e) {
    log.warn("[page-surgeon-store] read failed", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return new Map();
  }
}

export async function saveBrief(
  tenantId: string,
  pageUrl: string,
  evidenceHash: string,
  decision: PageAtomicDecision,
): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("page_surgeon_briefs").upsert(
      {
        tenant_id: tenantId,
        page_url: pageUrl,
        evidence_hash: evidenceHash,
        decision,
        decided_by: decision.decided_by,
        created_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,page_url" },
    );
    if (error) log.warn("[page-surgeon-store] save failed", { tenantId, pageUrl, error: error.message });
  } catch (e) {
    log.warn("[page-surgeon-store] save threw", {
      tenantId,
      pageUrl,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  // Append-only history (WL8): record each DISTINCT evidence state once so we can
  // show how a page's plan evolved. Separate fail-soft write — a history failure
  // (e.g. table not yet migrated) must never break the cache write above.
  await appendBriefHistory(tenantId, pageUrl, evidenceHash, decision);
}

export type BriefHistoryEntry = {
  evidence_hash: string;
  decision: PageAtomicDecision;
  headline_action: string;
  created_at: string;
};

async function appendBriefHistory(
  tenantId: string,
  pageUrl: string,
  evidenceHash: string,
  decision: PageAtomicDecision,
): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    // insert-ignore on the unique (tenant, page, evidence_hash): a re-run with the
    // same evidence is a no-op, keeping history one-row-per-distinct-evidence.
    const { error } = await sb
      .from("page_surgeon_brief_history")
      .upsert(
        {
          tenant_id: tenantId,
          page_url: pageUrl,
          evidence_hash: evidenceHash,
          decision,
          decided_by: decision.decided_by,
          headline_action: decision.recommended_atomic_action,
        },
        { onConflict: "tenant_id,page_url,evidence_hash", ignoreDuplicates: true },
      );
    if (error) log.warn("[page-surgeon-store] history append failed", { tenantId, pageUrl, error: error.message });
  } catch (e) {
    log.warn("[page-surgeon-store] history append threw", {
      tenantId,
      pageUrl,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Append-only change history for one page, newest first. Fail-soft → []. */
export async function getBriefHistory(
  tenantId: string,
  pageUrl: string,
  limit = 20,
): Promise<BriefHistoryEntry[]> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_surgeon_brief_history")
      .select("evidence_hash, decision, headline_action, created_at")
      .eq("tenant_id", tenantId)
      .eq("page_url", pageUrl)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((r) => ({
      evidence_hash: r.evidence_hash as string,
      decision: r.decision as PageAtomicDecision,
      headline_action: (r.headline_action as string) ?? "",
      created_at: r.created_at as string,
    }));
  } catch (e) {
    log.warn("[page-surgeon-store] history read failed", {
      tenantId,
      pageUrl,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}
