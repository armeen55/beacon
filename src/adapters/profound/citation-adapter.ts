import "server-only";

import type {
  CitationObservation,
  SourceCategory,
} from "@/domains/citation-observations/types";
import {
  normalizeHostname,
  normalizeUrl,
  parseDirtyCSV,
} from "@/lib/persistence/csv-parser";

const DIRECTORY_DOMAINS = new Set([
  "houzz.com",
  "yelp.com",
  "angi.com",
  "homeadvisor.com",
  "thumbtack.com",
  "buildzoom.com",
  "bbb.org",
  "diamondcertified.org",
  "generalcontractors.org",
  "homebuilderdigest.com",
  "homeguide.com",
  "manta.com",
]);

const SOCIAL_DOMAINS = new Set([
  "reddit.com",
  "youtube.com",
  "pinterest.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "quora.com",
]);

type ProfoundCitationRow = {
  run_id: string;
  date: string;
  url: string;
  hostname: string;
  title: string;
  citationCategory: string;
};

/** audit-wave7 #4: owned-host match must be SUFFIX-aware (a subdomain of an
 *  owned domain is owned), mirroring execution-adapter — an exact-only `.has()`
 *  mislabels blog./www2./shop. citations as "other" and undercounts owned AEO
 *  citations. */
function isOwnedHost(host: string, ownedSet: Set<string>): boolean {
  if (ownedSet.has(host)) return true;
  for (const d of ownedSet) {
    if (host === d || host.endsWith("." + d)) return true;
  }
  return false;
}

function mapSourceCategory(
  rawCategory: string,
  normalizedHost: string,
  ownedSet: Set<string>,
  warnings: string[],
  rowIndex: number
): SourceCategory {
  const c = rawCategory.trim().toLowerCase().replace(/\s+/g, "_");
  switch (c) {
    case "owned":
      return "owned";
    case "social":
      return "social";
    case "earned_media":
      return "earned_media";
    case "pr_wire":
      return "earned_media";
    case "earned_institutions":
      return "institution";
    case "other":
      if (DIRECTORY_DOMAINS.has(normalizedHost)) return "directory";
      if (SOCIAL_DOMAINS.has(normalizedHost)) return "social";
      if (isOwnedHost(normalizedHost, ownedSet)) return "owned";
      return "other";
    default:
      warnings.push(
        `Row ${rowIndex + 2}: unknown citationCategory "${rawCategory}", treating as other`
      );
      if (DIRECTORY_DOMAINS.has(normalizedHost)) return "directory";
      if (SOCIAL_DOMAINS.has(normalizedHost)) return "social";
      if (isOwnedHost(normalizedHost, ownedSet)) return "owned";
      return "other";
  }
}

/**
 * Parse Profound citations CSV into canonical {@link CitationObservation} records,
 * grouped by `observed_at` date for sharded cold storage.
 */
export function parseProfoundCitations(
  filePath: string,
  ownedDomains: string[],
  entityLookup: Map<string, string>
): {
  citationsByDate: Map<string, CitationObservation[]>;
  warnings: string[];
} {
  const rows = parseDirtyCSV<ProfoundCitationRow>(filePath);
  const warnings: string[] = [];
  const ownedSet = new Set(
    ownedDomains.map((d) => normalizeHostname(d)).filter(Boolean)
  );

  const seenRunUrl = new Set<string>();
  /** run_id → next citation_order for emitted rows */
  const orderByRun = new Map<string, number>();

  const citationsByDate = new Map<string, CitationObservation[]>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const runId = row.run_id?.trim();
    const date = row.date?.trim();
    if (!runId) {
      warnings.push(`Row ${i + 2}: missing run_id, skipped`);
      continue;
    }
    if (!date) {
      warnings.push(`Row ${i + 2}: missing date, skipped`);
      continue;
    }

    const rawUrl = row.url?.trim() ?? "";
    const normalizedUrl = rawUrl ? normalizeUrl(rawUrl) : "";
    const dedupeKey = `${runId}\t${normalizedUrl}`;
    if (seenRunUrl.has(dedupeKey)) continue;
    seenRunUrl.add(dedupeKey);

    const domain = normalizeHostname(row.hostname ?? "");
    if (!domain) {
      warnings.push(`Row ${i + 2}: empty hostname after normalize, skipped`);
      continue;
    }

    const order = orderByRun.get(runId) ?? 0;
    orderByRun.set(runId, order + 1);

    const source_category = mapSourceCategory(
      row.citationCategory ?? "",
      domain,
      ownedSet,
      warnings,
      i
    );
    const is_owned = ownedSet.has(domain);
    const tracked_entity_id = entityLookup.get(domain) ?? null;

    const titleRaw = row.title?.trim() ?? "";
    const observation: CitationObservation = {
      id: `cit-${runId}-${order}`,
      prompt_answer_id: runId,
      domain,
      url: normalizedUrl || null,
      title: titleRaw ? titleRaw : null,
      citation_order: order,
      source_category,
      is_owned,
      tracked_entity_id,
      observed_at: date,
    };

    const list = citationsByDate.get(date);
    if (list) list.push(observation);
    else citationsByDate.set(date, [observation]);
  }

  return { citationsByDate, warnings };
}
