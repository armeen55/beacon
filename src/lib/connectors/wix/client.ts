import "server-only";

/**
 * 2026-06-10 — Wix REST client (§push layer).
 *
 * Official endpoints (https://www.wixapis.com):
 *   • POST /wix-data/v2/items/query                 — query CMS items
 *   • PUT  /wix-data/v2/items/{dataItemId}          — update one item
 *
 * Auth: site-level API key — `Authorization: <api_key>` +
 * `wix-site-id: <site_id>` headers. Key never logged. Fail-soft
 * discriminated results; injected fetch + token seams for tests.
 *
 * SAFETY (push invariants, enforced structurally): this client exposes
 * NO delete endpoints and never writes slug/URL fields — the update
 * payload is field-merge only and `assertNoForbiddenFields` strips
 * slug-ish keys defensively.
 */

import { getWixConnectorToken, type WixConnectorToken } from "@/lib/connector-store";
import { log } from "@/lib/logger";
import type {
  WixDataItem,
  WixDiscoveredCollection,
  WixDiscoveredField,
  WixFetchResult,
} from "./types";

const WIX_BASE_URL = "https://www.wixapis.com";
const TIMEOUT_MS = 20_000;

/** Wix Data query max items per request (REST hard cap). */
const WIX_QUERY_PAGE_SIZE = 1000;
/** Safety ceiling on paginated full-collection reads: 50 × 1000 = 50k
 *  items/collection. Past this we stop + flag rather than loop forever. */
const WIX_QUERY_MAX_PAGES = 50;

export type WixDeps = {
  fetchImpl?: typeof fetch;
  /** Token override for tests. `null` = simulate not-connected. */
  token?: Pick<WixConnectorToken, "api_key" | "site_id" | "disconnected_at"> | null;
  tenantId?: string;
  /** Injectable sleep for the rate-limit backoff (tests pass a no-op so
   *  retries don't actually wait). Defaults to a real setTimeout sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
};

// Rate-limit safety (2026-06-13): Wix returns HTTP 429 when a key exceeds
// its quota, and 502/503 on transient hiccups. Retrying those with
// exponential backoff — honoring a Retry-After header when present —
// keeps a burst of pushes / a large collection sync from tripping Wix's
// limits (the ban/throttle risk). Bounded so a hard-down API still fails
// fast. Sources: Wix REST rate-limit docs (429 + Retry-After), MDN
// Retry-After, AWS/Google exponential-backoff guidance.
const WIX_MAX_RETRIES = 3;
const WIX_RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 502, 503]);
const WIX_MAX_BACKOFF_MS = 30_000;
function wixBackoffMs(attempt: number, retryAfter: string | null): number {
  const ra = retryAfter != null ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(ra) && ra >= 0) {
    return Math.min(Math.round(ra * 1000), WIX_MAX_BACKOFF_MS);
  }
  return Math.min(1000 * 2 ** attempt, 8000); // 1s, 2s, 4s, 8s …
}
const wixDefaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Slug/URL-bearing keys the push path must never modify (caps §3). */
const FORBIDDEN_FIELDS = new Set([
  "slug", "url", "link", "page-url", "pageUrl", "_id", "id",
]);

/** A URL/slug/link-bearing key Beacon must never CHANGE on an existing item
 *  (caps §3). Used to ASSERT a field edit doesn't target the URL — we never
 *  drop fields from a write payload (that once blanked a live slug → 404). */
export function isProtectedUrlField(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    FORBIDDEN_FIELDS.has(key) ||
    lower.includes("slug") ||
    lower === "link" ||
    lower.startsWith("link-") ||
    lower === "url" ||
    lower.endsWith("url")
  );
}

async function resolveToken(
  deps: WixDeps,
): Promise<WixFetchResult<Pick<WixConnectorToken, "api_key" | "site_id">>> {
  const token =
    deps.token !== undefined
      ? deps.token
      : await getWixConnectorToken(deps.tenantId);
  if (token == null) return { ok: false, reason: "no_key" };
  if (
    "disconnected_at" in token &&
    token.disconnected_at != null &&
    token.disconnected_at !== ""
  ) {
    return { ok: false, reason: "disconnected" };
  }
  return { ok: true, value: { api_key: token.api_key, site_id: token.site_id } };
}

async function wixFetch<T>(
  path: string,
  init: { method: string; body?: unknown },
  deps: WixDeps,
): Promise<WixFetchResult<T>> {
  const tok = await resolveToken(deps);
  if (!tok.ok) return tok;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleepImpl ?? wixDefaultSleep;
  let lastDetail = "unknown";
  for (let attempt = 0; attempt <= WIX_MAX_RETRIES; attempt++) {
    try {
      const res = await fetchImpl(`${WIX_BASE_URL}${path}`, {
        method: init.method,
        headers: {
          Authorization: tok.value.api_key,
          "wix-site-id": tok.value.site_id,
          "Content-Type": "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        return { ok: true, value: (await res.json().catch(() => ({}))) as T };
      }
      const text = await res.text().catch(() => "");
      lastDetail = `http_${res.status}: ${text.slice(0, 300)}`;
      // Rate-limit / transient backoff: respect Retry-After, else
      // exponential. Stop changing the live site the instant Wix pushes
      // back — never hammer past the limit (ban-safety).
      if (WIX_RETRYABLE_STATUS.has(res.status) && attempt < WIX_MAX_RETRIES) {
        await sleep(wixBackoffMs(attempt, res.headers.get("retry-after")));
        continue;
      }
      return { ok: false, reason: "api_error", detail: lastDetail };
    } catch (err) {
      // Network/timeout — not retried here (the original behavior); a
      // transient blip surfaces as api_error and the caller's own retry/
      // next-run handles it.
      return {
        ok: false,
        reason: "api_error",
        detail: err instanceof Error ? err.message : "unknown",
      };
    }
  }
  return { ok: false, reason: "api_error", detail: lastDetail };
}

/** Query ONE page of a collection's items. `offset` (default 0) +
 *  `limit` (default 200, hard-capped at WIX_QUERY_PAGE_SIZE) drive Wix's
 *  `paging`. For a complete collection read use `wixQueryAllDataItems`. */
export async function wixQueryDataItems(
  args: { dataCollectionId: string; limit?: number; offset?: number },
  deps: WixDeps = {},
): Promise<WixFetchResult<WixDataItem[]>> {
  const r = await wixFetch<{ dataItems?: Array<{ id?: string; data?: Record<string, unknown> }> }>(
    "/wix-data/v2/items/query",
    {
      method: "POST",
      body: {
        dataCollectionId: args.dataCollectionId,
        query: {
          paging: {
            limit: Math.min(args.limit ?? 200, WIX_QUERY_PAGE_SIZE),
            offset: Math.max(args.offset ?? 0, 0),
          },
        },
      },
    },
    deps,
  );
  if (!r.ok) return r;
  const items: WixDataItem[] = [];
  for (const it of r.value.dataItems ?? []) {
    if (typeof it.id !== "string") continue;
    items.push({
      id: it.id,
      dataCollectionId: args.dataCollectionId,
      data: it.data ?? {},
    });
  }
  return { ok: true, value: items };
}

/**
 * Query EVERY item of a collection, paginating until a short page (Wix
 * returns fewer than the page size) or the WIX_QUERY_MAX_PAGES ceiling.
 *
 * Fixes the silent-truncation bug where a single `limit: 1000` call
 * dropped every item past row 1000 of a collection — on a content site
 * (e.g. Iranopedia: recipes / names / cities) that silently removed pages
 * from the URL map, so they could never be matched, tracked, or pushed to.
 *
 * Mirrors the GSC search-analytics + GA4 loop-until-short-page idiom.
 * First-page failure surfaces the error verbatim (caller's `!ok` handling
 * is unchanged). Hitting the page ceiling returns the rows gathered so far
 * (partial beats zero) and logs a bounded warning.
 */
export async function wixQueryAllDataItems(
  args: { dataCollectionId: string; pageSize?: number },
  deps: WixDeps = {},
): Promise<WixFetchResult<WixDataItem[]>> {
  const pageSize = Math.min(args.pageSize ?? WIX_QUERY_PAGE_SIZE, WIX_QUERY_PAGE_SIZE);
  const all: WixDataItem[] = [];
  for (let page = 0; page < WIX_QUERY_MAX_PAGES; page++) {
    const r = await wixQueryDataItems(
      { dataCollectionId: args.dataCollectionId, limit: pageSize, offset: page * pageSize },
      deps,
    );
    // First page error → surface it. A later-page error → keep the partial
    // rows already gathered (do not lose a near-complete read to one blip).
    if (!r.ok) {
      if (page === 0) return r;
      log.warn("[wix-client] wixQueryAllDataItems: mid-pagination page failed; returning partial", {
        dataCollectionId: args.dataCollectionId,
        pagesFetched: page,
        itemsSoFar: all.length,
        reason: r.reason,
      });
      break;
    }
    for (const it of r.value) all.push(it);
    if (r.value.length < pageSize) return { ok: true, value: all }; // last page
    if (page === WIX_QUERY_MAX_PAGES - 1) {
      log.warn("[wix-client] wixQueryAllDataItems: hit WIX_QUERY_MAX_PAGES ceiling; collection truncated", {
        dataCollectionId: args.dataCollectionId,
        maxPages: WIX_QUERY_MAX_PAGES,
        itemsReturned: all.length,
      });
    }
  }
  return { ok: true, value: all };
}

/**
 * READ-ONLY discovery (§Phase 2 mapper, MAX_SEO_AEO audit P0 #2): list the
 * site's data collections + their fields so the operator can map them in a
 * guided UI instead of hand-writing JSON. Wix Data Collections v2 List
 * (GET /wix-data/v2/collections). No writes, ever.
 *
 * Narrows DEFENSIVELY against Wix's loosely-typed JSON (the API may omit a
 * field, return an unexpected shape, or nest fields differently): each
 * collection must carry a string `id`; each field a string `key`. A field's
 * type comes from `type ?? fieldType ?? "UNKNOWN"` (Wix uses both keys across
 * versions). Malformed collections/fields are skipped rather than throwing —
 * a single bad row never breaks discovery for the rest.
 */
export async function wixListDataCollections(
  deps: WixDeps = {},
): Promise<WixFetchResult<WixDiscoveredCollection[]>> {
  const r = await wixFetch<{ collections?: unknown[] }>(
    "/wix-data/v2/collections",
    { method: "GET" },
    deps,
  );
  if (!r.ok) return r;
  const out: WixDiscoveredCollection[] = [];
  for (const raw of r.value.collections ?? []) {
    if (raw == null || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const id = c.id;
    if (typeof id !== "string" || id === "") continue;
    const displayName =
      typeof c.displayName === "string" && c.displayName !== ""
        ? c.displayName
        : id;
    const fields: WixDiscoveredField[] = [];
    const rawFields = Array.isArray(c.fields) ? c.fields : [];
    for (const rf of rawFields) {
      if (rf == null || typeof rf !== "object") continue;
      const f = rf as Record<string, unknown>;
      const key = f.key;
      if (typeof key !== "string" || key === "") continue;
      const fieldDisplay =
        typeof f.displayName === "string" && f.displayName !== ""
          ? f.displayName
          : key;
      const type =
        typeof f.type === "string" && f.type !== ""
          ? f.type
          : typeof f.fieldType === "string" && f.fieldType !== ""
            ? f.fieldType
            : "UNKNOWN";
      fields.push({ key, displayName: fieldDisplay, type });
    }
    out.push({ id, displayName, fields });
  }
  return { ok: true, value: out };
}

// Blog draft-post + media-import handlers (wixCreateDraftPost /
// wixPublishDraftPost / wixImportMedia) were removed 2026-07-01 (FINAL
// PREMIUM PLAN item 102): built 2026-06-10 but never wired into any push
// route, zero callers. Rebuild from the Wix REST docs (POST
// /blog/v3/draft-posts, POST /blog/v3/draft-posts/{id}/publish, POST
// /site-media/v1/files/import) if the blog/media capability is scheduled.

// ── Wix SEO push slice (2026-06-12) — Stores product seoData ────────────
//
// Wix Stores products carry a `seoData` SeoSchema ({ tags: [...] })
// that is fully writable via the Catalog REST API with the same
// API-key + wix-site-id auth this client already uses. Per Wix's own
// docs, seoData "will override other sources of tags (for example
// patterns) and will be included in the <head> section" — i.e. a
// `script` tag with application/ld+json children renders server-side
// JSON-LD on the live product page. CMS dynamic pages have NO such
// per-item field (their SEO is template-based in the dashboard), so
// this write path is Stores-products-only by platform design.

type WixSeoTag = {
  type: "title" | "meta" | "script" | "link";
  props?: Record<string, string>;
  children?: string;
  custom?: boolean;
  disabled?: boolean;
};

type WixStoreProduct = {
  id: string;
  name: string | null;
  slug: string | null;
  seoData: { tags?: WixSeoTag[] } | null;
};

/** GET one Stores catalog product (V1). Used for the fail-closed
 *  pre-push snapshot of its current seoData. */
export async function wixGetStoreProduct(
  args: { productId: string },
  deps: WixDeps = {},
): Promise<WixFetchResult<WixStoreProduct>> {
  const r = await wixFetch<{
    product?: {
      id?: string;
      name?: string;
      slug?: string;
      seoData?: { tags?: WixSeoTag[] };
    };
  }>(`/stores/v1/products/${encodeURIComponent(args.productId)}`, {
    method: "GET",
  }, deps);
  if (!r.ok) return r;
  const p = r.value.product;
  if (p == null || typeof p.id !== "string") {
    return { ok: false, reason: "api_error", detail: "no_product_in_response" };
  }
  return {
    ok: true,
    value: {
      id: p.id,
      name: typeof p.name === "string" ? p.name : null,
      slug: typeof p.slug === "string" ? p.slug : null,
      seoData: p.seoData ?? null,
    },
  };
}

/** PATCH a product's seoData.tags (V1 catalog). PATCH semantics:
 *  only the sent fields update — the caller passes the COMPLETE
 *  desired tags array (existing tags merged upstream). */
export async function wixUpdateProductSeoData(
  args: { productId: string; tags: WixSeoTag[] },
  deps: WixDeps = {},
): Promise<WixFetchResult<{ id: string }>> {
  const r = await wixFetch<{ product?: { id?: string } }>(
    `/stores/v1/products/${encodeURIComponent(args.productId)}`,
    {
      method: "PATCH",
      body: { product: { seoData: { tags: args.tags } } },
    },
    deps,
  );
  if (!r.ok) return r;
  const id = r.value.product?.id;
  if (typeof id !== "string") {
    return { ok: false, reason: "api_error", detail: "no_product_in_response" };
  }
  return { ok: true, value: { id } };
}
