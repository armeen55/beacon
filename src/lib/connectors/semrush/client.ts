import "server-only";

/**
 * 2026-06-09 — Semrush Analytics API client.
 *
 * Key-based auth (like Yelp, no OAuth): the operator's API key + default
 * regional database live in the per-tenant `connector_tokens` row. This
 * module builds the request, fetches, and returns the raw CSV; report
 * parsing lives in `domain-reports.ts`.
 *
 * Hard contracts:
 *   • Server-only. The API key is never returned to the client and
 *     never logged.
 *   • Tenant-scoped: the key is read for `tenantId` only.
 *   • Fail-soft: no key / disconnected / non-2xx / ERROR body / network
 *     fault → a discriminated `{ ok: false, reason }`, never a throw, so
 *     a Semrush outage never breaks a render or the recommendation loop.
 *   • Unit-aware by default: `display_limit` defaults small (Semrush
 *     bills per result row) so a misconfig can't drain the operator's
 *     week-limited unit balance.
 *
 * `deps.fetchImpl` + `deps.token` are test seams — production omits both
 * (real `fetch`, real connector-store read). Tests never touch network.
 */

import { getSemrushConnectorToken } from "@/lib/connector-store";

export const SEMRUSH_BASE_URL = "https://api.semrush.com/";

/** Default rows per report. Small on purpose — Semrush bills per line. */
export const SEMRUSH_DEFAULT_DISPLAY_LIMIT = 10;

export type SemrushRawFetchArgs = {
  tenantId: string;
  /** Report type, e.g. "domain_ranks" / "domain_organic_organic". */
  type: string;
  /** Target domain (the `domain` param). */
  domain: string;
  /** Override the token's default regional database. */
  database?: string;
  /** Comma-separated Semrush column codes. */
  exportColumns?: string;
  /** Row cap. Defaults to SEMRUSH_DEFAULT_DISPLAY_LIMIT. */
  displayLimit?: number;
  /** Sort order, e.g. "tr_desc" (traffic share) — Insight Graph
   *  slice 2 (2026-06-12). Omitted → Semrush's default sort. */
  displaySort?: string;
};

export type SemrushTokenLike = {
  api_key: string;
  database: string;
  disconnected_at?: string;
};

export type SemrushRawFetchDeps = {
  fetchImpl?: typeof fetch;
  /**
   * Token override. `undefined` (default) → read connector-store.
   * `null` → simulate "no key". An object → use it directly (tests).
   */
  token?: SemrushTokenLike | null;
};

export type SemrushRawFetchResult =
  | { ok: true; csv: string }
  | {
      ok: false;
      reason: "no_key" | "disconnected" | "api_error";
      detail?: string;
    };

/**
 * Fetch one Semrush Analytics report as raw CSV. Fail-soft.
 */
export async function semrushRawFetch(
  args: SemrushRawFetchArgs,
  deps: SemrushRawFetchDeps = {},
): Promise<SemrushRawFetchResult> {
  const token =
    deps.token !== undefined
      ? deps.token
      : await getSemrushConnectorToken(args.tenantId);

  if (token == null || token.api_key === "") {
    return { ok: false, reason: "no_key" };
  }
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return { ok: false, reason: "disconnected" };
  }

  const url = new URL(SEMRUSH_BASE_URL);
  url.searchParams.set("type", args.type);
  url.searchParams.set("key", token.api_key);
  url.searchParams.set("domain", args.domain);
  url.searchParams.set("database", args.database ?? token.database);
  if (args.exportColumns != null && args.exportColumns !== "") {
    url.searchParams.set("export_columns", args.exportColumns);
  }
  url.searchParams.set(
    "display_limit",
    String(args.displayLimit ?? SEMRUSH_DEFAULT_DISPLAY_LIMIT),
  );
  if (args.displaySort != null && args.displaySort !== "") {
    url.searchParams.set("display_sort", args.displaySort);
  }

  const doFetch = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url.toString());
  } catch (e) {
    return {
      ok: false,
      reason: "api_error",
      detail: e instanceof Error ? e.message : "network error",
    };
  }
  if (!res.ok) {
    return { ok: false, reason: "api_error", detail: `HTTP ${res.status}` };
  }
  let csv: string;
  try {
    csv = await res.text();
  } catch {
    return { ok: false, reason: "api_error", detail: "unreadable body" };
  }
  // Semrush returns "ERROR ## :: message" with a 200 on logical errors
  // (bad key, no units, unknown type). Treat as api_error.
  if (/^ERROR\b/i.test(csv.trimStart())) {
    return { ok: false, reason: "api_error", detail: csv.trim().slice(0, 120) };
  }
  return { ok: true, csv };
}

/**
 * Parse Semrush's `;`-separated CSV (header row + data rows) into an
 * array of column-keyed records. Pure. Returns [] for header-only or
 * empty input.
 */
export function parseSemrushCsv(csv: string): Record<string, string>[] {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(";").map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(";");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? "").trim();
    });
    out.push(row);
  }
  return out;
}

/** Parse a Semrush numeric cell → number | null (blank/garbage → null). */
export function semrushNum(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
