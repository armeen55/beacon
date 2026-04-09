import { normalizeCompetitorDomain } from "./universe-normalize";

export type CitedDomainRow = { domain: string; name?: string; mentions?: number };

export type SplitCitedVsConfigured = {
  configuredInSample: { domain: string; label: string; mentions?: number }[];
  uncategorizedSample: { domain: string; name: string; mentions?: number }[];
  importRowDomainsInSample: { domain: string; mentions?: number }[];
};

/**
 * Classify citation-index (or benchmark) external domains vs configured universe
 * and vs imported competitor entity domains (hostname match).
 */
export function splitCitedDomainsByUniverse(
  topExternal: CitedDomainRow[],
  configuredDomainToLabel: Record<string, string>,
  importCompetitorDomains: string[]
): SplitCitedVsConfigured {
  const importSet = new Set(
    importCompetitorDomains.map((d) => normalizeCompetitorDomain(d)).filter(Boolean)
  );
  const configuredInSample: SplitCitedVsConfigured["configuredInSample"] = [];
  const uncategorizedSample: SplitCitedVsConfigured["uncategorizedSample"] = [];
  const importRowDomainsInSample: SplitCitedVsConfigured["importRowDomainsInSample"] =
    [];

  for (const row of topExternal) {
    const dom = normalizeCompetitorDomain(row.domain);
    if (!dom) continue;
    const label = configuredDomainToLabel[dom];
    const name = row.name ?? dom;
    const mentions = "mentions" in row && typeof row.mentions === "number" ? row.mentions : undefined;
    if (label) {
      configuredInSample.push({ domain: dom, label, mentions });
    } else if (importSet.has(dom)) {
      importRowDomainsInSample.push({ domain: dom, mentions });
    } else {
      uncategorizedSample.push({ domain: dom, name, mentions });
    }
  }

  return { configuredInSample, uncategorizedSample, importRowDomainsInSample };
}
