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
import type { CanonicalPairObservation } from "@/domains/evidence/ai-visibility/ai-observations";
import { caseIdByAnchor } from "@/domains/evidence/case-identity";
import { isCurrent } from "@/domains/evidence/freshness";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import type { CapabilityInputByKey, FunnelCounters, FunnelUnitFn, ParsedByCapability, ParsedKeywordItem } from "@/domains/evidence/dataforseo/funnel-boundary";
import { log } from "@/lib/logger";
import { applyFilters, dedupeKeywords, filterContextFrom, keywordsFromParsed, mergeOrigins, normalizeKeyword, retainDiverse, type SerpAgendaPageQuery } from "./normalize";
import type { KeywordOrigin } from "./research-evidence";
import { analysisWatermark, type FunnelKeyword, type FunnelState, MAX_REJECTED, MAX_RETAINED } from "./state";
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
    plan.push({ capability: "labs_related_keywords", input: { keyword, limit: 1000 }, via: "related", seed: keyword });
    plan.push({ capability: "labs_keyword_suggestions", input: { keyword, limit: 1000 }, via: "suggestion", seed: keyword });
  }
  return plan;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** THE ANSWER one canonical row IS, named in exactly the terms ai_observations files it under, so the trip
 *  back from a keyword to the answer that produced it is a lookup and never a guess. Every part is present
 *  because the row exists: the loader hands back only settled answers under current questions. */
function answerIdentity(o: CanonicalPairObservation): Omit<KeywordOrigin, "route"> {
  return { promptId: o.promptId, promptVersion: o.promptVersion, engine: o.engine, reportingDay: o.reportingDay, observationId: o.observationId };
}

/** A read I could not make is not an account with no answers, and it may never be reported as one. */
const AI_READ_FAILED = "I could not read your stored answers this pass, so I added nothing new from them. Everything I already found is still here and I will read them again on your next visit.";

/** The routes that come OUT of a stored answer. A kept row whose whole journey is answers to questions this
 *  account no longer asks is dropped on any pass that actually read the canonical set; a row that also
 *  arrived by search, by a results page or by a page of my own is not an answer's row and is never pruned. */
const AI_ROUTES = new Set(["prompt", "fanout", "answer_entity"]);
function stillAsked(rows: readonly FunnelKeyword[], observations: readonly CanonicalPairObservation[]): FunnelKeyword[] {
  const live = new Set(observations.map((o) => o.promptId));
  // The shelter reads only the KEPT origins: a non-AI arrival pushed past MAX_ORIGINS into the overflow count cannot shelter, which is narrow (seven-plus arrivals, the sheltering one last) and self-heals the next pass that source reports the query.
  return rows.filter((k) => (k.origins ?? []).length === 0
    || !k.origins!.every((o) => AI_ROUTES.has(o.route) && (!o.promptId || !live.has(o.promptId))));
}

/** THE SAME TAIL IS NOT DROPPED FOREVER. A route's ceiling always cuts somewhere, and a fixed walk cuts the
 *  SAME rows on every pass, so an account holding more answers than one pass can carry would never once reach
 *  the far end of its own set. The walk starts at an index derived from the newest reporting day, so a
 *  different head fills the ceiling tomorrow and what was turned away today gets its turn. Two passes inside
 *  one day agree only while the answer set itself is unchanged; a new answer moves the head. What earlier
 *  passes already harvested is kept by the union below, so the head moving costs nothing. */
function rotated(rows: readonly CanonicalPairObservation[]): readonly CanonicalPairObservation[] {
  if (rows.length < 2) return rows;
  const day = rows.reduce((newest, o) => (o.reportingDay > newest ? o.reportingDay : newest), "");
  const at = [...day].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % rows.length, 7);
  return [...rows.slice(at), ...rows.slice(0, at)];
}

/** EVERYTHING THIS ACCOUNT ALREADY OBSERVED, as keyword candidates, each carrying the ARRIVAL that produced
 *  it and not merely the name of the route. None of it costs a cent. Discovery used to ignore all of it and
 *  ask a provider for keywords instead, which is how a case could be investigated for a week while the exact
 *  question Google puts at the top of its own results page never entered the funnel; then it kept the route
 *  and threw the journey away, so a fan-out could not say which question, which engine or which answer
 *  produced it. THE SAME KEYWORD SEEN TWICE ON ONE ROUTE NOW MERGES rather than dropping the second
 *  arrival: two answers asking the same follow-up is two pieces of evidence, not one.
 *
 *  THE ANSWERS ARE READ OFF THE CANONICAL SET, not off the pairs one pass happens to be working. The working
 *  set holds whatever today's plan is mid-flight, which on this account was a single question, so almost
 *  every search the engines actually ran was invisible to discovery while sitting on file the whole time. */
function observedCandidates(
  tenantId: string, state: FunnelState, gscQueries: SerpAgendaPageQuery[] | null, observations: readonly CanonicalPairObservation[],
): FunnelKeyword[] {
  const rows = new Map<string, FunnelKeyword>();
  const taken = new Map<string, number>();
  /** The DISTINCT candidates a route's ceiling turned away, so a cap is reported and never silent. */
  const overflow = new Set<string>();
  /** EVERY arrival this pass saw for one candidate, kept WHOLE until the bound is applied once at the end.
   *  Folding the bound in arrival by arrival threw the seventh away and then counted the eighth against a
   *  list it was no longer in, so eight answers asking one follow-up came out as seven. */
  const arrivals = new Map<string, KeywordOrigin[]>();
  /** ONE candidate with ONE arrival. The raw string is recorded only when normalization is about to change
   *  it, so an origin never repeats the keyword back at whoever reads it. The per-route ceiling bounds
   *  DISTINCT keywords, so a keyword already held keeps collecting arrivals without spending a slot. */
  const take = (raw: string | null | undefined, origin: KeywordOrigin): void => {
    const keyword = normalizeKeyword(raw ?? "");
    if (!keyword) return;
    const at: KeywordOrigin = { ...origin, ...(raw && raw !== keyword ? { sourceQuery: raw } : {}) };
    const id = `${origin.route}|${keyword}`;
    if (rows.has(id)) { arrivals.get(id)!.push(at); return; }
    const spent = taken.get(origin.route) ?? 0;
    if (spent >= MAX_PER_ROUTE) { overflow.add(id); return; }
    taken.set(origin.route, spent + 1);
    rows.set(id, { keyword, searchVolume: null, competition: null, difficulty: null, intent: null, discoveredVia: origin.route, origins: [at] });
    arrivals.set(id, [at]);
  };
  for (const s of state.serps.queries) {
    for (const q of s.paa ?? []) take(q.question, { route: "paa", ...(s.query ? { parentQuery: s.query } : {}) });
    for (const r of s.related ?? []) take(r, { route: "related_search", ...(s.query ? { parentQuery: s.query } : {}) });
  }
  // ONE answer at a time: the question it asked, the searches the engine itself went and ran to answer it,
  // and (only where a reading was validly settled against this exact answer) what that answer was about and
  // what it actually answered. All three routes carry the SAME identity, so every one of them leads back.
  for (const o of rotated(observations)) {
    const from = answerIdentity(o), parent = o.promptText ? { parentQuery: o.promptText } : {};
    take(o.promptText, { route: "prompt", ...from });
    for (const f of o.fanOutQueries ?? []) take(f, { route: "fanout", ...from, ...parent });
    for (const e of [...strings(o.analysis?.topicEntities), ...strings(o.analysis?.questionsAnswered)]) take(e, { route: "answer_entity", ...from, ...parent });
  }
  for (const q of gscQueries ?? []) take(q.query, { route: "gsc", ...(q.page ? { pageUrl: q.page } : {}) });
  // A CEILING IS NEWS, NOT HOUSEKEEPING, AND EVERY ROUTE HAS ONE. Reporting only the follow-ups hid the pool
  // that actually overflows: 140 settled readings offer thousands of entities and questions, so the route that
  // lost the most is the one that has to be named. Counted per route, said out loud, never quietly deleted.
  const dropped = new Map<string, number>();
  for (const k of overflow) { const route = k.slice(0, k.indexOf("|")); dropped.set(route, (dropped.get(route) ?? 0) + 1); }
  if (dropped.size > 0) log.info(`[research-funnel] I reached my limit of ${MAX_PER_ROUTE} candidates and set ${[...dropped.values()].reduce((a, b) => a + b, 0)} more aside this pass (${[...dropped].sort().map(([r, n]) => `${r} ${n}`).join(", ")}). Each day I start from a different answer, so the ones I set aside get their turn on a later day.`,
    { tenantId, kept: MAX_PER_ROUTE, dropped: Object.fromEntries([...dropped].sort()) });
  // The bound, applied ONCE per candidate: the first MAX_ORIGINS distinct arrivals plus an exact count of
  // the rest.
  return [...rows.entries()].map(([id, row]) => ({ ...row, ...mergeOrigins({ origins: arrivals.get(id) ?? row.origins }) }));
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
    /** The one honest sentence a finished pass still owes the operator: coverage this pass could not get. */
    let softDetail: string | null = null;

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
            // The page of MY OWN this language was read off is the whole lineage of this route, so it rides along.
            if (n) raw.push({ keyword: n, searchVolume: null, competition: null, difficulty: null, intent: null, discoveredVia: "profile",
              origins: [{ route: "profile", ...(q === n ? {} : { sourceQuery: q }), ...(f.url ? { pageUrl: f.url } : {}) }] });
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
        // FREE, and already paid for once: my own Search Console queries, every answer on file with the
        // searches it ran and the reading of it, and everything my own results pages have shown me. Read
        // ONCE per pass. A failed read of either is absence of that source, never a claim it holds nothing.
        const gscQueries = await d.loadPageQueries(tenantId).catch(() => null);
        // null = the READ FAILED; [] = the account genuinely holds no answers yet. The old pairs source lived
        // in memory and could not fail, so nothing here ever had to tell those apart. This one is a table read
        // that times out, and a failure costs this pass its fresh AI look and NOTHING ELSE.
        const observations = await d.loadCanonicalObservations(tenantId).catch(() => null);
        if (!observations) { log.warn(`[research-funnel] ${AI_READ_FAILED}`, { tenantId }); softDetail = AI_READ_FAILED; }
        raw.push(...observedCandidates(tenantId, state, gscQueries, observations ?? []));
        // THE WATERMARK IS WHAT I ACTUALLY HARVESTED, stamped only on a pass that truly read the canonical set, so
        // an interrupted pass recomputes the same debt and a completed one clears it. A reading that settled as a
        // refusal carries a hash like any other, so it moves this and can open ONE consuming pass that harvests
        // nothing new: bounded, self-clearing, and better than never noticing a reading that DID say something.
        if (observations) state.discovery.consumedAnalyses = analysisWatermark(observations.map((o) => ({ id: o.observationId, hash: o.analysisHash ?? null })));
        // THE HARVEST ACCUMULATES, IT DOES NOT REPLACE. A wholesale rewrite from this pass's raw deleted every
        // keyword the pass did not happen to see again, journey, case join and bought volume with it, and the
        // rotation above guarantees a pass does NOT see the same slice twice. So what is retained is carried
        // into the pool and each pass ADDS its slice. GROWTH BOUND: at most MAX_RETAINED carried rows plus
        // this pass's own pool, which every route caps at MAX_PER_ROUTE, cut back to MAX_RETAINED below, so
        // the stored set can never exceed the ceiling it already had.
        const carried = observations ? stillAsked(state.discovery.retained, observations) : state.discovery.retained;
        // narrow: normalize -> dedupe -> join to a case -> filter -> diverse retain (before any SERP spend)
        const deduped = dedupeKeywords([...carried, ...raw]).map((k) => {
          // DISTINCT PAGES, NEVER ROWS. Counting rows made ONE page appearing twice for a search look like two
          // pages of mine competing, which is precisely the arithmetic "consolidation" is supposed to prove.
          // Best position first, so the surviving row for a page is its best one.
          const rows = (ownedRanks.get(k.keyword) ?? []).sort((a, b) => a.rank - b.rank);
          const owned = rows.filter((o, i) => rows.findIndex((x) => x.url === o.url) === i);
          const best = owned[0] ?? (k.ownedRankingUrl ? { url: k.ownedRankingUrl, rank: k.ownedPosition ?? 0 } : null);
          const held = owned.length > 0 ? owned.length : best ? 1 : 0;
          return { ...k, ...mergeOrigins(k), caseId: cases.of(k.keyword), ownedRankingUrl: best?.url ?? null, ownedPosition: best?.rank ?? null,
            supports: (!rankedLanded ? null : held >= 2 ? "consolidation" : held === 1 ? "existing_page" : "new_page") as FunnelKeyword["supports"] };
        });
        // A candidate that provably belongs to a case I am already investigating is not weighed against the
        // profile's relevance tokens: "what is served at a nowruz table" shares no token with "persian food"
        // and is exactly the question the case is about. Every constraint gate still applies to it.
        const filters = ctxFrom(profile);
        const joined = applyFilters(deduped.filter((k) => k.caseId), { ...filters, relevanceTokens: new Set<string>() }, MAX_REJECTED);
        const open = applyFilters(deduped.filter((k) => !k.caseId), filters, MAX_REJECTED);
        // ONE diverse cut over the whole pool, carried and fresh together. A priced-first tranche was tried
        // here and it is a cliff: once the ceiling fills with priced rows a fresh arrival can never land
        // again, so the AI harvest becomes a permanent silent no-op. retainDiverse's per-group round robin
        // already keeps every source's share, which protects paid rows without making any row immortal.
        const capped = retainDiverse([...joined.retained, ...open.retained], MAX_RETAINED);
        const rejected = [...joined.rejected, ...open.rejected].slice(0, MAX_REJECTED);
        state.discovery.seeds = seeds;
        state.discovery.retained = capped;
        state.discovery.rejected = rejected;
        state.discovery.counts = { raw: raw.length, normalized: deduped.length, retained: capped.length, rejected: rejected.length };
        // NOTHING NEW IS NOT NOTHING AT ALL: a pass that found no fresh candidate while holding a researched
        // set of its own has not failed, and must never say it has.
        if (raw.length === 0 && carried.length === 0) {
          await save(d, tenantId, basis, state, ctx);
          return { status: "failed", cursor: { stage: "labs" }, progress: discProgress(state), detail: softDetail ?? "I found no keywords from the research provider yet." };
        }
        if (capped.length === 0) {
          await save(d, tenantId, basis, state, ctx);
          return { status: "done", cursor: null, progress: discProgress(state), detail: softDetail ?? "No keywords survived the relevance filters this run." };
        }
        await save(d, tenantId, basis, state, ctx);
        if (d.now() > deadline) return { status: "advanced", cursor: { stage: "overview" }, progress: discProgress(state) };
      }

      // overview: enrich retained with volume/intent/difficulty, ceil(n / 700) REQUESTS
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
        const raw = await d.callProvider("labs_serp_competitors", { keywords }, ids);
        const r = interp(raw);
        track(state, r);
        if (r.kind === "waiting" || r.kind === "failed") {
          // WHICH CASE THE CEILING STOPPED travels back with the stop, and ONLY when the ceiling is what
          // stopped it. The runner writes it as a day-scoped marker on the run's own progress (no second
          // store), so the case receipt can say "I did not buy this one because the spending ceiling was
          // reached" about the case it actually happened to, exactly as it already can for a page by page
          // comparison. Every other stop reason keeps saying only what it always said.
          await save(d, tenantId, basis, state, ctx);
          return { status: r.kind === "waiting" ? "waiting" : "failed", progress: discProgress(state),
            cursor: { stage: "competitors", ...(raw.state === "capped" ? { cappedCase: caseId } : {}) },
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
