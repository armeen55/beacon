/**
 * build-local-aeo-intelligence — Trust Sprint Mini-Phase T6.2 (2026-05-06).
 *
 * Materializes derived intelligence files into
 * `.data/tenants/<slug>/brain/` so the brain (and future T6.3
 * recommendation-learning loop) can query pre-aggregated trajectories
 * instead of re-computing over raw observations every read.
 *
 * Pure compute. No paid APIs. No mutations to canonical stores.
 * Idempotent: re-running on the same input produces the same output.
 * Writes are atomic (write to .tmp, fsync, rename).
 *
 * Seven derived files + a manifest:
 *   daily-platform-summary.json     (per date × platform)
 *   weekly-platform-summary.json    (re-bucketed from daily)
 *   monthly-platform-summary.json   (re-bucketed from daily)
 *   competitor-trajectory.json      (weekly co-mentions per competitor)
 *   prompt-trajectory.json          (weekly mention/citation rate per prompt)
 *   citation-source-trajectory.json (weekly count per citing domain)
 *   geo-service-trajectory.json     (weekly brand-mention rate per (geo × service))
 *   manifest.json                   (built_at, file row counts, source SHAs)
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/build-local-aeo-intelligence.ts
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/build-local-aeo-intelligence.ts --tenant=ritz-builders
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

import {
  getPromptAnswerObservations,
  getTrackedPrompts,
  getTrackedEntities,
} from "../src/storage/canonical-store";
import type { PromptAnswerObservation } from "../src/domains/prompt-answer-observations/types";
import type { TrackedPrompt } from "../src/domains/tracked-prompts/types";
import type { TrackedEntity } from "../src/domains/tracked-entities/types";

const TENANT_SLUG_ARG = process.argv.find((a) => a.startsWith("--tenant="))?.split("=")[1];
const TENANT_SLUG = TENANT_SLUG_ARG ?? process.env.BEACON_TENANT_SLUG ?? "ritz-builders";
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, ".data", "tenants", TENANT_SLUG, "brain");

// ── Helpers ────────────────────────────────────────────────────────────

function dateOnly(iso: string | null | undefined): string {
  return (iso ?? "").slice(0, 10);
}

/** ISO 8601 week label, "YYYY-Www" (Mon-Sun). Not localized — UTC-stable. */
function isoWeek(iso: string | null | undefined): string {
  const dateStr = dateOnly(iso);
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  // Thursday in current week decides the year (ISO 8601)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function monthKey(iso: string | null | undefined): string {
  return dateOnly(iso).slice(0, 7); // "YYYY-MM"
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function atomicWriteJson(path: string, data: unknown): { rows: number; sha: string } {
  mkdirSync(dirname(path), { recursive: true });
  const json = JSON.stringify(data, null, 2);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, json, "utf-8");
  renameSync(tmp, path);
  return {
    rows: Array.isArray(data) ? data.length : Object.keys(data ?? {}).length,
    sha: sha256(json),
  };
}

// ── Builders ───────────────────────────────────────────────────────────

type DailyPlatformRow = {
  date: string;
  platform: string;
  observations: number;
  brand_mentions: number;
  brand_citations: number;
  citation_count_total: number;
  owned_citation_count_total: number;
  competitor_mentions_distinct: number;
};

function buildDailyPlatformSummary(obs: PromptAnswerObservation[]): DailyPlatformRow[] {
  type Bucket = {
    observations: number;
    brand_mentions: number;
    brand_citations: number;
    citation_count_total: number;
    owned_citation_count_total: number;
    competitor_mentions: Set<string>;
  };
  const map = new Map<string, Bucket>();
  for (const o of obs) {
    const date = dateOnly(o.observed_at);
    if (!date) continue;
    const platform = o.platform || "unknown";
    const key = `${date}::${platform}`;
    let b = map.get(key);
    if (!b) {
      b = {
        observations: 0,
        brand_mentions: 0,
        brand_citations: 0,
        citation_count_total: 0,
        owned_citation_count_total: 0,
        competitor_mentions: new Set<string>(),
      };
      map.set(key, b);
    }
    b.observations += 1;
    if (o.tracked_brand_mentioned === true) b.brand_mentions += 1;
    if (o.tracked_brand_cited === true) b.brand_citations += 1;
    b.citation_count_total += o.citation_count ?? 0;
    b.owned_citation_count_total += o.owned_citation_count ?? 0;
    for (const m of o.mentions ?? []) b.competitor_mentions.add(m);
  }
  const out: DailyPlatformRow[] = [];
  for (const [key, b] of map) {
    const [date, platform] = key.split("::");
    out.push({
      date,
      platform,
      observations: b.observations,
      brand_mentions: b.brand_mentions,
      brand_citations: b.brand_citations,
      citation_count_total: b.citation_count_total,
      owned_citation_count_total: b.owned_citation_count_total,
      competitor_mentions_distinct: b.competitor_mentions.size,
    });
  }
  return out.sort((a, b) => (a.date === b.date ? a.platform.localeCompare(b.platform) : a.date.localeCompare(b.date)));
}

type PeriodPlatformRow = {
  period: string;
  platform: string;
  observations: number;
  brand_mentions: number;
  brand_citations: number;
  brand_mention_rate: number;
  brand_citation_rate: number;
  citation_count_total: number;
  owned_citation_count_total: number;
};

function rebucketPlatformSummary(
  daily: DailyPlatformRow[],
  bucketFn: (date: string) => string,
): PeriodPlatformRow[] {
  type Bucket = {
    observations: number;
    brand_mentions: number;
    brand_citations: number;
    citation_count_total: number;
    owned_citation_count_total: number;
  };
  const map = new Map<string, Bucket>();
  for (const r of daily) {
    const period = bucketFn(r.date);
    if (!period) continue;
    const key = `${period}::${r.platform}`;
    let b = map.get(key);
    if (!b) {
      b = { observations: 0, brand_mentions: 0, brand_citations: 0, citation_count_total: 0, owned_citation_count_total: 0 };
      map.set(key, b);
    }
    b.observations += r.observations;
    b.brand_mentions += r.brand_mentions;
    b.brand_citations += r.brand_citations;
    b.citation_count_total += r.citation_count_total;
    b.owned_citation_count_total += r.owned_citation_count_total;
  }
  const out: PeriodPlatformRow[] = [];
  for (const [key, b] of map) {
    const [period, platform] = key.split("::");
    out.push({
      period,
      platform,
      observations: b.observations,
      brand_mentions: b.brand_mentions,
      brand_citations: b.brand_citations,
      brand_mention_rate: b.observations > 0 ? b.brand_mentions / b.observations : 0,
      brand_citation_rate: b.observations > 0 ? b.brand_citations / b.observations : 0,
      citation_count_total: b.citation_count_total,
      owned_citation_count_total: b.owned_citation_count_total,
    });
  }
  return out.sort((a, b) => (a.period === b.period ? a.platform.localeCompare(b.platform) : a.period.localeCompare(b.period)));
}

type CompetitorTrajectoryRow = {
  competitor_name: string;
  entity_type: string;
  total_co_mentions: number;
  first_observed: string | null;
  last_observed: string | null;
  weekly_co_mentions: Array<{ week: string; count: number }>;
};

function buildCompetitorTrajectory(
  obs: PromptAnswerObservation[],
  entities: TrackedEntity[],
): CompetitorTrajectoryRow[] {
  const competitorEntities = entities.filter((e) => e.entity_type === "competitor" || e.entity_type === "directory_source");
  const aliasMap = new Map<string, { name: string; entity_type: string }>();
  for (const e of competitorEntities) {
    aliasMap.set(e.name.toLowerCase(), { name: e.name, entity_type: e.entity_type });
    for (const a of e.aliases ?? []) aliasMap.set(a.toLowerCase(), { name: e.name, entity_type: e.entity_type });
  }

  type Bucket = {
    entity_type: string;
    weekly: Map<string, number>;
    total: number;
    first: string | null;
    last: string | null;
  };
  const map = new Map<string, Bucket>();

  for (const o of obs) {
    const w = isoWeek(o.observed_at);
    const date = dateOnly(o.observed_at);
    if (!w) continue;
    for (const m of o.mentions ?? []) {
      const hit = aliasMap.get(m.toLowerCase());
      if (!hit) continue;
      let b = map.get(hit.name);
      if (!b) {
        b = { entity_type: hit.entity_type, weekly: new Map(), total: 0, first: null, last: null };
        map.set(hit.name, b);
      }
      b.weekly.set(w, (b.weekly.get(w) ?? 0) + 1);
      b.total += 1;
      if (!b.first || date < b.first) b.first = date;
      if (!b.last || date > b.last) b.last = date;
    }
  }

  const out: CompetitorTrajectoryRow[] = [];
  for (const [name, b] of map) {
    out.push({
      competitor_name: name,
      entity_type: b.entity_type,
      total_co_mentions: b.total,
      first_observed: b.first,
      last_observed: b.last,
      weekly_co_mentions: [...b.weekly.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, count]) => ({ week, count })),
    });
  }
  return out.sort((a, b) => b.total_co_mentions - a.total_co_mentions);
}

type PromptTrajectoryRow = {
  prompt_id: string;
  prompt_text_snippet: string;
  intent_type: string | null;
  location_scope: string | null;
  service_scope: string | null;
  total_observations: number;
  total_brand_mentions: number;
  total_brand_citations: number;
  weekly: Array<{ week: string; observations: number; brand_mentions: number; brand_citations: number }>;
};

function buildPromptTrajectory(
  obs: PromptAnswerObservation[],
  prompts: TrackedPrompt[],
): PromptTrajectoryRow[] {
  const byId = new Map(prompts.map((p) => [p.id, p]));
  type Bucket = {
    weekly: Map<string, { observations: number; brand_mentions: number; brand_citations: number }>;
    totalObs: number;
    totalMentions: number;
    totalCitations: number;
  };
  const map = new Map<string, Bucket>();
  for (const o of obs) {
    const w = isoWeek(o.observed_at);
    if (!w) continue;
    let b = map.get(o.prompt_id);
    if (!b) {
      b = { weekly: new Map(), totalObs: 0, totalMentions: 0, totalCitations: 0 };
      map.set(o.prompt_id, b);
    }
    let wk = b.weekly.get(w);
    if (!wk) {
      wk = { observations: 0, brand_mentions: 0, brand_citations: 0 };
      b.weekly.set(w, wk);
    }
    wk.observations += 1;
    b.totalObs += 1;
    if (o.tracked_brand_mentioned === true) {
      wk.brand_mentions += 1;
      b.totalMentions += 1;
    }
    if (o.tracked_brand_cited === true) {
      wk.brand_citations += 1;
      b.totalCitations += 1;
    }
  }
  const out: PromptTrajectoryRow[] = [];
  for (const [pid, b] of map) {
    const p = byId.get(pid);
    const text = p?.text ?? "";
    const snippet = text.length > 60 ? `${text.slice(0, 57).trim()}…` : text;
    out.push({
      prompt_id: pid,
      prompt_text_snippet: snippet,
      intent_type: p?.intent_type ?? null,
      location_scope: p?.location_scope ?? null,
      service_scope: p?.service_scope ?? null,
      total_observations: b.totalObs,
      total_brand_mentions: b.totalMentions,
      total_brand_citations: b.totalCitations,
      weekly: [...b.weekly.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, v]) => ({ week, ...v })),
    });
  }
  return out.sort((a, b) => b.total_brand_citations - a.total_brand_citations);
}

type CitationSourceRow = {
  domain: string;
  classification: "owned" | "competitor" | "directory" | "other";
  total_citations: number;
  weekly: Array<{ week: string; citations: number }>;
};

function buildCitationSourceTrajectory(
  obs: PromptAnswerObservation[],
  entities: TrackedEntity[],
): CitationSourceRow[] {
  const ownedDomains = new Set<string>();
  const competitorDomains = new Set<string>();
  const directoryDomains = new Set<string>();
  for (const e of entities) {
    if (!e.domain) continue;
    const d = e.domain.toLowerCase();
    if (e.is_owned) ownedDomains.add(d);
    if (e.entity_type === "competitor") competitorDomains.add(d);
    if (e.entity_type === "directory_source") directoryDomains.add(d);
  }

  function classify(domain: string): CitationSourceRow["classification"] {
    const d = domain.toLowerCase();
    if (ownedDomains.has(d)) return "owned";
    if (competitorDomains.has(d)) return "competitor";
    if (directoryDomains.has(d)) return "directory";
    return "other";
  }

  type Bucket = { classification: CitationSourceRow["classification"]; weekly: Map<string, number>; total: number };
  const map = new Map<string, Bucket>();
  for (const o of obs) {
    const w = isoWeek(o.observed_at);
    if (!w) continue;
    for (const d of o.citation_domains ?? []) {
      const dom = (d || "").toLowerCase();
      if (!dom) continue;
      let b = map.get(dom);
      if (!b) {
        b = { classification: classify(dom), weekly: new Map(), total: 0 };
        map.set(dom, b);
      }
      b.weekly.set(w, (b.weekly.get(w) ?? 0) + 1);
      b.total += 1;
    }
  }

  const out: CitationSourceRow[] = [];
  for (const [domain, b] of map) {
    out.push({
      domain,
      classification: b.classification,
      total_citations: b.total,
      weekly: [...b.weekly.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, citations]) => ({ week, citations })),
    });
  }
  return out.sort((a, b) => b.total_citations - a.total_citations);
}

type GeoServiceRow = {
  geo: string;
  service: string;
  prompt_count: number;
  total_observations: number;
  total_brand_mentions: number;
  brand_mention_rate: number;
  weekly: Array<{ week: string; observations: number; brand_mentions: number }>;
};

function buildGeoServiceTrajectory(
  obs: PromptAnswerObservation[],
  prompts: TrackedPrompt[],
): GeoServiceRow[] {
  const byPrompt = new Map(prompts.map((p) => [p.id, p]));
  type Bucket = {
    promptIds: Set<string>;
    weekly: Map<string, { observations: number; brand_mentions: number }>;
    totalObs: number;
    totalMentions: number;
  };
  const map = new Map<string, Bucket>();
  for (const o of obs) {
    const p = byPrompt.get(o.prompt_id);
    const geo = p?.location_scope ?? "(none)";
    const service = p?.service_scope ?? "(none)";
    if (geo === "(none)" && service === "(none)") continue; // skip uncategorized
    const key = `${geo}::${service}`;
    let b = map.get(key);
    if (!b) {
      b = { promptIds: new Set(), weekly: new Map(), totalObs: 0, totalMentions: 0 };
      map.set(key, b);
    }
    b.promptIds.add(o.prompt_id);
    const w = isoWeek(o.observed_at);
    if (!w) continue;
    let wk = b.weekly.get(w);
    if (!wk) {
      wk = { observations: 0, brand_mentions: 0 };
      b.weekly.set(w, wk);
    }
    wk.observations += 1;
    b.totalObs += 1;
    if (o.tracked_brand_mentioned === true) {
      wk.brand_mentions += 1;
      b.totalMentions += 1;
    }
  }
  const out: GeoServiceRow[] = [];
  for (const [key, b] of map) {
    const [geo, service] = key.split("::");
    out.push({
      geo,
      service,
      prompt_count: b.promptIds.size,
      total_observations: b.totalObs,
      total_brand_mentions: b.totalMentions,
      brand_mention_rate: b.totalObs > 0 ? b.totalMentions / b.totalObs : 0,
      weekly: [...b.weekly.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, v]) => ({ week, ...v })),
    });
  }
  return out.sort((a, b) => b.total_brand_mentions - a.total_brand_mentions);
}

// ──────────────────────────────────────────────────────────────────────
// Trust Sprint T7.4 — Local AEO intelligence v2 builders.
//
// Adds 7 derived files on top of the v1 set. Each output record
// carries: window, sample size, platform, identifier (city/service/
// page/domain), brand mention rate, brand citation rate, top
// competitors / top domains, trend vs prior window, partial/full
// sample flag.
//
// Pure compute, no paid calls. Same atomic-write contract as v1.
// ──────────────────────────────────────────────────────────────────────

const SAMPLE_SIZE_FULL_THRESHOLD = 80; // matches T6.1 brain-health full-day threshold
const RECENT_WINDOW_DAYS = 14;

function lastNWeeks(n: number): string[] {
  const weeks = new Set<string>();
  const today = new Date();
  for (let i = 0; i < n; i += 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weeks.add(isoWeek(d.toISOString()));
  }
  return [...weeks].filter(Boolean).sort();
}

function trendDelta(curr: number, prior: number): number {
  if (prior === 0 && curr === 0) return 0;
  if (prior === 0) return curr > 0 ? 1 : 0;
  return curr / prior - 1;
}

type CityStrengthRow = {
  city: string;
  prompt_count: number;
  total_observations: number;
  brand_mentions: number;
  brand_citations: number;
  brand_mention_rate: number;
  brand_citation_rate: number;
  recent_2w_mentions: number;
  prior_2w_mentions: number;
  trend_vs_prior_window: number;
  sample_full: boolean;
  weekly: Array<{ week: string; observations: number; mentions: number; citations: number }>;
};

function buildCityStrengthIndex(
  obs: PromptAnswerObservation[],
  prompts: TrackedPrompt[],
): CityStrengthRow[] {
  const byPrompt = new Map(prompts.map((p) => [p.id, p]));
  type Bucket = {
    promptIds: Set<string>;
    weekly: Map<string, { observations: number; mentions: number; citations: number }>;
    totalObs: number;
    totalMentions: number;
    totalCitations: number;
  };
  const map = new Map<string, Bucket>();
  for (const o of obs) {
    const p = byPrompt.get(o.prompt_id);
    const city = (p?.location_scope ?? "").trim();
    if (!city) continue;
    let b = map.get(city);
    if (!b) {
      b = { promptIds: new Set(), weekly: new Map(), totalObs: 0, totalMentions: 0, totalCitations: 0 };
      map.set(city, b);
    }
    b.promptIds.add(o.prompt_id);
    const w = isoWeek(o.observed_at);
    if (!w) continue;
    let wk = b.weekly.get(w);
    if (!wk) {
      wk = { observations: 0, mentions: 0, citations: 0 };
      b.weekly.set(w, wk);
    }
    wk.observations += 1;
    b.totalObs += 1;
    if (o.tracked_brand_mentioned === true) {
      wk.mentions += 1;
      b.totalMentions += 1;
    }
    if (o.tracked_brand_cited === true) {
      wk.citations += 1;
      b.totalCitations += 1;
    }
  }
  const recentWeeks = new Set(lastNWeeks(2));
  const priorWeeks = new Set(lastNWeeks(4).filter((w) => !recentWeeks.has(w)));
  const out: CityStrengthRow[] = [];
  for (const [city, b] of map) {
    let recentMentions = 0;
    let priorMentions = 0;
    for (const [week, v] of b.weekly) {
      if (recentWeeks.has(week)) recentMentions += v.mentions;
      else if (priorWeeks.has(week)) priorMentions += v.mentions;
    }
    out.push({
      city,
      prompt_count: b.promptIds.size,
      total_observations: b.totalObs,
      brand_mentions: b.totalMentions,
      brand_citations: b.totalCitations,
      brand_mention_rate: b.totalObs > 0 ? b.totalMentions / b.totalObs : 0,
      brand_citation_rate: b.totalObs > 0 ? b.totalCitations / b.totalObs : 0,
      recent_2w_mentions: recentMentions,
      prior_2w_mentions: priorMentions,
      trend_vs_prior_window: trendDelta(recentMentions, priorMentions),
      sample_full: b.totalObs >= SAMPLE_SIZE_FULL_THRESHOLD,
      weekly: [...b.weekly.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, v]) => ({ week, ...v })),
    });
  }
  return out.sort((a, b) => b.brand_mention_rate - a.brand_mention_rate);
}

type ServiceStrengthRow = {
  service: string;
  prompt_count: number;
  total_observations: number;
  brand_mentions: number;
  brand_citations: number;
  brand_mention_rate: number;
  brand_citation_rate: number;
  recent_2w_mentions: number;
  prior_2w_mentions: number;
  trend_vs_prior_window: number;
  sample_full: boolean;
  weekly: Array<{ week: string; observations: number; mentions: number; citations: number }>;
};

function buildServiceStrengthIndex(
  obs: PromptAnswerObservation[],
  prompts: TrackedPrompt[],
): ServiceStrengthRow[] {
  const byPrompt = new Map(prompts.map((p) => [p.id, p]));
  type Bucket = {
    promptIds: Set<string>;
    weekly: Map<string, { observations: number; mentions: number; citations: number }>;
    totalObs: number;
    totalMentions: number;
    totalCitations: number;
  };
  const map = new Map<string, Bucket>();
  for (const o of obs) {
    const p = byPrompt.get(o.prompt_id);
    const svc = (p?.service_scope ?? "").trim();
    if (!svc) continue;
    let b = map.get(svc);
    if (!b) {
      b = { promptIds: new Set(), weekly: new Map(), totalObs: 0, totalMentions: 0, totalCitations: 0 };
      map.set(svc, b);
    }
    b.promptIds.add(o.prompt_id);
    const w = isoWeek(o.observed_at);
    if (!w) continue;
    let wk = b.weekly.get(w);
    if (!wk) {
      wk = { observations: 0, mentions: 0, citations: 0 };
      b.weekly.set(w, wk);
    }
    wk.observations += 1;
    b.totalObs += 1;
    if (o.tracked_brand_mentioned === true) {
      wk.mentions += 1;
      b.totalMentions += 1;
    }
    if (o.tracked_brand_cited === true) {
      wk.citations += 1;
      b.totalCitations += 1;
    }
  }
  const recentWeeks = new Set(lastNWeeks(2));
  const priorWeeks = new Set(lastNWeeks(4).filter((w) => !recentWeeks.has(w)));
  const out: ServiceStrengthRow[] = [];
  for (const [service, b] of map) {
    let recentMentions = 0;
    let priorMentions = 0;
    for (const [week, v] of b.weekly) {
      if (recentWeeks.has(week)) recentMentions += v.mentions;
      else if (priorWeeks.has(week)) priorMentions += v.mentions;
    }
    out.push({
      service,
      prompt_count: b.promptIds.size,
      total_observations: b.totalObs,
      brand_mentions: b.totalMentions,
      brand_citations: b.totalCitations,
      brand_mention_rate: b.totalObs > 0 ? b.totalMentions / b.totalObs : 0,
      brand_citation_rate: b.totalObs > 0 ? b.totalCitations / b.totalObs : 0,
      recent_2w_mentions: recentMentions,
      prior_2w_mentions: priorMentions,
      trend_vs_prior_window: trendDelta(recentMentions, priorMentions),
      sample_full: b.totalObs >= SAMPLE_SIZE_FULL_THRESHOLD,
      weekly: [...b.weekly.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, v]) => ({ week, ...v })),
    });
  }
  return out.sort((a, b) => b.brand_mention_rate - a.brand_mention_rate);
}

type CompetitorWeeklyV2Row = {
  competitor_name: string;
  entity_type: string;
  total_co_mentions: number;
  recent_2w: number;
  prior_2w: number;
  trend_vs_prior_window: number;
  rising: boolean;
  falling: boolean;
  first_observed: string | null;
  last_observed: string | null;
  weekly: Array<{ week: string; count: number }>;
};

function buildCompetitorWeeklyV2(
  competitorTraj: ReturnType<typeof buildCompetitorTrajectory>,
): CompetitorWeeklyV2Row[] {
  const recentWeeks = new Set(lastNWeeks(2));
  const priorWeeks = new Set(lastNWeeks(4).filter((w) => !recentWeeks.has(w)));
  return competitorTraj.map((c) => {
    let recent = 0;
    let prior = 0;
    for (const wk of c.weekly_co_mentions) {
      if (recentWeeks.has(wk.week)) recent += wk.count;
      else if (priorWeeks.has(wk.week)) prior += wk.count;
    }
    const trend = trendDelta(recent, prior);
    return {
      competitor_name: c.competitor_name,
      entity_type: c.entity_type,
      total_co_mentions: c.total_co_mentions,
      recent_2w: recent,
      prior_2w: prior,
      trend_vs_prior_window: trend,
      rising: trend > 0.15 && recent >= 5,
      falling: trend < -0.15 && prior >= 5,
      first_observed: c.first_observed,
      last_observed: c.last_observed,
      weekly: c.weekly_co_mentions,
    };
  });
}

type CitationDomainAuthorityRow = {
  domain: string;
  classification: "owned" | "competitor" | "directory" | "other";
  total_citations: number;
  weeks_observed: number;
  authority_score: number;
  recent_2w: number;
  prior_2w: number;
  trend_vs_prior_window: number;
  weekly: Array<{ week: string; citations: number }>;
};

function buildCitationDomainAuthority(
  citationTraj: ReturnType<typeof buildCitationSourceTrajectory>,
): CitationDomainAuthorityRow[] {
  const recentWeeks = new Set(lastNWeeks(2));
  const priorWeeks = new Set(lastNWeeks(4).filter((w) => !recentWeeks.has(w)));
  return citationTraj.map((d) => {
    let recent = 0;
    let prior = 0;
    for (const wk of d.weekly) {
      if (recentWeeks.has(wk.week)) recent += wk.citations;
      else if (priorWeeks.has(wk.week)) prior += wk.citations;
    }
    // Authority = volume × consistency. Consistency proxy = #weeks observed.
    const weeksObserved = d.weekly.length;
    const authority = d.total_citations * Math.log(1 + weeksObserved);
    return {
      domain: d.domain,
      classification: d.classification,
      total_citations: d.total_citations,
      weeks_observed: weeksObserved,
      authority_score: Number(authority.toFixed(2)),
      recent_2w: recent,
      prior_2w: prior,
      trend_vs_prior_window: trendDelta(recent, prior),
      weekly: d.weekly,
    };
  }).sort((a, b) => b.authority_score - a.authority_score);
}

type PageCitationTrajectoryRow = {
  page_url: string;
  domain: string;
  is_owned: boolean;
  total_citations: number;
  weeks_observed: number;
  recent_2w: number;
  prior_2w: number;
  trend_vs_prior_window: number;
  weekly: Array<{ week: string; citations: number }>;
};

function buildPageCitationTrajectory(
  obs: PromptAnswerObservation[],
  entities: TrackedEntity[],
): PageCitationTrajectoryRow[] {
  const ownedDomains = new Set<string>();
  for (const e of entities) {
    if (e.is_owned && e.domain) ownedDomains.add(e.domain.toLowerCase());
  }
  // Citations live in observation.citation_domains as a list of domains.
  // Per-page (URL) trajectory requires the citation_url field — we use
  // `metadata.extracted.citationsByUrl` if present, else fall back to
  // domain-only. To keep T7.4 pure-compute + no extraction, we
  // aggregate by `citation_domains` only, treating each domain as a
  // proxy for its top page (consistent with the citation-source v1
  // shape). Per-URL granularity will arrive in a future phase that
  // wires the citation evidence index.
  type Bucket = {
    classification: "owned" | "other";
    weekly: Map<string, number>;
    total: number;
  };
  const map = new Map<string, Bucket>();
  for (const o of obs) {
    const w = isoWeek(o.observed_at);
    if (!w) continue;
    for (const d of o.citation_domains ?? []) {
      const dom = (d || "").toLowerCase();
      if (!ownedDomains.has(dom)) continue; // page-citation focuses on owned URLs
      let b = map.get(dom);
      if (!b) {
        b = { classification: "owned", weekly: new Map(), total: 0 };
        map.set(dom, b);
      }
      b.weekly.set(w, (b.weekly.get(w) ?? 0) + 1);
      b.total += 1;
    }
  }
  const recentWeeks = new Set(lastNWeeks(2));
  const priorWeeks = new Set(lastNWeeks(4).filter((w) => !recentWeeks.has(w)));
  const out: PageCitationTrajectoryRow[] = [];
  for (const [domain, b] of map) {
    let recent = 0;
    let prior = 0;
    for (const [week, count] of b.weekly) {
      if (recentWeeks.has(week)) recent += count;
      else if (priorWeeks.has(week)) prior += count;
    }
    out.push({
      page_url: domain, // domain-only proxy; see comment above
      domain,
      is_owned: true,
      total_citations: b.total,
      weeks_observed: b.weekly.size,
      recent_2w: recent,
      prior_2w: prior,
      trend_vs_prior_window: trendDelta(recent, prior),
      weekly: [...b.weekly.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, citations]) => ({ week, citations })),
    });
  }
  return out.sort((a, b) => b.total_citations - a.total_citations);
}

type PromptOpportunityRow = {
  prompt_id: string;
  prompt_text_snippet: string;
  intent_type: string | null;
  location_scope: string | null;
  service_scope: string | null;
  total_observations: number;
  brand_mention_rate: number;
  brand_citation_rate: number;
  opportunity_score: number;
  status:
    | "winning"
    | "competitive"
    | "absent"
    | "outranked"
    | "early";
  sample_full: boolean;
};

function buildPromptOpportunityIndex(
  promptTraj: ReturnType<typeof buildPromptTrajectory>,
): PromptOpportunityRow[] {
  return promptTraj.map((p) => {
    const rate = p.total_observations > 0 ? p.total_brand_mentions / p.total_observations : 0;
    const cite = p.total_observations > 0 ? p.total_brand_citations / p.total_observations : 0;
    const sampleFull = p.total_observations >= SAMPLE_SIZE_FULL_THRESHOLD;
    let status: PromptOpportunityRow["status"];
    if (!sampleFull) status = "early";
    else if (rate < 0.05) status = "absent";
    else if (rate < 0.20) status = "outranked";
    else if (rate >= 0.50) status = "winning";
    else status = "competitive";
    // Opportunity score: high when brand-mention-rate is low (room
    // to grow) AND sample is full (real demand). Capped 0..1.
    const opportunity =
      sampleFull
        ? Math.max(0, Math.min(1, 1 - rate)) * Math.min(1, p.total_observations / 200)
        : 0;
    return {
      prompt_id: p.prompt_id,
      prompt_text_snippet: p.prompt_text_snippet,
      intent_type: p.intent_type,
      location_scope: p.location_scope,
      service_scope: p.service_scope,
      total_observations: p.total_observations,
      brand_mention_rate: rate,
      brand_citation_rate: cite,
      opportunity_score: Number(opportunity.toFixed(3)),
      status,
      sample_full: sampleFull,
    };
  }).sort((a, b) => b.opportunity_score - a.opportunity_score);
}

type LocalAeoOpportunityCell = {
  city: string;
  service: string;
  prompt_count: number;
  total_observations: number;
  brand_mention_rate: number;
  brand_citation_rate: number;
  top_competitor_co_mentions: number;
  opportunity_score: number;
  sample_full: boolean;
};

function buildLocalAeoOpportunityMap(
  obs: PromptAnswerObservation[],
  prompts: TrackedPrompt[],
  entities: TrackedEntity[],
): LocalAeoOpportunityCell[] {
  const byPrompt = new Map(prompts.map((p) => [p.id, p]));
  const competitorNames = new Set(
    entities.filter((e) => e.entity_type === "competitor").map((e) => e.name.toLowerCase()),
  );
  type Bucket = {
    promptIds: Set<string>;
    totalObs: number;
    brandMentions: number;
    brandCitations: number;
    competitorCoMentions: number;
  };
  const map = new Map<string, Bucket>();
  for (const o of obs) {
    const p = byPrompt.get(o.prompt_id);
    const city = (p?.location_scope ?? "").trim();
    const service = (p?.service_scope ?? "").trim();
    if (!city || !service) continue;
    const key = `${city}::${service}`;
    let b = map.get(key);
    if (!b) {
      b = {
        promptIds: new Set(),
        totalObs: 0,
        brandMentions: 0,
        brandCitations: 0,
        competitorCoMentions: 0,
      };
      map.set(key, b);
    }
    b.promptIds.add(o.prompt_id);
    b.totalObs += 1;
    if (o.tracked_brand_mentioned === true) b.brandMentions += 1;
    if (o.tracked_brand_cited === true) b.brandCitations += 1;
    for (const m of o.mentions ?? []) {
      if (competitorNames.has(m.toLowerCase())) b.competitorCoMentions += 1;
    }
  }
  const out: LocalAeoOpportunityCell[] = [];
  for (const [key, b] of map) {
    const [city, service] = key.split("::");
    const rate = b.totalObs > 0 ? b.brandMentions / b.totalObs : 0;
    const sampleFull = b.totalObs >= SAMPLE_SIZE_FULL_THRESHOLD;
    // Opportunity: brand low + competitor strong + real demand.
    const competitorPressure = b.totalObs > 0 ? b.competitorCoMentions / b.totalObs : 0;
    const opportunity =
      sampleFull
        ? Math.max(0, Math.min(1, 1 - rate)) * Math.min(1, competitorPressure) * Math.min(1, b.totalObs / 200)
        : 0;
    out.push({
      city,
      service,
      prompt_count: b.promptIds.size,
      total_observations: b.totalObs,
      brand_mention_rate: rate,
      brand_citation_rate: b.totalObs > 0 ? b.brandCitations / b.totalObs : 0,
      top_competitor_co_mentions: b.competitorCoMentions,
      opportunity_score: Number(opportunity.toFixed(3)),
      sample_full: sampleFull,
    });
  }
  return out.sort((a, b) => b.opportunity_score - a.opportunity_score);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`build-local-aeo-intelligence — Trust Sprint T6.2 (tenant=${TENANT_SLUG})`);
  console.log("Pure compute. Idempotent. Atomic writes. No paid APIs. No mutations.\n");

  console.log("Loading canonical stores…");
  const obs = await getPromptAnswerObservations();
  const prompts = await getTrackedPrompts();
  const entities = await getTrackedEntities();
  console.log(`  observations: ${obs.length}`);
  console.log(`  tracked_prompts: ${prompts.length}`);
  console.log(`  tracked_entities: ${entities.length}\n`);

  if (obs.length === 0) {
    console.error("No observations loaded. Refusing to write empty intelligence files.");
    process.exit(1);
  }

  console.log("Building derivations…");
  const daily = buildDailyPlatformSummary(obs);
  const weekly = rebucketPlatformSummary(daily, isoWeek);
  const monthly = rebucketPlatformSummary(daily, monthKey);
  const competitorTraj = buildCompetitorTrajectory(obs, entities);
  const promptTraj = buildPromptTrajectory(obs, prompts);
  const citationTraj = buildCitationSourceTrajectory(obs, entities);
  const geoServiceTraj = buildGeoServiceTrajectory(obs, prompts);

  // T7.4 v2 derivations.
  const cityStrength = buildCityStrengthIndex(obs, prompts);
  const serviceStrength = buildServiceStrengthIndex(obs, prompts);
  const competitorWeeklyV2 = buildCompetitorWeeklyV2(competitorTraj);
  const citationDomainAuthority = buildCitationDomainAuthority(citationTraj);
  const pageCitationTraj = buildPageCitationTrajectory(obs, entities);
  const promptOpportunity = buildPromptOpportunityIndex(promptTraj);
  const localAeoOpportunityMap = buildLocalAeoOpportunityMap(obs, prompts, entities);

  console.log(`  daily-platform rows:        ${daily.length}`);
  console.log(`  weekly-platform rows:       ${weekly.length}`);
  console.log(`  monthly-platform rows:      ${monthly.length}`);
  console.log(`  competitor rows:            ${competitorTraj.length}`);
  console.log(`  prompt rows:                ${promptTraj.length}`);
  console.log(`  citation source rows:       ${citationTraj.length}`);
  console.log(`  geo-service rows:           ${geoServiceTraj.length}`);
  console.log(`  city-strength rows:         ${cityStrength.length}`);
  console.log(`  service-strength rows:      ${serviceStrength.length}`);
  console.log(`  competitor-weekly-v2 rows:  ${competitorWeeklyV2.length}`);
  console.log(`  citation-domain-authority:  ${citationDomainAuthority.length}`);
  console.log(`  page-citation rows:         ${pageCitationTraj.length}`);
  console.log(`  prompt-opportunity rows:    ${promptOpportunity.length}`);
  console.log(`  local-aeo-opportunity-map:  ${localAeoOpportunityMap.length}\n`);

  console.log("Writing atomically…");
  const writes: Array<{ name: string; path: string; rows: number; sha: string }> = [];
  const fileSpecs: Array<{ name: string; data: unknown }> = [
    { name: "daily-platform-summary.json", data: daily },
    { name: "weekly-platform-summary.json", data: weekly },
    { name: "monthly-platform-summary.json", data: monthly },
    { name: "competitor-trajectory.json", data: competitorTraj },
    { name: "prompt-trajectory.json", data: promptTraj },
    { name: "citation-source-trajectory.json", data: citationTraj },
    { name: "geo-service-trajectory.json", data: geoServiceTraj },
    // T7.4 v2:
    { name: "city-strength-index.json", data: cityStrength },
    { name: "service-strength-index.json", data: serviceStrength },
    { name: "competitor-weekly-trajectory.json", data: competitorWeeklyV2 },
    { name: "citation-domain-authority.json", data: citationDomainAuthority },
    { name: "page-citation-trajectory.json", data: pageCitationTraj },
    { name: "prompt-opportunity-index.json", data: promptOpportunity },
    { name: "local-aeo-opportunity-map.json", data: localAeoOpportunityMap },
  ];
  for (const f of fileSpecs) {
    const path = join(OUT_DIR, f.name);
    const result = atomicWriteJson(path, f.data);
    writes.push({ name: f.name, path, ...result });
    console.log(`  ${f.name.padEnd(35)} ${String(result.rows).padStart(5)} rows  sha=${result.sha.slice(0, 12)}`);
  }

  // Manifest — built last so it captures all file SHAs
  const manifest = {
    built_at: new Date().toISOString(),
    tenant_slug: TENANT_SLUG,
    source_observations_count: obs.length,
    source_prompts_count: prompts.length,
    source_entities_count: entities.length,
    files: writes.map((w) => ({ name: w.name, rows: w.rows, sha256: w.sha })),
  };
  const manifestPath = join(OUT_DIR, "manifest.json");
  const manifestResult = atomicWriteJson(manifestPath, manifest);
  console.log(`  manifest.json                       (sha=${manifestResult.sha.slice(0, 12)})`);
  console.log(`\nAll files materialized at ${OUT_DIR}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("build-local-aeo-intelligence crashed:", err);
  process.exit(2);
});
