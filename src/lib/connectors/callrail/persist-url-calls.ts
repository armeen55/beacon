import "server-only";

/**
 * 2026-06-09 — CallRail refresh + read (§9.B).
 *
 * `refreshCallRailCalls` (operator-triggered): fetch calls → group by
 * canonical URL + UTC day → upsert into `call_url_attribution`. Soft-fails
 * on missing table/Supabase.
 *
 * `loadQualifiedCallCountForUrl` (read side): sum qualified calls for one
 * canonical URL since a date — the value the Mode A feed swaps in for the
 * hardcoded `qualifiedCallCount: 0`. Soft-fails to 0 so that with NO
 * CallRail connected the outcome surfaces are byte-identical to today.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { updateConnectorToken } from "@/lib/connector-store";
import { log } from "@/lib/logger";
import { callrailFetchCalls, type CallRailFetchDeps } from "./client";
import { groupCallsByUrlDay } from "./calls-by-url";
import type { CallRailQualifiedRule } from "./types";

const TABLE = "call_url_attribution";

export type RefreshCallRailResult =
  | { ok: true; rowsUpserted: number; persisted: boolean }
  | { ok: false; reason: "no_key" | "disconnected" | "api_error" | "empty"; detail?: string };

export async function refreshCallRailCalls(
  args: {
    tenantId: string;
    startDate?: string;
    endDate?: string;
    rule?: CallRailQualifiedRule;
    now?: Date;
  },
  deps: CallRailFetchDeps = {},
): Promise<RefreshCallRailResult> {
  const now = args.now ?? new Date();
  const res = await callrailFetchCalls(
    { tenantId: args.tenantId, startDate: args.startDate, endDate: args.endDate },
    deps,
  );
  if (!res.ok) return { ok: false, reason: res.reason, detail: res.detail };

  const rows = groupCallsByUrlDay(res.calls, args.rule);
  if (rows.length === 0) {
    // Connected + reachable but nothing to attribute yet — not an error.
    try {
      await updateConnectorToken(
        "callrail",
        { last_synced_at: now.toISOString() },
        args.tenantId,
      );
    } catch {
      /* best-effort */
    }
    return { ok: true, rowsUpserted: 0, persisted: false };
  }

  const persisted = await upsertRows(args.tenantId, rows, now);
  try {
    await updateConnectorToken(
      "callrail",
      { last_synced_at: now.toISOString() },
      args.tenantId,
    );
  } catch {
    /* best-effort */
  }
  // audit wave-2 #6 (2026-06-14): rowsUpserted must reflect REALITY — when
  // the Supabase write failed (persisted=false) the old code still reported
  // rowsUpserted=rows.length, so the operator's diagnostic showed "N calls
  // synced" on a write that wrote nothing. `ok` stays true (the CallRail
  // FETCH succeeded); `persisted=false` is the write-failure signal the
  // caller surfaces, and upsertRows now logs WHY.
  return { ok: true, rowsUpserted: persisted ? rows.length : 0, persisted };
}

async function upsertRows(
  tenantId: string,
  rows: ReadonlyArray<{ url: string; date: string; qualifiedCalls: number; totalCalls: number }>,
  now: Date,
): Promise<boolean> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return false;
  }
  const payload = rows.map((r) => ({
    tenant_id: tenantId,
    url: r.url,
    date: r.date,
    qualified_calls: r.qualifiedCalls,
    total_calls: r.totalCalls,
    last_synced_at: now.toISOString(),
    updated_at: now.toISOString(),
  }));
  const { error } = await admin
    .from(TABLE)
    .upsert(payload, { onConflict: "tenant_id,url,date" });
  if (error != null) {
    // audit wave-2 #6: never swallow a write failure silently.
    log.warn("[callrail] call_url_attribution upsert failed", {
      tenantId,
      rows: payload.length,
      error: error.message,
    });
    return false;
  }
  return true;
}

/**
 * Sum qualified calls for ONE canonical URL on/after `sinceUtcDate`
 * (YYYY-MM-DD). Soft-fails to 0 (no Supabase / no table / no rows) so
 * the Mode A feed degrades to today's behavior when CallRail is absent.
 * Matches the canonical URL and its trailing-slash variant (mirrors the
 * Mode A GA4 URL-scoped read).
 */
export async function loadQualifiedCallCountForUrl(args: {
  tenantId: string;
  canonicalUrl: string;
  sinceUtcDate: string;
}): Promise<number> {
  if (args.canonicalUrl === "") return 0;
  // Soft-fail read: ANY problem (no Supabase, missing table, unexpected
  // query-builder shape, malformed response) → 0, never a throw. With
  // CallRail unconnected this keeps the Mode A surfaces byte-identical.
  try {
    const admin = getSupabaseAdmin();
    const variants = [args.canonicalUrl, `${args.canonicalUrl}/`];
    const { data, error } = await admin
      .from(TABLE)
      .select("qualified_calls,url,date")
      .eq("tenant_id", args.tenantId)
      .in("url", variants)
      .gte("date", args.sinceUtcDate);
    if (error != null || !Array.isArray(data)) return 0;
    let n = 0;
    for (const row of data as Array<{ qualified_calls?: number }>) {
      if (typeof row.qualified_calls === "number") n += row.qualified_calls;
    }
    return n;
  } catch {
    return 0;
  }
}

export type CallAttributionRow = {
  url: string;
  date: string;
  qualifiedCalls: number;
  totalCalls: number;
};

/**
 * Most-recent attributed call rows for a tenant (operator diagnostic view
 * only). Soft-fails to [] (no Supabase / no table / no rows) so the
 * CallRail surface renders an empty state rather than crashing.
 */
export async function loadRecentCallAttribution(
  tenantId: string,
  limit = 50,
): Promise<CallAttributionRow[]> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from(TABLE)
      .select("url,date,qualified_calls,total_calls")
      .eq("tenant_id", tenantId)
      .order("date", { ascending: false })
      .limit(limit);
    if (error != null || !Array.isArray(data)) return [];
    const rows: CallAttributionRow[] = [];
    for (const row of data as Array<Record<string, unknown>>) {
      const url = typeof row.url === "string" ? row.url : null;
      const date = typeof row.date === "string" ? row.date : null;
      if (url == null || date == null) continue;
      rows.push({
        url,
        date,
        qualifiedCalls:
          typeof row.qualified_calls === "number" ? row.qualified_calls : 0,
        totalCalls:
          typeof row.total_calls === "number" ? row.total_calls : 0,
      });
    }
    return rows;
  } catch {
    return [];
  }
}
