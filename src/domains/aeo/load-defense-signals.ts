/**
 * AEO defense pack (BEACON 500 P8, 2026-07-03) - the I/O layer for the three
 * AEO-defense trigger predicates. Reads ONLY tables the Profound sync has
 * ALREADY persisted (this module NEVER calls the Profound API and NEVER
 * spends a cent):
 *
 *   - profound_citation_rows (tenant, category_id, date, model, root_domain,
 *     url, citation_count) - who AI cites per topic over time. Drives
 *     detector 1 (zero-source opening) and detector 2 (defend-a-cited-query,
 *     via a real 2-capture date delta).
 *   - profound_visibility_rows (executions per topic) - the observed-answer
 *     count that gates detector 1's presence floor.
 *   - profound_answer_rows (mentions, own_mentioned, response_excerpt) - the
 *     brand-mention answers detector 3 (brand-description accuracy) checks
 *     against the tenant's own config facts.
 *
 * Mirrors profound-topic-signals.ts / citation-loss.ts: this module does the
 * Supabase reads; the three predicates stay pure (pinned by
 * `recommendation-trigger-predicates-purity`). All pure math lives in
 * detect-defense.ts.
 *
 * Fail-soft: a missing table / no rows / any Supabase error returns an
 * all-empty bundle. No Profound connection simply means the predicates never
 * fire (self-hiding).
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import type { BusinessConfig } from "@/lib/business-config";
import { cleanTopicLabel } from "@/domains/demand-graph/clean-topic-label";

import type { AeoDefenseSignals } from "./defense-types";
import {
  detectBrandDescriptionMismatches,
  detectDefendCitedQueries,
  detectZeroSourceOpenings,
  isUuidShaped,
  stripWww,
  type BrandMentionAnswer,
  type KnownBrandFacts,
  type TopicCaptureSlice,
  type TopicCitationRollup,
} from "./detect-defense";

const MAX_ROWS = 50_000;
const PAGE_SIZE = 1_000;

const EMPTY: AeoDefenseSignals = {
  zeroSourceOpenings: [],
  defendCitedQueries: [],
  brandDescriptionMismatches: [],
};

// ---------------------------------------------------------------------------
// Own-domain set (www-stripped) for tenant-ownership checks.
// ---------------------------------------------------------------------------

/** Build the set of www-stripped owned domains from the tenant's config
 *  domain (host + bare label). Pure. */
export function buildOwnDomainSet(domain: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const host = stripWww(
    (domain ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, ""),
  );
  if (host) out.add(host);
  return out;
}

/** A short, human topic label for a category, resolved from the readable
 *  labels the config or the visibility/prompt rows carry. Never a UUID. */
function resolveTopicLabel(
  configLabel: string | null,
  rawTopicText: string | null,
): string | null {
  const candidate = (rawTopicText ?? "").trim() || (configLabel ?? "").trim();
  if (!candidate) return null;
  if (isUuidShaped(candidate)) return null;
  const cleaned = cleanTopicLabel(candidate);
  return cleaned && !isUuidShaped(cleaned) ? cleaned : null;
}

// ---------------------------------------------------------------------------
// Row projections
// ---------------------------------------------------------------------------

type CitationRow = {
  category_id: string;
  date: string;
  model: string;
  root_domain: string;
  citation_count: number;
};

type VisibilityExecRow = {
  category_id: string;
  executions: number;
  model: string;
};

type AnswerRow = {
  model: string | null;
  own_mentioned: boolean;
  response_excerpt: string | null;
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loadAeoDefenseSignalsForTenant(
  tenantId: string,
  config: Pick<BusinessConfig, "domain" | "industry" | "locations" | "services" | "profound">,
): Promise<AeoDefenseSignals> {
  let sb: ReturnType<typeof getSupabaseAdmin>;
  try {
    sb = getSupabaseAdmin();
  } catch {
    return EMPTY;
  }

  const configTopicLabel = config.profound?.topicLabel?.trim() || null;
  const ownDomains = buildOwnDomainSet(config.domain);

  // ── Read citation rows (items 1 + 2) ────────────────────────────────────
  const citationRows: CitationRow[] = [];
  try {
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("profound_citation_rows")
        .select("category_id, date, model, root_domain, citation_count")
        .eq("tenant_id", tenantId)
        .order("date", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[aeo-defense] citation rows read failed", { tenantId, offset, error: error.message });
        break;
      }
      const batch = (data ?? []) as unknown as CitationRow[];
      citationRows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
  } catch {
    // fall through with whatever we have (possibly none)
  }

  // ── Read per-topic executions (item 1 observed-answer floor) ────────────
  const execByTopic = new Map<string, { executions: number; models: Set<string> }>();
  try {
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("profound_visibility_rows")
        .select("category_id, executions, model")
        .eq("tenant_id", tenantId)
        .order("category_id")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[aeo-defense] visibility rows read failed", { tenantId, offset, error: error.message });
        break;
      }
      const batch = (data ?? []) as unknown as VisibilityExecRow[];
      for (const r of batch) {
        if (!r.category_id) continue;
        let e = execByTopic.get(r.category_id);
        if (!e) {
          e = { executions: 0, models: new Set() };
          execByTopic.set(r.category_id, e);
        }
        const exec = Number(r.executions) || 0;
        if (exec > e.executions) e.executions = exec;
        if (r.model) e.models.add(r.model);
      }
      if (batch.length < PAGE_SIZE) break;
    }
  } catch {
    // executions stay empty -> item 1 abstains (never fires without the floor)
  }

  // ── Read brand-mention answers (item 3) ─────────────────────────────────
  const brandMentions: BrandMentionAnswer[] = [];
  try {
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("profound_answer_rows")
        .select("model, own_mentioned, response_excerpt")
        .eq("tenant_id", tenantId)
        .eq("own_mentioned", true)
        .order("date", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[aeo-defense] answer rows read failed", { tenantId, offset, error: error.message });
        break;
      }
      const batch = (data ?? []) as unknown as AnswerRow[];
      for (const r of batch) {
        const excerpt = (r.response_excerpt ?? "").trim();
        if (!excerpt) continue;
        brandMentions.push({ model: r.model ?? null, excerpt });
      }
      if (batch.length < PAGE_SIZE) break;
    }
  } catch {
    // no brand mentions -> item 3 abstains
  }

  // ── Detector 1: zero-source openings (aggregate citation rows per topic) ─
  const rollupAcc = new Map<
    string,
    { byDomain: Map<string, number> }
  >();
  for (const r of citationRows) {
    if (!r.category_id) continue;
    const domain = stripWww(r.root_domain ?? "");
    if (!domain) continue;
    let acc = rollupAcc.get(r.category_id);
    if (!acc) {
      acc = { byDomain: new Map() };
      rollupAcc.set(r.category_id, acc);
    }
    acc.byDomain.set(domain, (acc.byDomain.get(domain) ?? 0) + (Number(r.citation_count) || 0));
  }
  const rollups: TopicCitationRollup[] = [];
  for (const [categoryId, acc] of rollupAcc) {
    const exec = execByTopic.get(categoryId);
    rollups.push({
      categoryId,
      topicLabel: resolveTopicLabel(configTopicLabel, null),
      observedAnswers: exec?.executions ?? 0,
      modelCount: exec?.models.size ?? 0,
      citationsByDomain: acc.byDomain,
    });
  }
  // Also surface topics that have executions but NO citations at all (the
  // purest zero-source opening): AI answered the topic but cited no one.
  for (const [categoryId, exec] of execByTopic) {
    if (rollupAcc.has(categoryId)) continue;
    rollups.push({
      categoryId,
      topicLabel: resolveTopicLabel(configTopicLabel, null),
      observedAnswers: exec.executions,
      modelCount: exec.models.size,
      citationsByDomain: new Map(),
    });
  }
  const zeroSourceOpenings = detectZeroSourceOpenings(rollups);

  // ── Detector 2: defend-a-cited-query (2-capture date delta per topic) ───
  // Group citation rows by (category, date), then take the two most recent
  // distinct dates per topic as (prior, latest).
  const datesByTopic = new Map<string, Map<string, Map<string, number>>>();
  for (const r of citationRows) {
    if (!r.category_id || !r.date) continue;
    const domain = stripWww(r.root_domain ?? "");
    if (!domain) continue;
    let byDate = datesByTopic.get(r.category_id);
    if (!byDate) {
      byDate = new Map();
      datesByTopic.set(r.category_id, byDate);
    }
    let byDomain = byDate.get(r.date);
    if (!byDomain) {
      byDomain = new Map();
      byDate.set(r.date, byDomain);
    }
    byDomain.set(domain, (byDomain.get(domain) ?? 0) + (Number(r.citation_count) || 0));
  }
  const slicesByTopic = new Map<string, { prior: TopicCaptureSlice; latest: TopicCaptureSlice }>();
  for (const [categoryId, byDate] of datesByTopic) {
    const dates = Array.from(byDate.keys()).sort(); // ascending ISO dates
    if (dates.length < 2) continue; // no 2-capture history -> no delta
    const priorDate = dates[dates.length - 2]!;
    const latestDate = dates[dates.length - 1]!;
    const label = resolveTopicLabel(configTopicLabel, null);
    slicesByTopic.set(categoryId, {
      prior: {
        categoryId,
        topicLabel: label,
        date: priorDate,
        citationsByDomain: byDate.get(priorDate)!,
      },
      latest: {
        categoryId,
        topicLabel: label,
        date: latestDate,
        citationsByDomain: byDate.get(latestDate)!,
      },
    });
  }
  const defendCitedQueries = detectDefendCitedQueries(slicesByTopic, ownDomains);

  // ── Detector 3: brand-description accuracy ──────────────────────────────
  const facts: KnownBrandFacts = {
    industry: (config.industry ?? "").trim(),
    locations: (config.locations ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean),
    services: (config.services ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
  const brandDescriptionMismatches = detectBrandDescriptionMismatches(brandMentions, facts);

  return {
    zeroSourceOpenings,
    defendCitedQueries,
    brandDescriptionMismatches,
  };
}
