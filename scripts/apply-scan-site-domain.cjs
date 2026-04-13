/**
 * Preload for `scan-owned-pages.ts`: sets BEACON_SITE_DOMAIN before getSiteConfig() runs,
 * when the operator has not set env but `.data` already contains pilot pages / config.
 *
 * **Keep in sync with** `src/domains/scanning/scan-site-domain.ts` → `resolveBeaconSiteDomainForScan`.
 */

const fs = require("fs");
const path = require("path");

function domainFromBusinessConfigFile() {
  try {
    const p = path.join(process.cwd(), ".data", "business-config.json");
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (typeof j.domain !== "string") return null;
    const d = j.domain.trim().toLowerCase().replace(/^www\./, "");
    return d.length > 0 ? d : null;
  } catch {
    return null;
  }
}

function domainFromPagesRegistryFile() {
  try {
    const p = path.join(process.cwd(), ".data", "pages.json");
    if (!fs.existsSync(p)) return null;
    const rows = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!Array.isArray(rows)) return null;
    const counts = new Map();
    for (const row of rows) {
      if (row.is_owned !== true || typeof row.domain !== "string") continue;
      const d = row.domain.trim().toLowerCase().replace(/^www\./, "");
      if (!d) continue;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    let best = null;
    let bestN = 0;
    for (const [d, n] of counts) {
      if (n > bestN) {
        best = d;
        bestN = n;
      }
    }
    return best;
  } catch {
    return null;
  }
}

function resolveBeaconSiteDomainFromWorkspace() {
  const env = process.env.BEACON_SITE_DOMAIN && String(process.env.BEACON_SITE_DOMAIN).trim();
  if (env) return env.toLowerCase().replace(/^www\./, "");
  return domainFromBusinessConfigFile() || domainFromPagesRegistryFile() || null;
}

function applyBeaconSiteDomainIfMissing() {
  if (process.env.BEACON_SITE_DOMAIN && String(process.env.BEACON_SITE_DOMAIN).trim()) return;
  const d = resolveBeaconSiteDomainFromWorkspace();
  if (d) process.env.BEACON_SITE_DOMAIN = d;
}

applyBeaconSiteDomainIfMissing();

module.exports = {
  resolveBeaconSiteDomainFromWorkspace,
  applyBeaconSiteDomainIfMissing,
};
