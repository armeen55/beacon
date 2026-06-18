import "server-only";

/**
 * SEMrush API unit-balance check (2026-06-18) — the pre-flight + post-flight
 * meter for any capped diagnostic pull.
 *
 * SEMrush exposes the remaining API-unit balance at a DIFFERENT host than the
 * Analytics API: `https://www.semrush.com/users/countapiunits.html?key=KEY`,
 * which returns a bare integer and itself costs ZERO units. We use it to read
 * the balance immediately before and after a pull so we can (a) abort if a pull
 * can't be afforded and (b) record the EXACT units a pull actually spent
 * (balanceBefore − balanceAfter), independent of our per-line estimate.
 *
 * Fail-soft + tenant-scoped + server-only, mirroring `client.ts`. The key is
 * read for `tenantId` only and never logged or returned.
 */

import { getSemrushConnectorToken } from "@/lib/connector-store";
import type { SemrushRawFetchDeps } from "./client";

export const SEMRUSH_UNITS_URL =
  "https://www.semrush.com/users/countapiunits.html";

export type SemrushUnitBalanceResult =
  | { ok: true; units: number }
  | { ok: false; reason: "no_key" | "disconnected" | "api_error"; detail?: string };

/**
 * Read the remaining SEMrush API-unit balance for a tenant. Costs 0 units.
 * Fail-soft: no key / disconnected / non-2xx / non-numeric body / network
 * fault → a discriminated `{ ok: false }`, never a throw.
 */
export async function fetchSemrushUnitBalance(
  args: { tenantId: string },
  deps: SemrushRawFetchDeps = {},
): Promise<SemrushUnitBalanceResult> {
  const token =
    deps.token !== undefined
      ? deps.token
      : await getSemrushConnectorToken(args.tenantId);

  if (token == null || token.api_key === "") return { ok: false, reason: "no_key" };
  if (token.disconnected_at != null && token.disconnected_at !== "")
    return { ok: false, reason: "disconnected" };

  const url = new URL(SEMRUSH_UNITS_URL);
  url.searchParams.set("key", token.api_key);

  const doFetch = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url.toString());
  } catch (e) {
    return { ok: false, reason: "api_error", detail: e instanceof Error ? e.message : "network error" };
  }
  if (!res.ok) return { ok: false, reason: "api_error", detail: `HTTP ${res.status}` };

  let body: string;
  try {
    body = (await res.text()).trim();
  } catch {
    return { ok: false, reason: "api_error", detail: "unreadable body" };
  }
  // Logical errors come back as "ERROR ## :: message" with a 200.
  if (/^ERROR\b/i.test(body)) {
    return { ok: false, reason: "api_error", detail: body.slice(0, 120) };
  }
  const units = Number(body);
  if (!Number.isFinite(units) || units < 0) {
    return { ok: false, reason: "api_error", detail: `non-numeric balance: ${body.slice(0, 40)}` };
  }
  return { ok: true, units: Math.floor(units) };
}
