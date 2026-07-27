import "server-only";

/**
 * funnel/discovery (integrity closure) - the broad-then-narrow keyword funnel
 * executor. Casts a wide labs net (keywords_for_site + ranked + related +
 * suggestions + page-inventory seeds) by CAPABILITY, normalizes/dedupes/filters
 * to a bounded retained set, and only THEN enriches that set via keyword_overview.
 * Zero SERP spend here. All state is basis-scoped with optimistic row_version.
 */

import type { BusinessProfile } from "@/domains/account";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import type { CapabilityInputByKey, FunnelCounters, FunnelUnitFn, ParsedKeywordItem } from "@/domains/evidence/dataforseo/funnel-boundary";
import { log } from "@/lib/logger";
import { applyFilters, dedupeKeywords, filterContextFrom, keywordsFromParsed, normalizeKeyword, retainDiverse } from "./normalize";
import { type FunnelKeyword, type FunnelState, MAX_REJECTED, MAX_RETAINED } from "./state";
import { basisFromCursor, beginCycle, CONFLICT_DETAIL, interp, NO_BASIS_DETAIL, resolveDeps, round, save, StateConflictError, track, type FunnelDeps } from "./shared";

function ctxFrom(p: BusinessProfile) {
  return filterContextFrom({
    offerings: p.offerings.value,
    topicsToOwn: p.topicsToOwn.value,
    customerProblems: p.customerProblems.value,
    topicsToExclude: p.topicsToExclude.value,
    bannedTerms: p.constraints.value.bannedTerms,
    competitors: p.competitors.value.map((c) => c.name),
  });
}

/** Usable only when at least one relevance source is operator-confirmed and non-empty. */
function profileConfirmed(p: BusinessProfile): boolean {
  return [p.offerings, p.topicsToOwn, p.customerProblems].some((s) => s.origin === "operator_confirmed" && s.value.length > 0);
}

/** Paid discovery seeds: EVERY confirmed theme, deduped in a stable order (topics I
 *  want to own, then what I sell, then the problems customers bring), bounded at 12.
 *  The old .slice(0, 5) silently starved most of an account's themes of any discovery
 *  at all, so their keywords never entered the funnel and could never be checked in
 *  search. Cost bound: 2 labs calls per seed (related + suggestions), so at most 24. */
const MAX_SEEDS = 12;

function seedsFrom(p: BusinessProfile): string[] {
  const all = [...p.topicsToOwn.value, ...p.offerings.value, ...p.customerProblems.value].map((s) => s.trim()).filter(Boolean);
  return [...new Set(all)].slice(0, MAX_SEEDS);
}

function discProgress(s: FunnelState): FunnelCounters {
  return {
    rawKeywords: s.discovery.counts.raw,
    normalizedKeywords: s.discovery.counts.normalized,
    retainedKeywords: s.discovery.counts.retained,
    rejectedKeywords: s.discovery.counts.rejected,
    cacheHits: s.cycle.cacheHits,
    spendUsd: round(s.cycle.spentUsd),
  };
}

type DiscCapability = "labs_keywords_for_site" | "labs_ranked_keywords" | "labs_related_keywords" | "labs_keyword_suggestions";
/** Discriminated so each step's input is TYPE-CHECKED against its capability. */
type DiscStep = { [K in DiscCapability]: { capability: K; input: CapabilityInputByKey[K]; via: FunnelKeyword["discoveredVia"]; seed?: string } }[DiscCapability];

function discoveryPlan(domain: string, seeds: string[]): DiscStep[] {
  const plan: DiscStep[] = [];
  if (domain) {
    plan.push({ capability: "labs_keywords_for_site", input: { target: domain, limit: 1000 }, via: "site" });
    plan.push({ capability: "labs_ranked_keywords", input: { target: domain, limit: 1000 }, via: "ranked" });
  }
  for (const s of seeds) {
    const keyword = normalizeKeyword(s);
    plan.push({ capability: "labs_related_keywords", input: { keyword, depth: 2, limit: 1000 }, via: "related", seed: keyword });
    plan.push({ capability: "labs_keyword_suggestions", input: { keyword, limit: 1000 }, via: "suggestion", seed: keyword });
  }
  return plan;
}

/** Labs keyword_overview documents its keywords array at up to 700 entries, each up to 80
 *  characters and 10 words. A violator is DROPPED before the batch (counted internally,
 *  never truncated into a different keyword) so one bad row cannot reject the whole
 *  request and cost the entire retained set its search volume. */
const overviewEligible = (k: string) => k.length > 0 && k.length <= 80 && k.split(" ").filter(Boolean).length <= 10;

export function keywordDiscoveryUnit(deps: FunnelDeps = {}): FunnelUnitFn {
  const d = resolveDeps(deps);
  return async (tenantId, cursor, budgetMs) => {
    const basis = basisFromCursor(cursor);
    if (!basis) return { status: "failed", cursor, progress: {}, detail: NO_BASIS_DETAIL };
    const unitKey = `discovery:${tenantId}`;
    const ids = { tenantId, unitKey };
    const deadline = d.now() + Math.max(1000, budgetMs);
    const loaded = await d.loadState(tenantId, basis);
    const state = loaded.state;
    beginCycle(state, cursor, unitKey); // a new run id resets this run's receipt
    const ctx = { rowVersion: loaded.rowVersion };
    const profile = await d.loadProfile(tenantId);
    if (!profileConfirmed(profile)) {
      return { status: "failed", cursor, progress: discProgress(state), detail: "I need your confirmed business basics before I can research keywords." };
    }
    const stage = (cursor?.stage as string) ?? "labs";

    try {
      if (stage !== "overview") {
        const account = await d.getAccount(tenantId).catch(() => null);
        const domain = account?.domain ? rootDomain(account.domain) : "";
        const seeds = seedsFrom(profile);
        const raw: FunnelKeyword[] = [];
        const crawl = await d.loadCrawl(tenantId).catch(() => null);
        for (const f of crawl?.page_facts ?? []) {
          for (const q of [f.title ?? "", ...(f.questions ?? [])]) {
            const n = normalizeKeyword(q);
            if (n) raw.push({ keyword: n, searchVolume: null, competition: null, difficulty: null, intent: null, discoveredVia: "profile" });
          }
        }
        for (const p of discoveryPlan(domain, seeds)) {
          if (d.now() > deadline) {
            state.discovery.raw = raw.slice(0, 1200);
            state.discovery.seeds = seeds;
            await save(d, tenantId, basis, state, ctx);
            return { status: "advanced", cursor: { stage: "labs" }, progress: discProgress(state) };
          }
          const r = interp(await d.callProvider(p.capability, p.input, ids));
          track(state, r);
          if (r.kind === "waiting") {
            state.discovery.raw = raw.slice(0, 1200);
            await save(d, tenantId, basis, state, ctx);
            return { status: "waiting", cursor: { stage: "labs" }, progress: discProgress(state), detail: r.detail };
          }
          if (r.kind === "failed") {
            state.discovery.raw = raw.slice(0, 1200);
            await save(d, tenantId, basis, state, ctx);
            return { status: "failed", cursor: { stage: "labs" }, progress: discProgress(state), detail: r.detail };
          }
          if (r.kind === "evidence") {
            const parsed = d.parse(p.capability, r.payload as never) as ParsedKeywordItem[] | null;
            if (parsed) raw.push(...keywordsFromParsed(parsed, p.via, p.seed));
          }
        }
        // narrow: normalize -> dedupe -> filter -> diverse retain (before any SERP spend)
        const deduped = dedupeKeywords(raw);
        const { retained, rejected } = applyFilters(deduped, ctxFrom(profile), MAX_REJECTED);
        const capped = retainDiverse(retained, MAX_RETAINED);
        state.discovery.seeds = seeds;
        state.discovery.raw = raw.slice(0, 1200);
        state.discovery.normalized = deduped.map((k) => k.keyword).slice(0, 800);
        state.discovery.retained = capped;
        state.discovery.rejected = rejected;
        state.discovery.counts = { raw: raw.length, normalized: deduped.length, retained: capped.length, rejected: rejected.length };
        if (raw.length === 0) {
          await save(d, tenantId, basis, state, ctx);
          return { status: "failed", cursor: { stage: "labs" }, progress: discProgress(state), detail: "I found no keywords from the research provider yet." };
        }
        if (capped.length === 0) {
          await save(d, tenantId, basis, state, ctx);
          return { status: "done", cursor: null, progress: discProgress(state), detail: "No keywords survived the relevance filters this run." };
        }
        await save(d, tenantId, basis, state, ctx);
        if (d.now() > deadline) return { status: "advanced", cursor: { stage: "overview" }, progress: discProgress(state) };
      }

      // overview: enrich retained with volume/intent/difficulty (ONE request, <=700)
      const retained = state.discovery.retained;
      let softDetail: string | null = null;
      const batch = retained.map((k) => k.keyword).filter(overviewEligible).slice(0, 700);
      if (batch.length < retained.length) log.info("[research-funnel] keywords left out of the overview batch", { tenantId, dropped: retained.length - batch.length, reason: "over_80_chars_or_10_words" });
      if (batch.length > 0) {
        const r = interp(await d.callProvider("labs_keyword_overview", { keywords: batch }, ids));
        track(state, r);
        if (r.kind === "waiting") {
          await save(d, tenantId, basis, state, ctx);
          return { status: "waiting", cursor: { stage: "overview" }, progress: discProgress(state), detail: r.detail };
        }
        if (r.kind === "failed") {
          // Enrichment failed terminally: pause honestly, keep the retained set intact.
          await save(d, tenantId, basis, state, ctx);
          return { status: "failed", cursor: { stage: "overview" }, progress: discProgress(state), detail: r.detail ?? "I could not add search volume this run. I will try again on the next pass." };
        }
        if (r.kind === "evidence") {
          const parsed = d.parse("labs_keyword_overview", r.payload as never) as ParsedKeywordItem[] | null;
          const byKw = new Map(keywordsFromParsed(parsed ?? [], "profile").map((e) => [e.keyword, e]));
          const merged = retained.map((k) => {
            const e = byKw.get(k.keyword);
            return e ? { ...k, searchVolume: e.searchVolume ?? k.searchVolume, competition: e.competition ?? k.competition, difficulty: e.difficulty ?? k.difficulty, intent: e.intent ?? k.intent } : k;
          });
          state.discovery.retained = retainDiverse(merged, MAX_RETAINED);
          state.discovery.counts.retained = state.discovery.retained.length;
        } else if (r.kind === "soft") {
          // Missing credentials: keep the retained keywords, labeled as unenriched.
          softDetail = "I kept your researched keywords but could not add search volume this run. I will enrich them on the next pass.";
        }
      }
      await save(d, tenantId, basis, state, ctx);
      return { status: "done", cursor: null, progress: discProgress(state), ...(softDetail ? { detail: softDetail } : {}) };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", code: "state_conflict", cursor, progress: discProgress(state), detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}
