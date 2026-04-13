import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolves `BEACON_SITE_DOMAIN` for the scan CLI when the env var is unset.
 * Order: `.data/business-config.json` → majority owned domain in `.data/pages.json` → null.
 * (Keep `scripts/apply-scan-site-domain.cjs` in sync — that file is preloaded for the same CLI.)
 */
export function resolveBeaconSiteDomainForScan(): string | null {
  const env = process.env.BEACON_SITE_DOMAIN?.trim();
  if (env) return env.toLowerCase().replace(/^www\./, "");

  try {
    const bc = join(process.cwd(), ".data", "business-config.json");
    if (existsSync(bc)) {
      const j = JSON.parse(readFileSync(bc, "utf8")) as { domain?: unknown };
      if (typeof j.domain === "string") {
        const d = j.domain.trim().toLowerCase().replace(/^www\./, "");
        if (d.length > 0) return d;
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const pp = join(process.cwd(), ".data", "pages.json");
    if (!existsSync(pp)) return null;
    const rows = JSON.parse(readFileSync(pp, "utf8")) as { is_owned?: boolean; domain?: string }[];
    if (!Array.isArray(rows)) return null;
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.is_owned !== true || typeof row.domain !== "string") continue;
      const d = row.domain.trim().toLowerCase().replace(/^www\./, "");
      if (!d) continue;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    let best: string | null = null;
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
