/**
 * Bridge adapter: canonical Beacon data → legacy app data contracts.
 *
 * Allows the existing Review / event-detection / candidate-discovery pipeline
 * to run on imported Profound data without rewriting all consumers.
 *
 * Two pure functions + one changelog CSV parser:
 *   canonicalSnapshotsToResults()      — DailyMetricSnapshot[] → Result[]
 *   parseChangelogCSVToLegacy()        — CSV file path → ChangelogEntry[]
 *   writeLegacyBridge()                — orchestrator helper that writes bridged data
 */

import "server-only";

import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { SignalType, AssetType } from "@/lib/constants";
import type { ImportRun } from "@/lib/import/types";

import { normalizePlatform } from "@/lib/platform";
import { writeStore } from "@/lib/persistence/json-store";
import { importRuns } from "@/lib/seed-data.server";
import {
  syncChangelogEntries,
  syncImportRuns,
  syncResults,
} from "@/lib/persistence/dual-write";

// ── Snapshot → Result bridge ────────────────────────────────────────

/**
 * Convert derived DailyMetricSnapshots (scope_type=topic) into the old
 * Result shape that detectOutcomeEvents() and discoverCandidates() expect.
 *
 * Creates one Result per snapshot.  Event detection only uses:
 *   topic, platform, snapshot_date, mention_count, citation_count, total_possible
 * so metric_type/metric_value/delta are set to reasonable defaults.
 */
export function canonicalSnapshotsToResults(
  snapshots: DailyMetricSnapshot[],
  importBatchId: string
): Result[] {
  const topicSnapshots = snapshots.filter(
    (s) => s.scope_type === "topic" && s.source_type === "derived"
  );

  const grouped = new Map<string, DailyMetricSnapshot[]>();
  for (const s of topicSnapshots) {
    const key = `${s.scope_id}|${s.platform}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }

  const results: Result[] = [];

  for (const [, group] of grouped) {
    const sorted = group.sort((a, b) => a.date.localeCompare(b.date));

    for (let i = 0; i < sorted.length; i++) {
      const snap = sorted[i];
      const prev = i > 0 ? sorted[i - 1] : null;

      const mentionValue = snap.mention_count;
      const prevMentions = prev?.mention_count ?? null;
      const delta =
        prevMentions !== null ? mentionValue - prevMentions : null;
      const deltaPct =
        prevMentions !== null && prevMentions > 0
          ? Math.round(((mentionValue - prevMentions) / prevMentions) * 100)
          : null;

      results.push({
        id: `br-${snap.id}`,
        snapshot_date: snap.date,
        platform: normalizePlatform(snap.platform),
        metric_type: "mention_count",
        metric_value: mentionValue,
        previous_value: prevMentions,
        delta,
        delta_percentage: deltaPct,
        topic: snap.scope_id,
        city: extractCity(snap.scope_id),
        url_measured: null,
        attributed_changelog_ids: [],
        notes: null,
        mention_count: snap.mention_count,
        citation_count: snap.citation_count,
        total_possible: snap.total_possible ?? null,
        position: snap.avg_position ?? null,
        created_at: new Date().toISOString(),
        source_system: "profound",
        import_batch_id: importBatchId,
        tenant_id: "",
      });
    }
  }

  return results;
}

/**
 * Try to extract a city name from a topic string.
 * Topics like "Menlo Park", "Los Altos" become city; compound topics
 * like "Custom Home Builder Bay Area" get the trailing geo portion.
 */
function extractCity(topic: string): string | null {
  const KNOWN_CITIES = [
    "Menlo Park",
    "Los Altos",
    "Palo Alto",
    "Saratoga",
    "Atherton",
    "Woodside",
    "Portola Valley",
    "Los Altos Hills",
    "Mountain View",
    "San Jose",
    "Sunnyvale",
    "Campbell",
    "Cupertino",
    "San Mateo",
    "Bay Area",
  ];
  const lower = topic.toLowerCase();
  for (const city of KNOWN_CITIES) {
    if (lower.includes(city.toLowerCase())) return city;
  }
  return null;
}

// ── Changelog CSV → ChangelogEntry bridge ───────────────────────────

const SIGNAL_TYPE_MAP: Record<string, SignalType> = {
  faq: "faq",
  content: "content",
  technical: "technical",
  page: "page",
  citation: "citation",
  review: "review",
  "lead form": "lead_form",
  "off-page seo": "off_page_seo",
  "off page seo": "off_page_seo",
  measurement: "measurement",
  "service page": "service_page",
};

const ASSET_TYPE_MAP: Record<string, AssetType> = {
  homepage: "homepage",
  "city page": "city_page",
  "service page": "service_page",
  infrastructure: "infrastructure",
  sitemap: "sitemap",
  "directory profile": "directory_profile",
  "lead form": "lead_form",
  "project page": "project_page",
};

/**
 * Parse the ChangeLogWebsite CSV into legacy ChangelogEntry[].
 *
 * The CSV has a known column-shift issue where header names are offset
 * by one position from the actual data.  We parse by column index:
 *
 *   0 = date, 1 = time, 2 = signal_type, 3 = asset_type, 4 = url,
 *   5 = asset_name, 6 = change_description, 7 = topic_targeted,
 *   8 = city_targeted, 9 = hypothesis, 10 = expected_impact_window,
 *   11 = notes
 */
export function parseChangelogCSVToLegacy(
  filePath: string,
  importBatchId: string
): ChangelogEntry[] {
  const raw = readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  const rows: string[][] = parse(raw, {
    relax_column_count: true,
    skip_empty_lines: true,
  });

  if (rows.length < 2) return [];

  const dataRows = rows.slice(1);
  const entries: ChangelogEntry[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < dataRows.length; i++) {
    const cols = dataRows[i];
    if (!cols[0]?.trim()) continue;

    const dateStr = cols[0]?.trim() ?? "";
    const timeStr = cols[1]?.trim() ?? "";
    const signalRaw = cols[2]?.trim() ?? "";
    const assetRaw = cols[3]?.trim() ?? "";
    const url = cols[4]?.trim() || null;
    const assetName = cols[5]?.trim() ?? "";
    const changeDesc = cols[6]?.trim() ?? "";
    const topicTargeted = cols[7]?.trim() ?? "";
    const cityTargeted = cols[8]?.trim() || null;
    const hypothesis = cols[9]?.trim() || null;
    const impactWindow = cols[10]?.trim() || null;
    const notes = cols[11]?.trim() || null;

    const timestamp = parseChangeDate(dateStr, timeStr);

    entries.push({
      id: `cl-${i + 1}-${timestamp.slice(0, 10)}`,
      timestamp,
      signal_type: normalizeSignalType(signalRaw),
      asset_type: normalizeAssetType(assetRaw),
      url,
      asset_name: assetName,
      change_description: changeDesc,
      topic_targeted: topicTargeted,
      city_targeted: cityTargeted,
      hypothesis,
      expected_impact_window: impactWindow === "Unknown" ? null : impactWindow,
      brief_id: null,
      opportunity_id: null,
      notes,
      created_at: now,
      updated_at: now,
      source_system: "changelog_csv",
      import_batch_id: importBatchId,
      tenant_id: "",
    });
  }

  return entries;
}

function parseChangeDate(dateStr: string, timeStr: string): string {
  try {
    const combined = timeStr ? `${dateStr} ${timeStr}` : dateStr;
    const d = new Date(combined);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {
    // fall through
  }
  try {
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      const [m, d, y] = parts;
      return new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00Z`).toISOString();
    }
  } catch {
    // fall through
  }
  return new Date().toISOString();
}

function normalizeSignalType(raw: string): SignalType {
  return SIGNAL_TYPE_MAP[raw.toLowerCase()] ?? "content";
}

function normalizeAssetType(raw: string): AssetType {
  return ASSET_TYPE_MAP[raw.toLowerCase()] ?? "infrastructure";
}

// ── Write bridge data to legacy stores ──────────────────────────────

export async function writeLegacyBridge(opts: {
  snapshots: DailyMetricSnapshot[];
  changelogCSVPath: string | null;
  /**
   * When provided, these rows replace `imported-changes` instead of parsing `changelogCSVPath`.
   * Used for header-discovered multi-file changelog merge. Omit to fall back to CSV path.
   */
  changelogEntries?: ChangelogEntry[];
  importBatchId: string;
  sourceSystem: string;
  totalCanonicalRows: number;
}): Promise<{ resultCount: number; changeCount: number }> {
  const results = canonicalSnapshotsToResults(opts.snapshots, opts.importBatchId);
  await writeStore("imported-results", results);

  let changes: ChangelogEntry[] = [];
  if (opts.changelogEntries !== undefined) {
    changes = opts.changelogEntries;
    await writeStore("imported-changes", changes);
  } else if (opts.changelogCSVPath) {
    changes = parseChangelogCSVToLegacy(opts.changelogCSVPath, opts.importBatchId);
    await writeStore("imported-changes", changes);
  }

  const importRun: ImportRun = {
    id: opts.importBatchId,
    source_system: opts.sourceSystem,
    entity_type: "results",
    format: "csv",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    total_rows: opts.totalCanonicalRows,
    imported_count: results.length + changes.length,
    skipped_count: 0,
    errors: [],
    warnings: [],
    tenant_id: "",
  };

  importRuns.push(importRun);
  await writeStore("import-runs", importRuns);

  await syncResults(results);
  if (changes.length > 0) {
    await syncChangelogEntries(changes);
  }
  await syncImportRuns(importRuns);

  return { resultCount: results.length, changeCount: changes.length };
}
