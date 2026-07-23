/**
 * tenant-source-allowlist (drafter last-mile G7, 2026-07-10) - the CURATED
 * per-tenant default for `BusinessConfig.authoritativeSourceDomains`.
 *
 * The source-authority gate (src/domains/decision/drafts/source-authority.ts) trusts a
 * tenant's own allowlist ON TOP OF the universal .gov/.edu + named encyclopedic/
 * major-press set. The allowlist is per-tenant DATA - the durable channel is the
 * tenant's `business_config` row (applied to prod via MCP by the architect). This
 * module is the CODE-path default that fills that field when the tenant has NOT
 * curated its own yet, so:
 *   - the field is readable through business-config for every consumer
 *     (prepare-today-moves, today-*-data, the draft gate) with zero extra wiring,
 *   - hermetic tests + the re-run script can exercise a real tenant allowlist
 *     without depending on a live prod row.
 *
 * Gated STRICTLY by canonical tenant id (mirrors src/lib/connectors/profound/
 * tenant-scope.ts): a tenant with no entry gets NOTHING back, so the empty-
 * allowlist behavior for every other tenant (and the founder) is byte-identical
 * - no cross-tenant / founder leak. A tenant that HAS curated its own allowlist
 * always wins (business-config only falls back to this default when the field is
 * unset/empty). PURE - constants + a lookup, no I/O.
 */

/**
 * Curated authoritative-source domains, keyed by canonical tenant id. Each domain
 * is a stable, editorially-governed reference that legitimately backs factual
 * claims for the tenant's subject - NEVER a directory, forum, or SEO farm.
 */
const CURATED_TENANT_SOURCE_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  // Iranopedia - a Persian-culture encyclopedia. The pilot's own sources plus
  // the standing references for people/history/heritage claims:
  //   - wikipedia.org      : the Google #5 + AI-cited overlap the teardown picked;
  //                          List_of_Iranian_singers backs many roundup names.
  //   - britannica.com     : already universal, listed so the tenant's allowlist
  //                          is self-describing (the pilot cited it for Googoosh /
  //                          Shajarian; it 403s the crawler -> needs_source_check).
  //   - unesco.org         : the authority behind Shajarian's UNESCO Mozart Medal
  //                          and Persian-heritage inscriptions.
  //   - iranicaonline.org  : Encyclopaedia Iranica - the peer-reviewed academic
  //                          reference of record for Iranian history and figures.
  //   - loc.gov            : Library of Congress (already universal; kept explicit
  //                          for the tenant's people/history citations).
  "tenant-iranopedia": ["wikipedia.org", "britannica.com", "unesco.org", "iranicaonline.org", "loc.gov"],
};

/**
 * The curated authoritative-source allowlist for a tenant, or `undefined` when
 * the tenant has no curated default (every non-listed tenant + the founder). A
 * fresh array copy so a caller can never mutate the shared constant.
 */
export function getCuratedSourceDomains(tenantId: string): string[] | undefined {
  const list = CURATED_TENANT_SOURCE_DOMAINS[tenantId];
  return list ? [...list] : undefined;
}
