/**
 * GSC connector READINESS — surfacing layer (2026-06-16, MAX_SEO_AEO Phase 4,
 * gaps #51/#52/#53/#54).
 *
 * The hard part — auto-resolving which property SHAPE the token owns
 * (URL-prefix `https://www.x.com/` vs domain `sc-domain:x.com`) — is already
 * solved in the SYNC path (`resolveProperty` → `gscListSites` →
 * `pickGscPropertyForDomain` in sync-search-analytics.ts / search-analytics.ts).
 * That resolution needs a LIVE Google token, so it can only run during a sync.
 *
 * This module is the READ-ONLY counterpart: it answers "is GSC actually ready,
 * and what is it pulling?" purely from what already persisted —
 *   • the connection/token state (connector-store, no HTTP), and
 *   • the synced rows in `gsc_daily_rows` (Supabase SELECT, tenant-scoped).
 *
 * NO live Google call, no new sync, no migration, no writes. The property it
 * reports is the one the LAST sync actually wrote rows under — derived from the
 * tenant's own data, never hardcoded. Fail-soft EVERYWHERE: a no-env / missing-
 * table / read error degrades to a coherent verdict (never throws), so a render
 * is never blocked.
 *
 * Coverage source — `gsc_daily_rows` (migration
 * 2026-06-12_gsc_search_analytics.sql):
 *   columns: tenant_id, property, date, page, query, clicks, impressions,
 *            ctr, position, is_final, pulled_at; PK (tenant_id, property, date,
 *            page, query).
 * We read `property`, `date`, and a row `count` for the tenant. When more than
 * one property has rows (e.g. a property-shape changed between syncs), we
 * report the one with the most RECENT data + that property's own row count.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getConnectorInfo } from "@/lib/connector-store";

/** The Supabase table the nightly GSC search-analytics rows land in. */
const GSC_DAILY_ROWS_TABLE = "gsc_daily_rows";

export type GscReadinessVerdict =
  | "ready"
  | "connected_no_data"
  | "not_connected"
  | "needs_reconnect";

export type GscReadiness = {
  verdict: GscReadinessVerdict;
  /** The GSC property data was synced UNDER — e.g. "sc-domain:iranopedia.com"
   *  or "https://www.iranopedia.com/". Null when nothing has synced yet. */
  property: string | null;
  /** Backfill window + total rows for the reported property. Null when no
   *  rows exist for the tenant. */
  coverage: { fromDate: string; toDate: string; rowCount: number } | null;
  /** The most recent synced date (YYYY-MM-DD), or null. Mirrors coverage.toDate
   *  when rows exist — surfaced separately so the presenter can compute
   *  freshness without re-deriving it. */
  lastDataDate: string | null;
  /** Whole days between `lastDataDate` and `now`. Null when there is no data. */
  freshnessDays: number | null;
};

function isUndefinedTableError(error: unknown): boolean {
  // PostgREST surfaces `code: "42P01"` on undefined_table — covers the deploy
  // window when code is live but the migration hasn't applied yet.
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown };
  return typeof e.code === "string" && e.code === "42P01";
}

/** Whole days (floored, never negative) between an ISO date and `now`. */
function daysSince(isoDate: string, now: Date): number {
  // Anchor the data date at Pacific-noon-ish UTC so a same-day comparison is
  // 0 rather than off-by-one from timezone. (GSC dates are Pacific.)
  const dataMs = Date.parse(isoDate + "T12:00:00Z");
  if (!Number.isFinite(dataMs)) return 0;
  const diff = now.getTime() - dataMs;
  if (diff <= 0) return 0;
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

type CoverageRead = {
  property: string;
  fromDate: string;
  toDate: string;
  rowCount: number;
} | null;

/**
 * Read the synced-row coverage for the tenant, tenant-scoped. Returns the
 * property with the MOST RECENT data (plus that property's row count + date
 * span), or null when there are no rows / no Supabase env / the table is
 * undefined. Fail-soft: any error → null (the caller maps that to a coherent
 * verdict, never throws).
 *
 * No aggregate RPC: we read (property, date) projected rows tenant-scoped and
 * fold them in memory — `count: "exact"` gives the total without pulling the
 * heavy metric columns. The (tenant_id, page, date desc) index keeps the
 * ordered read cheap.
 */
async function readCoverage(tenantId: string): Promise<CoverageRead> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    // No Supabase env configured (local dev) → treat as "no data yet".
    return null;
  }
  try {
    // Total row count for the tenant (HEAD-only; no rows transferred).
    const countRes = await admin
      .from(GSC_DAILY_ROWS_TABLE)
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (countRes.error != null) {
      if (isUndefinedTableError(countRes.error)) return null;
      return null;
    }
    const totalRows = countRes.count ?? 0;
    if (totalRows === 0) return null;

    // Per-property date span + per-property row count. We read the (property,
    // date) projection ordered by date desc and fold in memory: the first time
    // we see a property fixes its toDate (newest), and we keep extending its
    // fromDate. Bounded read — a tenant has a handful of properties at most.
    const spanRes = await admin
      .from(GSC_DAILY_ROWS_TABLE)
      .select("property,date")
      .eq("tenant_id", tenantId)
      .order("date", { ascending: false });
    if (spanRes.error != null) {
      if (isUndefinedTableError(spanRes.error)) return null;
      return null;
    }
    const rows = (spanRes.data ?? []) as Array<{
      property?: string;
      date?: string;
    }>;
    if (rows.length === 0) return null;

    // Fold per property: rows are date-desc, so the first row for a property is
    // its newest date; the last is its oldest. Track newest-overall to pick the
    // reported property.
    const byProperty = new Map<
      string,
      { toDate: string; fromDate: string; rowCount: number }
    >();
    for (const r of rows) {
      const property = typeof r.property === "string" ? r.property : "";
      const date = typeof r.date === "string" ? r.date.slice(0, 10) : "";
      if (property === "" || date === "") continue;
      const existing = byProperty.get(property);
      if (existing == null) {
        byProperty.set(property, {
          toDate: date,
          fromDate: date,
          rowCount: 1,
        });
      } else {
        // date-desc order → `date` here is <= existing.fromDate, so it only
        // ever extends fromDate backward.
        if (date < existing.fromDate) existing.fromDate = date;
        existing.rowCount += 1;
      }
    }
    if (byProperty.size === 0) return null;

    // Pick the property with the most recent data (newest toDate wins; ties
    // broken by higher row count for determinism).
    let picked: { property: string; toDate: string; fromDate: string; rowCount: number } | null =
      null;
    for (const [property, span] of byProperty) {
      if (
        picked == null ||
        span.toDate > picked.toDate ||
        (span.toDate === picked.toDate && span.rowCount > picked.rowCount)
      ) {
        picked = { property, ...span };
      }
    }
    if (picked == null) return null;

    // Prefer the exact total count for the SINGLE-property case (HEAD count is
    // the cheapest exact source); when multiple properties exist, the picked
    // property's own folded count is the honest number.
    const rowCount =
      byProperty.size === 1 ? totalRows : picked.rowCount;
    return {
      property: picked.property,
      fromDate: picked.fromDate,
      toDate: picked.toDate,
      rowCount,
    };
  } catch {
    return null;
  }
}

/**
 * Compose READ-ONLY GSC readiness for a tenant from the persisted token state
 * + synced rows. No live Google call. Fail-soft: any read failure degrades to
 * a coherent verdict (not_connected / connected_no_data), never throws.
 *
 * Verdict ladder (most-urgent / most-authoritative first):
 *   1. not_connected   — no token at all (or token store unreadable).
 *   2. needs_reconnect — connected but the last sync proved the grant is dead
 *                        (`auth_failed_at` set — the only authoritative
 *                        reconnect signal; an hourly `expires_at` is NOT, the
 *                        next refresh heals it).
 *   3. connected_no_data — connected + healthy, but zero synced rows yet.
 *   4. ready           — connected + healthy + has synced data.
 */
export async function loadGscReadiness(
  tenantId: string,
  now: Date = new Date(),
): Promise<GscReadiness> {
  const empty: Omit<GscReadiness, "verdict"> = {
    property: null,
    coverage: null,
    lastDataDate: null,
    freshnessDays: null,
  };

  // 1/2 — connection + reconnect state (no HTTP). A token-store read failure
  // degrades to not_connected (can't prove a connection → don't claim one).
  let info;
  try {
    info = await getConnectorInfo("google_gsc", tenantId);
  } catch {
    return { verdict: "not_connected", ...empty };
  }

  // Read coverage regardless of status so a soft-disconnected tenant still
  // surfaces its cached property + window (honest "here's what we last saw").
  const coverageRead = await readCoverage(tenantId);

  const coverage =
    coverageRead != null
      ? {
          fromDate: coverageRead.fromDate,
          toDate: coverageRead.toDate,
          rowCount: coverageRead.rowCount,
        }
      : null;
  const property = coverageRead?.property ?? null;
  const lastDataDate = coverageRead?.toDate ?? null;
  const freshnessDays =
    lastDataDate != null ? daysSince(lastDataDate, now) : null;
  const dataFields = { property, coverage, lastDataDate, freshnessDays };

  // Not connected (no token / soft-disconnected). We still carry the cached
  // property + coverage so the card can show what was last synced.
  if (info.status !== "connected") {
    return { verdict: "not_connected", ...dataFields };
  }

  // Connected, but the last sync proved the grant is dead → reconnect. This is
  // the only authoritative reconnect signal (see GoogleConnectorToken doc).
  if (info.auth_failed_at != null && info.auth_failed_at !== "") {
    return { verdict: "needs_reconnect", ...dataFields };
  }

  // Connected + healthy, but nothing synced yet.
  if (coverageRead == null) {
    return { verdict: "connected_no_data", ...empty };
  }

  // Connected + healthy + has data.
  return { verdict: "ready", ...dataFields };
}

// ─────────────────────────────────────────────────────────────────────
// Pure presenter — plain-English, white-label, honest. NO invented numbers:
// every figure comes straight from the GscReadiness. Unit-tested.
// ─────────────────────────────────────────────────────────────────────

export type GscReadinessTone = "ready" | "attention" | "idle";

export type GscReadinessDescription = {
  headline: string;
  detail: string;
  tone: GscReadinessTone;
};

/** "2026-06-14" → "Jun 14". Returns the raw input on any parse failure so we
 *  never fabricate a date. */
function shortDate(isoDate: string): string {
  const ms = Date.parse(isoDate + "T12:00:00Z");
  if (!Number.isFinite(ms)) return isoDate;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "refreshed today" / "refreshed 1 day ago" / "refreshed N days ago". */
function freshnessPhrase(days: number): string {
  if (days <= 0) return "refreshed today";
  if (days === 1) return "refreshed 1 day ago";
  return `refreshed ${days} days ago`;
}

/**
 * Plain-English, white-label, honest summary of GSC readiness. Pure — derives
 * everything from `r` only; never invents numbers or dates. Safe to render on
 * the client.
 */
export function describeGscReadiness(r: GscReadiness): GscReadinessDescription {
  switch (r.verdict) {
    case "ready": {
      const headline =
        r.property != null
          ? `Using property ${r.property}`
          : "Connected and pulling search data";
      const parts: string[] = [];
      if (r.coverage != null) {
        parts.push(
          `Search data ${shortDate(r.coverage.fromDate)} – ${shortDate(
            r.coverage.toDate,
          )}`,
        );
        parts.push(
          `${r.coverage.rowCount.toLocaleString()} row${
            r.coverage.rowCount === 1 ? "" : "s"
          }`,
        );
      }
      if (r.freshnessDays != null) parts.push(freshnessPhrase(r.freshnessDays));
      const detail =
        parts.length > 0 ? parts.join(" · ") : "Search data is up to date.";
      return { headline, detail, tone: "ready" };
    }
    case "connected_no_data": {
      return {
        headline: "Connected, but no Search Console data yet",
        detail:
          "Click “Pull my Search Console data” to backfill your search history.",
        tone: "attention",
      };
    }
    case "needs_reconnect": {
      return {
        headline: "Reconnect Google to resume",
        detail:
          "Google access stopped working — reconnect to keep your search data fresh.",
        tone: "attention",
      };
    }
    case "not_connected":
    default: {
      return {
        headline: "Not connected",
        detail:
          "Connect Google Search Console so Beacon can see what people search to find you.",
        tone: "idle",
      };
    }
  }
}
