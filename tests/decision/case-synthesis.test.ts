/**
 * SEMANTIC CASE SYNTHESIS (V1 Truth Convergence Phase 2): the ADVISORY reading over a grouping that is
 * already decided. Each pin states what the reading may change about my case registry and what it may never
 * change. Fixtures only, zero network: the gateway is seamed exactly as kernel-outcomes seams it.
 */
import { describe, it, expect, vi } from "vitest";
// Budget is not this file's subject: always-allowed, no-op hermetic seam.
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
import { synthesizeCases, type SynthesisCandidate } from "@/domains/decision/case-synthesis";
import { applySynthesis } from "@/domains/evidence/case-identity";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import type { CaseSynthesis } from "@/domains/decision/llm/schemas";
import type { ResearchCase } from "@/domains/evidence/funnel/research-evidence";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
import type { CacheImpl, LlmCallCacheEntry } from "@/domains/decision/llm/call-cache";

/** One case as it sits on file: an id and the canonical searches it is about. Nothing semantic yet. */
const onFile = (id: string, queries: string[]): ResearchCase => ({ id, anchors: queries.map((q) => canonicalQueryKey(q)) });
const LEADER = onFile("inv_leader", ["iran leader", "who is the leader of iran"]);
const NEWS = onFile("inv_news", ["iran news this week", "what is happening in iran now"]);
const MALE = onFile("inv_male_names", ["persian male names", "persian boy names"]);
const NAMES = onFile("inv_names", ["iranian names", "iranian name meanings"]);
const TERMS = onFile("inv_terms", ["persian vs iranian", "difference between persian and iranian"]);
const REPAIR = onFile("inv_repair", ["persian rug repair near me", "rug repair shop"]);
const RUGS = onFile("inv_rugs", ["persian rug history", "history of persian rugs", "persian rug cleaning"]);
/** The sites that come up for each case. Two cases that share none of them, and share no search either, are
 *  strangers however confidently a reading says otherwise. */
const DOMAINS = new Map<string, string[]>([[LEADER.id, ["britannica.example", "wiki.example"]], [NEWS.id, ["news.example", "wire.example"]],
  [MALE.id, ["names.example", "babble.example"]], [NAMES.id, ["names.example", "wiki.example"]], [TERMS.id, ["wiki.example", "forum.example"]],
  [REPAIR.id, ["maps.example", "yelp.example"]], [RUGS.id, ["wiki.example", "museum.example"]]]);
const ALL = [LEADER, NEWS, MALE, NAMES, TERMS, REPAIR, RUGS];
const reading = (over: Partial<CaseSynthesis> = {}): CaseSynthesis => ({ merges: [], splits: [], pageLinks: [], parentOf: [], ...over });
const apply = (plan: CaseSynthesis, cases: readonly ResearchCase[] = ALL) => applySynthesis(cases, plan, DOMAINS);
const live = (out: { cases: ResearchCase[] }) => out.cases.filter((c) => !c.aliasOf);
const held = (out: { cases: ResearchCase[] }, id: string) => out.cases.find((c) => c.id === id);

describe("what the semantic reading may change about my case registry", () => {
  it("keeps a subject and the week's news about it apart, and a local service apart from the subject itself, however the reading argues", () => {
    const out = apply(reading({ merges: [
      { keepId: LEADER.id, absorbIds: [NEWS.id], reason: "Both of these are about Iran, so I am treating them as one." },
      { keepId: RUGS.id, absorbIds: [REPAIR.id], reason: "Both of these are about persian rugs." }] }));
    expect(live(out).map((c) => c.id).sort()).toEqual(ALL.map((c) => c.id).sort()); // every case still its own, and nothing became an alias
    expect(out.refused).toEqual([
      `I did not join ${LEADER.id} and ${NEWS.id}: they share no search and no site, so I hold nothing that says they are one subject.`,
      `I did not join ${RUGS.id} and ${REPAIR.id}: they share no search and no site, so I hold nothing that says they are one subject.`]);
    expect(held(out, LEADER.id)!.anchors).toEqual(LEADER.anchors); }); // and the refused merge left the anchors alone too
  it("merges two ways of naming ONE subject into one canonical id plus a durable alias, and never a third id", () => {
    const out = apply(reading({ merges: [{ keepId: NAMES.id, absorbIds: [MALE.id], reason: "The searches on both are people looking for names to give a child." }] }));
    const kept = live(out).find((c) => c.id === MALE.id || c.id === NAMES.id)!;
    const alias = out.cases.find((c) => c.aliasOf)!; // WHICH id survives stays the file's own rule, never the reading's preference
    expect([alias.aliasOf, alias.anchors, live(out).length]).toEqual([kept.id, [], ALL.length - 1]);
    expect([...MALE.anchors, ...NAMES.anchors].every((a) => kept.anchors.includes(a))).toBe(true); // one case, every search it was ever about
    expect(held(out, TERMS.id)).toEqual(TERMS); }); // the terminology question is its own subject and no merge touched it
  it("files which page answers which case, so one page can answer two cases and one case can hold two pages", () => {
    const out = apply(reading({ merges: [{ keepId: NAMES.id, absorbIds: [MALE.id], reason: "One subject: names people give a child." }],
      pageLinks: [{ caseId: NAMES.id, url: "/iranian-names", relation: "covers", reason: "This page answers the whole question." },
        { caseId: MALE.id, url: "/persian-boy-names", relation: "partially_covers", reason: "It answers half of it." },
        { caseId: TERMS.id, url: "/iranian-names", relation: "does_not_cover", reason: "The page names people and never explains the two words." }],
      parentOf: [{ parentId: NAMES.id, childId: TERMS.id }] }));
    const kept = live(out).find((c) => c.id === MALE.id || c.id === NAMES.id)!;
    expect(kept.pages).toEqual([{ url: "/iranian-names", relation: "covers" }, { url: "/persian-boy-names", relation: "partially_covers" }]);
    expect(held(out, TERMS.id)!.pages).toEqual([{ url: "/iranian-names", relation: "does_not_cover" }]); // the same page, read honestly for a different case
    expect([held(out, TERMS.id)!.parentId, out.refused]).toEqual([kept.id, []]); }); // a parent named by an absorbed id follows to the id that answers for it
  it("splits one case into exactly one new branch, and refuses a split that would empty it", () => {
    const out = apply(reading({ splits: [{ fromId: RUGS.id, moveQueries: ["persian rug cleaning"], reason: "Cleaning a rug is a job to book, not the history to read." }] }));
    const branch = live(out).find((c) => !ALL.some((f) => f.id === c.id))!; // ONE new id, minted for the branch that left
    // The case that stays keeps every search it has EVER been about, because that history is what its identity is
    // matched against on the next pass. What the split changes is where the moved search is answered from now on.
    expect([held(out, RUGS.id)!.anchors, branch.anchors, out.cases.some((c) => c.aliasOf)]).toEqual([RUGS.anchors, [canonicalQueryKey("persian rug cleaning")], false]);
    const emptied = apply(reading({ splits: [{ fromId: RUGS.id, moveQueries: RUGS.anchors, reason: "Every one of these is its own thing." }] }));
    expect([emptied.refused, live(emptied).length]).toEqual([[`I did not split ${RUGS.id}: that moves every search out of it, which renames a case rather than splitting one.`], ALL.length]); });
  it("reads rows written before any of this existed, and carries what it filed forward untouched", () => {
    expect(Object.keys(held(apply(reading()), LEADER.id)!)).toEqual(["id", "anchors"]); // an old row stays exactly the case it was: no page, no parent, no new key
    const first = apply(reading({ pageLinks: [{ caseId: RUGS.id, url: "/persian-rugs", relation: "covers", reason: "This page is the answer." }] }));
    const saved = JSON.parse(JSON.stringify(first.cases)) as ResearchCase[]; // saved, then read back in a fresh process
    expect(held(applySynthesis(saved, reading(), DOMAINS), RUGS.id)!.pages).toEqual([{ url: "/persian-rugs", relation: "covers" }]); });
});

// ── the gateway wrapper: what may come back, and what costs a second call ─────
const candidate = (c: ResearchCase, queries: string[], ownedUrls: string[] = []): SynthesisCandidate =>
  ({ id: c.id, label: queries[0]!, queries, prompts: [], ownedUrls, groupedBy: ["shared_entity"] });
const CANDIDATES = [candidate(MALE, ["persian male names", "persian boy names"], ["/persian-boy-names"]),
  candidate(NAMES, ["iranian names", "iranian name meanings"], ["/iranian-names"])];
const MERGE = reading({ merges: [{ keepId: NAMES.id, absorbIds: [MALE.id], reason: "One subject: names people give a child." }],
  pageLinks: [{ caseId: NAMES.id, url: "/iranian-names", relation: "covers", reason: "This page answers it." }] });
/** A completion seam that answers with one fixed reading and counts how many times it actually ran. */
const seam = (value: unknown): { complete: CompleteFn; calls: () => number } => { let calls = 0; return { calls: () => calls, complete: async () => { calls += 1; return { value }; } }; };
const memoryCache = (): CacheImpl => { const rows = new Map<string, LlmCallCacheEntry>(); return { read: async (t, k) => rows.get(`${t}|${k}`) ?? null, write: async (t, e) => void rows.set(`${t}|${e.key}`, e), recentTexts: async () => [] }; };

describe("the one reading a pass may buy", () => {
  it("returns a reading that names only what it was given", async () => {
    const s = seam(MERGE);
    expect([await synthesizeCases(CANDIDATES, "t_fixture", { complete: s.complete }), s.calls()]).toEqual([MERGE, 1]); });
  it("throws away the WHOLE reading when it names a case or an address nobody gave it", async () => {
    const strangerCase = reading({ merges: [{ keepId: NAMES.id, absorbIds: ["inv_ghost"], reason: "These belong together." }] });
    const strangerPage = reading({ pageLinks: [{ caseId: NAMES.id, url: "/a-page-i-never-showed-it", relation: "covers", reason: "This page answers it." }] });
    const strangerSearch = reading({ splits: [{ fromId: NAMES.id, moveQueries: ["a search nobody made"], reason: "This one is its own subject." }] });
    for (const bad of [strangerCase, strangerPage, strangerSearch]) expect(await synthesizeCases(CANDIDATES, "t_fixture", { complete: seam(bad).complete })).toBeNull();
    expect(await synthesizeCases(CANDIDATES.slice(0, 1), "t_fixture", { complete: seam(MERGE).complete })).toBeNull(); }); // one case is nothing to regroup: no call at all
  it("asks the same question once: an unchanged registry buys no second reading", async () => {
    const s = seam(MERGE); const cacheImpl = memoryCache();
    const first = await synthesizeCases(CANDIDATES, "t_fixture", { complete: s.complete, cacheImpl });
    const again = await synthesizeCases([...CANDIDATES].reverse(), "t_fixture", { complete: s.complete, cacheImpl }); // the same set, listed the other way round
    expect([first, again, s.calls()]).toEqual([MERGE, MERGE, 1]); });
});
