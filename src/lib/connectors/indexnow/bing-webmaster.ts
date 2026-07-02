import "server-only";

/**
 * Optional Bing Webmaster API quota check (BEACON_500 item 75 part 3,
 * 2026-07-02).
 *
 * There is no free "is this URL in Bing's index" API - scraping Bing's
 * search results would violate its ToS, so this module never does that.
 * What Bing DOES offer, if the operator connects a Bing Webmaster Tools
 * account, is the official Bing Webmaster API's URL submission quota
 * endpoint - a legitimate, documented read of "how many manual/API
 * submissions do I have left today," which is a useful honesty check
 * alongside the IndexNow receipt trail (it tells the operator whether Bing
 * is even accepting more submissions right now, without claiming to know
 * whether any specific page is indexed).
 *
 * Self-hiding: this whole module is a no-op with no per-tenant
 * `bingWebmasterApiKey` configured (see config-store.ts). Never invents a
 * number - a failed or unconfigured call returns `null`, and the caller
 * must render that as "not available" rather than a fabricated status.
 *
 * Docs: https://ssl.bing.com/webmaster/api.svc/json/GetUrlSubmissionQuota
 */

import { log } from "@/lib/logger";
import { getIndexNowConfig } from "./config-store";

const ENDPOINT = "https://ssl.bing.com/webmaster/api.svc/json/GetUrlSubmissionQuota";
const TIMEOUT_MS = 10_000;

export type BingSubmissionQuota = {
  dailyQuota: number;
  monthlyQuota: number;
};

/**
 * Reads the tenant's daily/monthly URL-submission quota from the official
 * Bing Webmaster API, if a bearer key is configured for this tenant. Returns
 * null (not zero, not an error object) when the key is absent OR the call
 * fails - both read the same to the UI: "not available right now," never a
 * fabricated number.
 */
export async function getBingSubmissionQuota(
  siteUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BingSubmissionQuota | null> {
  const config = await getIndexNowConfig();
  const apiKey = config?.bingWebmasterApiKey;
  if (!apiKey) return null; // self-hidden: no Bing Webmaster key configured

  try {
    const url = `${ENDPOINT}?siteUrl=${encodeURIComponent(siteUrl)}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn("[indexnow] Bing Webmaster quota check failed", {
        status: res.status,
      });
      return null;
    }
    const data = (await res.json()) as {
      d?: { DailyQuota?: number; MonthlyQuota?: number };
    };
    const dailyQuota = data?.d?.DailyQuota;
    const monthlyQuota = data?.d?.MonthlyQuota;
    if (typeof dailyQuota !== "number" || typeof monthlyQuota !== "number") {
      return null;
    }
    return { dailyQuota, monthlyQuota };
  } catch (err) {
    log.warn("[indexnow] Bing Webmaster quota check errored (non-blocking)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
