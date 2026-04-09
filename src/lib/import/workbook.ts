import "server-only";

import * as XLSX from "xlsx";
import { now } from "@/lib/actions";
import {
  normalizeSignalType,
  normalizeAssetType,
  normalizeUrl,
  normalizeTopic,
  normalizeCity,
} from "./parsers";
import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { Platform } from "@/lib/constants";

export type WorkbookSheetSummary = {
  sheet: string;
  rows: number;
  imported: number;
  skipped: number;
  warnings: string[];
};

export type WorkbookImportData = {
  changes: ChangelogEntry[];
  results: Result[];
  opportunities: Opportunity[];
  competitors: Competitor[];
  sheets: WorkbookSheetSummary[];
  warnings: string[];
};

function excelSerialToISO(serial: number): string {
  const whole = Math.floor(serial);
  const ms = (whole - 25569) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function coerceDate(val: unknown): string | null {
  if (typeof val === "number" && val > 30000 && val < 70000) {
    return excelSerialToISO(val);
  }
  if (typeof val === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val;
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const ENGINE_MAP: Record<string, Platform> = {
  chatgpt: "chatgpt",
  "google ai overviews": "google_aio",
  perplexity: "perplexity",
};

function engineToPlatform(engine: string): Platform | null {
  return ENGINE_MAP[engine.toLowerCase().trim()] ?? null;
}

function stripUtm(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith("utm_")) u.searchParams.delete(k);
    }
    return u.toString().replace(/\?$/, "");
  } catch {
    return url;
  }
}

/** Workbook column prefix for owned-brand tracking columns (default matches legacy sheets). */
/** Persisted on imported rows — neutral product id (replaces legacy `ritz-workbook`). */
export const WORKBOOK_IMPORT_SOURCE = "beacon-workbook" as const;

function workbookTrackingPrefix(): string {
  const p = (process.env.BEACON_WORKBOOK_TRACKING_PREFIX ?? "").trim();
  return p || "Ritz";
}

function readOwnedCell(
  row: Record<string, unknown>,
  suffix: "Mentioned" | "Cited" | "Position" | "Citation URL"
): unknown {
  const prefix = workbookTrackingPrefix();
  const keys = [`${prefix} ${suffix}`, `Ritz ${suffix}`, `Owned ${suffix}`];
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

// ─── change_log sheet ───────────────────────────────────────────────────────
// Columns are shifted 2 positions right in some master workbooks:
// Timestamp(A)=date serial, Date(B)=time serial,
// then actual data starts at column C with header "Time" containing signal_type.
function parseChangeLogSheet(
  wb: XLSX.WorkBook,
  batchId: string,
  sheets: WorkbookSheetSummary[],
  globalWarnings: string[]
): ChangelogEntry[] {
  const ws = wb.Sheets["change_log"];
  if (!ws) {
    globalWarnings.push("Sheet 'change_log' not found");
    return [];
  }

  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
  });
  const entries: ChangelogEntry[] = [];
  const sheetWarnings: string[] = [];
  let skipped = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const dateVal = row["Timestamp"];
    const dateISO = coerceDate(dateVal);
    if (!dateISO) {
      sheetWarnings.push(`Row ${i + 1}: Could not parse date`);
      skipped++;
      continue;
    }

    const rawSignal = String(row["Time"] ?? "");
    const rawAsset = String(row["Signal Type"] ?? "");
    const rawUrl = String(row["Asset Type"] ?? "");
    const rawAssetName = String(row["URL"] ?? "");
    const rawDescription = String(row["Asset Name"] ?? "");
    const rawTopic = String(row["Exact Change Made"] ?? "");
    const rawCity = String(row["Topic Targeted"] ?? "");
    const rawHypothesis = String(row["City Targeted"] ?? "");
    const rawWindow = String(row["Intended Hypothesis"] ?? "");
    const rawNotes = String(row["Expected Impact Window"] ?? "");

    if (!rawAssetName && !rawDescription) {
      sheetWarnings.push(`Row ${i + 1}: Missing asset name and description`);
      skipped++;
      continue;
    }

    const signalType = normalizeSignalType(rawSignal) ?? "content";
    if (rawSignal && !normalizeSignalType(rawSignal)) {
      sheetWarnings.push(
        `Row ${i + 1}: Unknown signal_type "${rawSignal}", using "content"`
      );
    }

    const assetType = normalizeAssetType(rawAsset) ?? "service_page";

    const stableId = `wb-cl-${dateISO}-${slugify(rawAssetName || rawDescription)}`;

    entries.push({
      id: stableId,
      timestamp: dateISO,
      signal_type: signalType,
      asset_type: assetType,
      url: normalizeUrl(rawUrl),
      asset_name: rawAssetName || rawDescription,
      change_description: rawDescription || rawAssetName,
      topic_targeted: normalizeTopic(rawTopic) || rawAssetName,
      city_targeted: normalizeCity(rawCity),
      hypothesis: rawHypothesis.trim() || null,
      expected_impact_window: rawWindow.trim() || null,
      brief_id: null,
      opportunity_id: null,
      notes: rawNotes.trim() || null,
      created_at: now(),
      updated_at: now(),
      source_system: WORKBOOK_IMPORT_SOURCE,
      import_batch_id: batchId,
    });
  }

  sheets.push({
    sheet: "change_log",
    rows: data.length,
    imported: entries.length,
    skipped,
    warnings: sheetWarnings,
  });

  return entries;
}

// ─── prompt_intelligence_daily sheet ────────────────────────────────────────
// Aggregate by (date × engine × topic_cluster) → one Result per group
function parsePromptIntelligenceSheet(
  wb: XLSX.WorkBook,
  batchId: string,
  sheets: WorkbookSheetSummary[],
  globalWarnings: string[],
  visibilityRunId: string
): { results: Result[]; opportunities: Opportunity[] } {
  const ws = wb.Sheets["prompt_intelligence_daily"];
  if (!ws) {
    globalWarnings.push("Sheet 'prompt_intelligence_daily' not found");
    return { results: [], opportunities: [] };
  }

  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
  });
  const sheetWarnings: string[] = [];
  let skipped = 0;

  type AggKey = string;
  type AggBucket = {
    dateISO: string;
    engine: string;
    platform: Platform;
    topicCluster: string;
    totalPrompts: number;
    mentioned: number;
    cited: number;
    positions: number[];
    citationUrls: string[];
    samplePrompt: string;
  };

  const buckets = new Map<AggKey, AggBucket>();
  const topicClusters = new Map<
    string,
    { prompts: string[]; engines: Set<Platform> }
  >();

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const dateISO = coerceDate(row["Date"]);
    if (!dateISO) {
      sheetWarnings.push(`Row ${i + 1}: Could not parse date`);
      skipped++;
      continue;
    }

    const engineRaw = String(row["Engine"] ?? "");
    const platform = engineToPlatform(engineRaw);
    if (!platform) {
      sheetWarnings.push(`Row ${i + 1}: Unknown engine "${engineRaw}"`);
      skipped++;
      continue;
    }

    const topicCluster = String(row["Topic Cluster"] ?? "").trim();
    if (!topicCluster) {
      skipped++;
      continue;
    }

    const key = `${dateISO}|${platform}|${topicCluster}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        dateISO,
        engine: engineRaw,
        platform,
        topicCluster,
        totalPrompts: 0,
        mentioned: 0,
        cited: 0,
        positions: [],
        citationUrls: [],
        samplePrompt: "",
      };
      buckets.set(key, bucket);
    }

    bucket.totalPrompts++;

    const isMentioned = String(readOwnedCell(row, "Mentioned")).trim() === "Yes";
    const isCited = String(readOwnedCell(row, "Cited")).trim() === "Yes";

    if (isMentioned) {
      bucket.mentioned++;
      const pos = Number(readOwnedCell(row, "Position"));
      if (!isNaN(pos) && pos > 0) bucket.positions.push(pos);
    }
    if (isCited) {
      bucket.cited++;
      const citUrl = String(readOwnedCell(row, "Citation URL")).trim();
      if (citUrl) bucket.citationUrls.push(stripUtm(citUrl));
    }

    if (!bucket.samplePrompt) {
      bucket.samplePrompt = String(row["Prompt Text"] ?? "").trim();
    }

    let tc = topicClusters.get(topicCluster);
    if (!tc) {
      tc = { prompts: [], engines: new Set() };
      topicClusters.set(topicCluster, tc);
    }
    tc.engines.add(platform);
    if (tc.prompts.length < 3) {
      const pt = String(row["Prompt Text"] ?? "").trim();
      if (pt && !tc.prompts.includes(pt)) tc.prompts.push(pt);
    }
  }

  const results: Result[] = [];
  for (const bucket of buckets.values()) {
    const avgPos =
      bucket.positions.length > 0
        ? Math.round(
            (bucket.positions.reduce((a, b) => a + b, 0) /
              bucket.positions.length) *
              100
          ) / 100
        : null;

    const urlCounts = new Map<string, number>();
    for (const u of bucket.citationUrls) {
      urlCounts.set(u, (urlCounts.get(u) ?? 0) + 1);
    }
    let topUrl: string | null = null;
    let topUrlCount = 0;
    for (const [u, c] of urlCounts) {
      if (c > topUrlCount) {
        topUrl = u;
        topUrlCount = c;
      }
    }

    const stableId = `wb-pi-${bucket.dateISO}-${slugify(bucket.platform)}-${slugify(bucket.topicCluster)}`;

    results.push({
      id: stableId,
      snapshot_date: bucket.dateISO,
      platform: bucket.platform,
      metric_type: "mention_count",
      metric_value: bucket.mentioned,
      previous_value: null,
      delta: null,
      delta_percentage: null,
      topic: bucket.topicCluster,
      city: null,
      url_measured: topUrl,
      attributed_changelog_ids: [],
      notes: null,
      mention_count: bucket.mentioned,
      citation_count: bucket.cited,
      total_possible: bucket.totalPrompts,
      position: avgPos,
      created_at: now(),
      source_system: WORKBOOK_IMPORT_SOURCE,
      import_batch_id: batchId,
      visibility_observation_run_id: visibilityRunId,
    });
  }

  const opportunities = deriveOpportunities(topicClusters, batchId);

  sheets.push({
    sheet: "prompt_intelligence_daily",
    rows: data.length,
    imported: results.length,
    skipped,
    warnings: sheetWarnings,
  });

  return { results, opportunities };
}

// ─── Opportunity derivation ─────────────────────────────────────────────────
function deriveOpportunities(
  topicClusters: Map<string, { prompts: string[]; engines: Set<Platform> }>,
  batchId: string
): Opportunity[] {
  const opps: Opportunity[] = [];

  for (const [cluster, meta] of topicClusters) {
    const stableId = `wb-opp-${slugify(cluster)}`;
    const platforms: Platform[] = [...meta.engines];
    if (platforms.length === 0) platforms.push("all");

    opps.push({
      id: stableId,
      title: cluster,
      description: null,
      query_text: meta.prompts[0] ?? cluster,
      platforms,
      intent_type: "informational",
      city: null,
      topic: cluster,
      tags: cluster.toLowerCase().startsWith("shield:") ? ["shield"] : [],
      current_status: "monitoring",
      priority: "medium",
      estimated_impact: "medium",
      effort: "medium",
      confidence: "medium",
      source: "result_analysis",
      baseline_position: null,
      target_position: null,
      target_url: null,
      competitor_ids: [],
      primary_competitor_id: null,
      linked_brief_ids: [],
      linked_changelog_ids: [],
      related_opportunity_ids: [],
      identified_at: now(),
      activated_at: null,
      captured_at: null,
      lost_at: null,
      last_verified_at: null,
      assessed_at: null,
      deferred_at: null,
      deferred_until: null,
      closed_at: null,
      close_reason: null,
      regressed_at: null,
      notes: `Derived from workbook. Sample prompts: ${meta.prompts.slice(0, 2).join(" | ")}`,
      created_at: now(),
      updated_at: now(),
      source_system: WORKBOOK_IMPORT_SOURCE,
      import_batch_id: batchId,
    });
  }

  return opps;
}

// ─── Auto-link changes to opportunities ─────────────────────────────────────
function autoLinkChangesToOpportunities(
  changes: ChangelogEntry[],
  opportunities: Opportunity[]
): number {
  const index = new Map<string, string>();

  for (const opp of opportunities) {
    const topic = opp.topic.toLowerCase().trim();
    const stripped = topic.replace(/^shield:\s*/i, "").trim();

    index.set(topic, opp.id);
    if (stripped !== topic) index.set(stripped, opp.id);

    const cityMatch = stripped.match(/^(.+?)\s+construction$/i);
    if (cityMatch) {
      index.set(cityMatch[1].trim(), opp.id);
    }
  }

  let linked = 0;
  for (const change of changes) {
    if (change.opportunity_id) continue;
    const topic = change.topic_targeted.toLowerCase().trim();
    const match = index.get(topic);
    if (match) {
      change.opportunity_id = match;
      linked++;
    }
  }

  return linked;
}

// ─── competitor_summary_daily sheet ─────────────────────────────────────────
function parseCompetitorSheet(
  wb: XLSX.WorkBook,
  batchId: string,
  sheets: WorkbookSheetSummary[],
  globalWarnings: string[]
): Competitor[] {
  const ws = wb.Sheets["competitor_summary_daily"];
  if (!ws) {
    globalWarnings.push("Sheet 'competitor_summary_daily' not found");
    return [];
  }

  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
  });
  const sheetWarnings: string[] = [];

  const domainMap = new Map<
    string,
    { domain: string; topTopic: string; maxCited: number }
  >();

  for (const row of data) {
    const domain = String(row["Domain"] ?? "").trim().toLowerCase();
    if (!domain || domain.includes("ritz")) continue;

    const cited = Number(row["Times Cited"]) || 0;
    const topTopic = String(row["Top Topic"] ?? "").trim();
    const existing = domainMap.get(domain);
    if (!existing || cited > existing.maxCited) {
      domainMap.set(domain, { domain, topTopic, maxCited: cited });
    }
  }

  const competitors: Competitor[] = [];
  for (const info of domainMap.values()) {
    competitors.push({
      id: `wb-comp-${slugify(info.domain)}`,
      name: info.domain,
      domain: info.domain,
      description: info.topTopic ? `Top topic: ${info.topTopic}` : null,
      is_active: true,
      notes: null,
      created_at: now(),
      updated_at: now(),
      source_system: WORKBOOK_IMPORT_SOURCE,
      import_batch_id: batchId,
      source_of_truth: "imported_entity",
    });
  }

  sheets.push({
    sheet: "competitor_summary_daily",
    rows: data.length,
    imported: competitors.length,
    skipped: data.length - competitors.length,
    warnings: sheetWarnings,
  });

  return competitors;
}

// ─── Main parse entry point ─────────────────────────────────────────────────
export function parseWorkbook(
  buffer: ArrayBuffer,
  batchId: string,
  visibilityRunId: string
): WorkbookImportData {
  const wb = XLSX.read(buffer);
  const warnings: string[] = [];
  const sheets: WorkbookSheetSummary[] = [];

  const detectedSheets = wb.SheetNames;
  warnings.push(`Workbook contains ${detectedSheets.length} sheets: ${detectedSheets.join(", ")}`);

  const changes = parseChangeLogSheet(wb, batchId, sheets, warnings);
  const { results, opportunities } = parsePromptIntelligenceSheet(
    wb,
    batchId,
    sheets,
    warnings,
    visibilityRunId
  );
  const competitors = parseCompetitorSheet(wb, batchId, sheets, warnings);

  const linked = autoLinkChangesToOpportunities(changes, opportunities);
  warnings.push(
    `Auto-linked ${linked}/${changes.length} changes to ${opportunities.length} derived opportunities`
  );

  return { changes, results, opportunities, competitors, sheets, warnings };
}
