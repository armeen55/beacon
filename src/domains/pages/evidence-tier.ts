/**
 * Evidence tier classification for changelog entries.
 *
 * Tiers represent how much we can trust a changelog entry for attribution:
 * - exact: Specific page URL + specific change description + can be verified
 * - probable: URL present or strong description, but not fully verifiable
 * - weak: Vague description, no URL, or too many interpretations
 * - inferred: Not from changelog — reconstructed from data patterns
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { EvidenceTier, EvidenceTierMeta, PageEntity } from "./types";
import { isOpaqueUrl, normalizePageUrl } from "./classify";

const WEAK_DESCRIPTION_PATTERNS = [
  /applied.*edits.*based on/i,
  /captured.*baseline/i,
  /first clean baseline/i,
  /initial.*setup/i,
  /^updated?$/i,
  /^edits?$/i,
  /^changes?$/i,
  /^improvements?$/i,
];

const STRONG_DESCRIPTION_PATTERNS = [
  /published.*page/i,
  /built and published/i,
  /launched.*page/i,
  /added.*faq/i,
  /added.*schema/i,
  /published.*faq.*block/i,
  /new.*city.*page/i,
  /new.*service.*page/i,
  /new.*project.*page/i,
  /comparison.*table/i,
  /internal.*link/i,
  /crawlable.*html/i,
  /sitemap/i,
  /json-?ld/i,
  /structured.*data/i,
  /video.*embed/i,
  /review.*response/i,
  /directory.*profile/i,
];

const MEASUREMENT_SIGNALS = new Set(["measurement"]);

/**
 * Classify a changelog entry into an evidence tier.
 * Uses deterministic rules — no AI.
 */
export function classifyEvidenceTier(
  change: ChangelogEntry,
  pageRegistry?: Map<string, PageEntity>,
  /** Required only to resolve relative URLs. Omit → relative URL is not
   * structural; never borrow a process-global tenant domain. */
  siteDomain?: string,
): EvidenceTierMeta {
  const flags: string[] = [];

  if (MEASUREMENT_SIGNALS.has(change.signal_type)) {
    return {
      tier: "weak",
      has_structural_url: false,
      snapshot_verified: false,
      flags: ["measurement_only"],
    };
  }

  const hasUrl = !!change.url && !isOpaqueUrl(change.url);
  const parsed = hasUrl
    ? normalizePageUrl(change.url!, siteDomain)
    : null;
  const hasStructuralUrl = !!parsed;

  if (!hasUrl) flags.push("no_url");
  if (hasUrl && !hasStructuralUrl) flags.push("opaque_url");

  const desc = change.change_description ?? "";
  const isWeakDesc = WEAK_DESCRIPTION_PATTERNS.some((p) => p.test(desc));
  const isStrongDesc = STRONG_DESCRIPTION_PATTERNS.some((p) => p.test(desc));

  if (isWeakDesc) flags.push("weak_description");
  if (isStrongDesc) flags.push("specific_description");

  const hasCityContext = !!change.city_targeted && change.city_targeted.toLowerCase() !== "bay area";
  const hasTopicContext = !!change.topic_targeted;

  if (!hasCityContext && !hasTopicContext) flags.push("no_geo_topic_context");

  const snapshotVerified = hasStructuralUrl && pageRegistry
    ? pageRegistry.has(parsed!.url)
    : false;

  if (snapshotVerified) flags.push("page_exists_in_registry");

  let tier: EvidenceTier;

  if (hasStructuralUrl && isStrongDesc && !isWeakDesc && (hasCityContext || hasTopicContext)) {
    tier = snapshotVerified ? "exact" : "probable";
  } else if (hasStructuralUrl && !isWeakDesc) {
    tier = "probable";
  } else if (!hasStructuralUrl && isStrongDesc && hasCityContext) {
    tier = "probable";
  } else {
    tier = "weak";
  }

  return {
    tier,
    has_structural_url: hasStructuralUrl,
    snapshot_verified: snapshotVerified,
    flags,
  };
}

/**
 * Classify all changelog entries and return a map of id → tier metadata.
 */
export function classifyAllEntries(
  changes: ChangelogEntry[],
  pageRegistry?: Map<string, PageEntity>,
  siteDomain?: string,
): Map<string, EvidenceTierMeta> {
  const result = new Map<string, EvidenceTierMeta>();
  for (const change of changes) {
    result.set(
      change.id,
      classifyEvidenceTier(change, pageRegistry, siteDomain),
    );
  }
  return result;
}
