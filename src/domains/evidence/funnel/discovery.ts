import "server-only";

/**
 * funnel/discovery (B2) - the broad-then-narrow keyword funnel executor. Casts a
 * wide labs net (keywords_for_site + ranked_keywords + related + suggestions +
 * page-inventory seeds), normalizes/dedupes/filters to a bounded retained set,
 * and only THEN enriches that set via keyword_overview. Zero SERP spend here.
 */

import type { BusinessProfile } from "@/domains/account";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import type { FunnelCounters, FunnelUnitFn } from "@/domains/evidence/dataforseo/funnel-boundary";
import { applyFilters, dedupeKeywords, extractKeywordItems, filterContextFrom, normalizeKeyword, rankAndCap } from "./normalize";
import { type FunnelKeyword, type FunnelState, MAX_REJECTED, MAX_RETAINED } from "./state";
import { buildSpec, EP, EST, interp, LANG, LOC, resolveDeps, round, save, track, type FunnelDeps } from "./shared";

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

function seedsFrom(p: BusinessProfile): string[] {
  return [...new Set([...p.topicsToOwn.value, ...p.offerings.value])].map((s) => s.trim()).filter(Boolean).slice(0, 5);
}

function discProgress(s: FunnelState): FunnelCounters {
  return {
    rawKeywords: s.discovery.counts.raw,
    normalizedKeywords: s.discovery.counts.normalized,
    retainedKeywords: s.discovery.counts.retained,
    rejectedKeywords: s.discovery.counts.rejected,
    cacheHits: s.ledger.cacheHits,
    spendUsd: round(s.ledger.spentUsd),
  };
}

function discoveryPlan(domain: string, seeds: string[]) {
  const plan: { endpoint: string; payload: unknown[]; publicInput: Record<string, unknown>; via: FunnelKeyword["discoveredVia"] }[] = [];
  if (domain) {
    plan.push({ endpoint: EP.forSite, payload: [{ target: domain, location_code: LOC, language_code: LANG, limit: 1000 }], publicInput: { target: domain, ep: "forSite" }, via: "site" });
    plan.push({ endpoint: EP.ranked, payload: [{ target: domain, location_code: LOC, language_code: LANG, limit: 1000 }], publicInput: { target: domain, ep: "ranked" }, via: "ranked" });
  }
  for (const s of seeds) {
    plan.push({ endpoint: EP.related, payload: [{ keyword: s, location_code: LOC, language_code: LANG, depth: 2, limit: 1000 }], publicInput: { keyword: normalizeKeyword(s), ep: "related" }, via: "related" });
    plan.push({ endpoint: EP.suggest, payload: [{ keyword: s, location_code: LOC, language_code: LANG, limit: 1000 }], publicInput: { keyword: normalizeKeyword(s), ep: "suggest" }, via: "suggestion" });
  }
  return plan;
}

export function keywordDiscoveryUnit(deps: FunnelDeps = {}): FunnelUnitFn {
  const d = resolveDeps(deps);
  return async (tenantId, cursor, budgetMs) => {
    const unitKey = `discovery:${tenantId}`;
    const deadline = d.now() + Math.max(1000, budgetMs);
    const state = await d.loadState(tenantId);
    const profile = await d.loadProfile(tenantId);
    if (!profileConfirmed(profile)) {
      return { status: "failed", cursor, progress: discProgress(state), detail: "I need your confirmed business basics before I can research keywords." };
    }
    const stage = (cursor?.stage as string) ?? "labs";

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
          await save(d, tenantId, state);
          return { status: "advanced", cursor: { stage: "labs" }, progress: discProgress(state) };
        }
        const r = interp(await d.callProvider(buildSpec(tenantId, unitKey, p.endpoint, p.payload, p.publicInput, "live", EST.labs)));
        track(state, r);
        if (r.kind === "waiting") {
          state.discovery.raw = raw.slice(0, 1200);
          await save(d, tenantId, state);
          return { status: "waiting", cursor: { stage: "labs" }, progress: discProgress(state), detail: r.detail };
        }
        if (r.kind === "failed") {
          state.discovery.raw = raw.slice(0, 1200);
          await save(d, tenantId, state);
          return { status: "failed", cursor: { stage: "labs" }, progress: discProgress(state), detail: r.detail };
        }
        if (r.kind === "evidence") raw.push(...extractKeywordItems(r.payload, p.via));
      }
      // narrow: normalize -> dedupe -> filter -> rank/cap (before any SERP spend)
      const deduped = dedupeKeywords(raw);
      const { retained, rejected } = applyFilters(deduped, ctxFrom(profile), MAX_REJECTED);
      const capped = rankAndCap(retained, MAX_RETAINED);
      state.discovery.seeds = seeds;
      state.discovery.raw = raw.slice(0, 1200);
      state.discovery.normalized = deduped.map((k) => k.keyword).slice(0, 800);
      state.discovery.retained = capped;
      state.discovery.rejected = rejected;
      state.discovery.counts = { raw: raw.length, normalized: deduped.length, retained: capped.length, rejected: rejected.length };
      if (raw.length === 0) {
        await save(d, tenantId, state);
        return { status: "failed", cursor: { stage: "labs" }, progress: discProgress(state), detail: "I found no keywords from the research provider yet." };
      }
      if (capped.length === 0) {
        await save(d, tenantId, state);
        return { status: "done", cursor: null, progress: discProgress(state), detail: "No keywords survived the relevance filters this run." };
      }
      await save(d, tenantId, state);
      if (d.now() > deadline) return { status: "advanced", cursor: { stage: "overview" }, progress: discProgress(state) };
    }

    // overview: enrich retained with volume/intent/difficulty (<=700/batch)
    const retained = state.discovery.retained;
    if (retained.length > 0) {
      const r = interp(await d.callProvider(buildSpec(tenantId, unitKey, EP.overview, [{ keywords: retained.map((k) => k.keyword).slice(0, 700), location_code: LOC, language_code: LANG }], { keywords: retained.length, ep: "overview" }, "live", EST.overview)));
      track(state, r);
      if (r.kind === "waiting") {
        await save(d, tenantId, state);
        return { status: "waiting", cursor: { stage: "overview" }, progress: discProgress(state), detail: r.detail };
      }
      if (r.kind === "evidence") {
        const byKw = new Map(extractKeywordItems(r.payload, "profile").map((e) => [e.keyword, e]));
        const merged = retained.map((k) => {
          const e = byKw.get(k.keyword);
          return e ? { ...k, searchVolume: e.searchVolume ?? k.searchVolume, competition: e.competition ?? k.competition, difficulty: e.difficulty ?? k.difficulty, intent: e.intent ?? k.intent } : k;
        });
        state.discovery.retained = rankAndCap(merged, MAX_RETAINED);
        state.discovery.counts.retained = state.discovery.retained.length;
      }
    }
    await save(d, tenantId, state);
    return { status: "done", cursor: null, progress: discProgress(state) };
  };
}
