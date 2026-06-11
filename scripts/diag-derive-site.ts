/**
 * diag-derive-site — operator diagnostic (2026-06-11).
 *
 * Runs the URL-only onboarding derivation against LIVE sites and prints
 * what a stranger pasting that URL would get (profile + suggested
 * segment). Polite: identified UA, robots respected, ≤3 pages, 20s
 * timeout. Zero LLM/paid calls.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/diag-derive-site.ts acme.com other.com
 */
import { fetchSiteProfilePages } from "../src/domains/onboarding/fetch-site-profile";
import { deriveBusinessProfile } from "../src/domains/onboarding/derive-business-profile";
import { suggestSegmentFromProfile } from "../src/domains/onboarding/launch-config";

const sites = process.argv.slice(2);
(async () => {
  if (sites.length === 0) {
    console.error("Usage: diag-derive-site.ts <domain> [domain…]");
    process.exit(2);
  }
  for (const site of sites) {
    const fetched = await fetchSiteProfilePages(site, { timeoutMs: 20_000 });
    if (!fetched.ok) {
      console.log(`\n=== ${site}: UNREACHABLE (${fetched.reason}/${fetched.detail ?? ""})`);
      continue;
    }
    const p = deriveBusinessProfile(fetched.pages);
    console.log(`\n=== ${site} (${fetched.pages.length} pages)`);
    console.log(JSON.stringify({
      name: p.name, nameSource: p.nameSource, industry: p.industry,
      segment: suggestSegmentFromProfile(p),
      phone: p.phone, address: p.address,
      locations: p.locations, services: p.services.slice(0, 12),
      keyPages: p.keyPages.slice(0, 8), contentSiteSignal: p.contentSiteSignal,
      schemaTypes: p.schemaTypes.slice(0, 6),
    }, null, 1));
  }
})();
