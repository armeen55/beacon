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
import type { CapabilityInput, CapabilityKey, FunnelCounters, FunnelUnitFn, ParsedKeywordItem } from "@/domains/evidence/dataforseo/funnel-boundary";
import { applyFilters, dedupeKeywords, filterContextFrom, keywordsFromParsed, normalizeKeyword, rankAndCap } from "./normalize";
import { type FunnelKeyword, type FunnelState, MAX_REJECTED, MAX_RETAINED } from "./state";
import { basisFromCursor, CONFLICT_DETAIL, interp, NO_BASIS_DETAIL, resolveDeps, round, save, StateConflictError, track, type FunnelDeps } from "./shared";

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

type DiscStep = { capability: CapabilityKey; input: CapabilityInput; via: FunnelKeyword["discoveredVia"] };

function discoveryPlan(domain: string, seeds: string[]): DiscStep[] {
  const plan: DiscStep[] = [];
  if (domain) {
    plan.push({ capability: "labs_keywords_for_site", input: { target: domain, limit: 1000 }, via: "site" });
    plan.push({ capability: "labs_ranked_keywords", input: { target: domain, limit: 1000 }, via: "ranked" });
  }
  for (const s of seeds) {
    plan.push({ capability: "labs_related_keywords", input: { keyword: normalizeKeyword(s), depth: 2, limit: 1000 }, via: "related" });
    plan.push({ capability: "labs_keyword_suggestions", input: { keyword: normalizeKeyword(s), limit: 1000 }, via: "suggestion" });
  }
  return plan;
}

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
            if (parsed) raw.push(...keywordsFromParsed(parsed, p.via));
          }
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

      // overview: enrich retained with volume/intent/difficulty (<=700/batch)
      const retained = state.discovery.retained;
      if (retained.length > 0) {
        const r = interp(await d.callProvider("labs_keyword_overview", { keywords: retained.map((k) => k.keyword).slice(0, 700) }, ids));
        track(state, r);
        if (r.kind === "waiting") {
          await save(d, tenantId, basis, state, ctx);
          return { status: "waiting", cursor: { stage: "overview" }, progress: discProgress(state), detail: r.detail };
        }
        if (r.kind === "evidence") {
          const parsed = d.parse("labs_keyword_overview", r.payload as never) as ParsedKeywordItem[] | null;
          const byKw = new Map(keywordsFromParsed(parsed ?? [], "profile").map((e) => [e.keyword, e]));
          const merged = retained.map((k) => {
            const e = byKw.get(k.keyword);
            return e ? { ...k, searchVolume: e.searchVolume ?? k.searchVolume, competition: e.competition ?? k.competition, difficulty: e.difficulty ?? k.difficulty, intent: e.intent ?? k.intent } : k;
          });
          state.discovery.retained = rankAndCap(merged, MAX_RETAINED);
          state.discovery.counts.retained = state.discovery.retained.length;
        }
      }
      await save(d, tenantId, basis, state, ctx);
      return { status: "done", cursor: null, progress: discProgress(state) };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", cursor, progress: discProgress(state), detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}
