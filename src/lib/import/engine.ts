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
  cleanNumeric,
  normalizeImportDate,
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
  source: string,
  tenantId: string,
  visibilityObservationRunId?: string | null,
): RowResult<Result> {
  if (!tenantId) {
    throw new Error(
      `[mapResultRow] tenantId required (row ${idx + 1}); use the resolved tenant from the import action's currentTenantId() call.`,
    );
  }
  const errors: string[] = [];
  const warnings: string[] = [];

  const platformRaw = row.platform ?? row.platform_name ?? row.engine ?? row.channel ?? row.source ?? "";
  const platform = normalizePlatform(platformRaw);
  if (!platform) errors.push(`Row ${idx + 1}: Unknown platform "${platformRaw}"`);

  const metricRaw = row.metric_type ?? row.metric ?? row.metric_name ?? row.kpi ?? row.measure ?? "";
  const metricType = normalizeMetricType(metricRaw);
  if (!metricType) errors.push(`Row ${idx + 1}: Unknown metric_type "${metricRaw}"`);

  const metricValueRaw = row.metric_value ?? row.value ?? row.current_value ?? row.new_value ?? row.current ?? "";
  const metricValue = cleanNumeric(metricValueRaw);
  if (metricValue === null) errors.push(`Row ${idx + 1}: Invalid metric_value "${metricValueRaw}"`);

  const dateRaw = row.snapshot_date ?? row.date ?? row.occurred_at ?? row.measured_at ?? row.report_date ?? row.as_of ?? row.week_ending ?? row.week_of ?? "";
  const snapshotDate = normalizeImportDate(dateRaw);
  if (!snapshotDate && dateRaw) {
    warnings.push(`Row ${idx + 1}: Could not parse date "${dateRaw}", using as-is`);
  }
  if (!dateRaw) errors.push(`Row ${idx + 1}: Missing snapshot_date`);

  if (errors.length > 0) return { entity: null, errors, warnings };

  const prevRaw = row.previous_value ?? row.prev_value ?? row.old_value ?? row.prior ?? row.baseline ?? "";
  const previousValue = cleanNumeric(prevRaw);

  let delta: number | null = null;
  let deltaPercentage: number | null = null;
  if (previousValue !== null && metricValue !== null) {
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

  const mentionCountRaw = row.mention_count ?? row.mentions ?? row.mentioned ?? "";
  const citationCountRaw = row.citation_count ?? row.citations ?? row.cited ?? "";
  const totalPossibleRaw = row.total_possible ?? row.total_prompts ?? row.total ?? "";
  const positionRaw = row.position ?? row.avg_position ?? row.rank ?? "";

  const result: Result = {
    id: row.id?.trim() || generateId("res"),
    snapshot_date: snapshotDate || dateRaw,
    platform: platform!,
    metric_type: metricType!,
    metric_value: metricValue!,
    previous_value: previousValue,
    delta,
    delta_percentage: deltaPercentage,
    topic: normalizeTopic(row.topic ?? "") || null,
    city: normalizeCity(row.city ?? ""),
    url_measured: normalizeUrl(row.url_measured ?? row.url ?? ""),
    attributed_changelog_ids: changeIds,
    notes: row.notes?.trim() || null,
    mention_count: cleanNumeric(mentionCountRaw) ?? 0,
    citation_count: cleanNumeric(citationCountRaw) ?? 0,
    total_possible: cleanNumeric(totalPossibleRaw) ?? null,
    position: cleanNumeric(positionRaw) ?? null,
    created_at: row.created_at || now(),
    source_system: source,
    import_batch_id: batchId,
    visibility_observation_run_id:
      visibilityObservationRunId ??
      row.visibility_observation_run_id?.trim() ??
      null,
    tenant_id: tenantId,
  };

  return { entity: result, errors, warnings };
}

export function mapChangeRow(
  row: Record<string, string>,
  idx: number,
  batchId: string,
  source: string,
  tenantId: string,
): RowResult<ChangelogEntry> {
  if (!tenantId) {
    throw new Error(
      `[mapChangeRow] tenantId required (row ${idx + 1}); use the resolved tenant from the import action's currentTenantId() call.`,
    );
  }
  const errors: string[] = [];
  const warnings: string[] = [];

  const signalRaw = row.signal_type ?? row.type ?? row.category ?? row.change_type ?? row.workstream ?? "";
  const signalType = normalizeSignalType(signalRaw);
  if (!signalType && signalRaw) {
    warnings.push(`Row ${idx + 1}: Unknown signal_type "${signalRaw}", using "content"`);
  }

  const assetRaw = row.asset_type ?? row.page_type ?? row.content_type ?? "";
  const assetType = normalizeAssetType(assetRaw);
  if (!assetType && assetRaw) {
    warnings.push(`Row ${idx + 1}: Unknown asset_type "${assetRaw}", using "service_page"`);
  }

  const tsRaw = row.timestamp ?? row.date ?? row.occurred_at ?? row.changed_at ?? row.deploy_date ?? row.when ?? row.event_date ?? row.log_date ?? row.created_date ?? "";
  const timestamp = normalizeImportDate(tsRaw);
  if (!timestamp && tsRaw) {
    warnings.push(`Row ${idx + 1}: Could not parse date "${tsRaw}", using as-is`);
  }
  if (!tsRaw) errors.push(`Row ${idx + 1}: Missing timestamp/date`);

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
    timestamp: timestamp || tsRaw,
    signal_type: signalType ?? "content",
    asset_type: assetType ?? "service_page",
    url: normalizeUrl(row.url ?? row.page_url ?? row.link ?? row.target_url ?? ""),
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
    tenant_id: tenantId,
  };

  return { entity: entry, errors, warnings };
}

export function mapOpportunityRow(
  row: Record<string, string>,
  idx: number,
  batchId: string,
  source: string,
  tenantId: string,
): RowResult<Opportunity> {
  if (!tenantId) {
    throw new Error(
      `[mapOpportunityRow] tenantId required (row ${idx + 1}); use the resolved tenant from the import action's currentTenantId() call.`,
    );
  }
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
    tenant_id: tenantId,
  };

  return { entity: opp, errors, warnings };
}

export function mapCompetitorRow(
  row: Record<string, string>,
  idx: number,
  batchId: string,
  source: string,
  tenantId: string,
): RowResult<Competitor> {
  if (!tenantId) {
    throw new Error(
      `[mapCompetitorRow] tenantId required (row ${idx + 1}); use the resolved tenant from the import action's currentTenantId() call.`,
    );
  }
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
    source_of_truth: "imported_entity",
    tenant_id: tenantId,
  };

  return { entity: comp, errors, warnings };
}
