/**
 * entity-attribute-factory (2026-06-25, Sprint 6) — programmatic page-candidate
 * generation at scale (plan P12). PURE / deterministic / no I/O.
 *
 * Generates create_page CANDIDATES from the tenant's OWN entities × a generic SEO
 * attribute template set (meaning / history / guide / examples / vs …). Strongly
 * gated so it produces a clean set, not garbage:
 *  - entities come from the tenant's real themes (recurring tokens across owned
 *    pages + demand clusters) — tenant-agnostic, no hardcoded category list;
 *  - drop any candidate an existing page already covers (token overlap) — never a
 *    duplicate;
 *  - relevance-gated to the tenant's topic vocabulary;
 *  - every candidate is marked `needsDemandValidation` — NO demand/volume is
 *    invented; candidates must pass the DataForSEO create-page verdict before they
 *    become real Moves.
 *
 * Pinned by entity-attribute-factory.test.ts.
 */

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "is", "are", "what", "how", "best", "vs",
  "with", "your", "you", "near", "me", "list", "top", "guide", "page", "home", "www", "com", "https", "http",
  "index", "html", "php", "amp",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

function pathTokens(url: string): string[] {
  let p = url;
  try {
    p = url.startsWith("http") ? new URL(url).pathname : url;
  } catch {
    /* raw */
  }
  return tokens(p);
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Generic, tenant-agnostic SEO attribute templates. {e} = the entity phrase. */
export const DEFAULT_ATTRIBUTES: { key: string; title: (e: string) => string; intent: string }[] = [
  { key: "meaning", title: (e) => `${titleCase(e)} Meaning`, intent: "definitional" },
  { key: "history", title: (e) => `History of ${titleCase(e)}`, intent: "informational" },
  { key: "guide", title: (e) => `${titleCase(e)}: Complete Guide`, intent: "informational" },
  { key: "examples", title: (e) => `${titleCase(e)} Examples`, intent: "informational" },
  { key: "list", title: (e) => `Types of ${titleCase(e)}`, intent: "informational" },
];

export type PageCandidate = {
  slug: string;
  title: string;
  entity: string;
  attribute: string;
  intent: string;
  relevance: number;
  /** Always true — demand must be validated (DataForSEO) before this is a real Move. */
  needsDemandValidation: boolean;
  why: string;
};

export type FactoryInput = {
  /** The tenant's owned page URLs (for dedup + entity mining). */
  ownedUrls: string[];
  /** Demand-cluster labels (real themes the tenant engages). */
  demandLabels: string[];
  /** The tenant's topic vocabulary (relevance anchor). */
  tenantTopics?: string[];
  attributes?: { key: string; title: (e: string) => string; intent: string }[];
  /** A token must recur at least this many times across sources to be an "entity". */
  minEntityFreq?: number;
  maxCandidates?: number;
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

/**
 * Mine recurring entities from the tenant's pages + demand labels, then generate
 * deduped, relevance-gated create_page candidates (entity × attribute). PURE.
 */
export function generatePageCandidates(input: FactoryInput): PageCandidate[] {
  const attributes = input.attributes ?? DEFAULT_ATTRIBUTES;
  const minFreq = input.minEntityFreq ?? 2;
  const maxOut = input.maxCandidates ?? 50;

  // 1. Mine entity tokens: count token frequency across owned pages + demand labels.
  const freq = new Map<string, number>();
  for (const u of input.ownedUrls) for (const t of pathTokens(u)) freq.set(t, (freq.get(t) ?? 0) + 1);
  for (const l of input.demandLabels) for (const t of tokens(l)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const entities = [...freq.entries()]
    .filter(([, n]) => n >= minFreq)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  // 2. Existing-coverage index (dedup) + relevance vocabulary.
  const ownedTokenSets = input.ownedUrls.map((u) => new Set(pathTokens(u)));
  const topicSet = new Set((input.tenantTopics ?? []).flatMap((t) => tokens(t)));

  const out: PageCandidate[] = [];
  const seenSlugs = new Set<string>();
  for (const entity of entities) {
    // Relevance: the entity must be in the tenant's topic vocabulary (when supplied).
    if (topicSet.size > 0 && !topicSet.has(entity)) continue;
    for (const attr of attributes) {
      const title = attr.title(entity);
      const candTokens = new Set([entity, ...tokens(attr.key)]);
      // Dedup: skip if an owned page already covers (entity + attribute keyword) well.
      const covered = ownedTokenSets.some((pt) => {
        let hit = 0;
        for (const t of candTokens) if (pt.has(t)) hit += 1;
        return hit >= candTokens.size; // owned page contains all candidate tokens
      });
      if (covered) continue;
      const slug = slugify(`${entity}-${attr.key}`);
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      out.push({
        slug,
        title,
        entity,
        attribute: attr.key,
        intent: attr.intent,
        relevance: topicSet.size > 0 ? 1 : 0.5,
        needsDemandValidation: true,
        why: `"${entity}" is a recurring theme on your site; no page covers "${attr.key}" yet. Validate demand before building.`,
      });
      if (out.length >= maxOut) return out;
    }
  }
  return out;
}
