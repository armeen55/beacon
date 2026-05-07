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

  console.log(`  daily-platform rows:      ${daily.length}`);
  console.log(`  weekly-platform rows:     ${weekly.length}`);
  console.log(`  monthly-platform rows:    ${monthly.length}`);
  console.log(`  competitor rows:          ${competitorTraj.length}`);
  console.log(`  prompt rows:              ${promptTraj.length}`);
  console.log(`  citation source rows:     ${citationTraj.length}`);
  console.log(`  geo-service rows:         ${geoServiceTraj.length}\n`);

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
