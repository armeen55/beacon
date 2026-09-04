import "server-only";

/** GSC URL Inspection (2026-09-03) - WHEN GOOGLE LAST CRAWLED A PAGE, so a measurement window starts the day the change was indexed instead
 *  of the day it was pressed. Roughly two in five edited pages are not recrawled inside a week, and an early reading taken before that
 *  recrawl averages the changed page with the unchanged one Google is still serving. API (primary docs): POST
 *  https://searchconsole.googleapis.com/v1/urlInspection/index:inspect with { inspectionUrl, siteUrl }, and the answer carries
 *  inspectionResult.indexStatusResult.lastCrawlTime. FREE, and Google's quota is 2000 calls a day per property, so the caller caps itself.
 *  NO SCOPE IS WIDENED HERE: it reuses the grant the search-analytics reader already resolves, which requires `webmasters.readonly`, and a
 *  grant without that scope resolves no token, so this answers nothing rather than asking the operator for more access. Fail-soft
 *  everywhere: no token, no property, a quota stop, a non-2xx or an unreadable body all leave the caller the clock it already had. */

import { log } from "@/lib/logger";
import { resolveGscAccessToken } from "./search-analytics";
import { resolveProperty } from "./sync-search-analytics";

const ENDPOINT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
/** An auth or quota answer is about the whole pass, never this one page, so the walk stops instead of spending the rest of its cap on it. */
const STOP_STATUS: ReadonlySet<number> = new Set([401, 403, 429]);

/** The last crawl Google reports for each page it answered for, as the ISO instant it gave, keyed by the url that was asked. A page Google
 *  has never crawled, and a page the call could not be made for, are both simply absent. NEVER throws. */
export async function gscLastCrawlTimes(
  tenantId: string, pages: readonly string[], deps: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!tenantId || pages.length === 0) return out;
  const token = await resolveGscAccessToken(tenantId, deps.now ?? new Date()).catch(() => null);
  if (token == null) { log.info("[gsc-url-inspection] no grant here can be asked when Google last read a page, so the ship date stays the clock", { tenantId }); return out; }
  const siteUrl = await resolveProperty(tenantId, token).catch(() => null);
  if (siteUrl == null) return out;
  const fetchImpl = deps.fetchImpl ?? fetch;
  for (const inspectionUrl of pages) {
    try {
      const res = await fetchImpl(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inspectionUrl, siteUrl }), signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        log.warn("[gsc-url-inspection] Google would not say when it last read this page", { tenantId, status: res.status });
        if (STOP_STATUS.has(res.status)) break;
        continue;
      }
      const last = (await res.json() as { inspectionResult?: { indexStatusResult?: { lastCrawlTime?: unknown } } })?.inspectionResult?.indexStatusResult?.lastCrawlTime;
      if (typeof last === "string" && last.length >= 10) out.set(inspectionUrl, last);
    } catch { /* one page that would not answer never stops the pass */ }
  }
  return out;
}
