import { generateId, now } from "@/lib/actions";
import { METRIC_DIRECTION } from "@/lib/constants";
import {
  normalizePlatform,
  normalizeMetricType,
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
import type { Platform, MetricType } from "@/lib/constants";

type RowResult<T> = {
  entity: T | null;
  errors: string[];
  warnings: string[];
};

export function mapResultRow(
  row: Record<string, string>,
  idx: number,
  batchId: string,
  source: string
): RowResult<Result> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const platform = normalizePlatform(row.platform ?? "");
  if (!platform) errors.push(`Row ${idx + 1}: Unknown platform "${row.platform}"`);

  const metricType = normalizeMetricType(row.metric_type ?? row.metric ?? "");
  if (!metricType) errors.push(`Row ${idx + 1}: Unknown metric_type "${row.metric_type ?? row.metric}"`);

  const metricValueRaw = row.metric_value ?? row.value ?? row.current_value ?? row.new_value ?? "";
  const metricValue = parseFloat(metricValueRaw);
  if (!metricValueRaw || isNaN(metricValue)) errors.push(`Row ${idx + 1}: Invalid metric_value "${metricValueRaw}"`);

  const snapshotDate = row.snapshot_date ?? row.date ?? row.occurred_at ?? row.measured_at ?? "";
  if (!snapshotDate) errors.push(`Row ${idx + 1}: Missing snapshot_date`);

  if (errors.length > 0) return { entity: null, errors, warnings };

  const prevRaw = row.previous_value ?? row.prev_value ?? row.old_value ?? "";
  const previousValue = prevRaw ? parseFloat(prevRaw) : null;

  let delta: number | null = null;
  let deltaPercentage: number | null = null;
  if (previousValue !== null && !isNaN(previousValue)) {
    const rawDelta = metricValue - previousValue;
    const dir = METRIC_DIRECTION[metricType!];
    delta = dir === "lower_is_better" ? -rawDelta : rawDelta;
    if (previousValue !== 0) {
      deltaPercentage = Math.round((rawDelta / Math.abs(previousValue)) * 1000) / 10;
    }
  }

  const changeIds = (row.attributed_change_ids ?? row.attributed_changelog_ids ?? row.change_ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result: Result = {
    id: row.id?.trim() || generateId("res"),
    snapshot_date: snapshotDate,
    platform: platform!,
    metric_type: metricType!,
    metric_value: metricValue,
    previous_value: previousValue,
    delta,
    delta_percentage: deltaPercentage,
    topic: normalizeTopic(row.topic ?? "") || null,
    city: normalizeCity(row.city ?? ""),
    url_measured: normalizeUrl(row.url_measured ?? row.url ?? ""),
    attributed_changelog_ids: changeIds,
    notes: row.notes?.trim() || null,
    created_at: row.created_at || now(),
    source_system: source,
    import_batch_id: batchId,
  };

  return { entity: result, errors, warnings };
}

export function mapChangeRow(
  row: Record<string, string>,
  idx: number,
  batchId: string,
  source: string
): RowResult<ChangelogEntry> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const signalType = normalizeSignalType(row.signal_type ?? row.type ?? "");
  if (!signalType) {
    if (row.signal_type || row.type) {
      warnings.push(`Row ${idx + 1}: Unknown signal_type "${row.signal_type ?? row.type}", using "content"`);
    }
  }

  const assetType = normalizeAssetType(row.asset_type ?? "");
  if (!assetType && row.asset_type) {
    warnings.push(`Row ${idx + 1}: Unknown asset_type "${row.asset_type}", using "service_page"`);
  }

  const timestamp = row.timestamp ?? row.date ?? row.occurred_at ?? row.changed_at ?? row.deploy_date ?? row.when ?? "";
  if (!timestamp) errors.push(`Row ${idx + 1}: Missing timestamp/date`);

  const assetName = row.asset_name ?? row.name ?? row.title ?? row.page ?? row.asset ?? "";
  if (!assetName) errors.push(`Row ${idx + 1}: Missing asset_name`);

  let description = row.change_description ?? row.description ?? row.summary ?? row.what_changed ?? row.details ?? "";
  if (!description && assetName) {
    warnings.push(`Row ${idx + 1}: Missing change_description, using asset_name`);
    description = assetName;
  } else if (!description) {
    errors.push(`Row ${idx + 1}: Missing change_description`);
  }

  let topic = normalizeTopic(row.topic_targeted ?? row.topic ?? row.keyword ?? row.query ?? row.theme ?? "");
  if (!topic && assetName) {
    warnings.push(`Row ${idx + 1}: Missing topic_targeted, using asset_name`);
    topic = assetName;
  } else if (!topic) {
    errors.push(`Row ${idx + 1}: Missing topic_targeted`);
  }

  if (errors.length > 0) return { entity: null, errors, warnings };

  const entry: ChangelogEntry = {
    id: row.id?.trim() || generateId("cl"),
    timestamp,
    signal_type: signalType ?? "content",
    asset_type: assetType ?? "service_page",
    url: normalizeUrl(row.url ?? ""),
    asset_name: assetName,
    change_description: description,
    topic_targeted: topic,
    city_targeted: normalizeCity(row.city_targeted ?? row.city ?? ""),
    hypothesis: row.hypothesis?.trim() || null,
    expected_impact_window: row.expected_impact_window ?? row.impact_window ?? null,
    brief_id: row.brief_id?.trim() || null,
    opportunity_id: row.opportunity_id?.trim() || null,
    notes: row.notes?.trim() || null,
    created_at: row.created_at || now(),
    updated_at: row.updated_at || now(),
    source_system: source,
    import_batch_id: batchId,
  };

  return { entity: entry, errors, warnings };
}

export function mapOpportunityRow(
  row: Record<string, string>,
  idx: number,
  batchId: string,
  source: string
): RowResult<Opportunity> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const title = row.title?.trim();
  if (!title) errors.push(`Row ${idx + 1}: Missing title`);

  const queryText = row.query_text ?? row.query ?? "";
  if (!queryText) errors.push(`Row ${idx + 1}: Missing query_text`);

  const topic = normalizeTopic(row.topic ?? "");
  if (!topic) errors.push(`Row ${idx + 1}: Missing topic`);

  const platformsRaw = row.platforms ?? row.platform ?? "";
  const platforms: Platform[] = platformsRaw
    .split(",")
    .map((p) => normalizePlatform(p.trim()))
    .filter((p): p is Platform => p !== null);
  if (platforms.length === 0 && platformsRaw) {
    warnings.push(`Row ${idx + 1}: No valid platforms from "${platformsRaw}"`);
    platforms.push("all");
  } else if (platforms.length === 0) {
    platforms.push("all");
  }

  if (errors.length > 0) return { entity: null, errors, warnings };

  const opp: Opportunity = {
    id: row.id?.trim() || generateId("opp"),
    title: title!,
    description: row.description?.trim() || null,
    query_text: queryText,
    platforms,
    intent_type: (row.intent_type as Opportunity["intent_type"]) ?? "informational",
    city: normalizeCity(row.city ?? ""),
    topic,
    tags: (row.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    current_status: (row.current_status as Opportunity["current_status"]) ?? "monitoring",
    priority: (row.priority as Opportunity["priority"]) ?? "medium",
    estimated_impact: (row.estimated_impact as Opportunity["estimated_impact"]) ?? "medium",
    effort: (row.effort as Opportunity["effort"]) ?? "medium",
    confidence: (row.confidence as Opportunity["confidence"]) ?? "medium",
    source: (row.source as Opportunity["source"]) ?? "manual_audit",
    baseline_position: row.baseline_position ? parseFloat(row.baseline_position) : null,
    target_position: row.target_position ? parseFloat(row.target_position) : null,
    target_url: normalizeUrl(row.target_url ?? ""),
    competitor_ids: [],
    primary_competitor_id: null,
    linked_brief_ids: [],
    linked_changelog_ids: [],
    related_opportunity_ids: [],
    identified_at: row.identified_at || row.created_at || now(),
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
    notes: row.notes?.trim() || null,
    created_at: row.created_at || now(),
    updated_at: row.updated_at || now(),
    source_system: source,
    import_batch_id: batchId,
  };

  return { entity: opp, errors, warnings };
}

export function mapCompetitorRow(
  row: Record<string, string>,
  idx: number,
  batchId: string,
  source: string
): RowResult<Competitor> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = row.name?.trim();
  if (!name) errors.push(`Row ${idx + 1}: Missing name`);

  const domain = row.domain?.trim();
  if (!domain) errors.push(`Row ${idx + 1}: Missing domain`);

  if (errors.length > 0) return { entity: null, errors, warnings };

  const comp: Competitor = {
    id: row.id?.trim() || generateId("comp"),
    name: name!,
    domain: domain!,
    description: row.description?.trim() || null,
    is_active: row.is_active ? row.is_active === "true" : true,
    notes: row.notes?.trim() || null,
    created_at: row.created_at || now(),
    updated_at: row.updated_at || now(),
    source_system: source,
    import_batch_id: batchId,
  };

  return { entity: comp, errors, warnings };
}
