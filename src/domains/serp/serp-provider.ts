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
  private readonly enabled: boolean;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.login = env.DATAFORSEO_LOGIN;
    this.password = env.DATAFORSEO_PASSWORD;
    this.enabled = env.BEACON_SERP_PROVIDER === "dataforseo";
  }

  isConfigured(): boolean {
    return this.enabled && !!this.login && !!this.password;
  }

  async getSerp(_query: string, _opts?: { limit?: number; locale?: string }): Promise<SerpSnapshot | null> {
    // Pause rail: no paid API call until the operator enables it. Until the live
    // fetch is wired (operator-gated), return null = "SERP unknown" (honest).
    return null;
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
