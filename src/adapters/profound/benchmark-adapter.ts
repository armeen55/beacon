import "server-only";

import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import {
  parseAvgPosition,
  parseCSV,
  parsePercent,
} from "@/lib/persistence/csv-parser";
import { getSiteConfig } from "@/lib/site-config";

type BenchmarkCSVRow = {
  key?: string;
  date: string;
  asset: string;
  platform: string;
  visibility: string;
  shareOfVoice: string;
  averagePosition: string;
  rank: string;
};

export type EntityCandidate = {
  name: string;
  classification:
    | "likely_builder"
    | "likely_directory"
    | "likely_social"
    | "likely_location"
    | "ambiguous";
  row_count: number;
};

const BUILDER_FRAGMENTS = [
  "builder",
  "construct",
  "home",
  "design",
  "build",
  "remodel",
  "guild",
] as const;

const DIRECTORY_TOKENS = [
  "houzz",
  "yelp",
  "angi",
  "angie's list",
  "homeadvisor",
  "thumbtack",
  "porch",
  "nextdoor",
  "bbb",
  "better business bureau",
  "trustpilot",
  "yellow pages",
  "superpages",
  "dexknows",
  "alignable",
  "bark",
  "manta",
] as const;

const SOCIAL_TOKENS = [
  "reddit",
  "youtube",
  "facebook",
  "instagram",
  "twitter",
  "linkedin",
  "tiktok",
  "pinterest",
  "quora",
  "medium",
  "threads",
] as const;

const LOCATION_TOKENS = [
  "cupertino",
  "palo alto",
  "menlo park",
  "menlo",
  "atherton",
  "san jose",
  "mountain view",
  "sunnyvale",
  "santa clara",
  "los altos",
  "redwood city",
  "campbell",
  "saratoga",
  "los gatos",
] as const;

function slugify(text: string): string {
  const lower = text.toLowerCase().replace(/\s+/g, "-");
  return lower.replace(/[^a-z0-9-]+/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Merge owned-entity name variants (legacy demo sheets + configured tenant) so scope_id stays consistent.
 */
function canonicalAssetLabel(asset: string): string {
  const norm = asset.trim().replace(/\s+/g, " ");
  if (norm.length === 0) return norm;
  const lower = norm.toLowerCase();
  const { entityDisplayName } = getSiteConfig();
  const entityLower = entityDisplayName.trim().toLowerCase();
  const firstTok = entityLower.split(/\s+/)[0] ?? "";
  const legacyRitz =
    lower === "ritz" ||
    lower === "ritz builders" ||
    lower.startsWith("ritz /");
  const matchesTenant =
    lower === entityLower ||
    (firstTok.length > 0 &&
      (lower === firstTok || lower.startsWith(`${firstTok} /`)));
  if (legacyRitz || matchesTenant) {
    return entityDisplayName.trim();
  }
  return norm;
}

function classifyAsset(name: string): EntityCandidate["classification"] {
  const lower = name.toLowerCase();
  for (const frag of BUILDER_FRAGMENTS) {
    if (lower.includes(frag)) return "likely_builder";
  }
  for (const tok of DIRECTORY_TOKENS) {
    if (lower.includes(tok)) return "likely_directory";
  }
  for (const tok of SOCIAL_TOKENS) {
    if (lower.includes(tok)) return "likely_social";
  }
  for (const tok of LOCATION_TOKENS) {
    if (lower.includes(tok)) return "likely_location";
  }
  return "ambiguous";
}

export function parseProfoundBenchmark(
  filePath: string,
  accountId: string,
  entityLookup: Map<string, string>
): {
  snapshots: DailyMetricSnapshot[];
  entityCandidates: EntityCandidate[];
  warnings: string[];
} {
  void accountId;
  const rows = parseCSV<BenchmarkCSVRow>(filePath);
  const snapshots: DailyMetricSnapshot[] = [];
  const warnings: string[] = [];
  const candidateCounts = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const asset = (row.asset ?? "").trim();
    const date = (row.date ?? "").trim();
    const platform = (row.platform ?? "").trim();

    if (!date) {
      warnings.push(`Row ${rowNum}: missing date`);
    }
    if (!asset) {
      warnings.push(`Row ${rowNum}: missing asset`);
    }
    if (!platform) {
      warnings.push(`Row ${rowNum}: missing platform`);
    }

    const canonical = canonicalAssetLabel(asset);
    if (canonical.length > 0) {
      candidateCounts.set(
        canonical,
        (candidateCounts.get(canonical) ?? 0) + 1
      );
    }

    const resolvedId = entityLookup.get(asset);
    const scopeId =
      resolvedId ?? slugify(canonicalAssetLabel(asset));

    const id = `bench-${date}-${slugify(asset)}-${slugify(platform)}`;

    snapshots.push({
      id,
      date,
      scope_type: "entity",
      scope_id: scopeId,
      platform,
      source_type: "benchmark",
      visibility_score: parsePercent(row.visibility),
      mention_count: 0,
      citation_count: 0,
      share_of_voice: parsePercent(row.shareOfVoice),
      avg_position: parseAvgPosition(row.averagePosition),
      total_possible: null,
      metadata: {
        rank: row.rank,
        asset,
      },
    });
  }

  const entityCandidates: EntityCandidate[] = [...candidateCounts.entries()]
    .map(([name, row_count]) => ({
      name,
      classification: classifyAsset(name),
      row_count,
    }))
    .sort((a, b) => b.row_count - a.row_count);

  return { snapshots, entityCandidates, warnings };
}
