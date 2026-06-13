/**
 * Insight Graph slice 1 (2026-06-12) — nightly GSC Search Analytics
 * sync, per Google's documented best practice: "run a query each day
 * for one day's worth of data" (day-sliced pulls), paginate by 25k,
 * idempotent UPSERTs keyed (tenant, property, date, page, query).
 *
 * Sync design (research note in the slice commit):
 *   • FINAL_LAG = 3 days — Search Analytics "final" data settles in
 *     ~2-3 days; we only persist is_final rows from days older than
 *     the lag.
 *   • REPULL = 4 days — each run re-pulls a trailing window so days
 *     that finalized late self-heal (UPSERT makes this idempotent).
 *   • BACKFILL_DAYS = 90 on first run (decay slice 2026-06-12:
 *     the refresh rule compares two consecutive 28d windows and the
 *     Animalz decay guidance is 90-day-based; 90 days ≈ 180 requests
 *     << the 1,200 QPM quota; completes in 2 runs under
 *     MAX_DAYS_PER_RUN). 16 months exist upstream if needed.
 *   • Per-day we ALSO pull the ungrouped (no-dimension) totals row:
 *     Google drops rows on page/query-grouped queries, so the
 *     grouped sum undercounts — the totals row makes that honest.
 *   • All dates are Search Console dates = PACIFIC TIME.
 *
 * PROPERTY RESOLUTION (no hardcoding): BEACON_GSC_SITE_URL env wins
 * when set (existing single-tenant behavior, e.g. a URL-prefix
 * property); otherwise derived from the tenant's own configured
 * domain as `sc-domain:{domain}` — the canonical Domain-property
 * form. A wrong guess fail-softs (API non-2xx → skip + log).
 *
 * Fail-soft EVERYWHERE: no token / no domain / table missing /
 * quota → returns { synced: false, reason } — callers log one line
 * and move on. The cron must never die on this step.
 *
 * IDEMPOTENT-SYNC CONTRACT (audit #35, 2026-06-12): rows UPSERT on
 * (tenant_id, property, date, page, query). A failed chunk ends the
 * run early with everything before it kept; the next nightly run's
 * REPULL window re-pulls those days and the UPSERT converges — no
 * dedupe pass, no manual repair, safe to re-run any number of times.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getBusinessConfig } from "@/lib/business-config";
import { getTenant } from "@/domains/tenants/store";
import { log } from "@/lib/logger";

import {
  pullDayRows,
  resolveGscAccessToken,
  gscListSites,
  pickGscPropertyForDomain,
} from "./search-analytics";

const FINAL_LAG_DAYS = 3;
const REPULL_DAYS = 4;
const BACKFILL_DAYS = 90;
/** Hard bound on days per run — keeps a cold backfill bounded. */
const MAX_DAYS_PER_RUN = 45;
const UPSERT_CHUNK = 500;

export type GscSyncResult =
  | { synced: false; reason: string }
  | {
      synced: true;
      property: string;
      days: number;
      rows_upserted: number;
    };

/** YYYY-MM-DD for `d` in America/Los_Angeles (Search Console dates
 *  are Pacific Time). en-CA locale renders ISO order. */
export function pacificDateString(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function addDays(isoDate: string, days: number): string {
  const t = new Date(isoDate + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

async function resolveProperty(
  tenantId: string,
  accessToken: string,
): Promise<string | null> {
  const env = process.env.BEACON_GSC_SITE_URL;
  if (env != null && env !== "") return env;
  // Domain source: business-config first, then the tenant REGISTRY. On hosted
  // (read-only lambda FS) the business-config files don't deploy, so the
  // operator's Settings→Config domain only reaches the nightly sync via the
  // registry (Supabase-backed). Without this fallback the hosted sync gets no
  // domain → no_property_derivable → never runs.
  let domain: string | undefined = getBusinessConfig(tenantId).domain?.trim();
  if (!domain) {
    try {
      domain = (await getTenant(tenantId))?.domain?.trim() || undefined;
    } catch {
      /* registry unavailable — fall through to null */
    }
  }
  if (!domain) return null;
  // Auto-discover the property SHAPE the token actually owns. The account may
  // have a URL-prefix property (https://www.x.com/) rather than a domain
  // property (sc-domain:x.com) — guessing the wrong one → HTTP 403 and 0 rows
  // (the 2026-06-13 Iranopedia incident: sc-domain guess 403'd; the real
  // property was the URL-prefix). Fail-soft to the sc-domain derivation when
  // sites.list is unavailable, preserving prior behavior.
  const sites = await gscListSites(accessToken);
  const picked = pickGscPropertyForDomain(sites, domain);
  if (picked != null) return picked;
  return "sc-domain:" + domain.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

async function readWatermark(
  tenantId: string,
  property: string,
): Promise<string | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("date")
      .eq("tenant_id", tenantId)
      .eq("property", property)
      .eq("is_final", true)
      .order("date", { ascending: false })
      .limit(1);
    if (error) return null;
    const d = (data?.[0] as { date?: string } | undefined)?.date;
    return typeof d === "string" ? d.slice(0, 10) : null;
  } catch {
    return null;
  }
}

export async function syncGscSearchAnalyticsForTenant(args: {
  tenantId: string;
  now?: Date;
  /** Operator backfill override (YYYY-MM-DD). The normal path is incremental-
   *  FORWARD (watermark + per-run day cap), so it can never reach back for the
   *  full history GSC holds. When set, start the pull here and bypass both the
   *  watermark and the day cap — bounded by the operator's chosen start. */
  startDate?: string;
}): Promise<GscSyncResult> {
  const { tenantId } = args;
  const now = args.now ?? new Date();

  const accessToken = await resolveGscAccessToken(tenantId, now);
  if (accessToken == null) {
    return { synced: false, reason: "no_usable_gsc_token" };
  }
  const property = await resolveProperty(tenantId, accessToken);
  if (property == null) {
    return { synced: false, reason: "no_property_derivable" };
  }

  const todayPt = pacificDateString(now);
  const lastFinalDay = addDays(todayPt, -FINAL_LAG_DAYS);
  const watermark = await readWatermark(tenantId, property);
  let startDay =
    args.startDate != null
      ? args.startDate
      : watermark != null
        ? addDays(watermark, -REPULL_DAYS)
        : addDays(lastFinalDay, -(BACKFILL_DAYS - 1));
  // Never run unbounded: cap the window — EXCEPT an explicit operator backfill,
  // which the operator has already bounded by choosing startDate.
  if (args.startDate == null) {
    const maxStart = addDays(lastFinalDay, -(MAX_DAYS_PER_RUN - 1));
    if (startDay < maxStart) startDay = maxStart;
  }
  if (startDay > lastFinalDay) {
    return { synced: true, property, days: 0, rows_upserted: 0 };
  }

  const sb = getSupabaseAdmin();
  let days = 0;
  let rowsUpserted = 0;
  for (let day = startDay; day <= lastFinalDay; day = addDays(day, 1)) {
    const rows = await pullDayRows({
      accessToken,
      siteUrl: property,
      day,
      dimensions: ["page", "query"],
      dataState: "final",
    });
    if (rows == null) {
      // Auth/quota/network — stop here; UPSERTs so far are kept and
      // the next run's re-pull window resumes cleanly.
      log.warn("[gsc-sa-sync] day pull failed; stopping run", {
        tenantId,
        property,
        day,
      });
      break;
    }
    const mapped = rows
      .filter((r) => Array.isArray(r.keys) && r.keys.length === 2)
      .map((r) => ({
        tenant_id: tenantId,
        property,
        date: day,
        page: r.keys[0]!,
        query: r.keys[1]!,
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
        is_final: true,
        pulled_at: now.toISOString(),
      }));
    for (let i = 0; i < mapped.length; i += UPSERT_CHUNK) {
      const chunk = mapped.slice(i, i + UPSERT_CHUNK);
      const { error } = await sb
        .from("gsc_daily_rows")
        .upsert(chunk, { onConflict: "tenant_id,property,date,page,query" });
      if (error) {
        log.warn("[gsc-sa-sync] upsert failed", {
          tenantId,
          day,
          error: error.message,
        });
        return { synced: true, property, days, rows_upserted: rowsUpserted };
      }
      rowsUpserted += chunk.length;
    }

    // Ungrouped totals (Google drops rows on grouped queries — the
    // totals row is the honest property-level truth for the day).
    const totals = await pullDayRows({
      accessToken,
      siteUrl: property,
      day,
      dimensions: [],
      dataState: "final",
    });
    const t = totals?.[0];
    if (t != null) {
      await sb.from("gsc_daily_totals").upsert(
        [
          {
            tenant_id: tenantId,
            property,
            date: day,
            clicks: t.clicks ?? 0,
            impressions: t.impressions ?? 0,
            ctr: t.ctr ?? 0,
            position: t.position ?? 0,
            is_final: true,
            pulled_at: now.toISOString(),
          },
        ],
        { onConflict: "tenant_id,property,date" },
      );
    }

    // Per-PAGE ungrouped totals (dimensions=[page]). Unlike the page+query
    // grain above, this INCLUDES the anonymized low-volume queries GSC hides —
    // so these clicks/impressions/CTR/position are the honest page-level
    // numbers that match the GSC UI. The card leads with these; page+query
    // stays for query-level evidence (topQueries).
    const pageTotals = await pullDayRows({
      accessToken,
      siteUrl: property,
      day,
      dimensions: ["page"],
      dataState: "final",
    });
    if (pageTotals != null && pageTotals.length > 0) {
      const pageRows = pageTotals
        .filter((r) => Array.isArray(r.keys) && r.keys.length === 1)
        .map((r) => ({
          tenant_id: tenantId,
          property,
          date: day,
          page: r.keys[0]!,
          clicks: r.clicks ?? 0,
          impressions: r.impressions ?? 0,
          ctr: r.ctr ?? 0,
          position: r.position ?? 0,
          is_final: true,
          pulled_at: now.toISOString(),
        }));
      for (let i = 0; i < pageRows.length; i += UPSERT_CHUNK) {
        const chunk = pageRows.slice(i, i + UPSERT_CHUNK);
        const { error } = await sb
          .from("gsc_daily_page_totals")
          .upsert(chunk, { onConflict: "tenant_id,property,date,page" });
        if (error) {
          log.warn("[gsc-sa-sync] page-totals upsert failed", {
            tenantId,
            day,
            error: error.message,
          });
          break;
        }
      }
    }
    days += 1;
  }

  return { synced: true, property, days, rows_upserted: rowsUpserted };
}
