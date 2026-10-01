import "server-only";
import { PROOF_SPEND } from "@/lib/spend-scope";
import { createHash } from "node:crypto";
import { identityCacheKey } from "./cached-call";
import { resolveDeps } from "./default-deps";
import type { FunnelBoundaryDeps } from "./funnel-boundary";
import { canonicalUrl } from "./capabilities";
import { freshnessMsFor, isCurrent } from "../freshness"; import { pageExtractFromRecord } from "../funnel/research-evidence";

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const EXTRACT_TTL_MS = freshnessMsFor("winner_extract");

const PAGE_EXTRACT_ENDPOINT = "public/page_extract";
function pageExtractKey(url: string): string {
  return identityCacheKey({ endpoint: PAGE_EXTRACT_ENDPOINT, publicInput: { url: canonicalUrl(url) }, locationCode: 0, languageCode: "" });
}

export async function readPublicPageExtract(url: string, deps: FunnelBoundaryDeps = {}, held?: Pick<ReturnType<typeof pageExtractFromRecord>, "title" | "h1" | "mainText" | "fetchedAt">): Promise<{ extract: Record<string, unknown>; contentHash: string; fetchedAt: string } | null> {
  const d = resolveDeps(deps);
  const row = await d.cacheRead(pageExtractKey(url)).catch(() => null);
  if (!row || row.status !== "ready" || row.payload == null || !(Date.parse(row.expires_at) > d.now().getTime()) || PROOF_SPEND.cacheOnly() && (row.cache_key !== pageExtractKey(url) || row.endpoint !== PAGE_EXTRACT_ENDPOINT || !!row.quarantined_at || !!row.error_detail)) return null;
  const p = row.payload as { extract?: Record<string, unknown>; content_hash?: string; fetched_at?: string };
  const extract = p.extract ?? {}, original = pageExtractFromRecord(extract), date = Object.hasOwn(extract, "fetchedAt") ? original.fetchedAt : p.fetched_at, norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
  // Complete-pattern callers bind the original to their dated tenant-held capture; wrapper clocks cannot refresh it.
  if (held && (original.truncated !== false || !original.mainText?.trim() || !held.mainText?.trim() || !date || Date.parse(date) > d.now().getTime() || !isCurrent("winner_extract", date, d.now().getTime()) || date !== held.fetchedAt || norm(original.title) !== norm(held.title) || norm(original.h1) !== norm(held.h1) || !norm(original.mainText).startsWith(norm(held.mainText)) || original.totalChars != null && original.totalChars !== original.mainText.length || typeof extract.url === "string" && canonicalUrl(extract.url) !== canonicalUrl(url))) return null;
  return { extract: held ? { ...extract, fetchedAt: date } : extract, contentHash: p.content_hash ?? "", fetchedAt: p.fetched_at ?? "" };
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
