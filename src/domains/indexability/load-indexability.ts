/**
 * 2026-05-14 Phase A.3 Step 3b — read-only indexability verdict loader.
 *
 * Joins existing tenant-stored signals into the pure
 * `computeIndexability` function from A.3.1. NO fresh HTTP fetches,
 * NO scan triggers, NO GSC, NO UI consumer (A.3.4 wires UI).
 *
 * Signal sources:
 *   • `PageSnapshot` via the tenant-scoped repository
 *     (`getRepository().forTenant(tenantId).getPageSnapshots()`).
 *     Reads the Supabase-backed `page_snapshots` table in production
 *     (filtered by `tenant_id`); reads `.data/tenants/{slug}/page-
 *     snapshots.json` in dev via the file-backend. The repository
 *     boundary is the canonical production read path — Vercel
 *     lambdas have a read-only FS outside `/tmp`, so the file path
 *     never carries data there even though the daily-scan writes
 *     it on the GH Actions runner. Supabase is the persistent
 *     store; the daily-scan dual-writes to it. (Post-A.3.5 fix,
 *     2026-05-14: prior import from `@/domains/pages/snapshot-
 *     store` bypassed the repository and returned `[]` on
 *     production.)
 *   • `SitemapReconciliation` via `repo.getSitemapReconciliation()`.
 *     Phase A.3 (post-A.3.5) flipped the store classification from
 *     GLOBAL → TENANT_SCOPED. Supabase-backend reads
 *     `public.sitemap_reconciliation` filtered by tenant_id;
 *     file-backend reads
 *     `.data/tenants/{slug}/sitemap-reconciliation.json`. The
 *     loader's tenant-domain filter on `canonical_pages` is
 *     RETAINED as defense-in-depth (the per-tenant PK is the
 *     primary storage-layer boundary now).
 *   • `RobotsFile` via `readRobotsState({tenantId})`. Phase A.3
 *     (post-A.3.5) retrofitted to async + tenant-scoped through
 *     the repository (`public.robots_state` Supabase mirror;
 *     `.data/tenants/{slug}/robots-state.json` in dev via SINGLETON
 *     classification). The pre-A.3 flat-path file is RETIRED.
 *     The loader's siteDomain-vs-tenantDomain defense is RETAINED
 *     as defense-in-depth.
 *
 * Sequencing model A (operator-locked): the repository read paths
 * soft-fail to null on the PostgreSQL `42P01` (undefined_table)
 * error so this code is safe to deploy BEFORE the two Supabase
 * migrations apply. Until the migrations apply AND the next
 * daily-scan runs the dual-writes, robots + sitemap signals stay
 * null and verdicts collapse to `unknown` — identical behavior to
 * the pre-fix state. After both migrations apply + next scan, the
 * loader sees real signals.
 *
 * Cache: `unstable_cache` keyed by `(tenantId, canonicalUrl)`, TTL
 * 60s, tagged `recommended_edits:${tenantId}` +
 * `page-snapshots:${tenantId}` so existing tag-invalidation paths
 * also flush indexability state.
 */

import "server-only";

import { unstable_cache } from "next/cache";

import { computeIndexability } from "./compute-indexability";
import { loadGscSignal } from "./load-gsc-signal";
import type {
  IndexabilityGscSignal,
  IndexabilityRobotsSignal,
  IndexabilitySitemapSignal,
  OwnedUrlIndexability,
} from "./types";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  evaluateAiBotAccess,
  evaluateGooglebotAccess,
  readRobotsState,
} from "@/domains/pages/robots-parser";
import type { SitemapReconciliation } from "@/domains/pages/types";
import { getBusinessConfig } from "@/lib/business-config";
import { getRepository } from "@/lib/persistence/repositories";
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
 *
 * Exported in Slice 4.5.C.α₁ so the batch indexability helper
 * (`./batch-load-indexability.ts`) can reuse the exact same
 * defense-ladder shape without duplicating the literal.
 */
export function nullRobotsFlags(): IndexabilityRobotsSignal {
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
 *
 * Exported in Slice 4.5.C.α₁ for reuse by the batch indexability
 * helper.
 */
export function normalizeHost(raw: string | null | undefined): string {
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
/**
 * Exported in Slice 4.5.C.α₁ for reuse by the batch indexability
 * helper.
 */
export function computeRobotsAgeDays(
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
 *
 * Exported in Slice 4.5.C.α₁ for reuse by the batch indexability
 * helper.
 */
export function buildSitemapSignal(
  reconciliation: SitemapReconciliation | null,
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
 *
 * Exported in Slice 4.5.C.α₁ for reuse by the batch indexability
 * helper.
 */
export function buildRobotsSignal(
  state: Awaited<ReturnType<typeof readRobotsState>>,
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
/**
 * A.3.b1.beta (2026-05-17) — GSC opt-in budget for the diagnostic
 * caller. Mutable counter the caller (operator diagnostic page only)
 * threads through a sequence of `loadIndexabilityForUrl` invocations.
 * Each fresh GSC fetch decrements `remaining`; once it hits zero the
 * remaining URLs in the same render get cache-read-only behavior
 * (allowFreshFetch=false), so quota burn is structurally bounded.
 *
 * Customer-facing callers MUST pass `enableGsc: false` (or omit the
 * option entirely) so this counter is never touched. The opt-in
 * gate is asserted by
 * `tests/architecture/gsc-no-customer-surface-import.test.ts`.
 */
export type GscFreshFetchBudget = { remaining: number };

export async function loadIndexabilityForUrl(opts: {
  tenantId: string;
  url: string;
  now?: Date | string;
  /**
   * Operator-substrate opt-in. When false/omitted (the default), no
   * GSC signal is loaded and `signals.gsc` stays `null`; verdict is
   * byte-equal to pre-A.3.b1.beta behavior. Only the operator-only
   * `/diagnostics/indexability` page passes `enableGsc: true`.
   */
  enableGsc?: boolean;
  /**
   * Mutable per-render budget. Required when `enableGsc=true`;
   * ignored otherwise. The loader decrements `remaining` for each
   * fresh GSC fetch it issues. Locked cap is
   * `GSC_INSPECT_PER_RENDER_LIMIT = 5` (see `./load-gsc-signal`).
   */
  gscBudget?: GscFreshFetchBudget;
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

  // A.3.b1.beta cache-staleness threshold for the GSC signal.
  // Matches `CACHE_TTL_MS` inside `gscUrlInspect` — cached entries
  // older than 24h count as "stale" for prioritization purposes.
  const GSC_CACHE_STALE_MS = 24 * 60 * 60 * 1000;

  const cacheKey = ["indexability:v1", opts.tenantId, canonicalUrl];

  const cached = unstable_cache(
    async () => {
      const cfg = getBusinessConfig(opts.tenantId);
      const tenantDomain = normalizeHost(cfg.domain);

      // Phase A.3 (post-A.3.5 production-data fix, 2026-05-14):
      // route page-snapshots through the tenant-scoped repository
      // (`getRepository().forTenant(...).getPageSnapshots()`) so
      // production reads the Supabase-backed rows that the daily
      // scan dual-writes. The prior import from
      // `@/domains/pages/snapshot-store` (which calls
      // `readDotDataJson("page-snapshots")` → direct file read)
      // returned `[]` on Vercel because the lambda FS doesn't
      // carry `.data/tenants/{slug}/page-snapshots.json`. The
      // repository's tenant-scoped getter is the canonical
      // production read path (supabase-backend.ts:659–700).
      // Phase A.3 (post-A.3.5 second-stage, 2026-05-15): route ALL
      // three signal sources through the tenant-scoped repository.
      //   • Page snapshots — already routed (prior commit).
      //   • Sitemap reconciliation — newly routed through
      //     `repo.getSitemapReconciliation()`. The
      //     `@/domains/pages/sitemap-reconciliation-store` standalone
      //     module is retired from this caller; the store-
      //     classification flip from GLOBAL → TENANT_SCOPED makes
      //     the repo method tenant-routed in both backends.
      //   • Robots state — now async + tenant-scoped via the
      //     repository. Supabase-backend reads `public.robots_state`
      //     filtered by tenant_id (soft-fails to null on missing
      //     table during sequencing model A). File-backend reads
      //     `.data/tenants/{slug}/robots-state.json` via the
      //     SINGLETON classification dispatch.
      const repo = getRepository().forTenant(opts.tenantId);
      const [snapshots, reconciliation, robotsState] = await Promise.all([
        repo.getPageSnapshots(),
        repo.getSitemapReconciliation(),
        readRobotsState({ tenantId: opts.tenantId }),
      ]);

      // Snapshot lookup: exact match on canonicalized URL. The
      // repository getter is tenant-filtered upstream, so the
      // array we get back is already scoped to opts.tenantId.
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

  const baseResult = await cached();

  // A.3.b1.beta (2026-05-17) — GSC opt-in path. Default off; every
  // customer-facing caller hits the early return above.
  if (!opts.enableGsc) return baseResult;

  // Operator-substrate opt-in. Bypass the 60s unstable_cache from
  // here on: the GSC budget is per-render mutable state that cannot
  // be memoized, and the GSC adapter has its own durable 24h cache
  // in Supabase (`public.gsc_url_inspections`). The operator-only
  // diagnostic page is the sole caller; cache savings are marginal
  // relative to the durable GSC cache.

  // Step 1: cache-peek (allowFreshFetch=false) — never triggers an
  // API call. Returns the current cached signal (or null if absent).
  const cachedSignal = await loadGscSignal({
    tenantId: opts.tenantId,
    inspectionUrl: canonicalUrl,
    allowFreshFetch: false,
    now,
  });

  // Step 2: prioritization — decide whether this URL is eligible to
  // consume a fresh-fetch budget slot. Operator-locked rule:
  //   1. no cache row → eligible
  //   2. stale cache row (last_checked_at > 24h) → eligible
  //   3. composite_verdict === "unknown" → eligible
  //   4. otherwise → NOT eligible (cache value already returned)
  //
  // ALSO: only `ok` / `unknown` verdicts are eligible — higher-
  // severity verdicts (bad_status_code, noindex_meta, etc.) always
  // win, so a `not_indexed_in_gsc` flip can never reach them
  // anyway. Skipping these saves budget for URLs where the GSC
  // signal can actually change the verdict.
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const cacheLastCheckedMs =
    cachedSignal != null && cachedSignal.last_checked_at != null
      ? Date.parse(cachedSignal.last_checked_at)
      : NaN;
  const cacheIsAbsent = cachedSignal == null;
  const cacheIsStale =
    !cacheIsAbsent &&
    Number.isFinite(cacheLastCheckedMs) &&
    nowMs - cacheLastCheckedMs >= GSC_CACHE_STALE_MS;
  const verdictIsUnknown = baseResult.composite_verdict === "unknown";
  const verdictAcceptsGscFlip =
    baseResult.composite_verdict === "ok" ||
    baseResult.composite_verdict === "unknown";

  const isFreshFetchEligible =
    verdictAcceptsGscFlip &&
    (cacheIsAbsent || cacheIsStale || verdictIsUnknown);

  // Step 3: budget consumption. The caller's mutable counter is
  // shared across all per-URL calls in a single render.
  let allowFreshFetch = false;
  if (
    isFreshFetchEligible &&
    opts.gscBudget != null &&
    opts.gscBudget.remaining > 0
  ) {
    allowFreshFetch = true;
    opts.gscBudget.remaining -= 1;
  }

  // Step 4: resolve the final GSC signal.
  let gsc: IndexabilityGscSignal = cachedSignal;
  if (allowFreshFetch) {
    const freshSignal = await loadGscSignal({
      tenantId: opts.tenantId,
      inspectionUrl: canonicalUrl,
      allowFreshFetch: true,
      now,
    });
    // Fall back to cached signal if fresh fetch failed (token gone,
    // API error, etc.). Better than dropping a stale-but-useful
    // signal entirely.
    gsc = freshSignal ?? cachedSignal;
  }

  if (gsc == null) {
    // No GSC signal at all — return the base verdict unchanged.
    return baseResult;
  }

  // Step 5: recompute verdict with the GSC signal. Reuse the
  // already-fetched signals from `baseResult.signals` so we don't
  // re-read the repository. `computeIndexability` is pure.
  const ps = baseResult.signals.page_snapshot;
  return computeIndexability({
    url: canonicalUrl,
    sitemap_membership: baseResult.signals.sitemap_membership,
    robots_txt: baseResult.signals.robots_txt,
    page_snapshot:
      ps == null
        ? null
        : {
            http_status: ps.http_status,
            canonical_url: ps.canonical_url,
            has_canonical_mismatch: ps.has_canonical_mismatch,
            robots_meta: ps.robots_meta,
            fetched_at: ps.fetched_at,
            extraction_certainty: ps.extraction_certainty,
          },
    gsc,
    now,
  });
}
