/**
 * serp-teardown-fusion (2026-06-25, Sprint 6) — fuse DataForSEO SERP winners with
 * Profound-cited competitors to pick the BEST teardown targets. PURE / no I/O.
 *
 * Today teardown only reads Profound-cited URLs (who AI cites). But the audit's
 * highest-value signal is the Google+AI OVERLAP: a page that BOTH ranks on Google
 * AND is cited by AI is the page to reverse-engineer first. This module ranks
 * teardown targets: overlap (both) → AI-only → Google-only. No fabrication — with no
 * SERP data it simply returns the Profound order unchanged.
 *
 * Pinned by serp-teardown-fusion.test.ts.
 */

export function rootDomainOf(urlOrDomain: string): string {
  if (!urlOrDomain) return "";
  let host = urlOrDomain;
  try {
    host = urlOrDomain.startsWith("http") ? new URL(urlOrDomain).hostname : urlOrDomain;
  } catch {
    host = urlOrDomain;
  }
  host = host.toLowerCase().replace(/^www\./, "");
  host = host.split("/")[0].split("?")[0]; // strip any path/query (no-scheme inputs)
  const parts = host.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : host;
}

export type TeardownTarget = {
  /** A full URL when we have one (Profound), else a bare domain (SERP-only). */
  value: string;
  kind: "url" | "domain";
  sources: ("ai" | "google")[];
  isOverlap: boolean;
  priority: number; // lower = tear down first
};

/**
 * Rank teardown targets from Profound competitor URLs + SERP top domains. PURE.
 * Excludes the tenant's own domain. Overlap (a Profound URL whose domain also ranks
 * on Google) comes first; then AI-only URLs; then Google-only domains we don't yet
 * have a cited URL for.
 */
export function fuseTeardownTargets(input: {
  competitorUrls: string[]; // Profound-cited (full URLs)
  serpTopDomains: string[]; // DataForSEO Google winners (domains)
  ownDomain: string;
}): TeardownTarget[] {
  const own = rootDomainOf(input.ownDomain);
  const serpDomains = new Set(input.serpTopDomains.map(rootDomainOf).filter((d) => d && d !== own));
  const out: TeardownTarget[] = [];
  const seen = new Set<string>();

  // Profound-cited URLs first (we have a concrete page to tear down).
  for (const url of input.competitorUrls) {
    if (!url) continue;
    const dom = rootDomainOf(url);
    if (!dom || dom === own || seen.has(url)) continue;
    seen.add(url);
    const overlap = serpDomains.has(dom);
    out.push({
      value: url,
      kind: "url",
      sources: overlap ? ["ai", "google"] : ["ai"],
      isOverlap: overlap,
      priority: overlap ? 0 : 1,
    });
  }

  // Google-only domains (rank on Google, not yet seen as an AI-cited URL).
  const citedDomains = new Set(out.map((t) => rootDomainOf(t.value)));
  for (const dom of serpDomains) {
    if (citedDomains.has(dom) || seen.has(dom)) continue;
    seen.add(dom);
    out.push({ value: dom, kind: "domain", sources: ["google"], isOverlap: false, priority: 2 });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

/**
 * Pick the single best teardown URL for a move: prefer a Profound-cited URL whose
 * domain also ranks on Google (overlap), else the first usable competitor URL. PURE.
 * Returns null when nothing usable. Used to upgrade the teardown target selection
 * without changing its shape.
 */
export function pickOverlapTeardownUrl(
  competitorUrls: string[],
  serpTopDomains: string[],
  ownDomain: string,
  isBad: (u: string) => boolean = () => false,
): { url: string; overlap: boolean } | null {
  const own = rootDomainOf(ownDomain);
  const serpDomains = new Set(serpTopDomains.map(rootDomainOf).filter((d) => d && d !== own));
  const usable = competitorUrls.filter((u) => u && rootDomainOf(u) !== own && !isBad(u));
  if (usable.length === 0) return null;
  const overlap = usable.find((u) => serpDomains.has(rootDomainOf(u)));
  if (overlap) return { url: overlap, overlap: true };
  return { url: usable[0], overlap: false };
}
