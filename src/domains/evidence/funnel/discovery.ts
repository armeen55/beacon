import "server-only";

/**
 * funnel/discovery (case-scoped universe) - the broad-then-narrow keyword funnel executor.
 *
 * THE UNIVERSE IS CASE-SCOPED NOW, and it was account-global before. First, the pool stopped being only what
 * the provider was asked for: the questions Google already put on this account's results pages, the searches
 * the engines themselves ran, the entities its answers named and its own Search Console queries were all
 * observed already and every one of them was thrown away. They are free, they are the account's real
 * language, and each arrives TAGGED with the route it came by. Second, every retained keyword is joined to
 * the registry case it belongs to through the same case identity everything else joins through, so an id a
 * merge absorbed lands on the case that answers for it now; a candidate that provably belongs to a live case
 * is not weighed against the profile's relevance tokens, but it still passes every constraint gate.
 *
 * BATCHES FILL THE PROVIDER'S OWN CEILINGS: enrichment runs ceil(n / 700) keyword_overview requests, never
 * one per keyword and never a silent truncation at one request's worth, and the recurring winning domains
 * for a case are ONE serp_competitors request at its 200-keyword ceiling. Zero SERP spend here. All state is
 * basis-scoped with optimistic row_version.
 */

import type { BusinessProfile } from "@/domains/account";
import { caseIdByAnchor } from "@/domains/evidence/case-identity";
import { isCurrent } from "@/domains/evidence/freshness";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import type { CapabilityInputByKey, FunnelCounters, FunnelUnitFn, ParsedByCapability, ParsedKeywordItem } from "@/domains/evidence/dataforseo/funnel-boundary";
import { log } from "@/lib/logger";
import { applyFilters, dedupeKeywords, filterContextFrom, keywordsFromParsed, normalizeKeyword, retainDiverse, type SerpAgendaPageQuery } from "./normalize";
import { type FunnelKeyword, type FunnelState, MAX_REJECTED, MAX_RETAINED } from "./state";
import { basisFromCursor, beginCycle, CONFLICT_DETAIL, interp, NO_BASIS_DETAIL, pauseDetail, resolveDeps, round, save, StateConflictError, track, type FunnelDeps } from "./shared";

/** ONE case of the run's FROZEN plan, as plain data: Evidence never reads Runtime or Decision. */
type PlanCase = { caseId: string; query: string | null };

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
/** Candidates one OBSERVED route may contribute in a pass. Each is free, so this bounds the pool and the
 *  stored blob, never money. Case sets on file match the decoder's own bound. */
/** RESERVE ARITHMETIC AT THE CEILING, stated once so it is checkable. A case set is ONE labs_serp_competitors
 *  request reserved at $0.05, the run's frozen plan is what the loop below walks, and MAX_CASE_SETS is the most
 *  this state ever holds, so the absolute worst pass reserves 12 x 0.05 = $0.60 of competitor work (a normal
 *  three-topic plan reserves $0.15). The un-truncated overview batching adds one further $0.25 request at
 *  MAX_RETAINED, because 1,400 keywords is ceil(1400 / 700) = 2 requests where the old path bought 1. So this
 *  unit's per-pass reservation ceiling went up by $0.85. Reservations, never charges: reconcile drops each one
 *  to actual, and the account's own spend cap is still the thing that fails closed. */
const MAX_PER_ROUTE = 300, MAX_CASE_SETS = 12;
/** The two documented request ceilings, verified on docs.dataforseo.com 2026-07-31: keyword_overview takes up
 *  to 700 keywords ("The maximum number of keywords you can specify: 700") and serp_competitors up to 200. A
 *  larger set is ceil(n / ceiling) REQUESTS, never a truncation and never one request per keyword. */
const OVERVIEW_BATCH = 700, COMPETITOR_KEYWORDS = 200;

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

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** EVERYTHING THIS ACCOUNT ALREADY OBSERVED, as keyword candidates, each tagged with the route it actually
 *  arrived by. None of it costs a cent. Discovery used to ignore all of it and ask a provider for keywords
 *  instead, which is how a case could be investigated for a week while the exact question Google puts at the
 *  top of its own results page never entered the funnel. Pure. */
function observedCandidates(
  state: FunnelState, gscQueries: SerpAgendaPageQuery[] | null, analyses: readonly Record<string, unknown>[],
): FunnelKeyword[] {
  const out: FunnelKeyword[] = [];
  const seen = new Map<string, Set<string>>();
  const take = (raw: string | null | undefined, via: FunnelKeyword["discoveredVia"]): void => {
    const keyword = normalizeKeyword(raw ?? "");
    const bucket = seen.get(via) ?? new Set<string>();
    seen.set(via, bucket);
    if (!keyword || bucket.has(keyword) || bucket.size >= MAX_PER_ROUTE) return;
    bucket.add(keyword);
    out.push({ keyword, searchVolume: null, competition: null, difficulty: null, intent: null, discoveredVia: via });
  };
  for (const s of state.serps.queries) {
    for (const q of s.paa ?? []) take(q.question, "paa");
    for (const r of s.related ?? []) take(r, "related_search");
  }
  for (const p of state.prompts.pairs) {
    take(p.promptText, "prompt");
    for (const f of p.fanOutQueries ?? []) take(f, "fanout");
  }
  for (const q of gscQueries ?? []) take(q.query, "gsc");
  // The analysis of an answer already bought: what the answer was ABOUT and what it actually answered.
  for (const a of analyses) {
    for (const e of strings(a.topicEntities)) take(e, "answer_entity");
    for (const q of strings(a.questionsAnswered)) take(q, "answer_entity");
  }
  return out;
}

/** THE case a search belongs to: the registry on file, plus the frozen plan's own cases, every id resolved
 *  through the same alias chain the rest of the file uses. A plan naming an absorbed id therefore files its
 *  keywords under the case that answers for it now, never under a row that is no longer a case. */
function caseLookup(state: FunnelState, plan: readonly PlanCase[]): { of: (keyword: string) => string | null; id: (caseId: string) => string } {
  const index = caseIdByAnchor(state.cases ?? []);
  for (const p of plan) {
    const key = canonicalQueryKey(normalizeKeyword(p.query ?? ""));
    if (key && p.caseId) index.set(key, index.get(p.caseId) ?? p.caseId);
  }
  return { of: (keyword) => index.get(canonicalQueryKey(keyword)) ?? null, id: (caseId) => index.get(caseId) ?? caseId };
}

/** Labs keyword_overview documents its keywords array at up to 700 entries, each up to 80
 *  characters and 10 words. A violator is DROPPED before the batch (counted internally,
 *  never truncated into a different keyword) so one bad row cannot reject the whole
 *  request and cost the entire retained set its search volume. */
const overviewEligible = (k: string) => k.length > 0 && k.length <= 80 && k.split(" ").filter(Boolean).length <= 10;

export function keywordDiscoveryUnit(deps: FunnelDeps = {}, planCases: readonly PlanCase[] = []): FunnelUnitFn {
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
    const cases = caseLookup(state, planCases);

    try {
      if (stage === "labs") {
        const account = await d.getAccount(tenantId).catch(() => null);
        const domain = account?.domain ? rootDomain(account.domain) : "";
        const seeds = seedsFrom(profile);
        const raw: FunnelKeyword[] = [];
        // The account's OWN rankings as the ranked pull reports them: which of my pages ranks for a keyword and how many
        // do. It is the whole basis of the support classification, so it is trusted only when the pull actually LANDED.
        const ownedRanks = new Map<string, { url: string; rank: number }[]>();
        let rankedLanded = false;
        const crawl = await d.loadCrawl(tenantId).catch(() => null);
        for (const f of crawl?.page_facts ?? []) {
          for (const q of [f.title ?? "", ...(f.questions ?? [])]) {
            const n = normalizeKeyword(q);
            if (n) raw.push({ keyword: n, searchVolume: null, competition: null, difficulty: null, intent: null, discoveredVia: "profile" });
          }
        }
        for (const p of discoveryPlan(domain, seeds)) {
          if (d.now() > deadline) {
            state.discovery.seeds = seeds;
            await save(d, tenantId, basis, state, ctx);
            return { status: "advanced", cursor: { stage: "labs" }, progress: discProgress(state) };
          }
          const r = interp(await d.callProvider(p.capability, p.input, ids));
          track(state, r);
          if (r.kind === "waiting") {
            await save(d, tenantId, basis, state, ctx);
            return { status: "waiting", cursor: { stage: "labs" }, progress: discProgress(state), detail: r.detail };
          }
          if (r.kind === "failed") {
            await save(d, tenantId, basis, state, ctx);
            return { status: "failed", cursor: { stage: "labs" }, progress: discProgress(state), detail: r.detail };
          }
          if (r.kind === "evidence") {
            const parsed = d.parse(p.capability, r.payload as never) as ParsedKeywordItem[] | null;
            if (parsed) raw.push(...keywordsFromParsed(parsed, p.via, p.seed));
            if (p.via === "ranked" && parsed) {
              rankedLanded = true;
              for (const it of parsed) {
                const key = normalizeKeyword(it.keyword);
                if (key && it.rankedUrl) ownedRanks.set(key, [...(ownedRanks.get(key) ?? []), { url: it.rankedUrl, rank: it.rankedRank ?? 0 }]);
              }
            }
          }
        }
        // IDEAS: the one ask that reaches beyond what the site already ranks for, batched
        // at the documented 200 seeds per request rather than one paid request per theme.
        // A batched ask cannot attribute WHICH seed produced an idea, so these rows carry
        // discoveredVia "ideas" and NO seed: an unknown lineage is recorded as unknown.
        if (seeds.length > 0) {
          for (const r of await d.keywordIdeas(seeds, ids)) {
            const t = interp(r);
            track(state, t);
            if (t.kind === "evidence") {
              const parsed = d.parse("labs_keyword_ideas", t.payload as never) as ParsedKeywordItem[] | null;
              if (parsed) raw.push(...keywordsFromParsed(parsed, "ideas", undefined));
            }
          }
        }
        // FREE, and already paid for once: my own Search Console queries, the answers I have analyzed, and
        // everything my own results pages and tracked questions have shown me. A failed read of either is
        // absence of that source, never a claim that it holds nothing.
        const gscQueries = await d.loadPageQueries(tenantId).catch(() => null);
        const analyses = await d.loadAnswerAnalyses(tenantId).catch(() => []);
        raw.push(...observedCandidates(state, gscQueries, analyses));
        // narrow: normalize -> dedupe -> join to a case -> filter -> diverse retain (before any SERP spend)
        const deduped = dedupeKeywords(raw).map((k) => {
          // DISTINCT PAGES, NEVER ROWS. Counting rows made ONE page appearing twice for a search look like two
          // pages of mine competing, which is precisely the arithmetic "consolidation" is supposed to prove.
          // Best position first, so the surviving row for a page is its best one.
          const rows = (ownedRanks.get(k.keyword) ?? []).sort((a, b) => a.rank - b.rank);
          const owned = rows.filter((o, i) => rows.findIndex((x) => x.url === o.url) === i);
          const best = owned[0] ?? (k.ownedRankingUrl ? { url: k.ownedRankingUrl, rank: k.ownedPosition ?? 0 } : null);
          const held = owned.length > 0 ? owned.length : best ? 1 : 0;
          return { ...k, caseId: cases.of(k.keyword), ownedRankingUrl: best?.url ?? null, ownedPosition: best?.rank ?? null,
            supports: (!rankedLanded ? null : held >= 2 ? "consolidation" : held === 1 ? "existing_page" : "new_page") as FunnelKeyword["supports"] };
        });
        // A candidate that provably belongs to a case I am already investigating is not weighed against the
        // profile's relevance tokens: "what is served at a nowruz table" shares no token with "persian food"
        // and is exactly the question the case is about. Every constraint gate still applies to it.
        const filters = ctxFrom(profile);
        const joined = applyFilters(deduped.filter((k) => k.caseId), { ...filters, relevanceTokens: new Set<string>() }, MAX_REJECTED);
        const open = applyFilters(deduped.filter((k) => !k.caseId), filters, MAX_REJECTED);
        const capped = retainDiverse([...joined.retained, ...open.retained], MAX_RETAINED);
        const rejected = [...joined.rejected, ...open.rejected].slice(0, MAX_REJECTED);
        state.discovery.seeds = seeds;
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

      // overview: enrich retained with volume/intent/difficulty, ceil(n / 700) REQUESTS
      let softDetail: string | null = null;
      if (stage !== "competitors") {
        const retained = state.discovery.retained;
        const eligible = retained.map((k) => k.keyword).filter(overviewEligible);
        if (eligible.length < retained.length) log.info("[research-funnel] keywords left out of the overview batch", { tenantId, dropped: retained.length - eligible.length, reason: "over_80_chars_or_10_words" });
        const priced = new Map<string, FunnelKeyword>();
        for (let at = 0; at < eligible.length; at += OVERVIEW_BATCH) {
          const batch = eligible.slice(at, at + OVERVIEW_BATCH);
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
            for (const e of keywordsFromParsed(parsed ?? [], "profile")) priced.set(e.keyword, e);
          } else if (r.soft === "not_configured") {
            // Missing credentials: keep the retained keywords, labeled as unenriched.
            softDetail = "I kept your researched keywords but could not add search volume this run. I will enrich them on the next pass.";
            break;
          }
        }
        if (priced.size > 0) {
          const merged = retained.map((k) => {
            const e = priced.get(k.keyword);
            // competitionLevel is the PROVIDER's own band; dropping it here made an
            // enriched row fall back to a derived guess while the bought value existed.
            return e ? { ...k, searchVolume: e.searchVolume ?? k.searchVolume, competition: e.competition ?? k.competition,
              competitionLevel: e.competitionLevel ?? k.competitionLevel, difficulty: e.difficulty ?? k.difficulty, intent: e.intent ?? k.intent } : k;
          });
          state.discovery.retained = retainDiverse(merged, MAX_RETAINED);
          state.discovery.counts.retained = state.discovery.retained.length;
        }
        await save(d, tenantId, basis, state, ctx);
        if (d.now() > deadline) return { status: "advanced", cursor: { stage: "competitors" }, progress: discProgress(state) };
      }

      // COMPETITORS: the domains that keep winning across a case's WHOLE keyword set, in ONE request for the
      // set. This capability had been registered and consumed by nothing; it is DOMAIN evidence stored beside
      // the case, never a keyword, and a set answered inside the week is served from what is already on file.
      for (const p of planCases) {
        // Out of budget with a case still unchecked is REAL work still owed, so the phase hands the run back
        // at this same stage rather than reporting a discovery that never looked at who is winning.
        if (d.now() > deadline) { await save(d, tenantId, basis, state, ctx); return { status: "advanced", cursor: { stage: "competitors" }, progress: discProgress(state) }; }
        const caseId = cases.id(p.caseId);
        const held = (state.discovery.caseCompetitors ?? []).find((c) => c.caseId === caseId);
        if (!caseId || (held && isCurrent("serp_cold", held.observedAt, d.now()))) continue;
        const keywords = state.discovery.retained.filter((k) => k.caseId === caseId).map((k) => k.keyword).slice(0, COMPETITOR_KEYWORDS);
        if (keywords.length === 0) continue;
        const r = interp(await d.callProvider("labs_serp_competitors", { keywords }, ids));
        track(state, r);
        if (r.kind === "waiting" || r.kind === "failed") {
          // DEFERRED TO PHASE 5 (the run's durable due-work state), NAMED HERE so it is not lost: the pass
          // stops honestly and the unit reports why, but nothing per CASE is persisted, so the case receipt
          // cannot yet say "I did not buy this one because the ceiling was reached" the way it already can
          // for a page by page comparison. That needs a durable per-case marker with a due date on it, which
          // is the state Phase 5 introduces; inventing a second, private one here would be the parallel
          // progress store the Foundation freeze exists to prevent.
          await save(d, tenantId, basis, state, ctx);
          return { status: r.kind === "waiting" ? "waiting" : "failed", cursor: { stage: "competitors" }, progress: discProgress(state),
            detail: r.detail ?? pauseDetail(r.disposition, "I could not check who keeps winning these searches this pass. I will try again on your next visit.") };
        }
        if (r.kind !== "evidence") continue;
        const parsed = d.parse("labs_serp_competitors", r.payload as never) as ParsedByCapability["labs_serp_competitors"] | null;
        if (!parsed) continue;
        const row = { caseId, keywordsAsked: keywords.length, domains: parsed.slice(0, 25), observedAt: new Date(d.now()).toISOString(),
          receipt: r.cacheKey, served: (r.hit ? "cache" : "paid") as "cache" | "paid" };
        state.discovery.caseCompetitors = [row, ...(state.discovery.caseCompetitors ?? []).filter((c) => c.caseId !== caseId)].slice(0, MAX_CASE_SETS);
      }
      await save(d, tenantId, basis, state, ctx);
      return { status: "done", cursor: null, progress: discProgress(state), ...(softDetail ? { detail: softDetail } : {}) };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", code: "state_conflict", cursor, progress: discProgress(state), detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}
