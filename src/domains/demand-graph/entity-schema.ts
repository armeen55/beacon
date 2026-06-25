/**
 * entity-schema (2026-06-25, L11) — a PURE, deterministic generator for the SITE
 * entity foundation: an Organization + WebSite JSON-LD @graph. This is the
 * site-level counterpart to composeSchema's page-level Article/FAQ schema — it
 * tells Google + AI answer engines WHO this site is (a named entity with a stable
 * @id), which underpins entity recognition + knowledge-panel eligibility. No LLM,
 * no tenant hardcoding (everything from business config); fully testable.
 */

export type EntitySchemaInput = {
  name: string;
  /** Bare domain (e.g. "iranopedia.com") or full URL — normalized to an origin. */
  domain: string;
  /** Optional one-line description of the entity. */
  description?: string | null;
  /** Optional public profile URLs (sameAs) — social/wiki links if configured. */
  sameAs?: string[];
};

/** Normalize a domain-or-URL into a clean https origin with a trailing slash. */
function toOrigin(domain: string): string | null {
  const d = (domain ?? "").trim();
  if (!d) return null;
  const host = d.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/\/+$/, "");
  if (!host || !host.includes(".")) return null;
  return `https://${host}/`;
}

/**
 * Build the Organization + WebSite JSON-LD @graph for a tenant. Returns the
 * pretty-printed JSON string ready to paste into the site <head>, or null when
 * there isn't enough config (no name or unusable domain) to make a valid entity.
 */
export function buildEntitySchema(input: EntitySchemaInput): string | null {
  const name = (input.name ?? "").trim();
  const origin = toOrigin(input.domain);
  if (!name || !origin) return null;

  const org: Record<string, unknown> = {
    "@type": "Organization",
    "@id": `${origin}#organization`,
    name,
    url: origin,
  };
  const description = (input.description ?? "").trim();
  if (description) org.description = description;
  const sameAs = (input.sameAs ?? []).map((s) => s.trim()).filter(Boolean);
  if (sameAs.length > 0) org.sameAs = sameAs;

  const website: Record<string, unknown> = {
    "@type": "WebSite",
    "@id": `${origin}#website`,
    url: origin,
    name,
    publisher: { "@id": `${origin}#organization` },
  };

  const graph = { "@context": "https://schema.org", "@graph": [org, website] };
  return JSON.stringify(graph, null, 2);
}

/** The ready-to-paste <script> tag wrapping the entity schema (or null). */
export function buildEntitySchemaScript(input: EntitySchemaInput): string | null {
  const json = buildEntitySchema(input);
  if (!json) return null;
  return `<script type="application/ld+json">\n${json}\n</script>`;
}
