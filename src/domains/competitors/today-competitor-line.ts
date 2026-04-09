import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { VisibilityObservationRun } from "@/domains/observations/visibility-types";
import { computeMarketBenchmark } from "@/domains/pages/builder-benchmark";
import type { PersistedIssue } from "@/domains/pages/issues";
import { splitCitedDomainsByUniverse } from "./universe-split";
import type { CompetitorUniverseRuntime } from "./universe-types";
import { competitorUniverseDriftNote } from "./universe-drift-copy";

const NO_ISSUES: PersistedIssue[] = [];

const DIRECTORY_SKIP = new Set([
  "houzz.com",
  "yelp.com",
  "angi.com",
  "reddit.com",
  "diamondcertified.org",
]);

/**
 * Single honest paragraph for Today: configured universe vs citation sample domains.
 */
export function buildTodayCompetitorLine(opts: {
  universe: CompetitorUniverseRuntime;
  citationIndex: CitationEvidenceIndex | null;
  primaryVisibilityRun: VisibilityObservationRun | null;
  /** Imported/seed competitor entity hostnames for “import row” overlap (optional). */
  importCompetitorDomains: string[];
}): string | null {
  const { universe, citationIndex, primaryVisibilityRun, importCompetitorDomains } =
    opts;
  if (!citationIndex) return null;

  const bench = computeMarketBenchmark(citationIndex, NO_ISSUES);
  const top = bench.topCompetitors.filter(
    (c) => !DIRECTORY_SKIP.has(c.domain)
  );
  if (top.length === 0) return null;

  const split = splitCitedDomainsByUniverse(
    top.map((c) => ({
      domain: c.domain,
      name: c.name,
      mentions: c.mentions,
    })),
    universe.domainToLabel,
    importCompetitorDomains
  );

  const runTag = primaryVisibilityRun
    ? `Visibility sample run \`${primaryVisibilityRun.run_id}\`. `
    : "Visibility run unresolved — ";

  const nCfg = Object.keys(universe.domainToLabel).length;
  let universePreamble: string;
  if (universe.origin === "empty_import_mode" && nCfg === 0) {
    universePreamble =
      "No competitor universe configured for this workspace — external domains below are citation-sample only (not an intentional tracked set). ";
  } else if (universe.origin === "demo_defaults_explicit") {
    universePreamble = `Demo configured competitor universe (${nCfg} active — explicit defaults, not inferred from the sample). `;
  } else {
    universePreamble = `Configured competitor universe (${nCfg} active from workspace file). `;
  }

  const fpShort = universe.pin.universe_fingerprint?.slice(0, 14) ?? "—";
  const verLine = `Universe pin: v${universe.pin.universe_version ?? "—"} · ${fpShort}…${universe.pin.legacy_unversioned_file ? " (legacy file — inferred v1)" : ""}${universe.pin.fingerprint_mismatch ? " · fingerprint drift vs JSON" : ""}. `;

  const cfgNames = split.configuredInSample
    .map((c) => c.label)
    .filter(Boolean);
  const cfgPart =
    cfgNames.length > 0
      ? `Among top cited external domains in this index, these match configured competitors: ${cfgNames.join(", ")}. `
      : "None of the top cited external domains in this index match your configured universe hostnames — pressure may be from directories, editorial, or unlisted builders. ";

  const otherCount = split.uncategorizedSample.length;
  const otherPart =
    otherCount > 0
      ? `${otherCount} other top external domain${otherCount !== 1 ? "s" : ""} in this sample are uncategorized (not in configured universe).`
      : "";

  const imp = split.importRowDomainsInSample.length;
  const impPart =
    imp > 0 && universe.origin !== "empty_import_mode"
      ? ` ${imp} top-domain row${imp !== 1 ? "s" : ""} align with imported competitor entity hostnames but are not in the configured universe file — treat as sample/import overlap, not “tracked” until added to the universe.`
      : "";

  const main = `${runTag}${universePreamble}${verLine}${cfgPart}${otherPart}${impPart}`.trim();
  const drift = competitorUniverseDriftNote(universe, primaryVisibilityRun);
  if (drift) return `${main} ${drift}`;
  return main;
}
