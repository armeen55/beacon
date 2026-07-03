import "server-only";

/**
 * site-uptime-store (BEACON_500 T0c, 2026-07-03) - one polite HEAD/GET on the
 * tenant's homepage per nightly sync, recording status + time-to-first-byte
 * so the deadman verdict (deadman.ts) can say "your site did not answer"
 * when the site is down two nights in a row.
 *
 * Persistence follows the pipeline-health-store sibling pattern exactly: a
 * GLOBAL json-store (rows carry tenant_id, because the nightly cron fans out
 * across tenants with no ambient request context) that is Supabase-mirrored
 * (json_store_blobs) so the write survives Vercel's read-only filesystem and
 * Today can read it at $0. Registered in store-classification.ts
 * (GLOBAL_STORES) + json-store.ts (SUPABASE_MIRRORED_STORES); the mirror
 * inherits the PGRST205/42P01 file-fallback convention from json-store.
 *
 * HONEST LIMIT: fetch() exposes no TLS internals, so certificate expiry
 * dates are NOT read here. An already-expired certificate still surfaces:
 * the fetch fails, the probe records not-ok with the error text, and two
 * such nights raise the banner. A status/timeout probe is the 90 percent
 * win; true cert-expiry forecasting would need a raw TLS socket later.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

const STORE = "site-uptime-probes";

/** Keep a month of nightly probes per tenant (the deadman only reads 2). */
const MAX_ROWS_PER_TENANT = 30;

const PROBE_TIMEOUT_MS = 15_000;
const PROBE_UA = "BeaconBot/1.0 (uptime-check)";

export type SiteProbeRow = {
  tenant_id: string;
  url: string;
  checked_at: string;
  ok: boolean;
  /** HTTP status of the final response, null when the request never answered. */
  status: number | null;
  /** Time to headers (fetch resolves on headers, body untouched). */
  ttfb_ms: number | null;
  error: string | null;
};

/** PURE: the homepage URL to probe for a tenant domain. Null for empty or
 *  placeholder domains (never probe example.com). */
export function homepageUrlForDomain(domain: string | null | undefined): string | null {
  const raw = (domain ?? "").trim();
  if (raw === "") return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.hostname === "" || u.hostname === "example.com" || u.hostname === "www.example.com") {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

export type ProbeOutcome = {
  ok: boolean;
  status: number | null;
  ttfbMs: number | null;
  error: string | null;
};

export type ProbeDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * One polite probe: HEAD first (cheapest), retried once as GET when the host
 * mishandles HEAD (405/501). ok = a 2xx/3xx answer. Never throws.
 */
export async function probeHomepage(url: string, deps: ProbeDeps = {}): Promise<ProbeOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const started = Date.now();
    let res = await fetchImpl(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": PROBE_UA },
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": PROBE_UA },
      });
    }
    const ttfbMs = Date.now() - started;
    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      ttfbMs,
      error: null,
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      status: null,
      ttfbMs: null,
      error: aborted
        ? `no answer within ${Math.round(timeoutMs / 1000)}s`
        : (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Persist one probe row (bounded per tenant, newest kept). FAIL-SOFT BY
 *  CONTRACT: never throws - a ledger write failure must never fail the
 *  nightly sync phase recording it. */
export async function recordSiteProbe(row: SiteProbeRow): Promise<void> {
  try {
    const rows = await readStore<SiteProbeRow>(STORE, []);
    const mine = rows.filter((r) => r.tenant_id === row.tenant_id);
    const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
    const nextMine = [...mine, row]
      .sort((a, b) => b.checked_at.localeCompare(a.checked_at))
      .slice(0, MAX_ROWS_PER_TENANT);
    await writeStore(STORE, [...others, ...nextMine]);
  } catch (e) {
    log.warn("[site-uptime-store] probe write failed (fail-soft)", {
      tenantId: row.tenant_id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Newest-first probes for a tenant. Fail-soft to []. */
export async function listRecentSiteProbes(
  tenantId: string,
  limit = 2,
): Promise<SiteProbeRow[]> {
  try {
    const rows = await readStore<SiteProbeRow>(STORE, []);
    return rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.checked_at.localeCompare(a.checked_at))
      .slice(0, limit);
  } catch {
    return [];
  }
}
