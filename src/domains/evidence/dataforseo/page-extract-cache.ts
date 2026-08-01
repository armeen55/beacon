import "server-only";
import { createHash } from "node:crypto";
import { identityCacheKey } from "./cached-call";
import { resolveDeps } from "./default-deps";
import type { FunnelBoundaryDeps } from "./funnel-boundary";
import { canonicalUrl } from "./capabilities";
import { freshnessMsFor } from "../freshness";

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
/** A BANKED BODY EXPIRES WHEN THE MATRIX SAYS THE BODY IS OLD, never a week sooner: this row is the reuse
 *  that keeps a winning page from being fetched or bought again, and expiring it at seven days threw away
 *  three weeks of a read the projection above it still counts as current. */
const EXTRACT_TTL_MS = freshnessMsFor("winner_extract");

// ── content-hash-aware public page-extract reuse (same evidence_cache table) ──
const PAGE_EXTRACT_ENDPOINT = "public/page_extract";
function pageExtractKey(url: string): string {
  return identityCacheKey({ endpoint: PAGE_EXTRACT_ENDPOINT, publicInput: { url: canonicalUrl(url) }, locationCode: 0, languageCode: "" });
}

export async function readPublicPageExtract(url: string, deps: FunnelBoundaryDeps = {}): Promise<{ extract: Record<string, unknown>; contentHash: string; fetchedAt: string } | null> {
  const d = resolveDeps(deps);
  const row = await d.cacheRead(pageExtractKey(url)).catch(() => null);
  if (!row || row.status !== "ready" || row.payload == null || Date.parse(row.expires_at) <= d.now().getTime()) return null;
  const p = row.payload as { extract?: Record<string, unknown>; content_hash?: string; fetched_at?: string };
  return { extract: p.extract ?? {}, contentHash: p.content_hash ?? "", fetchedAt: p.fetched_at ?? "" };
}

export async function writePublicPageExtract(url: string, extract: Record<string, unknown>, contentHash: string, deps: FunnelBoundaryDeps = {}): Promise<void> {
  const d = resolveDeps(deps);
  const now = d.now();
  await d.cacheUpsert(pageExtractKey(url), {
    endpoint: PAGE_EXTRACT_ENDPOINT, endpoint_version: "v3", input_hash: sha256(canonicalUrl(url)).slice(0, 40),
    input_summary: canonicalUrl(url).slice(0, 200), location_code: 0, language_code: "", status: "ready",
    payload: { extract, content_hash: contentHash, fetched_at: now.toISOString() }, content_hash: contentHash, cost_usd: 0,
    ready_at: now.toISOString(), expires_at: new Date(now.getTime() + EXTRACT_TTL_MS).toISOString(), fetch_claimed_until: null,
  }).catch(() => {});
}
