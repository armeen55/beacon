/**
 * 2026-05-14 Phase A.3 Step 3b — read-only indexability verdict loader.
 *
 * Joins existing tenant-stored signals into the pure
 * `computeIndexability` function from A.3.1. NO fresh HTTP fetches,
 * NO scan triggers, NO GSC, NO UI consumer (A.3.4 wires UI).
 *
 * Signal sources:
 *   • `PageSnapshot` via `getPageSnapshots()`. Routed tenant-per-tenant
 *     through `readDotDataJson("page-snapshots")` →
 *     `.data/tenants/{slug}/page-snapshots.json`. Tenant safety is
 *     enforced upstream by the AsyncLocalStorage `currentTenantSlug`
 *     resolver; this loader adds an explicit tenant-context assertion
 *     at the entry point to catch misconfigured callers fail-loud.
 *   • `SitemapReconciliation` via `getSitemapReconciliation()`. **GLOBAL
 *     STORE** — lives at `.data/global/sitemap-reconciliation.json`
 *     and is shared across tenants. The loader's defense is a
 *     tenant-domain filter applied to `canonical_pages` BEFORE the
 *     URL-membership check: rows whose host does not match the
 *     tenant's `BusinessConfig.domain` are excluded as if they
 *     belong to another tenant. Architecture invariant
 *     `indexability-loader-tenant-isolation` pins this filter.
 *   • `RobotsFile` via `readRobotsState()`. **FLAT-PATH READER** —
 *     `readRobotsState()` reads `.data/robots-state.json` directly,
 *     bypassing tenant routing despite the classification layer
 *     marking `robots-state` as SINGLETON (per-tenant). This loader
 *     defends against the resulting cross-tenant churn risk by
 *     validating `state.siteDomain` against the tenant's
 *     `BusinessConfig.domain` before consuming the state — a
 *     mismatch yields null bot flags (verdict falls through to
 *     `unknown`).
 *
 * Future infra debt — NOT fixed in this step:
 *   • Retrofit `readRobotsState()` / `writeRobotsState()` in
 *     `src/domains/pages/robots-parser.ts` to route through
 *     `readDotDataJson("robots-state")` / `writeDotDataJson(...)`.
 *     The classification layer already declares `robots-state` as
 *     SINGLETON (`store-classification.ts:131`); only the reader
 *     and writer functions need to be retrofitted. Affects the
 *     scan orchestrator (the lone caller besides this loader).
 *     Documented in the retirement-condition of the
 *     `indexability-loader-tenant-isolation` catalog row so the
 *     debt is bi-navigable from invariant ↔ catalog.
 *
 * Cache: `unstable_cache` keyed by `(tenantId, canonicalUrl)`, TTL
 * 60s, tagged `recommended_edits:${tenantId}` +
 * `page-snapshots:${tenantId}` so existing tag-invalidation paths
 * also flush indexability state.
 */

import "server-only";

import { unstable_cache } from "next/cache";

import { computeIndexability } from "./compute-indexability";
import type {
  IndexabilityRobotsSignal,
  IndexabilitySitemapSignal,
  OwnedUrlIndexability,
} from "./types";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { getSitemapReconciliation } from "@/domains/pages/sitemap-reconciliation-store";
import {
  evaluateAiBotAccess,
  evaluateGooglebotAccess,
  readRobotsState,
} from "@/domains/pages/robots-parser";
import { getBusinessConfig } from "@/lib/business-config";
import { currentTenantId } from "@/lib/tenant-context";

const MS_PER_DAY = 86_400_000;

/**
 * Locked stale-evidence gate. Robots state older than this threshold
 * has its bot flags downgraded to `null` so the loader never claims
 * `ok` on month-old robots evidence. Tunable in a future step; pinned
 * by `load-indexability.test.ts` boundary cases.
 */
export const STALE_ROBOTS_THRESHOLD_DAYS = 30;

/**
 * Null-flags helper used at every robots-defense exit (state missing,
 * siteDomain mismatch, fetchedAt unparseable, stale).
 */
function nullRobotsFlags(): IndexabilityRobotsSignal {
  return {
    googlebot_allowed: null,
    gptbot_allowed: null,
    perplexitybot_allowed: null,
    claudebot_allowed: null,
    google_extended_allowed: null,
  };
}

/**
 * Lowercase + strip-leading-www on a hostname. Mirrors the
 * citation-lifecycle canonicalizer's host-normalization so the
 * tenant-domain filter and the URL-equality check use the same shape.
 */
function normalizeHost(raw: string | null | undefined): string {
  if (raw == null) return "";
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return "";
  // Accept either a bare host ("ritzbuilders.com") or a full URL
  // ("https://ritzbuilders.com/path"). Strip protocol/path if present.
  let host = trimmed;
  if (/^https?:\/\//.test(host)) {
    try {
      host = new URL(host).hostname.toLowerCase();
    } catch {
      return "";
    }
  } else {
    // For bare-host inputs, slice off any trailing path that might
    // have been included accidentally ("ritzbuilders.com/services").
    const slash = host.indexOf("/");
    if (slash !== -1) host = host.slice(0, slash);
  }
  if (host.startsWith("www.")) host = host.slice(4);
  return host;
}

/**
 * UTC-day delta between `fetchedAt` and `now`. Returns null when
 * either value is unparseable. Negative deltas (clock skew) are
 * clamped to 0 so callers never see a stale-gate trigger from
 * "fetched 5 days in the future".
 */
function computeRobotsAgeDays(
  fetchedAt: string | null,
  now: Date | string,
): number | null {
  if (fetchedAt == null) return null;
  const fetchedMs = new Date(fetchedAt).getTime();
  if (Number.isNaN(fetchedMs)) return null;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Number.isNaN(nowMs)) return null;
  const delta = Math.floor((nowMs - fetchedMs) / MS_PER_DAY);
  return delta < 0 ? 0 : delta;
}

/**
 * Build the sitemap-membership signal under the global-store
 * tenant-domain filter.
 *
 * Decision tree:
 *   • `reconciliation === null` → `{ in_sitemap: null, sitemap_url: null }`
 *   • `tenantDomain === ""` (placeholder config) → null (cannot filter
 *     safely; do not claim membership)
 *   • `tenantRows.length === 0` after filtering → null (no rows for
 *     this tenant; could mean scan hasn't run for them, OR they have
 *     no sitemap at all — caller can't disambiguate, so honest null)
 *   • `tenantRows.some(canonicalize match)` → true
 *   • otherwise → false
 *
 * Filtering is host-only; the canonicalize step matches the URL
 * comparison so trailing slash / case / protocol normalize together.
 */
function buildSitemapSignal(
  reconciliation: Awaited<ReturnType<typeof getSitemapReconciliation>>,
  tenantDomain: string,
  canonicalUrl: string,
): IndexabilitySitemapSignal {
  if (reconciliation == null) {
    return { in_sitemap: null, sitemap_url: null };
  }
  if (tenantDomain === "") {
    return { in_sitemap: null, sitemap_url: null };
  }
  const tenantRows = reconciliation.canonical_pages.filter((p) => {
    const host = normalizeHost(p.url);
    return host !== "" && host === tenantDomain;
  });
  if (tenantRows.length === 0) {
    return { in_sitemap: null, sitemap_url: null };
  }
  const inSitemap = tenantRows.some(
    (p) => canonicalizeCitationUrl(p.url) === canonicalUrl,
  );
  return { in_sitemap: inSitemap, sitemap_url: null };
}

/**
 * Build the robots-bot-allow signal with structural defenses against
 * the flat-path read hazard.
 *
 * Defense ladder (in order):
 *   1. `state === null` → null flags.
 *   2. `state.parsed === null` (404 fetch with cleared body) → null flags.
 *   3. `normalizeHost(state.siteDomain) !== tenantDomain` → null flags
 *      (state belongs to another tenant — flat-path overwrite).
 *   4. `computeRobotsAgeDays(state.fetchedAt, now) === null` → null flags
 *      (unparseable fetchedAt; defensive).
 *   5. `ageDays >= STALE_ROBOTS_THRESHOLD_DAYS` → null flags (stale).
 *   6. Otherwise evaluate via the existing helpers.
 *
 * The path argument is derived from the canonical URL's pathname so
 * robots evaluation uses the same path shape regardless of the
 * caller's input.
 */
function buildRobotsSignal(
  state: ReturnType<typeof readRobotsState>,
  tenantDomain: string,
  canonicalUrl: string,
  now: Date | string,
): IndexabilityRobotsSignal {
  if (state == null) return nullRobotsFlags();
  if (state.parsed == null) return nullRobotsFlags();
  if (tenantDomain === "") return nullRobotsFlags();
  if (normalizeHost(state.siteDomain) !== tenantDomain) {
    return nullRobotsFlags();
  }
  // `RobotsStateFile.lastFetchedAt` is the top-level fetch timestamp
  // (always present, even when `parsed` was cleared). The parsed body
  // ALSO carries a `RobotsFile.fetchedAt` field — for the stale gate
  // we use the top-level value since it's set on every write,
  // including the cleared-parsed branch.
  const age = computeRobotsAgeDays(state.lastFetchedAt, now);
  if (age === null) return nullRobotsFlags();
  if (age >= STALE_ROBOTS_THRESHOLD_DAYS) return nullRobotsFlags();

  let path: string;
  try {
    path = new URL(canonicalUrl).pathname;
  } catch {
    return nullRobotsFlags();
  }

  const ai = evaluateAiBotAccess(state.parsed, path);
  const google = evaluateGooglebotAccess(state.parsed, path);

  return {
    googlebot_allowed: google.allowed,
    gptbot_allowed: ai.perCrawler.GPTBot.allowed,
    perplexitybot_allowed: ai.perCrawler.PerplexityBot.allowed,
    claudebot_allowed: ai.perCrawler.ClaudeBot.allowed,
    google_extended_allowed: ai.perCrawler["Google-Extended"].allowed,
  };
}

/**
 * Load per-URL indexability for one tenant + one URL, joining existing
 * stored signals into `computeIndexability`. Read-only — no fetches,
 * no scan triggers, no GSC.
 *
 * Tenant context assertion: throws fail-loud if the AsyncLocalStorage
 * resolved tenant doesn't match `opts.tenantId`. Catches misconfigured
 * callers immediately rather than silently leaking cross-tenant data.
 *
 * URL canonicalization: `opts.url` is canonicalized via the existing
 * citation-lifecycle canonicalizer (lowercase host, strip www, strip
 * query/fragment, normalize http→https, strip trailing slash, preserve
 * path case). Snapshot lookup + sitemap membership both compare
 * canonicalized strings.
 *
 * Returns the `OwnedUrlIndexability` shape from `computeIndexability`
 * verbatim — composite verdict + raw signals + freshness.
 */
export async function loadIndexabilityForUrl(opts: {
  tenantId: string;
  url: string;
  now?: Date | string;
}): Promise<OwnedUrlIndexability> {
  // Tenant-context assertion. The repository pattern + AsyncLocalStorage
  // routing for `page-snapshots` depend on the current tenant matching
  // the caller's intent. A mismatch is a fail-loud signal.
  const ctxId = await currentTenantId();
  if (ctxId !== opts.tenantId) {
    throw new Error(
      `loadIndexabilityForUrl: tenant context mismatch — opts.tenantId=${opts.tenantId} but currentTenantId=${ctxId}`,
    );
  }

  const now = opts.now ?? new Date();
  const canonicalUrl = canonicalizeCitationUrl(opts.url);

  // If the input URL doesn't canonicalize (sentinel, malformed, etc.)
  // there's no useful indexability statement to make. Return unknown
  // with empty signals so consumers can branch on verdict.
  if (canonicalUrl == null) {
    return computeIndexability({
      url: opts.url,
      sitemap_membership: { in_sitemap: null, sitemap_url: null },
      robots_txt: nullRobotsFlags(),
      page_snapshot: null,
      now,
    });
  }

  const cacheKey = ["indexability:v1", opts.tenantId, canonicalUrl];

  const cached = unstable_cache(
    async () => {
      const cfg = getBusinessConfig();
      const tenantDomain = normalizeHost(cfg.domain);

      const [snapshots, reconciliation] = await Promise.all([
        getPageSnapshots(),
        getSitemapReconciliation(),
      ]);
      // readRobotsState is synchronous; awaiting noisily here keeps
      // the Promise.all shape readable but the call itself doesn't
      // produce a Promise.
      const robotsState = readRobotsState();

      // Snapshot lookup: exact match on canonicalized URL. The
      // existing snapshot routing already filters per-tenant via
      // AsyncLocalStorage, so the array we get back is tenant-scoped.
      const snapshot =
        snapshots.find(
          (s) => canonicalizeCitationUrl(s.url) === canonicalUrl,
        ) ?? null;

      const sitemap_membership = buildSitemapSignal(
        reconciliation,
        tenantDomain,
        canonicalUrl,
      );
      const robots_txt = buildRobotsSignal(
        robotsState,
        tenantDomain,
        canonicalUrl,
        now,
      );

      return computeIndexability({
        url: canonicalUrl,
        sitemap_membership,
        robots_txt,
        page_snapshot:
          snapshot == null
            ? null
            : {
                http_status: snapshot.http_status,
                canonical_url: snapshot.canonical_url,
                has_canonical_mismatch: snapshot.has_canonical_mismatch,
                robots_meta: snapshot.robots_meta,
                fetched_at: snapshot.fetched_at,
                extraction_certainty: snapshot.extraction_certainty ?? null,
              },
        now,
      });
    },
    cacheKey,
    {
      revalidate: 60,
      tags: [
        `recommended_edits:${opts.tenantId}`,
        `page-snapshots:${opts.tenantId}`,
      ],
    },
  );

  return cached();
}
