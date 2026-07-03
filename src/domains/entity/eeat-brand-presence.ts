/**
 * Knowledge-Graph / brand presence detector (BEACON 500 P10 v1 372/507,
 * 2026-07-03).
 *
 * THE CHECK (connector-free, deterministic, cold-start safe): does the tenant's
 * OWN site already establish the brand as an entity Google can recognize? Two
 * things make a brand knowable: (1) Organization schema on the site, and (2)
 * `sameAs` cross-links from that schema out to the profiles that confirm the
 * identity. Without them, Google has no clean anchor for "who is this brand",
 * which is the foundation everything else in P10 sits on.
 *
 * This needs NO connector: it reads the tenant's own homepage / site-root
 * snapshot schema, already crawled. So it works at cold start, the first time a
 * site is scanned, before any GSC / Profound / analytics connection.
 *
 * PURE. No I/O, no LLM, no tenant hardcoding. The loader pre-computes
 * `hasOrganizationSchema` / `hasSameAsLinks` from the site-root snapshot.
 *
 * SELF-HIDES when well-represented: a site that already carries Organization
 * schema WITH sameAs links returns null (no Move), so a brand Google already
 * knows never gets nagged.
 */

import { buildEntitySchema } from "@/domains/demand-graph/entity-schema";
import type { BrandPresenceGap, BrandPresenceInput } from "./eeat-types";

/**
 * Classify the tenant's brand-presence state into a gap, or null when the brand
 * is already well-represented (Organization schema present WITH sameAs links) or
 * when there isn't enough config (no brand name or no usable site root) to make
 * an honest claim.
 *
 *   - null                 -> well represented, or no usable input (self-hide).
 *   - gap "no_org_schema"  -> no Organization schema anywhere on the site root
 *                             (the bigger, foundational gap).
 *   - gap "no_sameas"      -> Organization schema present, but no sameAs links
 *                             (Google sees the name but cannot confirm the
 *                             identity across the web).
 */
export function classifyBrandPresence(
  input: BrandPresenceInput,
): BrandPresenceGap | null {
  const brandName = (input.brandName ?? "").trim();
  if (!brandName) return null;
  if (input.siteRootUrl == null || input.siteRootUrl.length === 0) return null;

  // Well represented: nothing to do.
  if (input.hasOrganizationSchema && input.hasSameAsLinks) return null;

  const gap: BrandPresenceGap["gap"] = input.hasOrganizationSchema
    ? "no_sameas"
    : "no_org_schema";

  return {
    siteRootUrl: input.siteRootUrl,
    brandName,
    domain: input.domain,
    gap,
    fetchedAt: input.fetchedAt,
  };
}

/**
 * Compose the ready-to-paste Organization + WebSite JSON-LD for a brand-presence
 * gap, reusing the SHIPPED `buildEntitySchema` (the site entity foundation) so
 * the pasted block matches exactly what the rest of Beacon expects a site's
 * entity graph to look like. `sameAs` is left as a clearly-marked placeholder
 * for the operator to fill with their real profile URLs (Beacon never invents a
 * profile link). Returns the pretty-printed JSON string, or null when config is
 * insufficient.
 */
export function composeBrandEntitySchema(gap: BrandPresenceGap): string | null {
  return buildEntitySchema({
    name: gap.brandName,
    domain: gap.domain || gap.siteRootUrl,
    // sameAs intentionally omitted here: the composed block is a valid, complete
    // Organization + WebSite graph; the copy tells the operator to add their own
    // real profile URLs as sameAs, because Beacon must never fabricate a link.
  });
}

/** The ready-to-paste <script> tag wrapping the brand entity schema (or null). */
export function composeBrandEntityScript(gap: BrandPresenceGap): string | null {
  const json = composeBrandEntitySchema(gap);
  if (!json) return null;
  return `<script type="application/ld+json">\n${json}\n</script>`;
}
