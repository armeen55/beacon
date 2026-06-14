import "server-only";

/**
 * 2026-06-09 — Semrush domain-metrics refresh + persistence.
 *
 * Operator-triggered: fetches the domain overview + organic competitors
 * for a domain and upserts a snapshot into `semrush_domain_metrics`
 * (migration 2026-06-09). Lets a week-limited Semrush key yield durable
 * data. Soft-fails on a missing table (42P01) + missing Supabase env so
 * the pre-migration / no-Supabase windows are harmless.
 *
 * Fetch order is unit-frugal: the 1-line `domain_ranks` overview runs
 * first; if Semrush isn't connected (no_key/disconnected) we bail before
 * spending competitor units. `deps` are test seams (no network, no key).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { updateConnectorToken } from "@/lib/connector-store";
import { log } from "@/lib/logger";
import {
  fetchDomainOverview,
  fetchOrganicCompetitors,
} from "./domain-reports";
import type { SemrushRawFetchDeps } from "./client";
import type { SemrushDomainMetricsSnapshot } from "./types";

const TABLE = "semrush_domain_metrics";

export type RefreshSemrushResult =
  | { ok: true; snapshot: SemrushDomainMetricsSnapshot; persisted: boolean }
  | {
      ok: false;
      reason: "no_key" | "disconnected" | "api_error" | "empty";
      detail?: string;
    };

function isUndefinedTableError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown };
  return typeof e.code === "string" && e.code === "42P01";
}

export async function refreshSemrushDomainMetrics(
  args: {
    tenantId: string;
    domain: string;
    database?: string;
    competitorLimit?: number;
    now?: Date;
  },
  deps: SemrushRawFetchDeps = {},
): Promise<RefreshSemrushResult> {
  const now = args.now ?? new Date();

  // Overview first (1 unit-line). A connection-level failure short-
  // circuits before we spend competitor units.
  const overviewRes = await fetchDomainOverview(
    { tenantId: args.tenantId, domain: args.domain, database: args.database },
    deps,
  );
  if (
    !overviewRes.ok &&
    (overviewRes.reason === "no_key" || overviewRes.reason === "disconnected")
  ) {
    return { ok: false, reason: overviewRes.reason, detail: overviewRes.detail };
  }
  const overview = overviewRes.ok ? overviewRes.rows[0]! : null;

  const compRes = await fetchOrganicCompetitors(
    {
      tenantId: args.tenantId,
      domain: args.domain,
      database: args.database,
      limit: args.competitorLimit,
    },
    deps,
  );
  const organicCompetitors = compRes.ok ? compRes.rows : [];

  // Nothing usable came back at all → surface the most specific reason.
  if (overview == null && organicCompetitors.length === 0) {
    const reason =
      !overviewRes.ok && overviewRes.reason === "api_error"
        ? "api_error"
        : "empty";
    return { ok: false, reason };
  }

  const snapshot: SemrushDomainMetricsSnapshot = {
    tenant_id: args.tenantId,
    domain: args.domain,
    database: args.database ?? overview?.database ?? "us",
    fetched_at: now.toISOString(),
    overview,
    organic_competitors: organicCompetitors,
  };

  const persisted = await upsertSnapshot(snapshot, now);
  // Bump the token's last_synced_at (no-op if no real token, e.g. tests).
  try {
    await updateConnectorToken("semrush", { last_synced_at: now.toISOString() }, args.tenantId);
  } catch {
    /* token update is best-effort; never fail the refresh on it */
  }

  return { ok: true, snapshot, persisted };
}

async function upsertSnapshot(
  snapshot: SemrushDomainMetricsSnapshot,
  now: Date,
): Promise<boolean> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return false; // Supabase not configured in this environment.
  }
  const { error } = await admin.from(TABLE).upsert(
    {
      tenant_id: snapshot.tenant_id,
      domain: snapshot.domain,
      database: snapshot.database,
      fetched_at: snapshot.fetched_at,
      overview: snapshot.overview,
      organic_competitors: snapshot.organic_competitors,
      last_synced_at: now.toISOString(),
      updated_at: now.toISOString(),
    },
    { onConflict: "tenant_id,domain" },
  );
  if (error != null) {
    // audit wave-2 #9 (2026-06-14): don't swallow the write failure
    // silently — the caller returns ok:true with persisted=false, so
    // without this line a failed snapshot write left NO trace anywhere
    // (the keyword-gap trigger then reads a stale/absent competitor seed
    // with no clue why). 42P01 (pre-migration) is expected/benign but
    // still worth a one-line breadcrumb.
    log.warn("[semrush-domain-metrics] snapshot upsert failed", {
      tenantId: snapshot.tenant_id,
      domain: snapshot.domain,
      error: error.message,
    });
    return false;
  }
  return true;
}

/**
 * Read the cached snapshot for a domain. Soft-fails to null on missing
 * Supabase / missing table / no row.
 */
export async function loadSemrushDomainMetrics(
  tenantId: string,
  domain: string,
): Promise<SemrushDomainMetricsSnapshot | null> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return null;
  }
  const { data, error } = await admin
    .from(TABLE)
    .select("tenant_id,domain,database,fetched_at,overview,organic_competitors")
    .eq("tenant_id", tenantId)
    .eq("domain", domain)
    .maybeSingle();
  if (error != null) {
    if (isUndefinedTableError(error)) return null;
    return null;
  }
  if (data == null) return null;
  const row = data as Record<string, unknown>;
  return {
    tenant_id: String(row.tenant_id ?? tenantId),
    domain: String(row.domain ?? domain),
    database: String(row.database ?? "us"),
    fetched_at: String(row.fetched_at ?? ""),
    overview:
      (row.overview as SemrushDomainMetricsSnapshot["overview"]) ?? null,
    organic_competitors:
      (row.organic_competitors as SemrushDomainMetricsSnapshot["organic_competitors"]) ??
      [],
  };
}
