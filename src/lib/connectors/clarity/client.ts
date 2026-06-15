/**
 * Connect-cards slice (2026-06-12) — Microsoft Clarity Data Export
 * client. ONE documented endpoint (learn.microsoft.com/clarity —
 * Data Export API):
 *
 *   GET https://www.clarity.ms/export-data/api/v1/project-live-insights
 *     ?numOfDays=1|2|3 [&dimension1=URL ...]
 *   Authorization: Bearer <per-project token>
 *
 * Hard platform limits (server-enforced; researched + cited in the
 * connect-cards commit): 10 requests/DAY per project, 1-3 day
 * lookback only (no backfill, no pagination, ≤1000 rows, ≤3
 * dimensions). The nightly harvester budgets ONE request/day.
 *
 * The response is a JSON array of metric objects:
 *   [{ metricName: "Traffic", information: [{ totalSessionCount,
 *      Url?, ... }] }, { metricName: "RageClickCount", information:
 *      [{ subTotal/ sessionsWithMetricPercentage, Url? ... }] }, ...]
 * Field naming in the wild varies by metric — the parser is
 * defensive: it keys rows by the URL dimension and reads the first
 * numeric-looking count field. Fail-soft null on any error.
 */

import "server-only";

import { getConnectorToken } from "@/lib/connector-store";
import { log } from "@/lib/logger";

const ENDPOINT =
  "https://www.clarity.ms/export-data/api/v1/project-live-insights";

export type ClarityUrlMetrics = {
  url: string;
  sessions: number;
  rageClicks: number;
  deadClicks: number;
  excessiveScroll: number;
  quickbacks: number;
  scriptErrors: number;
  avgScrollDepth: number | null;
  engagementTimeSeconds: number | null;
};

type RawMetric = {
  metricName?: string;
  information?: Array<Record<string, unknown>>;
};

function numField(row: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return 0;
}

function urlField(row: Record<string, unknown>): string | null {
  for (const k of ["Url", "url", "URL", "PagesViews", "Page"]) {
    const v = row[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  return null;
}

/** Fetch yesterday-ish per-URL behavioral metrics (numOfDays=1).
 *  ONE request — the whole daily budget the harvester spends.
 *
 *  Kept at numOfDays=1 deliberately: the Clarity Data Export API returns a
 *  SINGLE aggregate per URL over the requested window with NO per-day
 *  breakdown, and the sync stamps every row with one date (yesterday). So
 *  numOfDays>1 would mislabel a multi-day total as a single day's metrics
 *  (3× inflation). Clarity exposes only a rolling 1–3 day window and cannot
 *  backfill — long-term history is ACCUMULATED forward, one clean daily row
 *  per refresh, never fetched in bulk. */
export async function fetchClarityUrlMetrics(args: {
  tenantId: string;
}): Promise<ClarityUrlMetrics[] | null> {
  const token = await getConnectorToken("clarity", args.tenantId);
  if (
    token == null ||
    token.provider !== "clarity" ||
    !token.api_token ||
    (token.disconnected_at != null && token.disconnected_at !== "")
  ) {
    return null;
  }
  let raw: RawMetric[];
  try {
    const res = await fetch(
      `${ENDPOINT}?numOfDays=1&dimension1=URL`,
      {
        headers: { Authorization: `Bearer ${token.api_token}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      log.warn("[clarity-client] non-2xx", { status: res.status });
      return null;
    }
    raw = (await res.json()) as RawMetric[];
    if (!Array.isArray(raw)) return null;
  } catch (err) {
    log.warn("[clarity-client] fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const byUrl = new Map<string, ClarityUrlMetrics>();
  const ensure = (url: string): ClarityUrlMetrics => {
    let m = byUrl.get(url);
    if (!m) {
      m = {
        url,
        sessions: 0,
        rageClicks: 0,
        deadClicks: 0,
        excessiveScroll: 0,
        quickbacks: 0,
        scriptErrors: 0,
        avgScrollDepth: null,
        engagementTimeSeconds: null,
      };
      byUrl.set(url, m);
    }
    return m;
  };

  for (const metric of raw) {
    const name = (metric.metricName ?? "").toLowerCase();
    for (const row of metric.information ?? []) {
      const url = urlField(row);
      if (!url) continue;
      const m = ensure(url);
      const count = numField(row, [
        "subTotal",
        "totalSessionCount",
        "sessionsCount",
        "count",
        "total",
      ]);
      if (name.includes("traffic")) m.sessions = count || m.sessions;
      else if (name.includes("rage")) m.rageClicks = count;
      else if (name.includes("dead")) m.deadClicks = count;
      else if (name.includes("excessive")) m.excessiveScroll = count;
      else if (name.includes("quick")) m.quickbacks = count;
      else if (name.includes("error")) m.scriptErrors = count;
      else if (name.includes("scroll") && name.includes("depth")) {
        m.avgScrollDepth = numField(row, ["averageScrollDepth", "average", "subTotal"]) || null;
      } else if (name.includes("engagement")) {
        m.engagementTimeSeconds =
          numField(row, ["activeTime", "totalTime", "subTotal"]) || null;
      }
    }
  }
  return [...byUrl.values()];
}
