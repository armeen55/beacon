import "server-only";

/**
 * 2026-06-10 — Wix REST client (§push layer).
 *
 * Official endpoints (https://www.wixapis.com):
 *   • POST /wix-data/v2/items/query                 — query CMS items
 *   • PUT  /wix-data/v2/items/{dataItemId}          — update one item
 *   • POST /blog/v3/draft-posts                     — create draft post
 *   • POST /blog/v3/draft-posts/{id}/publish        — publish draft
 *   • POST /site-media/v1/files/import              — import media by URL
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
import type { WixDataItem, WixDraftPostRef, WixFetchResult } from "./types";

export const WIX_BASE_URL = "https://www.wixapis.com";
const TIMEOUT_MS = 20_000;

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

export function stripForbiddenFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const lower = k.toLowerCase();
    if (
      FORBIDDEN_FIELDS.has(k) ||
      lower.includes("slug") ||
      // Wix auto-generates URL-bearing "link-…" fields on dynamic items.
      lower === "link" ||
      lower.startsWith("link-")
    ) {
      continue;
    }
    out[k] = v;
  }
  return out;
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

/** Query items of one collection (paged; v1 pulls up to `limit`). */
export async function wixQueryDataItems(
  args: { dataCollectionId: string; limit?: number },
  deps: WixDeps = {},
): Promise<WixFetchResult<WixDataItem[]>> {
  const r = await wixFetch<{ dataItems?: Array<{ id?: string; data?: Record<string, unknown> }> }>(
    "/wix-data/v2/items/query",
    {
      method: "POST",
      body: {
        dataCollectionId: args.dataCollectionId,
        query: { paging: { limit: Math.min(args.limit ?? 200, 1000) } },
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
 * Field-merge update of ONE item: reads nothing, writes only the given
 * fields (server merges via PATCH semantics — we send the full data
 * object the caller built from current+patch, minus forbidden keys).
 */
export async function wixUpdateDataItem(
  args: {
    dataCollectionId: string;
    dataItemId: string;
    /** FULL data object to save (caller merges current + patch). */
    data: Record<string, unknown>;
  },
  deps: WixDeps = {},
): Promise<WixFetchResult<WixDataItem>> {
  const safe = stripForbiddenFields(args.data);
  const r = await wixFetch<{ dataItem?: { id?: string; data?: Record<string, unknown> } }>(
    `/wix-data/v2/items/${encodeURIComponent(args.dataItemId)}`,
    {
      method: "PUT",
      body: {
        dataCollectionId: args.dataCollectionId,
        dataItem: { data: safe },
      },
    },
    deps,
  );
  if (!r.ok) return r;
  return {
    ok: true,
    value: {
      id: r.value.dataItem?.id ?? args.dataItemId,
      dataCollectionId: args.dataCollectionId,
      data: r.value.dataItem?.data ?? safe,
    },
  };
}

/**
 * INSERT a new CMS item (§page-factory create path). Unlike updates,
 * creation MAY set the slug field — a NEW page has no URL to change
 * (Invariant 3 forbids changing existing URLs/nav and deleting; net-new
 * pages are the cluster feature itself, behind approval + the daily cap).
 * Only `_id`/`id` are stripped (server assigns identity).
 */
export async function wixInsertDataItem(
  args: { dataCollectionId: string; data: Record<string, unknown> },
  deps: WixDeps = {},
): Promise<WixFetchResult<WixDataItem>> {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.data)) {
    if (k === "_id" || k === "id") continue;
    data[k] = v;
  }
  const r = await wixFetch<{ dataItem?: { id?: string; data?: Record<string, unknown> } }>(
    "/wix-data/v2/items",
    {
      method: "POST",
      body: { dataCollectionId: args.dataCollectionId, dataItem: { data } },
    },
    deps,
  );
  if (!r.ok) return r;
  const id = r.value.dataItem?.id;
  if (typeof id !== "string") {
    return { ok: false, reason: "api_error", detail: "no_item_id_in_response" };
  }
  return {
    ok: true,
    value: { id, dataCollectionId: args.dataCollectionId, data: r.value.dataItem?.data ?? data },
  };
}

/** Create a blog draft post (NOT published). */
export async function wixCreateDraftPost(
  args: { title: string; contentHtml: string; memberId?: string },
  deps: WixDeps = {},
): Promise<WixFetchResult<WixDraftPostRef>> {
  const r = await wixFetch<{ draftPost?: { id?: string; title?: string } }>(
    "/blog/v3/draft-posts",
    {
      method: "POST",
      body: {
        draftPost: {
          title: args.title,
          // richContent is Wix's native format; contentText keeps v1
          // simple — the draft opens in the Wix editor for final review.
          contentText: args.contentHtml,
          ...(args.memberId ? { memberId: args.memberId } : {}),
        },
      },
    },
    deps,
  );
  if (!r.ok) return r;
  const id = r.value.draftPost?.id;
  if (typeof id !== "string") {
    return { ok: false, reason: "api_error", detail: "no_draft_id_in_response" };
  }
  return { ok: true, value: { id, title: r.value.draftPost?.title ?? args.title } };
}

/** Publish an existing draft post. */
export async function wixPublishDraftPost(
  args: { draftPostId: string },
  deps: WixDeps = {},
): Promise<WixFetchResult<{ postId: string }>> {
  const r = await wixFetch<{ postId?: string }>(
    `/blog/v3/draft-posts/${encodeURIComponent(args.draftPostId)}/publish`,
    { method: "POST" },
    deps,
  );
  if (!r.ok) return r;
  return {
    ok: true,
    value: { postId: r.value.postId ?? args.draftPostId },
  };
}

/** Import a media file into the Media Manager from a public URL. */
export async function wixImportMedia(
  args: { url: string; displayName?: string },
  deps: WixDeps = {},
): Promise<WixFetchResult<{ fileId: string }>> {
  const r = await wixFetch<{ file?: { id?: string } }>(
    "/site-media/v1/files/import",
    {
      method: "POST",
      body: { url: args.url, displayName: args.displayName },
    },
    deps,
  );
  if (!r.ok) return r;
  const id = r.value.file?.id;
  if (typeof id !== "string") {
    return { ok: false, reason: "api_error", detail: "no_file_id_in_response" };
  }
  return { ok: true, value: { fileId: id } };
}

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

export type WixSeoTag = {
  type: "title" | "meta" | "script" | "link";
  props?: Record<string, string>;
  children?: string;
  custom?: boolean;
  disabled?: boolean;
};

export type WixStoreProduct = {
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
