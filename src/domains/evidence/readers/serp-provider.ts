/**
 * serp-provider (2026-06-24, L7) — the pluggable live-SERP abstraction. OFF by
 * default: `getSerpProvider()` returns a no-op until the operator sets
 * `BEACON_SERP_PROVIDER=dataforseo` + `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`.
 * No live/paid calls happen from this module unless explicitly configured — this
 * is the skeleton + selection so the rest of the engine can depend on a stable
 * interface now and the real fetch lights up when the key lands (operator-gated).
 *
 * Confirmed vendor (Google Custom Search JSON API is sunsetting): DataForSEO SERP
 * ≈ $0.0006–0.002 per 10-result query; live SERP gives the top-N + AI Overview /
 * featured snippet / PAA / image-pack signals that feed Steps 2–3 with Google
 * winners (not just AEO-cited ones).
 */

import "server-only";

export type SerpFeature =
  | "ai_overview"
  | "featured_snippet"
  | "people_also_ask"
  | "image_pack"
  | "video"
  | "knowledge_panel";

export type SerpResult = {
  rank: number;
  url: string;
  title: string;
  domain: string;
};

export type SerpSnapshot = {
  query: string;
  results: SerpResult[];
  features: SerpFeature[];
  source: "dataforseo" | "none";
  fetchedAt: string | null;
};

export interface SerpProvider {
  readonly name: string;
  /** True only when env is fully configured (key present). */
  isConfigured(): boolean;
  /** Live top-N SERP for a query, or null when not configured / fail-soft. */
  getSerp(query: string, opts?: { limit?: number; locale?: string }): Promise<SerpSnapshot | null>;
}

/** Default provider: does nothing. The engine treats null as "SERP unknown" —
 *  never fabricates results. */
export class NoopSerpProvider implements SerpProvider {
  readonly name = "noop";
  isConfigured(): boolean {
    return false;
  }
  async getSerp(_query: string, _opts?: { limit?: number; locale?: string }): Promise<SerpSnapshot | null> {
    return null;
  }
}

/**
 * DataForSEO provider SKELETON. Reads creds from env but performs NO live call
 * unless `BEACON_SERP_PROVIDER === "dataforseo"` AND creds exist. The actual
 * HTTP fetch is intentionally left unimplemented until the operator enables it
 * (paid-API pause rail) — `getSerp` returns null (fail-soft) until then. When
 * enabled, implement POST https://api.dataforseo.com/v3/serp/google/organic/live
 * with Basic auth (login:password), parse items[] → results + the SERP-feature
 * item types → features[].
 */
export class DataForSeoSerpProvider implements SerpProvider {
  readonly name = "dataforseo";
  private readonly login: string | undefined;
  private readonly password: string | undefined;
  private readonly authB64: string | undefined;
  private readonly enabled: boolean;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.login = env.DATAFORSEO_LOGIN;
    this.password = env.DATAFORSEO_PASSWORD;
    this.authB64 = env.DATAFORSEO_AUTH_B64;
    this.enabled = env.BEACON_SERP_PROVIDER === "dataforseo";
  }

  isConfigured(): boolean {
    // Usable auth = the dashboard base64 string OR login+password.
    return this.enabled && (!!this.authB64 || (!!this.login && !!this.password));
  }

  async getSerp(query: string, opts?: { limit?: number; locale?: string }): Promise<SerpSnapshot | null> {
    // Delegate to the safe runner: cache → DRY-RUN (default, no spend) → hard
    // monthly cap (fail-closed) → paid call → record spend. Returns the snapshot
    // only on a real "ok"/"cache_hit"; dry-run/capped/error → null ("SERP unknown",
    // never fabricated). The live fetch stays inert until the operator sets
    // DATAFORSEO_DRY_RUN=false AND a tiny test is approved (paid-API pause rail).
    const { runSerpQuery } = await import("./dataforseo-serp");
    const r = await runSerpQuery(query, { depth: opts?.limit ?? 10 });
    return r.snapshot;
  }
}

/** Select the active provider from env. Off (noop) by default. */
export function getSerpProvider(env: NodeJS.ProcessEnv = process.env): SerpProvider {
  if (env.BEACON_SERP_PROVIDER === "dataforseo") {
    const p = new DataForSeoSerpProvider(env);
    if (p.isConfigured()) return p;
  }
  return new NoopSerpProvider();
}

export function rootDomain(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname
      .replace(/^www\./i, "")
      .toLowerCase();
  } catch {
    return "";
  }
}
