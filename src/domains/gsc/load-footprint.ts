/**
 * load-footprint (R17c / P2, v1 items 491 + 493) - the I/O edges for the
 * total-Google-footprint roll-up and the Google Discover probe.
 *
 * loadGscFootprint (491): reads the SAME per-page GSC signal every other GSC
 * surface uses (loadGscPageSignalsForTenant, 90-day window, $0 - no API call)
 * and rolls it up into the one "how big is my Google presence" line. Fail-soft
 * null - the surface self-hides.
 *
 * loadDiscoverPresence (493): ONE bounded searchanalytics.query with
 * searchType "discover" (Google's phone home-feed, a SEPARATE data source most
 * properties never receive), behind a small volatile presentation cache (the
 * "gsc-discover-probe" json-store, 12h TTL, Supabase-mirrored). If Discover
 * returns nothing for the property, NOTHING is fabricated - the probe caches an
 * empty result so it does not re-query for 12h and the surface self-hides.
 *
 * THE DISCOVER RULE: this probe is READ-ONLY and never touches the daily final
 * tables - it caches only its own aggregate totals, exactly like fresh-tail.
 *
 * Request-deduped via react cache.
 */

import "server-only";

import { cache } from "react";

import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";
import {
  gscSearchAnalyticsQuery,
  resolveGscAccessToken,
} from "@/lib/connectors/gsc/search-analytics";
import {
  FINAL_LAG_DAYS,
  pacificDateString,
  resolveProperty,
} from "@/lib/connectors/gsc/sync-search-analytics";
import {
  buildDiscoverPresence,
  buildGscFootprint,
  type DiscoverPresence,
  type FootprintPageInput,
  type GscFootprint,
} from "./footprint";

/** The per-page signal window (gsc-page-signals.ts WINDOW_DAYS). */
const FOOTPRINT_WINDOW_DAYS = 90;

/** 491: the total-footprint roll-up. $0, self-hiding null. */
export const loadGscFootprint = cache(
  async (tenantId: string): Promise<GscFootprint | null> => {
    if (!tenantId) return null;
    try {
      const signals = await loadGscPageSignalsForTenant(tenantId);
      const pages: FootprintPageInput[] = [];
      for (const s of signals.values()) {
        pages.push({
          page: s.page,
          impressions90d: s.impressions90d,
          clicks90d: s.clicks90d,
          queries: s.topQueries.map((q) => q.query),
        });
      }
      return buildGscFootprint(pages, FOOTPRINT_WINDOW_DAYS);
    } catch (e) {
      log.warn("[gsc-footprint] load failed (surface self-hides)", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  },
);

// ---------------------------------------------------------------------------
// 493: Google Discover probe
// ---------------------------------------------------------------------------

export const GSC_DISCOVER_PROBE_STORE = "gsc-discover-probe";

/** Discover moves slowly and most properties never receive it; a 12h reuse
 *  keeps the probe from re-querying a quiet feed on a busy page. */
export const DISCOVER_PROBE_CACHE_MS = 12 * 60 * 60 * 1000;

const DISCOVER_WINDOW_DAYS = 90;

type DiscoverProbeCacheRow = {
  tenant_id: string;
  computedAt: string;
  /** Aggregate totals over the window, or null when Discover returned nothing.
   *  A null totals is cached so an unavailable Discover feed does not re-query. */
  totals: { impressions: number; clicks: number } | null;
};

function addDays(isoDate: string, days: number): string {
  const t = new Date(isoDate + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/**
 * 493: the Discover presence line, or null when the property has no Discover
 * data (self-hides honestly). ONE bounded probe behind a 12h volatile cache.
 */
export const loadDiscoverPresence = cache(
  async (tenantId: string, now: Date = new Date()): Promise<DiscoverPresence | null> => {
    if (!tenantId) return null;

    // Volatile cache first (a warm row within TTL, even a cached empty result).
    let cached: DiscoverProbeCacheRow[] = [];
    try {
      cached = await readStore<DiscoverProbeCacheRow>(GSC_DISCOVER_PROBE_STORE, []);
      const mine = cached.find((r) => r.tenant_id === tenantId);
      if (
        mine &&
        Number.isFinite(Date.parse(mine.computedAt)) &&
        now.getTime() - Date.parse(mine.computedAt) < DISCOVER_PROBE_CACHE_MS
      ) {
        return buildDiscoverPresence(mine.totals, DISCOVER_WINDOW_DAYS);
      }
    } catch {
      cached = [];
    }

    let totals: { impressions: number; clicks: number } | null = null;
    try {
      const accessToken = await resolveGscAccessToken(tenantId, now);
      if (accessToken == null) return null;
      const property = await resolveProperty(tenantId, accessToken);
      if (property == null) return null;
      const endDate = addDays(pacificDateString(now), -FINAL_LAG_DAYS);
      const startDate = addDays(endDate, -(DISCOVER_WINDOW_DAYS - 1));
      // ONE Discover-typed request, no dimensions (property-level totals only).
      // Discover forbids the query dimension; the empty dimensions list returns
      // a single aggregate row (or none when the feed has no data).
      const rows = await gscSearchAnalyticsQuery({
        accessToken,
        siteUrl: property,
        startDate,
        endDate,
        dimensions: [],
        searchType: "discover",
        dataState: "final",
      });
      if (rows == null) return null; // probe failed - do NOT cache (retry next time)
      if (rows.length > 0) {
        totals = {
          impressions: rows.reduce((s, r) => s + (Number(r.impressions) || 0), 0),
          clicks: rows.reduce((s, r) => s + (Number(r.clicks) || 0), 0),
        };
      }
      // rows.length === 0 -> totals stays null (Discover unavailable/empty).

      // Best-effort cache write (one row per tenant; an empty result is cached
      // too so a quiet feed does not re-probe for 12h).
      try {
        const others = cached.filter((r) => r.tenant_id !== tenantId);
        await writeStore<DiscoverProbeCacheRow>(GSC_DISCOVER_PROBE_STORE, [
          ...others,
          { tenant_id: tenantId, computedAt: now.toISOString(), totals },
        ]);
      } catch {
        /* cache write is best-effort */
      }

      return buildDiscoverPresence(totals, DISCOVER_WINDOW_DAYS);
    } catch (e) {
      log.warn("[gsc-discover-probe] probe failed (surface self-hides)", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  },
);
