/**
 * backlink-provider (2026-06-24, L9) — the Link-Authority abstraction ("#1
 * ranking" half). OFF by default: `getBacklinkProvider()` returns a no-op until
 * the operator sets `BEACON_BACKLINK_PROVIDER=dataforseo` + DataForSEO creds. No
 * live/paid calls from this module unless configured — skeleton + selection +
 * the PURE link-gap logic so the engine can find "who links to the competitor
 * pages AI/Google cite, but not to you" the moment the key lands (operator-gated).
 */

import "server-only";

export type ReferringDomain = {
  domain: string;
  /** Provider domain-authority/rating 0–100, when known. */
  rating: number | null;
  /** Backlinks from this referring domain to the target. */
  backlinks: number;
};

export type BacklinkProfile = {
  target: string;
  referringDomains: ReferringDomain[];
  totalBacklinks: number;
  domainRating: number | null;
  source: "dataforseo" | "none";
  fetchedAt: string | null;
};

export interface BacklinkProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Referring-domain profile for a URL/domain, or null (fail-soft / not configured). */
  getProfile(target: string): Promise<BacklinkProfile | null>;
}

export class NoopBacklinkProvider implements BacklinkProvider {
  readonly name = "noop";
  isConfigured(): boolean {
    return false;
  }
  async getProfile(_target: string): Promise<BacklinkProfile | null> {
    return null;
  }
}

/**
 * DataForSEO Backlinks provider SKELETON. Configured only with the flag + creds;
 * `getProfile` returns null until the operator enables the paid fetch (pause
 * rail). When enabled, implement POST
 * https://api.dataforseo.com/v3/backlinks/referring_domains/live (Basic auth) and
 * map items[] → referringDomains.
 */
export class DataForSeoBacklinkProvider implements BacklinkProvider {
  readonly name = "dataforseo";
  private readonly enabled: boolean;
  private readonly login: string | undefined;
  private readonly password: string | undefined;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.enabled = env.BEACON_BACKLINK_PROVIDER === "dataforseo";
    this.login = env.DATAFORSEO_LOGIN;
    this.password = env.DATAFORSEO_PASSWORD;
  }
  isConfigured(): boolean {
    return this.enabled && !!this.login && !!this.password;
  }
  async getProfile(_target: string): Promise<BacklinkProfile | null> {
    return null; // pause rail: no paid call until operator-enabled
  }
}

export function getBacklinkProvider(env: NodeJS.ProcessEnv = process.env): BacklinkProvider {
  if (env.BEACON_BACKLINK_PROVIDER === "dataforseo") {
    const p = new DataForSeoBacklinkProvider(env);
    if (p.isConfigured()) return p;
  }
  return new NoopBacklinkProvider();
}

export type LinkGap = {
  /** A domain linking to ≥1 competitor but NOT to you — an outreach target. */
  domain: string;
  rating: number | null;
  /** How many of the competitor profiles this domain links to (breadth). */
  linksToCompetitors: number;
};

/**
 * PURE link-gap: referring domains that link to the competitor profiles but not
 * to the owned profile, ranked by breadth × rating. The outreach worklist.
 */
export function computeLinkGaps(
  ownedProfile: BacklinkProfile | null,
  competitorProfiles: ReadonlyArray<BacklinkProfile>,
): LinkGap[] {
  const ownedRefs = new Set(
    (ownedProfile?.referringDomains ?? []).map((r) => r.domain.replace(/^www\./i, "").toLowerCase()),
  );
  const byDomain = new Map<string, { rating: number | null; count: number }>();
  for (const prof of competitorProfiles) {
    for (const r of prof.referringDomains) {
      const d = r.domain.replace(/^www\./i, "").toLowerCase();
      if (!d || ownedRefs.has(d)) continue;
      const ex = byDomain.get(d);
      if (ex) {
        ex.count += 1;
        if (r.rating != null && (ex.rating == null || r.rating > ex.rating)) ex.rating = r.rating;
      } else {
        byDomain.set(d, { rating: r.rating, count: 1 });
      }
    }
  }
  return [...byDomain.entries()]
    .map(([domain, v]) => ({ domain, rating: v.rating, linksToCompetitors: v.count }))
    .sort(
      (a, b) =>
        b.linksToCompetitors - a.linksToCompetitors || (b.rating ?? 0) - (a.rating ?? 0),
    );
}
