/**
 * Profound connector client (2026-06-12 night shift) — answer-engine
 * visibility + citations for the tenant's own brand, from Profound's
 * official REST API. Spec verified against the OFFICIAL docs on
 * 2026-06-12 (docs digest in docs/research/CONNECTOR_RESEARCH_2026-06-12.md):
 *
 *   • Base URL https://api.tryprofound.com; auth header `X-API-Key`
 *     (docs.tryprofound.com/rest-api/authentication). Keys are
 *     customer-minted, EXPIRE, and the API is beta/Enterprise-gated —
 *     401 means "re-paste your key", not a Beacon bug.
 *   • Rate limit 600 requests/hour per key
 *     (docs.tryprofound.com/rest-api/introduction). A full nightly
 *     sync is ~2 + 2·categories requests — trivially inside it.
 *   • Report envelope (docs.tryprofound.com/rest-api/response-format):
 *     `{ info: { total_rows }, data: [{ dimensions: [...], metrics: [...] }] }`
 *     where dimensions[i]/metrics[i] are POSITIONAL — they map to the
 *     i-th requested dimension/metric in request order. The decoder
 *     below is the single place that rule lives.
 *   • Dates are inclusive both ends and interpreted as EST when sent
 *     as plain "YYYY-MM-DD" (docs.tryprofound.com/rest-api/date-ranges
 *     — "Incorrect timezone handling is the most common cause of
 *     missing or unexpected data").
 *
 * Fail-soft null everywhere, like every Beacon connector fetch: the
 * nightly cron must never die on a connector.
 */

import "server-only";

import { getConnectorToken } from "@/lib/connector-store";
import { log } from "@/lib/logger";

export const PROFOUND_BASE_URL = "https://api.tryprofound.com";

export type ProfoundFetchDeps = {
  fetchImpl?: typeof fetch;
  /** Test seam — resolves the tenant's API key. */
  getApiKey?: (tenantId: string) => Promise<string | null>;
};

async function defaultGetApiKey(tenantId: string): Promise<string | null> {
  const token = await getConnectorToken("profound", tenantId);
  if (token == null || token.provider !== "profound") return null;
  if (token.disconnected_at) return null;
  return token.api_key || null;
}

/**
 * #88 (2026-06-14) — does this tenant have a usable Profound key? Pure
 * classification (no HTTP), reusing the SAME key resolver the fetch uses
 * (test seam honored). Lets the sync split the old `no_key_or_api_error`
 * conflation into an honest "not connected yet" (no key) vs "the API call
 * failed" (key present but the request errored) — so a real auth/API error
 * never hides behind a benign "skipped" and zero-results never looks failed.
 */
export async function profoundKeyPresent(
  tenantId: string,
  deps: ProfoundFetchDeps = {},
): Promise<boolean> {
  const getApiKey = deps.getApiKey ?? defaultGetApiKey;
  return (await getApiKey(tenantId)) != null;
}

async function profoundRequest(
  args: {
    tenantId: string;
    method: "GET" | "POST";
    path: string;
    body?: unknown;
  },
  deps: ProfoundFetchDeps = {},
): Promise<unknown | null> {
  const getApiKey = deps.getApiKey ?? defaultGetApiKey;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const apiKey = await getApiKey(args.tenantId);
  if (apiKey == null) return null;

  try {
    const res = await fetchImpl(PROFOUND_BASE_URL + args.path, {
      method: args.method,
      headers: {
        "X-API-Key": apiKey,
        ...(args.body != null ? { "Content-Type": "application/json" } : {}),
      },
      ...(args.body != null ? { body: JSON.stringify(args.body) } : {}),
    });
    if (!res.ok) {
      // 401 → expired/revoked key (Profound keys expire by design);
      // 429 → hourly budget; both are skip-tonight conditions.
      log.warn("[profound] non-2xx", {
        tenantId: args.tenantId,
        path: args.path,
        status: res.status,
      });
      return null;
    }
    return (await res.json()) as unknown;
  } catch (err) {
    log.warn("[profound] fetch failed", {
      tenantId: args.tenantId,
      path: args.path,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Discovery — GET /v1/org/categories (the workspace IDs every report needs).
// ---------------------------------------------------------------------------

export type ProfoundCategory = { id: string; name: string };

export async function fetchProfoundCategories(
  tenantId: string,
  deps: ProfoundFetchDeps = {},
): Promise<ProfoundCategory[] | null> {
  const raw = await profoundRequest(
    { tenantId, method: "GET", path: "/v1/org/categories" },
    deps,
  );
  if (raw == null) return null;
  // Docs show a bare array; tolerate a {data: [...]} wrapper defensively.
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown }).data)
      ? ((raw as { data: unknown[] }).data)
      : null;
  if (list == null) return null;
  const out: ProfoundCategory[] = [];
  for (const item of list) {
    if (item == null || typeof item !== "object") continue;
    const { id, name } = item as { id?: unknown; name?: unknown };
    if (typeof id === "string" && id.length > 0) {
      out.push({ id, name: typeof name === "string" ? name : "" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agents — the ONLY "submit input, run now" primitive in the API (deep-research
// 2026-06-22). Prompt Volumes / Query Fanout Estimator / AEO Content Scorecard
// have NO arbitrary-input REST endpoint; the way to run them on a query/URL of
// OUR choosing (no tracked category, no waiting for a daily run) is to invoke a
// PUBLISHED Profound Agent that wraps those nodes:
//   1. GET  /v1/agents                      → find the published agent + its id
//   2. GET  /v1/agents/{id}                 → read input/output VARIABLE IDS
//   3. POST /v1/agents/{id}/runs            → 202 + run id (ASYNC, not sync)
//   4. GET  /v1/agents/{id}/runs/{run_id}   → poll to terminal, read outputs
// All fail-soft → null, reusing profoundRequest (X-API-Key, 401/429 skip).
// ---------------------------------------------------------------------------

export type ProfoundAgent = { id: string; name: string; status: string };

/** A run is done once it reaches one of these (no webhook — poll only). */
export const TERMINAL_AGENT_RUN_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "canceled",
  "skipped",
  "error",
]);

export function isTerminalAgentRunStatus(status: string | null | undefined): boolean {
  return status != null && TERMINAL_AGENT_RUN_STATUSES.has(status.toLowerCase());
}

function asList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  const data = (raw as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data : null;
}

/** Published + draft agents on the org. Discovery: the load-bearing check for
 *  whether an arbitrary-input (Prompt-Volumes/Fanout/AEO) agent exists at all. */
export async function listProfoundAgents(
  tenantId: string,
  deps: ProfoundFetchDeps = {},
): Promise<ProfoundAgent[] | null> {
  const raw = await profoundRequest({ tenantId, method: "GET", path: "/v1/agents" }, deps);
  const list = asList(raw);
  if (list == null) return null;
  const out: ProfoundAgent[] = [];
  for (const item of list) {
    if (item == null || typeof item !== "object") continue;
    const { id, name, status } = item as { id?: unknown; name?: unknown; status?: unknown };
    if (typeof id === "string" && id.length > 0) {
      out.push({
        id,
        name: typeof name === "string" ? name : "",
        status: typeof status === "string" ? status : "",
      });
    }
  }
  return out;
}

/** Start an agent run. `inputs` keys are the agent's input VARIABLE IDs (read
 *  them via GET /v1/agents/{id}). Returns the run id (async). */
export async function startProfoundAgentRun(
  args: { tenantId: string; agentId: string; inputs: Record<string, unknown> },
  deps: ProfoundFetchDeps = {},
): Promise<{ runId: string } | null> {
  const raw = await profoundRequest(
    {
      tenantId: args.tenantId,
      method: "POST",
      path: `/v1/agents/${encodeURIComponent(args.agentId)}/runs`,
      body: { inputs: args.inputs },
    },
    deps,
  );
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as { id?: unknown; run_id?: unknown };
  const runId = typeof r.id === "string" ? r.id : typeof r.run_id === "string" ? r.run_id : null;
  return runId ? { runId } : null;
}

export type ProfoundAgentRun = {
  status: string;
  outputs: Record<string, unknown> | null;
};

/** Poll a single run. status is one of pending/running/<terminal>. */
export async function getProfoundAgentRun(
  args: { tenantId: string; agentId: string; runId: string },
  deps: ProfoundFetchDeps = {},
): Promise<ProfoundAgentRun | null> {
  const raw = await profoundRequest(
    {
      tenantId: args.tenantId,
      method: "GET",
      path: `/v1/agents/${encodeURIComponent(args.agentId)}/runs/${encodeURIComponent(args.runId)}`,
    },
    deps,
  );
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as { status?: unknown; outputs?: unknown };
  return {
    status: typeof r.status === "string" ? r.status : "",
    outputs:
      r.outputs != null && typeof r.outputs === "object"
        ? (r.outputs as Record<string, unknown>)
        : null,
  };
}

/**
 * Start an agent run and poll it to terminal status. Bounded: stops after
 * `maxWaitMs` (default 60s) with `pollMs` spacing (default 3s) so it never
 * starves the 600/hr budget or hangs a request. Returns the terminal run
 * (read `.outputs[<variable_id>]`) or null on any failure / timeout. The
 * `sleep` dep is injectable so tests run instantly.
 */
export async function runProfoundAgentToCompletion(
  args: {
    tenantId: string;
    agentId: string;
    inputs: Record<string, unknown>;
    maxWaitMs?: number;
    pollMs?: number;
  },
  deps: ProfoundFetchDeps & { sleep?: (ms: number) => Promise<void> } = {},
): Promise<ProfoundAgentRun | null> {
  const maxWaitMs = args.maxWaitMs ?? 60_000;
  const pollMs = args.pollMs ?? 3_000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const started = await startProfoundAgentRun(
    { tenantId: args.tenantId, agentId: args.agentId, inputs: args.inputs },
    deps,
  );
  if (started == null) return null;

  const deadline = maxWaitMs;
  let waited = 0;
  // Poll until terminal or the budget window elapses.
  for (;;) {
    const run = await getProfoundAgentRun(
      { tenantId: args.tenantId, agentId: args.agentId, runId: started.runId },
      deps,
    );
    if (run == null) return null;
    if (isTerminalAgentRunStatus(run.status)) return run;
    if (waited >= deadline) return null; // timed out before terminal
    await sleep(pollMs);
    waited += pollMs;
  }
}

// ---------------------------------------------------------------------------
// Report envelope decoding — THE positional rule.
// ---------------------------------------------------------------------------

export type ProfoundReportRow = {
  /** Requested dimension name → value (string-coerced). */
  dims: Record<string, string>;
  /** Requested metric name → numeric value (non-numeric → 0). */
  mets: Record<string, number>;
};

/**
 * Decode Profound's positional report envelope. `dimensions[i]` /
 * `metrics[i]` in each data row correspond to the i-th REQUESTED
 * dimension/metric — this helper re-keys them by name so nothing
 * downstream depends on request order. Rows with mismatched arity
 * are dropped (beta API; never guess a misaligned mapping).
 */
export function decodeProfoundEnvelope(
  requestedDimensions: readonly string[],
  requestedMetrics: readonly string[],
  payload: unknown,
): { rows: ProfoundReportRow[]; totalRows: number } | null {
  if (payload == null || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const info = (payload as { info?: { total_rows?: unknown } }).info;
  const totalRows =
    typeof info?.total_rows === "number" ? info.total_rows : data.length;

  const rows: ProfoundReportRow[] = [];
  for (const item of data) {
    if (item == null || typeof item !== "object") continue;
    const d = (item as { dimensions?: unknown }).dimensions;
    const m = (item as { metrics?: unknown }).metrics;
    const dimsArr = Array.isArray(d) ? d : [];
    const metsArr = Array.isArray(m) ? m : [];
    if (
      dimsArr.length !== requestedDimensions.length ||
      metsArr.length !== requestedMetrics.length
    ) {
      continue; // positional contract broken — drop, never misalign
    }
    const dims: Record<string, string> = {};
    requestedDimensions.forEach((name, i) => {
      const v = dimsArr[i];
      dims[name] = v == null ? "" : String(v);
    });
    const mets: Record<string, number> = {};
    requestedMetrics.forEach((name, i) => {
      const v = metsArr[i];
      mets[name] = typeof v === "number" && Number.isFinite(v) ? v : 0;
    });
    rows.push({ dims, mets });
  }
  return { rows, totalRows };
}

// ---------------------------------------------------------------------------
// Reports — POST /v1/reports/{citations,visibility}.
// ---------------------------------------------------------------------------

/** Single page cap per the docs (limit ≤ 50000, default 10000). One
 *  page is plenty for a 3-day window; `totalRows` lets the caller log
 *  honestly if anything was left behind (no silent caps). */
const REPORT_PAGE_LIMIT = 50_000;

export async function queryProfoundReport(
  args: {
    tenantId: string;
    /** "citations" | "visibility" | "sentiment" | "query-fanouts" */
    report: string;
    categoryId: string;
    /** Plain YYYY-MM-DD — interpreted as EST by Profound (inclusive). */
    startDate: string;
    endDate: string;
    metrics: readonly string[];
    dimensions: readonly string[];
  },
  deps: ProfoundFetchDeps = {},
): Promise<{ rows: ProfoundReportRow[]; totalRows: number } | null> {
  const raw = await profoundRequest(
    {
      tenantId: args.tenantId,
      method: "POST",
      path: `/v1/reports/${args.report}`,
      body: {
        category_id: args.categoryId,
        start_date: args.startDate,
        end_date: args.endDate,
        date_interval: "day",
        metrics: args.metrics,
        dimensions: args.dimensions,
        pagination: { limit: REPORT_PAGE_LIMIT, offset: 0 },
      },
    },
    deps,
  );
  if (raw == null) return null;
  return decodeProfoundEnvelope(args.dimensions, args.metrics, raw);
}

// ---------------------------------------------------------------------------
// Agent Analytics v2 — POST /v2/reports/{bots,referrals}.
// Unlike the /v1 answer-engine reports these take a RAW `domain` (no
// category_id needed) and default end_date to now-UTC (official spec:
// api-reference/reports/get-bots-report-v2 + get-referrals-report-v2;
// the deprecated /v1/logs/raw* path sunset 2026-06-10 — these v2
// hourly-materialized reports are the replacement).
// ---------------------------------------------------------------------------

export async function queryProfoundV2Report(
  args: {
    tenantId: string;
    /** "bots" | "referrals" */
    report: string;
    domain: string;
    /** Plain YYYY-MM-DD (inclusive; EST semantics like all dates). */
    startDate: string;
    endDate: string;
    metrics: readonly string[];
    dimensions: readonly string[];
  },
  deps: ProfoundFetchDeps = {},
): Promise<{ rows: ProfoundReportRow[]; totalRows: number } | null> {
  const raw = await profoundRequest(
    {
      tenantId: args.tenantId,
      method: "POST",
      path: `/v2/reports/${args.report}`,
      body: {
        domain: args.domain,
        start_date: args.startDate,
        end_date: args.endDate,
        date_interval: "day",
        metrics: args.metrics,
        dimensions: args.dimensions,
        pagination: { limit: 50_000, offset: 0 },
      },
    },
    deps,
  );
  if (raw == null) return null;
  return decodeProfoundEnvelope(args.dimensions, args.metrics, raw);
}
