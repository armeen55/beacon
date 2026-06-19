/**
 * SEMrush CAPPED DIAGNOSTIC PULL (2026-06-18) — the operator-driven, hard-
 * budgeted pull that enriches the Page Surgeon evidence packets with broader
 * market/query context for a handful of diagnostic pages.
 *
 * This is the opposite of a "broad pull": it is metered end-to-end. Before any
 * paid request it (1) reads the live unit balance, (2) estimates the spend per
 * endpoint × row-limit, (3) ABORTS if the estimate exceeds the hard cap or the
 * balance can't cover it. Every request is LIVE (no historical display_date)
 * with tight row limits. It logs the balance before/after and persists an exact
 * receipt (endpoint, rows, estimated + actual units).
 *
 * Endpoints (all already cheap "live" reports):
 *   • domain_organic        — the domain's top keyword portfolio (1 call)
 *   • url_organic           — per-page keyword portfolio (1 call / diagnostic page)
 *   • phrase_related        — query variants for each page's top query
 *   • phrase_questions      — question keywords for each page's top query
 *   • domain_ranks + domain_organic_organic — competitor domains (via the
 *     existing refreshSemrushDomainMetrics; competitor RANKING URLs per keyword
 *     are NOT a supported report, so they're a labelled gap, not faked)
 *
 * Persistence reuses the existing ToS-compliant tables: organic rows →
 * semrush_organic_keywords; expansions → semrush_keyword_expansions; competitors
 * → semrush_domain_metrics. A receipt row → semrush_pull_receipts.
 *
 * Fail-soft + tenant-scoped + server-only.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getBusinessConfig } from "@/lib/business-config";
import { log } from "@/lib/logger";

import type { SemrushRawFetchDeps } from "./client";
import { fetchSemrushUnitBalance } from "./account-units";
import {
  DOMAIN_ORGANIC_NIGHTLY_LIMIT,
  fetchDomainOrganicKeywords,
  type SemrushOrganicKeyword,
} from "./domain-organic";
import { URL_ORGANIC_DIAGNOSTIC_LIMIT, fetchUrlOrganicKeywords } from "./url-organic";
import {
  PHRASE_EXPANSION_DIAGNOSTIC_LIMIT,
  fetchPhraseQuestions,
  fetchPhraseRelated,
  type SemrushPhraseKeyword,
} from "./phrase-expansions";

/** Hard pre-flight abort threshold (operator spec: abort if estimate > 20,000). */
export const SEMRUSH_DIAGNOSTIC_UNIT_CAP = 20_000;

/** Per-line LIVE unit costs (SEMrush Analytics API). Conservative — the TRUE
 *  spend is measured via countapiunits before/after; this only drives the
 *  pre-flight abort gate, so over-estimating is the safe direction. */
export const SEMRUSH_UNIT_COST = {
  domain_organic: 10,
  url_organic: 10,
  domain_organic_organic: 10,
  domain_ranks: 10,
  phrase_related: 40,
  phrase_questions: 40,
} as const;

export type PullEndpoint = keyof typeof SEMRUSH_UNIT_COST;

export type PullStep = {
  endpoint: PullEndpoint;
  /** domain / url / phrase the call targets. */
  target: string;
  displayLimit: number;
  unitsPerLine: number;
  estUnits: number;
  /** For phrase steps: the diagnostic page the seed query belongs to. */
  pageUrl?: string;
};

export type DiagnosticPullPlan = {
  steps: PullStep[];
  estTotalUnits: number;
};

export type DiagnosticPullPage = { url: string; topQuery: string | null };

/** Build the (pure) pull plan + unit estimate. No network, no spend. */
export function buildDiagnosticPullPlan(args: {
  domain: string;
  pages: DiagnosticPullPage[];
  domainOrganicLimit?: number;
  urlOrganicLimit?: number;
  phraseLimit?: number;
  competitorLimit?: number;
  /** Restrict the plan to these endpoints (e.g. a frugal organic-only re-pull). */
  onlyEndpoints?: PullEndpoint[];
}): DiagnosticPullPlan {
  const domainOrganicLimit = args.domainOrganicLimit ?? DOMAIN_ORGANIC_NIGHTLY_LIMIT;
  const urlOrganicLimit = args.urlOrganicLimit ?? URL_ORGANIC_DIAGNOSTIC_LIMIT;
  const phraseLimit = args.phraseLimit ?? PHRASE_EXPANSION_DIAGNOSTIC_LIMIT;
  const competitorLimit = args.competitorLimit ?? 10;

  const steps: PullStep[] = [];
  const add = (endpoint: PullEndpoint, target: string, displayLimit: number, pageUrl?: string) => {
    const unitsPerLine = SEMRUSH_UNIT_COST[endpoint];
    steps.push({ endpoint, target, displayLimit, unitsPerLine, estUnits: displayLimit * unitsPerLine, pageUrl });
  };

  // 1) Domain-wide keyword portfolio (broad market context).
  add("domain_organic", args.domain, domainOrganicLimit);
  // 2) Per-page keyword portfolio for each diagnostic page.
  for (const p of args.pages) add("url_organic", p.url, urlOrganicLimit, p.url);
  // 3) Query expansions for each page's top query (related + questions).
  for (const p of args.pages) {
    const q = p.topQuery?.trim();
    if (!q) continue;
    add("phrase_related", q, phraseLimit, p.url);
    add("phrase_questions", q, phraseLimit, p.url);
  }
  // 4) Competitor domains (supported); overview is a single line.
  add("domain_ranks", args.domain, 1);
  add("domain_organic_organic", args.domain, competitorLimit);

  const filtered = args.onlyEndpoints
    ? steps.filter((s) => args.onlyEndpoints!.includes(s.endpoint))
    : steps;
  const estTotalUnits = filtered.reduce((s, st) => s + st.estUnits, 0);
  return { steps: filtered, estTotalUnits };
}

export type DiagnosticPullResult =
  | {
      ok: false;
      reason:
        | "no_domain"
        | "balance_check_failed"
        | "over_cap"
        | "insufficient_units";
      detail?: string;
      plan?: DiagnosticPullPlan;
      balanceBefore?: number;
    }
  | {
      ok: true;
      domain: string;
      balanceBefore: number;
      balanceAfter: number | null;
      actualSpend: number | null;
      estTotalUnits: number;
      steps: Array<{ endpoint: PullEndpoint; target: string; rows: number; ok: boolean; pageUrl?: string }>;
      persisted: { organicRows: number; expansionRows: number; competitorsRefreshed: boolean };
    };

function normalizeDomain(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^https?:\/\//, "").replace(/^www\./, "");
}

/**
 * Run the capped diagnostic pull for a tenant + its diagnostic pages.
 * Honors the 7 guardrails: balance check, per-endpoint estimate, abort >cap,
 * live-only, tight limits, before/after balance log, exact receipt.
 */
export async function runCappedSemrushDiagnosticPull(
  args: {
    tenantId: string;
    pages: DiagnosticPullPage[];
    domain?: string;
    now?: Date;
    domainOrganicLimit?: number;
    urlOrganicLimit?: number;
    phraseLimit?: number;
    competitorLimit?: number;
    onlyEndpoints?: PullEndpoint[];
  },
  deps: SemrushRawFetchDeps = {},
): Promise<DiagnosticPullResult> {
  const { tenantId } = args;
  const now = args.now ?? new Date();
  const domain = normalizeDomain(args.domain ?? getBusinessConfig(tenantId).domain);
  if (!domain) return { ok: false, reason: "no_domain" };

  // (1) Live unit balance BEFORE.
  const before = await fetchSemrushUnitBalance({ tenantId }, deps);
  if (!before.ok) {
    return { ok: false, reason: "balance_check_failed", detail: before.reason };
  }
  const balanceBefore = before.units;

  // (2) Estimate + (3) abort gates.
  const plan = buildDiagnosticPullPlan({
    domain,
    pages: args.pages,
    domainOrganicLimit: args.domainOrganicLimit,
    urlOrganicLimit: args.urlOrganicLimit,
    phraseLimit: args.phraseLimit,
    competitorLimit: args.competitorLimit,
    onlyEndpoints: args.onlyEndpoints,
  });
  if (plan.estTotalUnits > SEMRUSH_DIAGNOSTIC_UNIT_CAP) {
    return { ok: false, reason: "over_cap", plan, balanceBefore };
  }
  if (balanceBefore < plan.estTotalUnits) {
    return { ok: false, reason: "insufficient_units", plan, balanceBefore };
  }

  log.info("[semrush-capped-pull] starting", {
    tenantId,
    domain,
    balanceBefore,
    estTotalUnits: plan.estTotalUnits,
    steps: plan.steps.length,
  });

  // (4)(5) Execute — all LIVE, tight limits.
  const organic: SemrushOrganicKeyword[] = [];
  const expansionRows: Array<{
    tenant_id: string;
    page_url: string;
    seed_query: string;
    kind: "related" | "question";
    keyword: string;
    volume: number | null;
    difficulty: number | null;
    cpc: number | null;
    intent: string | null;
    fetched_at: string;
  }> = [];
  const stepResults: Array<{ endpoint: PullEndpoint; target: string; rows: number; ok: boolean; pageUrl?: string }> = [];
  let competitorsRefreshed = false;

  const database = (deps.token && "database" in deps.token ? deps.token.database : undefined) as
    | string
    | undefined;

  for (const step of plan.steps) {
    try {
      if (step.endpoint === "domain_organic") {
        const rows = await fetchDomainOrganicKeywords(
          { tenantId, domain, displayLimit: step.displayLimit },
          deps,
        );
        if (rows) organic.push(...rows);
        stepResults.push({ endpoint: step.endpoint, target: step.target, rows: rows?.length ?? 0, ok: rows != null });
      } else if (step.endpoint === "url_organic") {
        const rows = await fetchUrlOrganicKeywords(
          { tenantId, url: step.target, database, displayLimit: step.displayLimit },
          deps,
        );
        if (rows) organic.push(...rows);
        stepResults.push({ endpoint: step.endpoint, target: step.target, rows: rows?.length ?? 0, ok: rows != null, pageUrl: step.pageUrl });
      } else if (step.endpoint === "phrase_related" || step.endpoint === "phrase_questions") {
        const kind = step.endpoint === "phrase_related" ? "related" : "question";
        const fetcher = step.endpoint === "phrase_related" ? fetchPhraseRelated : fetchPhraseQuestions;
        const rows: SemrushPhraseKeyword[] | null = await fetcher(
          { tenantId, phrase: step.target, database, displayLimit: step.displayLimit },
          deps,
        );
        if (rows && step.pageUrl) {
          for (const r of rows) {
            expansionRows.push({
              tenant_id: tenantId,
              page_url: step.pageUrl,
              seed_query: step.target,
              kind,
              keyword: r.keyword,
              volume: r.volume,
              difficulty: r.difficulty,
              cpc: r.cpc,
              intent: r.intent,
              fetched_at: now.toISOString(),
            });
          }
        }
        stepResults.push({ endpoint: step.endpoint, target: step.target, rows: rows?.length ?? 0, ok: rows != null, pageUrl: step.pageUrl });
      } else if (step.endpoint === "domain_organic_organic") {
        // Competitor domains via the existing operator-supported refresh
        // (domain_ranks overview + domain_organic_organic competitors).
        const { refreshSemrushDomainMetrics } = await import("./persist-domain-metrics");
        const r = await refreshSemrushDomainMetrics(
          { tenantId, domain, competitorLimit: step.displayLimit, now },
          deps,
        );
        competitorsRefreshed = r.ok === true;
        stepResults.push({ endpoint: step.endpoint, target: step.target, rows: competitorsRefreshed ? step.displayLimit : 0, ok: competitorsRefreshed });
      }
      // domain_ranks is folded into refreshSemrushDomainMetrics above; its
      // plan step exists only so the estimate accounts for that 1 line.
    } catch (e) {
      stepResults.push({ endpoint: step.endpoint, target: step.target, rows: 0, ok: false, pageUrl: step.pageUrl });
      log.warn("[semrush-capped-pull] step threw", {
        tenantId,
        endpoint: step.endpoint,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Persist organic (domain + url) + expansions.
  const persisted = { organicRows: 0, expansionRows: 0, competitorsRefreshed };
  try {
    const sb = getSupabaseAdmin();
    // Dedupe by (keyword, url) — domain_organic and url_organic can both return
    // the same keyword at the same page URL, and a single upsert batch with the
    // same conflict key twice errors ("cannot affect row a second time"). Keep
    // the better-ranking (lower position) row.
    const dedup = new Map<string, SemrushOrganicKeyword>();
    for (const k of organic) {
      const key = `${k.keyword} ${k.url}`;
      const prev = dedup.get(key);
      if (!prev || k.position < prev.position) dedup.set(key, k);
    }
    const organicDeduped = [...dedup.values()];
    if (organicDeduped.length > 0) {
      const rows = organicDeduped.map((k) => ({
        tenant_id: tenantId,
        domain,
        keyword: k.keyword,
        position: k.position,
        prev_position: k.prevPosition,
        volume: k.volume,
        cpc: k.cpc,
        url: k.url,
        traffic_pct: k.trafficPct,
        difficulty: k.difficulty,
        intent: k.intent,
        fetched_at: now.toISOString(),
      }));
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await sb
          .from("semrush_organic_keywords")
          .upsert(rows.slice(i, i + CHUNK), { onConflict: "tenant_id,domain,keyword,url" });
        if (error) {
          log.warn("[semrush-capped-pull] organic upsert failed", { tenantId, error: error.message });
          break;
        }
        persisted.organicRows += Math.min(CHUNK, rows.length - i);
      }
    }
    if (expansionRows.length > 0) {
      const { error } = await sb
        .from("semrush_keyword_expansions")
        .upsert(expansionRows, { onConflict: "tenant_id,page_url,kind,keyword" });
      if (error) log.warn("[semrush-capped-pull] expansions upsert failed", { tenantId, error: error.message });
      else persisted.expansionRows = expansionRows.length;
    }
  } catch (e) {
    log.warn("[semrush-capped-pull] persist threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  // (6) Live unit balance AFTER (fail-soft → null spend).
  const after = await fetchSemrushUnitBalance({ tenantId }, deps);
  const balanceAfter = after.ok ? after.units : null;
  const actualSpend = balanceAfter != null ? Math.max(0, balanceBefore - balanceAfter) : null;

  // (7) Exact receipt.
  try {
    const sb = getSupabaseAdmin();
    await sb.from("semrush_pull_receipts").insert({
      tenant_id: tenantId,
      ran_at: now.toISOString(),
      domain,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      actual_spend: actualSpend,
      est_total_units: plan.estTotalUnits,
      steps: stepResults,
    });
  } catch (e) {
    log.warn("[semrush-capped-pull] receipt insert failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  log.info("[semrush-capped-pull] done", {
    tenantId,
    domain,
    balanceBefore,
    balanceAfter,
    actualSpend,
    estTotalUnits: plan.estTotalUnits,
    organicRows: persisted.organicRows,
    expansionRows: persisted.expansionRows,
    competitorsRefreshed,
  });

  return {
    ok: true,
    domain,
    balanceBefore,
    balanceAfter,
    actualSpend,
    estTotalUnits: plan.estTotalUnits,
    steps: stepResults,
    persisted,
  };
}
