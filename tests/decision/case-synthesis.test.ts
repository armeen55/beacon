/** SEMANTIC CASE SYNTHESIS (V1 Truth Convergence Phase 2): the ADVISORY reading over a grouping that is already decided. Each pin states what the reading may change about my case registry and what it may never change. Fixtures only, zero network: the gateway is seamed exactly as kernel-outcomes seams it. */
import { describe, it, expect, vi } from "vitest";
// Budget is not this file's subject: always-allowed, no-op hermetic seam.
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
import { synthesizeCases, type SynthesisCandidate } from "@/domains/decision/case-synthesis";
import { applySynthesis, caseRows, foldCases } from "@/domains/evidence/case-identity";
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
/** The sites that come up for each case. Two cases that share none of them, and share no search either, are strangers however confidently a reading says otherwise. */
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
    const out = apply(reading({ merges: [{ keepId: NAMES.id, absorbIds: [MALE.id], reason: "The searches on both are people looking for names to give a child." }] })); const kept = live(out).find((c) => c.id === MALE.id || c.id === NAMES.id)!;
    const alias = out.cases.find((c) => c.aliasOf)!; // WHICH id survives stays the file's own rule, never the reading's preference
    expect([alias.aliasOf, alias.anchors, live(out).length]).toEqual([kept.id, [], ALL.length - 1]);
    expect([...MALE.anchors, ...NAMES.anchors].every((a) => kept.anchors.includes(a))).toBe(true); // one case, every search it was ever about
    expect(held(out, TERMS.id)).toEqual(TERMS); // the terminology question is its own subject and no merge touched it
    // THE MERGE IS THE REGISTRY'S NOW, so the rules can never take it apart again: three more reconciles, the same rows every time, no third id, nothing to save.
    let rows = out.cases;
    for (let n = 0; n < 3; n += 1) { const next = apply(reading(), rows); expect([next.cases, next.refused]).toEqual([rows, []]); rows = next.cases; } });
  it("says so when a merge names a case that was already absorbed, instead of applying as silence", () => {
    const merged = apply(reading({ merges: [{ keepId: NAMES.id, absorbIds: [MALE.id], reason: "One subject." }] })).cases; const alias = merged.find((c) => c.aliasOf)!.id, canonical = merged.find((c) => c.aliasOf)!.aliasOf!;
    const out = apply(reading({ merges: [{ keepId: TERMS.id, absorbIds: [alias], reason: "These belong together." },
      { keepId: "inv_ghost", absorbIds: [RUGS.id], reason: "And so do these." }] }), merged);
    expect(out.refused).toEqual([`I did not join ${TERMS.id} and ${alias}: ${alias} names a case that was already absorbed into another one.`,
      `I did not join inv_ghost and ${RUGS.id}: inv_ghost is not a case I hold.`]);
    expect([out.cases, out.cases.filter((c) => c.id === canonical).length]).toEqual([merged, 1]); }); // nothing moved, and one row per id either way
  it("files which page answers which case, so one page can answer two cases and one case can hold two pages", () => {
    const out = apply(reading({ merges: [{ keepId: NAMES.id, absorbIds: [MALE.id], reason: "One subject: names people give a child." }],
      pageLinks: [{ caseId: NAMES.id, url: "/iranian-names", relation: "covers", reason: "This page answers the whole question." },
        { caseId: MALE.id, url: "/persian-boy-names", relation: "partially_covers", reason: "It answers half of it." },
        { caseId: TERMS.id, url: "/iranian-names", relation: "does_not_cover", reason: "The page names people and never explains the two words." }],
      parentOf: [{ parentId: NAMES.id, childId: TERMS.id }] }));
    const kept = live(out).find((c) => c.id === MALE.id || c.id === NAMES.id)!; expect(kept.pages).toEqual([{ url: "/iranian-names", relation: "covers" }, { url: "/persian-boy-names", relation: "partially_covers" }]);
    expect(held(out, TERMS.id)!.pages).toEqual([{ url: "/iranian-names", relation: "does_not_cover" }]); // the same page, read honestly for a different case
    expect([held(out, TERMS.id)!.parentId, out.refused]).toEqual([kept.id, []]); }); // a parent named by an absorbed id follows to the id that answers for it
  it("splits one case into exactly one new branch, and refuses a split that would empty it", () => {
    const out = apply(reading({ splits: [{ fromId: RUGS.id, moveQueries: ["persian rug cleaning"], reason: "Cleaning a rug is a job to book, not the history to read." }] }));
    const branch = live(out).find((c) => !ALL.some((f) => f.id === c.id))!; // ONE new id, minted for the branch that left
    // THE CASE THAT STAYS SHEDS THE SEARCH IT MOVED. The row it leaves behind is what the next pass unions its groups against, so a parent that kept the moved anchor would say, in the one place that now outranks every grouping rule, that the two of them are one subject, and the branch it just minted would be folded straight back into it on the very next reconcile.
    const gone = canonicalQueryKey("persian rug cleaning"); expect([held(out, RUGS.id)!.anchors, branch.anchors, out.cases.some((c) => c.aliasOf)]).toEqual([RUGS.anchors.filter((a) => a !== gone), [gone], false]);
    const byId = (rows: typeof out.cases) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    const after = apply(reading(), out.cases); // disjoint owned sets: the split survives its own next reconcile and mints nothing
    expect([byId(after.cases), after.refused]).toEqual([byId(out.cases), []]); const emptied = apply(reading({ splits: [{ fromId: RUGS.id, moveQueries: RUGS.anchors, reason: "Every one of these is its own thing." }] }));
    expect([emptied.refused, live(emptied).length]).toEqual([[`I did not split ${RUGS.id}: that moves every search out of it, which renames a case rather than splitting one.`], ALL.length]); });
  it("can never hand back two rows claiming one case id, whatever it was folded from", () => {
    // A Map keyed on id would have hidden this: two rows answering for one case means every join downstream reads whichever one it happened to see first.
    const rows = caseRows([{ id: "inv_one", anchors: ["x"], aliases: ["inv_two"], from: [0] }, { id: "inv_two", anchors: ["y"], aliases: [], from: [1] }], [MALE]);
    expect([rows.map((c) => c.id), rows.map((c) => c.aliasOf ?? "")]).toEqual([["inv_one", "inv_two", MALE.id], ["", "inv_one", ""]]); });
  it("reads rows written before any of this existed, and carries what it filed forward untouched", () => {
    expect(Object.keys(held(apply(reading()), LEADER.id)!)).toEqual(["id", "anchors"]); // an old row stays exactly the case it was: no page, no parent, no new key
    const first = apply(reading({ pageLinks: [{ caseId: RUGS.id, url: "/persian-rugs", relation: "covers", reason: "This page is the answer." }] }));
    const saved = JSON.parse(JSON.stringify(first.cases)) as ResearchCase[]; // saved, then read back in a fresh process
    expect(held(applySynthesis(saved, reading(), DOMAINS), RUGS.id)!.pages).toEqual([{ url: "/persian-rugs", relation: "covers" }]); }); });
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
    const s = seam(MERGE); expect([await synthesizeCases(CANDIDATES, "t_fixture", { complete: s.complete }), s.calls()]).toEqual([MERGE, 1]); });
  it("throws away the WHOLE reading when it names a case or an address nobody gave it", async () => {
    const strangerCase = reading({ merges: [{ keepId: NAMES.id, absorbIds: ["inv_ghost"], reason: "These belong together." }] });
    const strangerPage = reading({ pageLinks: [{ caseId: NAMES.id, url: "/a-page-i-never-showed-it", relation: "covers", reason: "This page answers it." }] });
    const strangerSearch = reading({ splits: [{ fromId: NAMES.id, moveQueries: ["a search nobody made"], reason: "This one is its own subject." }] });
    for (const bad of [strangerCase, strangerPage, strangerSearch]) expect(await synthesizeCases(CANDIDATES, "t_fixture", { complete: seam(bad).complete })).toBeNull();
    expect(await synthesizeCases(CANDIDATES.slice(0, 1), "t_fixture", { complete: seam(MERGE).complete })).toBeNull(); }); // one case is nothing to regroup: no call at all
  it("reviews the cases the run is stuck on first, then the ones the most people search for, and never the ones whose id happens to sort early", async () => {
    const seen: string[] = []; const complete: CompleteFn = async (req) => { seen.push(String((req as { user?: string }).user ?? "")); return { value: reading() }; };
    const many = [candidate(RUGS, ["persian rug history"]), candidate(NEWS, ["iran news this week"]), candidate(LEADER, ["iran leader"]), candidate(TERMS, ["persian vs iranian"])];
    await synthesizeCases([{ ...many[0]!, demand: 40 }, { ...many[1]!, demand: 90 }, { ...many[2]!, demand: 10, inPlan: true }, many[3]!], "t_fixture", { complete });
    expect(seen[0]!.split("\n").filter((l) => l.startsWith("inv_")).map((l) => l.split(" ")[0]))
      .toEqual([LEADER.id, NEWS.id, RUGS.id, TERMS.id]); }); // frozen plan first, then 90, then 40, then the one with no priced demand at all
  it("asks the same question once: an unchanged registry buys no second reading", async () => {
    const s = seam(MERGE); const cacheImpl = memoryCache(); const first = await synthesizeCases(CANDIDATES, "t_fixture", { complete: s.complete, cacheImpl });
    const again = await synthesizeCases([...CANDIDATES].reverse(), "t_fixture", { complete: s.complete, cacheImpl }); // the same set, listed the other way round
    expect([first, again, s.calls()]).toEqual([MERGE, MERGE, 1]); }); });
it("keeps the FILE's survivor when the model prefers the smaller case, and an emptied case aliases to its real taker", () => {
  // The model says keep the 1-anchor case; the file's rule (most anchors, then smaller id) keeps the 4-anchor case.
  const big = { id: "inv_zzz_big", anchors: ["b1", "b2", "b3", "b4"] }, small = { id: "inv_aaa_small", anchors: ["s1"] };
  const out = applySynthesis([big, small], { merges: [{ keepId: small.id, absorbIds: [big.id] }], splits: [], pageLinks: [], parentOf: [] },
    new Map([[big.id, ["shared.example"]], [small.id, ["shared.example"]]]));
  const alive = out.cases.filter((c) => !c.aliasOf); expect([alive.map((c) => c.id), out.cases.find((c) => c.id === small.id)?.aliasOf]).toEqual([[big.id], big.id]);
  // And a case the partition empties aliases to the case that took its last anchor, never to whoever sorts first.
  const fold = foldCases([["t1"], ["t2"]], [
    { id: "inv_aaa_unrelated", anchors: ["u1"] }, { id: "inv_stale", anchors: ["t1", "t2"] },
    { id: "inv_taker", anchors: ["t1", "t2", "t3"] }]);
  expect(fold.find((f) => f.id === "inv_taker")?.aliases).toContain("inv_stale"); });
