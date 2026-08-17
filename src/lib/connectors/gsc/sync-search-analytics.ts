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
import {
  getGoogleConnectorToken,
  persistRefreshedGoogleToken,
  updateConnectorToken,
} from "@/lib/connector-store";
import { getTenant } from "@/domains/account/tenants/store";
import { log } from "@/lib/logger";
import { reportingDay } from "@/lib/reporting-day";

import {
  pullDayRows,
  resolveGscAccessToken,
  forceRefreshGscAccessToken,
  gscListSites,
  pickGscPropertyForDomain,
} from "./search-analytics";
import { refreshGoogleAccessToken } from "@/lib/connectors/google-auth";
// R17a (ingestion gaps, v1 266): after the normal incremental window, the
// nightly run also re-pulls days that are MISSING inside the covered range
// (sync holes the trailing REPULL window can never reach back to), capped per
// night. Classification is the shared pure module the connections card reads.
import { loadGscIngestionGapReport } from "@/domains/evidence/gsc/load-ingestion-gaps";
import { selectGapRepullDates } from "@/domains/evidence/gsc/ingestion-gaps";

/** Exported so ingestion-gaps.GSC_FINAL_LAG_DAYS can be pinned in lockstep. */
export const FINAL_LAG_DAYS = 3;
const REPULL_DAYS = 4;
const BACKFILL_DAYS = 90;
/** Hard bound on days per run — keeps a cold backfill bounded. */
const MAX_DAYS_PER_RUN = 45;
const UPSERT_CHUNK = 500;

type GscSyncResult =
  | { synced: false; reason: string }
  | {
      synced: true;
      property: string;
      days: number;
      rows_upserted: number;
      /** R17a: gap days healed by tonight's re-pull (absent when none ran). */
      gap_days_repulled?: number;
    };

function addDays(isoDate: string, days: number): string {
  const t = new Date(isoDate + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const GSC_REQUIRED_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/**
 * #87 (2026-06-14) — classify WHY resolveGscAccessToken returned null so the
 * "Sync now" summary can be honest. Pure classification over the stored token
 * (no HTTP): an absent token row means the owner never connected GSC (benign
 * skip → `no_usable_gsc_token`); a present token that is soft-disconnected,
 * lost its scope, or is expired/stale means the connection BROKE and the owner
 * must reconnect (failure → `gsc_token_expired`). Mirrors the exact null
 * branches in resolveGscAccessToken so the two stay in lockstep.
 */
async function classifyMissingGscToken(
  tenantId: string,
): Promise<string> {
  let token;
  try {
    token = await getGoogleConnectorToken("gsc", tenantId);
  } catch {
    // Token store unreadable — can't prove a broken connection; treat as the
    // benign "not connected" skip rather than alarm the owner.
    return "no_usable_gsc_token";
  }
  // Genuinely never connected (no row at all).
  if (token == null) return "no_usable_gsc_token";
  // A row exists, so the owner DID connect at some point. Missing scope,
  // soft-disconnect, or an expired/stale grant all mean "reconnect".
  if (!Array.isArray(token.scopes) || !token.scopes.includes(GSC_REQUIRED_SCOPE)) {
    return "gsc_token_expired";
  }
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return "gsc_token_expired";
  }
  // expires within / past window, or a stale_under_7d refresh that just failed.
  return "gsc_token_expired";
}

/**
 * Reconnect signal (2026-06-15) — persist the auth-failure marker onto the
 * google_gsc token row so getConnectorHealth can surface a "Reconnect Google"
 * state from a render (no live HTTP). FAIL-SOFT by contract: a token-write
 * error here must NEVER change the sync's own return value or throw — the
 * sync's outcome is already decided. Tenant-scoped (RAILS: isolation sacred).
 *   • stampGscAuthFailure  → set auth_failed_at = now ISO (sync ended in auth failure)
 *   • clearGscAuthFailure  → set auth_failed_at = null  (sync succeeded, auth OK)
 */
/**
 * Returns TRUE only when the grant is PROVEN dead (refresh token rejected with
 * invalid_grant, or no refresh token at all) — i.e. the one case the operator
 * must actually reconnect. Returns FALSE for an alive or merely-transient
 * failure, so the caller can emit a non-alarming reason instead of "revoked".
 */
type GscAuthVerdict =
  /** refresh token genuinely rejected (invalid_grant) → operator must reconnect */
  | "dead"
  /** Google rejected Beacon's OWN credentials (invalid_client) → server config
   *  bug (wrong GOOGLE_CLIENT_SECRET); reconnecting does NOT help. */
  | "misconfig"
  /** grant alive, or a transient/network failure → no alarm */
  | "ok";

async function stampGscAuthFailure(tenantId: string, now: Date): Promise<GscAuthVerdict> {
  let dead = false;
  try {
    const token = await getGoogleConnectorToken("gsc", tenantId);
    // No token row → never connected; never fabricate a "Reconnect" prompt.
    if (token == null) return "ok";
    // DEFINITIVE (2026-06-22): "Google revoked access" is set ONLY when the
    // REFRESH TOKEN is genuinely dead. The on-use auto-refresh fires this sync
    // CONCURRENTLY on every shell render, so a transient 401, an
    // expired-but-refreshable access token, a network blip, or a lost
    // refresh-race must NEVER false-alarm on a live grant (proven 2026-06-22:
    // the GSC grant was healthy — sites.list 200 siteOwner + searchAnalytics
    // 200 with data — yet auth_failed_at kept getting stamped). Probe the grant
    // with a LIVE refresh and decide off the result:
    //   • refresh succeeds → grant ALIVE → CLEAR the marker, never stamp.
    //   • invalid_grant    → refresh token dead → the REAL reconnect case → STAMP.
    //   • any other error  → TRANSIENT → leave state unchanged (no alarm).
    if (token.refresh_token) {
      try {
        const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
          provider: "google_gsc",
          tenantId,
          connectedAt: token.connected_at,
        });
        // alive → clear the reconnect marker (the write is fail-soft; its
        // failure never flips the verdict). SPLIT (2026-07-09, review P1-1):
        // token fields and the reconnect marker now travel separate paths. A
        // rotated refresh_token captured here (the nightly probe is also our
        // chance to catch one, only when Google returned it) MUST go through the
        // guarded compare-and-swap, never a patch: the patch path refuses
        // refresh_token and a read-merge-write here is the cross-instance race
        // the CAS resolves. persistRefreshedGoogleToken is fail-soft itself.
        if (refreshed.refresh_token) {
          await persistRefreshedGoogleToken(
            "google_gsc",
            {
              access_token: refreshed.access_token,
              expires_in: refreshed.expires_in,
              refresh_token: refreshed.refresh_token,
            },
            tenantId,
          );
        }
        try {
          await updateConnectorToken(
            "google_gsc",
            { auth_failed_at: null },
            tenantId,
          );
        } catch {
          /* fail-soft */
        }
        return "ok";
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        // invalid_client = Beacon's OWN client_id/secret is wrong (server config).
        // The user's grant is fine; reconnecting won't help. Do NOT stamp a
        // reconnect prompt — surface the real cause (fix GOOGLE_CLIENT_SECRET).
        if (/invalid_client/i.test(msg)) return "misconfig";
        if (!/invalid_grant/i.test(msg)) {
          return "ok"; // transient (5xx / 429 / network) — do NOT alarm
        }
        dead = true; // invalid_grant → genuinely dead
      }
    } else {
      dead = true; // no refresh token → cannot recover → genuinely dead
    }
    try {
      await updateConnectorToken(
        "google_gsc",
        { auth_failed_at: now.toISOString() },
        tenantId,
      );
    } catch {
      /* fail-soft — a write error must not undo the dead verdict */
    }
    return dead ? "dead" : "ok";
  } catch {
    return dead ? "dead" : "ok"; // fail-soft — never alter the sync outcome
  }
}

async function clearGscAuthFailure(tenantId: string): Promise<void> {
  try {
    await updateConnectorToken("google_gsc", { auth_failed_at: null }, tenantId);
  } catch {
    /* fail-soft — never alter the sync outcome */
  }
}

/** R17b: exported (additive) so the weekly dimensions pass
 *  (weekly-dimensions-sync.ts) and the fresh-tail read resolve the SAME
 *  property this nightly sync writes rows under - one resolution rule. */
export async function resolveProperty(
  tenantId: string,
  accessToken: string,
): Promise<string | null> {
  // audit-wave5 #1 (CRITICAL tenant-isolation): BEACON_GSC_SITE_URL is a single
  // process-global env (set during a backfill to ONE tenant's property). The
  // nightly cron fans out over ALL active tenants and calls resolveProperty for
  // each — an UNGATED env override would write that one property's GSC rows
  // (clicks/impressions/queries) under EVERY tenant_id, showing tenant B
  // tenant A's Search Console numbers as its own. Gate it to the tenant it was
  // set for (mirrors the BEACON_TENANT_ID===id pattern in currentTenantSlug):
  // in the cron fan-out BEACON_TENANT_ID is unset/single-valued, so the global
  // property can never attach to a tenant it doesn't belong to — everyone else
  // falls through to per-tenant domain derivation below.
  const env = process.env.BEACON_GSC_SITE_URL;
  const envTenant = process.env.BEACON_TENANT_ID;
  if (env != null && env !== "" && envTenant != null && envTenant === tenantId) {
    return env;
  }
  // Canonical Website: the Account row owns the one domain.
  let domain: string | undefined;
  {
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
  /** Item 63 (deep backfill chunking): caps the pull's LAST day (YYYY-MM-DD),
   *  bounded by the normal lastFinalDay when it is earlier. Only meaningful
   *  alongside `startDate` — lets the deep-history backfill (src/lib/connectors/
   *  gsc/deep-backfill.ts) pull one bounded month-sized window per invocation
   *  instead of racing all the way to today and risking a lambda timeout.
   *  Omitted for every existing caller (back-compat: pulls through lastFinalDay). */
  endDate?: string;
}): Promise<GscSyncResult> {
  const { tenantId } = args;
  const now = args.now ?? new Date();

  const accessToken = await resolveGscAccessToken(tenantId, now);
  if (accessToken == null) {
    // #87 (2026-06-14) — distinguish "never connected" (a benign skip) from
    // "connected but the grant expired/went stale" (a FAILURE that must tell
    // the owner to reconnect). resolveGscAccessToken returns null for BOTH;
    // we re-read the token row here (classification only — no fetch) to emit
    // the honest reason. A present-but-stale/disconnected/scope-lost token →
    // gsc_token_expired; a genuinely absent token → no_usable_gsc_token.
    const reason = await classifyMissingGscToken(tenantId);
    // Reconnect signal (2026-06-15): only an EXPIRED/BROKEN grant
    // (gsc_token_expired) means the operator must reconnect; a genuinely
    // never-connected tenant (no_usable_gsc_token) must NOT be stamped — that
    // would fabricate a "Reconnect" prompt on a source the owner never wired.
    // Fail-soft (never alters this return).
    if (reason === "gsc_token_expired") {
      const verdict = await stampGscAuthFailure(tenantId, now);
      // misconfig = Beacon's client secret is wrong (server config); "expired"
      // would mislead the operator into reconnecting (which can't fix it).
      if (verdict === "misconfig")
        return { synced: false, reason: "gsc_client_misconfig" };
      // ALIVE → a transient resolve miss / refresh race; don't say "expired".
      if (verdict === "ok") return { synced: false, reason: "gsc_auth_transient" };
      // verdict === "dead" → fall through to the honest gsc_token_expired.
    }
    return { synced: false, reason };
  }
  // Reconnect signal (2026-06-15): a usable access token resolved — the grant
  // is alive and authenticating. Clear any prior auth-failure marker so the
  // strip drops back to a plain "connected" ✓. This is the single
  // clear-on-success point: every path from here to a `synced:true` return had
  // working auth; the only auth-failure path below (a mid-sync 401/403 that
  // survives the refresh-retry) RE-stamps after this clear, so the marker stays
  // correct. Fail-soft (never alters the sync outcome).
  await clearGscAuthFailure(tenantId);
  const property = await resolveProperty(tenantId, accessToken);
  if (property == null) {
    return { synced: false, reason: "no_property_derivable" };
  }

  const todayPt = reportingDay(now);
  const naturalLastFinalDay = addDays(todayPt, -FINAL_LAG_DAYS);
  // Item 63: an explicit endDate (deep-backfill chunking) bounds the pull's
  // last day too, never later than the natural lastFinalDay (GSC has nothing
  // final past that point regardless of what the caller asks for).
  const lastFinalDay =
    args.endDate != null && args.endDate < naturalLastFinalDay ? args.endDate : naturalLastFinalDay;
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
  // R17a: the "nothing new past the watermark" case no longer returns early;
  // the main loop below simply doesn't execute (day window is empty), so the
  // gap re-pull still gets its turn on a fully-caught-up tenant (old holes
  // behind the watermark are exactly what the incremental window never heals).

  const sb = getSupabaseAdmin();
  let days = 0;
  let rowsUpserted = 0;
  // audit-wave2 #9: track a failed day-pull so a quota/network failure on the
  // FIRST day (days===0) doesn't return synced:true and stamp freshness fresh.
  let pullFailed = false;

  // R17a: the per-day pull+upsert body, extracted so the main window and the
  // gap re-pull run EXACTLY the same code (same grains, same idempotent
  // UPSERTs, same failure classification). Accumulates rowsUpserted via
  // closure, exactly as the inline body did.
  type DayOutcome =
    | { ok: true }
    // wave-11 follow-on (2026-06-14): set by pullDayRows -> the query on a GSC
    // AUTH failure (401/403). Pre-fix the run stopped and reported synced:true
    // (GREEN) on a dead/expired grant, hiding stale GSC demand (the pivot's
    // core signal) from the operator. Surfaced so the caller can return
    // synced:false and the operator knows to reconnect GSC.
    | { ok: false; kind: "auth"; status: number }
    | { ok: false; kind: "pull" }
    | { ok: false; kind: "rows_upsert" }
    | { ok: false; kind: "page_totals_upsert" };

  const syncOneDay = async (
    day: string,
    opts: { writeZeroTotalsWhenEmpty?: boolean } = {},
  ): Promise<DayOutcome> => {
    let authFailureStatus: number | null = null;
    const rows = await pullDayRows({
      accessToken,
      siteUrl: property,
      day,
      dimensions: ["page", "query"],
      dataState: "final",
      onAuthFailure: (status) => {
        authFailureStatus = status;
      },
      // Self-heal a recoverable 401 (expired access token) mid-sync via the
      // refresh token, retrying once before the fail-loud above fires.
      refreshAccessToken: () => forceRefreshGscAccessToken(tenantId),
    });
    if (authFailureStatus !== null) {
      return { ok: false, kind: "auth", status: authFailureStatus };
    }
    if (rows == null) {
      // Quota/network — stop here; UPSERTs so far are kept and
      // the next run's re-pull window resumes cleanly.
      return { ok: false, kind: "pull" };
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
        // B82 (completes audit-4): report NOT synced on a DB write failure so
        // cron-sync (which gates positively on synced===true) doesn't stamp the
        // success watermark over a failed write — the day re-pulls next run.
        return { ok: false, kind: "rows_upsert" };
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
      refreshAccessToken: () => forceRefreshGscAccessToken(tenantId),
    });
    const t = totals?.[0];
    if (t != null) {
      // audit #16 (2026-06-14): check { error } like the gsc_daily_rows +
      // page-totals paths — this upsert previously swallowed failures, so a
      // silent write failure was invisible in the nightly log.
      const { error: totalsErr } = await sb.from("gsc_daily_totals").upsert(
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
      if (totalsErr) {
        log.warn("[gsc-sa-sync] gsc_daily_totals upsert failed", {
          tenantId,
          day,
          error: totalsErr.message,
        });
      }
    } else if (opts.writeZeroTotalsWhenEmpty) {
      // R17a (gap re-pull only): Google returned NO totals row for this day;
      // the pull HAPPENED and reported nothing (a genuinely zero-traffic day).
      // Persist the zero row as the pulled truth so the day stops classifying
      // as a hole and re-pulling forever. This is a real pull result recorded
      // verbatim, never interpolation.
      const { error: zeroErr } = await sb.from("gsc_daily_totals").upsert(
        [
          {
            tenant_id: tenantId,
            property,
            date: day,
            clicks: 0,
            impressions: 0,
            ctr: 0,
            position: 0,
            is_final: true,
            pulled_at: now.toISOString(),
          },
        ],
        { onConflict: "tenant_id,property,date" },
      );
      if (zeroErr) {
        log.warn("[gsc-sa-sync] zero-totals marker upsert failed", {
          tenantId,
          day,
          error: zeroErr.message,
        });
      }
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
      refreshAccessToken: () => forceRefreshGscAccessToken(tenantId),
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
          // audit-4 + B82 completion: STOP the run on a page-totals write failure
          // (mirror the page+query path) AND report it as NOT synced. audit-4 fixed
          // the stop-advancing half but still returned synced:true, so a live DB
          // write failure silently stamped the success watermark (cron-sync gates
          // positively on synced===true). Returning synced:false leaves the day
          // un-stamped → it re-pulls next run instead of masking the gap as success.
          return { ok: false, kind: "page_totals_upsert" };
        }
      }
    }
    return { ok: true };
  };

  for (let day = startDay; day <= lastFinalDay; day = addDays(day, 1)) {
    const outcome = await syncOneDay(day);
    if (!outcome.ok) {
      if (outcome.kind === "auth") {
        log.error(
          "[gsc-sa-sync] GSC auth failure — token expired or lost scope; reconnect GSC",
          { tenantId, property, status: outcome.status },
        );
        // Reconnect signal (2026-06-15, hardened 2026-06-22): a mid-sync 401/403
        // is only a REAL reconnect case if the grant is genuinely dead. Probe with
        // a live refresh — if it's alive (a transient API blip / token-refresh
        // race), emit a soft transient reason so the UI never screams "revoked" on
        // a healthy grant. Only invalid_grant stamps + returns the auth-failed
        // reason. Fail-soft (never throws).
        const verdict = await stampGscAuthFailure(tenantId, now);
        return {
          synced: false,
          reason:
            verdict === "dead"
              ? `gsc_auth_failed_${outcome.status}`
              : verdict === "misconfig"
                ? "gsc_client_misconfig"
                : "gsc_auth_transient",
        };
      }
      if (outcome.kind === "pull") {
        log.warn("[gsc-sa-sync] day pull failed; stopping run", {
          tenantId,
          property,
          day,
        });
        pullFailed = true;
        break;
      }
      if (outcome.kind === "rows_upsert") {
        return { synced: false, reason: "gsc_daily_rows_upsert_failed" };
      }
      return { synced: false, reason: "gsc_page_totals_upsert_failed" };
    }
    days += 1;
  }

  // R17a (ingestion gaps, v1 266): heal old holes the incremental window can
  // never reach: re-pull up to GAP_REPULL_CAP_PER_NIGHT missing days inside the
  // covered range, newest first, through the SAME syncOneDay body. Runs only on
  // the normal nightly path (an operator/deep backfill bounds its own window)
  // and only when the main window completed cleanly (no point hammering a
  // struggling quota). STRICTLY fail-soft: a gap-day failure logs and stops the
  // gap loop; it never flips the main sync's result.
  let gapDaysRepulled = 0;
  if (args.startDate == null && args.endDate == null && !pullFailed) {
    try {
      const report = await loadGscIngestionGapReport(tenantId, { property, now });
      const gapDates = (report?.gapDates ?? []).filter(
        // Days inside the window just pulled are already handled above.
        (d) => d < startDay || d > lastFinalDay,
      );
      for (const day of selectGapRepullDates(gapDates)) {
        const outcome = await syncOneDay(day, { writeZeroTotalsWhenEmpty: true });
        if (!outcome.ok) {
          log.warn("[gsc-sa-sync] gap re-pull stopped early; remaining gaps retry tomorrow", {
            tenantId,
            property,
            day,
            kind: outcome.kind,
          });
          break;
        }
        gapDaysRepulled += 1;
      }
      if (gapDaysRepulled > 0) {
        log.info("[gsc-sa-sync] gap re-pull healed missing days", {
          tenantId,
          property,
          gapDaysRepulled,
        });
      }
    } catch (e) {
      log.warn("[gsc-sa-sync] gap re-pull failed", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // audit-wave2 #9: a first-day pull failure (quota/network) wrote nothing —
  // report it as not-synced so freshness isn't stamped fresh on zero data.
  if (days === 0 && pullFailed) {
    return { synced: false, reason: "gsc_day_pull_failed" };
  }
  // THE MONTHLY ARCHIVE FOLLOWS THE ROWS, in the same path that landed them: it is what the demand-unit history reads, and an archive nothing refreshed is how pulled history stays invisible. Current month and the previous, for a sync that crossed a month edge; fail-soft, the sync already succeeded.
  if (rowsUpserted > 0) {
    const now2 = new Date(), m = now2.toISOString().slice(0, 7);
    const prev = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    for (const month of [prev, m]) await getSupabaseAdmin().rpc("refresh_gsc_month", { p_tenant_id: tenantId, p_month: `${month}-01` }).then(({ error }) => {
      if (error) log.warn("[gsc-sync] archive month refresh failed", { tenantId, month, error: error.message }); });
  }
  return {
    synced: true,
    property,
    days,
    rows_upserted: rowsUpserted,
    ...(gapDaysRepulled > 0 ? { gap_days_repulled: gapDaysRepulled } : {}),
  };
}
