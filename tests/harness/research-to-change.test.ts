/** THE WHOLE RESEARCH-TO-CONTENT SEQUENCE IN ONE TEST CYCLE. The campaign debugged production by waiting for the next half-hour tick, so each round found
 *  only what the round before had opened. Every drive below is the REAL `runResearchCycle` over the REAL `defaultSteps`, with the clock advanced between
 *  drives instead of a scheduler waited on, the captured production rows seeded through the canonical stores, and the three providers answered from a
 *  script. Nothing here is a second runtime and nothing is marked Ready by hand: what an arm asserts, the shipped code decided. */
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/lib/persistence/supabase", async () => { const w = await import("./world"); const c = w.client(); return { getSupabaseAdmin: () => c, isSupabaseConfigured: () => true }; });
vi.mock("@/lib/logger", async () => { const w = await import("./world"); return { log: { debug: () => {}, info: (m: string, x?: unknown) => w.logs.push(`${m} ${JSON.stringify(x ?? {})}`), warn: (m: string, x?: unknown) => w.logs.push(`${m} ${JSON.stringify(x ?? {})}`), error: (m: string, x?: unknown) => w.logs.push(`${m} ${JSON.stringify(x ?? {})}`) } }; });
// THE TWO SEAMS THE CHANGES ACTION SITS BEHIND, and nothing else about it: who may publish for this account, and which account the request is for. The framework's own page cache and its background
// hook are stubbed because there is no request here to revalidate or defer into; every rule the press applies is the shipped one.
vi.mock("@/lib/auth/can-publish", () => ({ canPublishForCurrentTenant: async () => true }));
vi.mock("@/lib/tenant-context", async (actual) => ({ ...(await actual<Record<string, unknown>>()), currentTenantId: async () => (await import("./world")).T }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async () => {}, readCustomerSurface: async () => null, isCustomerSurfaceStale: () => false, refreshCustomerSurface: async () => ({}) }));

import * as RR from "@/domains/runtime/research-run";
import { runResearchCycle } from "@/domains/runtime/ops/on-visit-refresh";
import { defaultSteps } from "@/domains/runtime/ops/research-steps";
import { dueWork, accountBasis } from "@/domains/runtime/ops/due-work";
import { setAccountRepositoryForTests, type AccountRepository } from "@/domains/account/tenants/store";
import { nextObligation } from "@/domains/decision/obligation";
import { loadChangeProposals } from "@/domains/decision/proposal-store";
import { authorizedCorrections, readFactChecks, rulesVersionFor } from "@/domains/evidence/pages/fact-checks";
import { pageHashOf, claimIdentity } from "@/domains/evidence/pages/fact-check-run";
import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { resolveCurrentBasis } from "@/domains/decision/load-proposals";
import {
  advance, clock, fixture, installFetch, logs, meter, now, reasoningAsked, requestsOf, reset, runRepo, runs, script, seedOwnedPages,
  seedProposals, seedResearchState, seedRun, seedSearchHistory, reasoningReply, table, T, SITE,
  type FixtureSerp, type FixtureWinner, type Row, type RunRow,
} from "./world";

/** The one search this file drives end to end, the page that owes it, and the host at position four that the reading reserve refuses outright. */
const HUB = "/famous-iranians", QUERY = "famous iranians", FORUM = "reddit.com";
const serpFor = (q: string): FixtureSerp[] => fixture<FixtureSerp[]>("serps.json").filter((s) => s.query === q);

/** One results page as the provider answers it: `Task Created` at the post, then the finished rows once `ready` flips. */
function searchScript(state: { ready: boolean; posts: number }) {
  return (path: string) => {
    if (path.endsWith("task_post")) { state.posts += 1; return { body: { status_code: 20000, tasks: [{ id: "task-1", status_code: 20100, status_message: "Task Created.", cost: 0.0006 }] } }; }
    if (path.includes("task_get")) return { body: { status_code: 20000, cost: 0, tasks: [{ id: "task-1", status_code: state.ready ? 20000 : 40602, status_message: state.ready ? "Ok." : "Task in Queue.",
      result: state.ready ? [{ keyword: QUERY, items: [{ type: "organic", rank_absolute: 1, domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/List_of_Iranians", title: "List of Iranians" }] }] : null }] } };
    // The keyword endpoints are Live: an empty result on a Live call is an ambiguous purchase and quarantines, so this answers them with real rows.
    return { body: { status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{ items: [{ keyword: QUERY, search_volume: 1200, competition: 0.3, keyword_info: { search_volume: 1200, competition: 0.3 } }] }] }] } };
  };
}
/** A publisher that answers, in the shape the reader extracts: a title, a heading and enough words to be a reading. */
const pageScript = (url: string) => (url.endsWith("/robots.txt") ? { html: "User-agent: *\nAllow: /", contentType: "text/plain" }
  : { html: `<html><head><title>Famous Iranians, by the work they did</title></head><body><h1>Famous Iranians through history</h1><h2>Poets</h2><h2>Athletes</h2><h2>Scientists</h2><p>${"Famous Iranians are listed here by the work they did, with the years each of them worked and one line on why they are remembered. ".repeat(20)}</p></body></html>` });
/** THE WORDS THE WRITER HANDS BACK, in the shape the canonical editor accepts: an opening that answers the search outright, one claim per assertion, and every claim naming an id the packet really
 *  carries. It is a script and never a bypass: the same deterministic contract, the same evaluator and the same per-claim ruling read these words as they read production's. */
const WRITER = { field: "answer_block", before: null, naturalHeading: "Who the widely known Iranians are", placementId: "", implementationMinutes: 15,
  rationale: "The first lines never say who the search is about, so the answer is stated before the sections that hold the names.",
  after: "Iran's widely known figures fall into three groups of people: poets, athletes and screen actors. The athletes are wrestlers and weightlifters who won world titles, and the actors worked on screen at home and abroad.",
  claims: [{ text: "Poets, athletes and screen actors are the three kinds of people named.", supportedBy: ["page-heading-2", "page-heading-3", "page-heading-4"] },
    { text: "The athletes are wrestlers and weightlifters who won world titles, and the actors worked on screen at home and abroad.", supportedBy: ["page-copy-1"] }] };
/** THE READING OF THOSE WORDS, one ruling per claim by the index the evaluator is shown. A judge that says yes is still the REAL judge: what it may say is fixed by the schema the gateway sends, and
 *  every deterministic gate in front of it has already run on this same copy. */
const JUDGE = { pageFit: true, usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, contested: false,
  claims: [0, 1].map((i) => ({ i, by: WRITER.claims[i]!.supportedBy, entailed: true })), notes: "The first lines now name who the search is about before the sections that hold the names.", resolution: "none" };
/** The words the reasoning gateway hands back where a door reads them; every other field comes from the request's own schema. */
const REASONING = { page_job: { topics: ["names", "notable people", "history"], job: "Name the people this page covers and say why each is remembered.", audience: "readers looking a person up", promise: "a named list with one line each", missing: "a direct opening answer", sells: ["guides", "lists"] }, atomic_edit: WRITER, editor_judgement: JUDGE };

const ownedPage = () => seedOwnedPages([{ path: HUB, title: "Most Famous Iranians and Persians of All Time", h1: "Famous and Influential Iranian People",
  meta: "Explore the most famous Iranians and Persians in history.", h2: ["Famous Iranian Poets", "Famous Iranian Athletes", "Famous Iranian Actors"],
  body: ["Iran has produced writers, athletes and performers whose work travelled far beyond its borders.", "The poets section lists three poets with a short line on each.", "The athletes section lists wrestlers and weightlifters who won world titles.", "The actors section lists screen performers who worked at home and abroad.", "Each entry gives a name, a period and one sentence about why the person is remembered."].join("\n") }]);

/** ONE DRIVE. A pass that closed leaves the account with no open run, exactly as production does, so the next drive opens its own with the plan it is for. */
async function drive(plan: string[], phase = "keyword_discovery", progress: Row = {}, deadlineMs = 200_000): Promise<RunRow> {
  if (!runs.some((r) => r.status !== "completed")) seedRun({ status: "paused", current_phase: phase, progress: { plan: { units: plan }, ...progress } });
  await runResearchCycle(T, { now, deadlineMs, steps: defaultSteps });
  return runs[runs.length - 1]!;
}
const acquisitions = (r: RunRow): { key: string; kind: string; query: string; outcome: string; detail: string; sharedWith?: string[] }[] => (r.progress as { acquisitions?: never[] }).acquisitions ?? [];
/** WHAT THE DAY STILL OWES AFTER A DRIVE, with the stamps that drive wrote on it: a results page posted today is collected for nothing on the next drive, and the fact that it was posted lives on the need itself, so a fixture that re-seeds an unstamped need pays twice where production does not (`carriedDayState` in research-run.ts hands the owed list, its buy stamps and its post stamps to every same-day pass). */
const owedAfter = (r: RunRow, fallback: readonly Row[]): Row[] => { const owed = (r.progress as { evidenceOwed?: Row[] }).evidenceOwed; return owed?.length ? owed : [...fallback]; };
const winnersOf = (): FixtureWinner[] => ((table("research_state")[0]?.state as { winningPages?: FixtureWinner[] })?.winningPages ?? []);
const serpsOf = (): FixtureSerp[] => ((table("research_state")[0]?.state as { serps?: { queries?: FixtureSerp[] } })?.serps?.queries ?? []);

let basis = "";
beforeEach(async () => {
  reset(); installFetch();
  vi.stubEnv("DATAFORSEO_AUTH_B64", "harness-not-a-key");
  vi.stubEnv("OPENAI_API_KEY", "harness-not-a-key");
  vi.stubEnv("DATA_SOURCE", "supabase");
  const byId = async (id: string) => ({ id, slug: id, provisional_name: "", domain: SITE, status: "active" as const, signup_date: "2026-01-01", tos_accepted_at: "2026-01-01T00:00:00.000Z", daily_budget_usd: 50, growth_goal: null, created_at: "", updated_at: "" });
  setAccountRepositoryForTests({ getAccountById: byId, getAccountBySlug: byId } satisfies AccountRepository);
  RR.setResearchRunRepoForTests(runRepo() as never);
  script.reasoning = (body) => reasoningReply(REASONING, body);
  script.page = pageScript;
  basis = (await accountBasis(T))!;
  seedProposals((r) => String(r.page_key) === HUB);
  seedSearchHistory([{ path: HUB, query: QUERY }]);
  ownedPage();
});

describe("the owed results page, bought once and finished for nothing", () => {
  const need = (workKey = `${HUB}::body::${QUERY}::wc5::e1`) => ({ key: `${HUB}::body::${QUERY}`, kind: "serp", query: QUERY, rank: 1, reasonCode: "no_winner_to_read",
    reason: "no results page for this search is on file", workKey, unlocks: { proposalId: `${T}::${HUB}::existing_edit::demand_recovery`, step: "draft" } });

  it("1 and 2: the row's own ladder names the results page it lacks, and the drive posts the provider task", async () => {
    const stored = (await loadChangeProposals(T)).get(`${T}::${HUB}::existing_edit::demand_recovery`)!;
    expect(nextObligation({ ...stored, winnersOnFile: "none", obligation: { kind: "terminal", reason: "no substantive gap named" } }),
      "with no results page on file the ladder's next step is that results page, which is what the runtime then buys")
      .toEqual({ kind: "evidence", need: { kind: "serp", query: QUERY, reasonCode: "no_winner_to_read" } });

    seedResearchState(basis, { serps: [], winningPages: [] });
    const state = { ready: false, posts: 0 }; script.search = searchScript(state);
    const run = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need()] });

    expect([state.posts > 0, meter.paidUsd > 0], "the task is posted and the money moves at the post, which is where the provider charges").toEqual([true, true]);
    expect(new Set(acquisitions(run).filter((a) => a.query === QUERY).map((a) => `${a.kind}|${a.outcome}`)), "the need is stamped on the run row as bought and not yet read, never as a silence")
      .toEqual(new Set(["serp|not_read"]));
    expect(acquisitions(run).filter((a) => a.query === QUERY).every((a) => a.detail.includes("waiting")), "and every receipt for it says the provider is still working on it").toBe(true);
  });

  it("3 and 4: a later drive finishes it for nothing, the search lands on file, and the collection is not a second purchase", async () => {
    seedResearchState(basis, { serps: [], winningPages: [] });
    const state = { ready: false, posts: 0 }; script.search = searchScript(state);
    const first = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need()] });
    const postsAtPost = state.posts, searchesAtPost = requestsOf("search");

    state.ready = true; advance(30 * 60_000);
    const second = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: owedAfter(first, [need()]) });

    expect(state.posts, "the drive that finishes the answer posts nothing: a task is charged at the post and collected with a free follow-up").toBe(postsAtPost);
    expect(requestsOf("search") > searchesAtPost, "and the finishing request did go out, so the answer was fetched rather than assumed").toBe(true);
    const forThisSearch = acquisitions(second).filter((a) => a.kind === "serp" && a.query === QUERY);
    expect(forThisSearch.some((a) => a.outcome === "unlocked" && a.detail.includes("done")), "the second drive's receipt says the obligation moved, and says so by name").toBe(true);
    expect(acquisitions(second).some((a) => a.kind === "competitor_page" && a.outcome === "unlocked"),
      "and the drive that lands the results page goes straight on to read the pages that win it").toBe(true);
    expect(serpsOf().filter((s) => s.query === QUERY && s.status === "done").length, "the results page is on file for the row's own search").toBe(1);
    expect((second.progress as { collected?: { pending: number; ready: number } }).collected, "and the drive's own receipt counts the page that landed, so a collection that worked never reads as zero")
      .toEqual({ pending: 2, ready: 2 });
  });
});

describe("the winners of a search on file", () => {
  it("5 and 6: the due-work receipt and the reading unit agree on what is owed, the words are retained, and a capture that was cut keeps its typed answer", async () => {
    const held = fixture<FixtureWinner[]>("winners.json").filter((w) => !w.extract);
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: held });
    script.search = searchScript({ ready: true, posts: 0 });

    const owed = await dueWork(T, now());
    expect(owed.due.includes("read_winner_pages"), "a search on file whose pages nobody has read owes exactly that reading").toBe(true);
    expect(owed.winners.unread, "a capture the publisher refused is not owed again before its own retry date, so nothing on file is unread").toBe(0);

    await drive(["read_winner_pages"], "winning_pages");

    const read = winnersOf().filter((w) => (w.extract?.mainText ?? "").length > 0);
    expect(read.length > 0, "the pages that win this account's search are read and their words are kept").toBe(true);
    expect(read.some((w) => w.url.includes("List_of_Iranians")), "the winner at position one for the row's own search is among them").toBe(true);
    const cut = winnersOf().filter((w) => w.readOutcome != null);
    expect(cut.map((w) => (w.readOutcome as { state?: string }).state).sort(), "a capture that was cut carries the reason it was cut, typed, and is not silently dropped")
      .toEqual(["provider_unavailable", "robots_blocked", "robots_blocked"]);
    expect(cut.every((w) => !meter.requests.some((q) => q.url === w.url)), "and nothing fetched it again before its own retry date").toBe(true);
    expect(meter.paidUsd, "reading a public page is a polite free fetch, so the winner reads cost nothing").toBe(0);
  });

  /** A READING IS NEVER EVICTED BY A RANKING (production, 2026-09-06). The winners array was rebuilt from the ranked window on every pass, so the pages read for one search were thrown away as soon as this account's other searches competed for the same fifteen slots: the row that needed them read "none of the pages winning it has been read", bought the readings again, and lost them again. On the captured rows: five searches, four readings on file, one pass, and three of the four lost under the rule this replaces. */
  it("14: every winner already read for one of this account's searches is still on file, with its words, after a pass that ranks other searches above it", async () => {
    seedResearchState(basis, {}); // every captured search and every captured winner, four of them carrying words
    script.search = searchScript({ ready: true, posts: 0 });
    const read = () => new Set(winnersOf().filter((w) => (w.extract?.mainText ?? "").length > 0).map((w) => w.url)), before = read();

    await drive(["read_winner_pages"], "winning_pages");

    expect([before.size, [...before].filter((u) => !read().has(u))], "the readings on file before the pass are the readings on file after it: a ranking chooses which unread pages to read next, never which readings to keep").toEqual([4, []]);
    expect([...read()].some((u) => u.includes("List_of_Iranians")), "including the page at position one for the search this account's largest page owes a comparison for").toBe(true);
  });
});

describe("the reading the comparison names", () => {
  it("7: the drive buys the exact reading the refusal named and drafts again in the same turn", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: [] });
    script.search = searchScript({ ready: true, posts: 0 });

    const run = await drive(["read_winner_pages"], "winning_pages");

    expect(logs.some((l) => l.includes("none of its words are on file")), "the refusal names the one page whose words would settle the comparison").toBe(true);
    expect(acquisitions(run).map((a) => [a.kind, a.outcome]), "and that exact reading is bought for the row that asked for it").toEqual([["competitor_page", "unlocked"]]);
    expect(logs.some((l) => l.includes("the reading landed, so the work that asked for it was drafted in the same turn")),
      "the drive that lands the reading hands it to the writer without waiting for the next tick").toBe(true);
    expect(winnersOf().some((w) => w.url.includes("List_of_Iranians") && (w.extract?.mainText ?? "").length > 0), "the winner's own words are on file afterwards").toBe(true);
  });

  /** THE STALL THIS ARM WAS WRITTEN FOR: `producers/core.ts` took the next winner off the results page with no words on file and excused only a publisher's robots refusal, while the reading reserve
   *  (`funnel/normalize`, `isNoiseDomain`) drops a social, forum or marketplace host and marked nothing, so www.reddit.com at position 4 was demanded on every drive and read on none. Measured before
   *  the repair: six drives, six purchases, the identical refusal each time, and the row never left needs_review. One rule now, in the projection both sides read. */
  it("8: a winner the reading reserve will never take is not demanded, so the comparison finishes and the drive can write", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: [] });
    script.search = searchScript({ ready: true, posts: 0 });
    const refusals: string[] = [];
    for (let i = 0; i < 6; i += 1) { advance(30 * 60_000); await drive(["read_winner_pages"], "winning_pages"); refusals.push(logs.filter((l) => l.includes("no bundle this pass")).at(-1) ?? ""); logs.length = 0; }

    expect(refusals.some((r) => r.includes(FORUM)), `a page the reader will never take was demanded anyway: ${refusals.find((r) => r.includes(FORUM))}`).toBe(false);
    expect(new Set(refusals).size, "a drive that reads a winner leaves a different page to read, so no two drives may give the identical refusal").toBeGreaterThan(1);
    expect(refusals.at(-1), "and once every readable page above it has been read the comparison finishes, so the drive writes instead of asking for one more reading").toBe("");
    const ahead = winnersOf().map((w) => w.url);
    expect(ahead.some((u) => u.includes(FORUM)), "and nothing was fetched from that host either, so the door and the reader agree about what a reading is").toBe(false);
  });
});

describe("the finished work, and recording that the operator applied it", () => {
  /** STEPS EIGHT TO TEN OF THE SEQUENCE, on the account's own captured rows: the packet's evidence reaches the writer, the reading of the finished words is given the same copy and the same page, and
   *  what the drive wrote survives a reload of the canonical store as work the operator can act on. The writer and the reading are scripted; every gate between them is the shipped one. */
  it("9 and 10: the assignment reaches the writer with the packet's evidence, review reads the same material, and the finished copy reloads as Ready", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: [] });
    script.search = searchScript({ ready: true, posts: 0 });
    for (let i = 0; i < 2; i += 1) { advance(30 * 60_000); await drive(["read_winner_pages"], "winning_pages"); }

    const asked = reasoningAsked.filter((a) => a.kind === "atomic_edit").at(-1);
    expect([asked != null, asked?.ask.includes(QUERY) === true, asked?.ask.includes("page-copy-1") === true],
      "the writer is hired for this row's own search and handed the page's stored words under the ids a claim may cite").toEqual([true, true, true]);
    const read = reasoningAsked.filter((a) => a.kind === "editor_judgement").at(-1);
    expect([read != null, read?.ask.includes(WRITER.after) === true, read?.ask.includes(WRITER.claims[0]!.text) === true],
      "and the reading of those words is given the copy itself and the claims it declared, not a summary of them").toEqual([true, true, true]);

    const rows = [...(await loadChangeProposals(T)).values()].filter((r) => (r.pagePath ?? "") === HUB);
    expect(rows.map((r) => r.status), "one change stands for the page, and the copy the drive wrote survives a reload as work the operator can act on").toEqual(["ready"]);
    const change = rows[0]!.recommendedChange;
    expect(change.kind === "existing_edit" && change.after.includes("poets, athletes and screen actors"),
      "and what reloads is the finished copy itself, not a note about it").toBe(true);
  });

  /** STEP TWELVE, through the REAL Changes action: the press the operator makes on the card the drive just wrote. The change keeps the id it was written under, the record names the page and the exact
   *  words that went out, and the row comes back as work under measurement rather than work still to do. */
  it("12: recording the implementation keeps the change's identity and its baseline", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: [] });
    script.search = searchScript({ ready: true, posts: 0 });
    for (let i = 0; i < 2; i += 1) { advance(30 * 60_000); await drive(["read_winner_pages"], "winning_pages"); }
    const ready = [...(await loadChangeProposals(T)).values()].find((r) => (r.pagePath ?? "") === HUB)!;

    const { markProposalImplementedAction } = await import("@/app/(shell)/changes/actions");
    const pressed = await markProposalImplementedAction({ proposalId: ready.id });

    expect(pressed.success, `the press was refused: ${"error" in pressed ? pressed.error : ""}`).toBe(true);
    const after = (await loadChangeProposals(T)).get(ready.id);
    expect([after?.id, after?.status], "the change keeps the identity it was written under and reads as work being measured").toEqual([ready.id, "implemented_pending_verification"]);
    const shipped = table("shipped_change_proof").filter((r) => r.tenant_id === T);
    expect(shipped.length, "and exactly one record stands behind it, so nothing is measured twice").toBe(1);
    const facts = shipped[0] as { page?: string; components_applied?: { after?: string }[] };
    expect([facts.page, (facts.components_applied ?? [])[0]?.after?.includes("poets, athletes and screen actors")],
      "the record names the page it went out on and the exact words that went with it, which is what a later reading compares against").toEqual([`https://${SITE}${HUB}`, true]);
  });
});

describe("a pass that has nothing new to buy", () => {
  it("11: a later pass keeps the finished copy and the readings on file, and buys nothing to do it", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: [] });
    script.search = searchScript({ ready: true, posts: 0 });
    for (let i = 0; i < 2; i += 1) { advance(30 * 60_000); await drive(["read_winner_pages"], "winning_pages"); }
    const held = [...(await loadChangeProposals(T)).values()].find((r) => (r.pagePath ?? "") === HUB)!;
    const after = winnersOf().length, spent = meter.paidUsd, fetches = requestsOf("page"), copy = held.recommendedChange.kind === "existing_edit" ? held.recommendedChange.after : "";

    advance(30 * 60_000);
    await drive(["read_winner_pages"], "winning_pages");

    const again = [...(await loadChangeProposals(T)).values()].find((r) => (r.pagePath ?? "") === HUB);
    expect([again?.id, again?.status], "the finished change stands under the identity it was written with, and a later pass does not send it back to be reviewed").toEqual([held.id, "ready"]);
    expect(winnersOf().length >= after, "nothing already read is thrown away by a later pass").toBe(true);
    expect([meter.paidUsd, again?.recommendedChange.kind === "existing_edit" ? again.recommendedChange.after : ""], "a pass with nothing new to read buys nothing, and the words on file are the words that were written").toEqual([spent, copy]);
    expect(requestsOf("page") <= fetches + winnersOf().length, "a page whose words are on file and fresh is not fetched again").toBe(true);
  });
});

/** THREE ROWS, EACH WAITING ON ITS OWN RESULTS PAGE, AT THE RANKS THE PRODUCTION CASE SAT AT (58, 63 and 66, behind a head that needs no reading). This is the drive-count promise the operator's
 *  correction is about. Under the rule this replaces, the loop stopped at the first gap in the ranking and crossed it at most once a drive, for work the last walk had reached: with no walk behind
 *  the row it crossed nothing, so the first of these was deferred with "the work ranked above this reading needs no reading at all" and none of the three was ever bought. Under one order they are
 *  posted together, collected together, and the row whose last dependency landed is finished on the drive that collected it. */
describe("three opportunities waiting on their own results page", () => {
  const PAGES = [{ path: HUB, query: QUERY, h2: ["Famous Iranian Poets", "Famous Iranian Athletes", "Famous Iranian Actors"] },
    { path: "/persian-male-names", query: "iranian male names", h2: ["Names from poetry", "Names from history", "Names in use today"] },
    { path: "/persian-female-first-names", query: "girl iranian names", h2: ["Names from poetry", "Names from history", "Names in use today"] }] as const;
  /** ONE PROVIDER, THREE TASKS. A post is charged and answers `Task Created`; the free follow-up answers `Ok.` for the search that task was posted for, so which task belongs to which search is the
   *  provider's own bookkeeping and not the test's. */
  const threeTasks = (state: { ready: boolean; posted: string[] }) => { const byId = new Map<string, string>();
    return (path: string, payload: unknown) => {
      const asked = String(((payload as { keyword?: unknown }[] | null)?.[0]?.keyword) ?? "");
      if (path.endsWith("task_post")) { state.posted.push(asked); const id = `task-${state.posted.length}`; byId.set(id, asked); return { body: { status_code: 20000, tasks: [{ id, status_code: 20100, status_message: "Task Created.", cost: 0.0006 }] } }; }
      if (path.includes("task_get")) { const id = path.split("/").pop() ?? "", q = byId.get(id) ?? "";
        return { body: { status_code: 20000, cost: 0, tasks: [{ id, status_code: state.ready ? 20000 : 40602, status_message: state.ready ? "Ok." : "Task in Queue.",
          result: state.ready ? [{ keyword: q, items: [1, 2, 3].map((n) => ({ type: "organic", rank_absolute: n, domain: `ref${n}.example`, url: `https://ref${n}.example/${q.replace(/\s+/g, "-")}`, title: `${q} on ref${n}` })) }] : null }] } }; }
      return { body: { status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{ items: [{ keyword: asked, search_volume: 1200, competition: 0.3, keyword_info: { search_volume: 1200, competition: 0.3 } }] }] }] } }; }; };
  const seedSiblings = (of: readonly typeof PAGES[number][]): void => void seedOwnedPages(of.map((p) => ({ path: p.path, title: `Persian and Iranian ${p.query}`, h1: `Persian and Iranian ${p.query}`, meta: `A named list for ${p.query}.`, h2: [...p.h2],
    body: ["Iran has produced writers, athletes and performers whose work travelled far beyond its borders.", "The poets section lists three poets with a short line on each.", "The athletes section lists wrestlers and weightlifters who won world titles.", "The actors section lists screen performers who worked at home and abroad.", "Each entry gives a name, a period and one sentence about why the person is remembered."].join("\n") })));
  const owedSerp = (p: typeof PAGES[number], rank: number) => ({ key: `${p.path}::body::${p.query}`, kind: "serp" as const, query: p.query, rank, reasonCode: "no_exact_serp",
    reason: `no results page for "${p.query}" is on file`, workKey: `${p.path}::body::${p.query}::wc5::e1`, unlocks: { proposalId: `${T}::${p.path}::existing_edit::demand_recovery`, step: "draft" } });

  it("13: three results pages are posted on one drive and collected on the next, the winner reads follow on that same drive, and the row whose last dependency landed is drafted before the drive ends", async () => {
    const OTHERS = PAGES.slice(1);
    seedSearchHistory(OTHERS.map((p) => ({ path: p.path, query: p.query })));
    seedSiblings(OTHERS);
    seedResearchState(basis, { serps: [], winningPages: [] });
    const state = { ready: false, posted: [] as string[] }; script.search = threeTasks(state);
    const owed = PAGES.map((p, i) => owedSerp(p, [58, 63, 66][i]!)), keys = owed.map((n) => n.key).sort(), mine = (a: { key: string }) => keys.includes(a.key);

    const one = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: owed });
    const posted = [...new Set(acquisitions(one).filter((a) => mine(a) && a.kind === "serp" && a.detail.includes("waiting")).map((a) => a.key))].sort();
    expect([posted, acquisitions(one).filter((a) => a.outcome === "deferred").length],
      "all three results pages are posted on the one drive, each receipt saying the provider is still working on it, and no reading is put off to a later drive").toEqual([keys, 0]);
    const postsAfterOne = PAGES.map((p) => state.posted.filter((q) => q === p.query).length);

    state.ready = true; advance(30 * 60_000);
    const two = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: owedAfter(one, owed) });

    expect([PAGES.map((p) => state.posted.filter((q) => q === p.query).length), postsAfterOne, acquisitions(two).filter((a) => a.outcome === "deferred").length],
      "the drive that finishes them posts none of them again, and none of them is put off: one search is two posted tasks, the results page and the answer above it, each charged at the post and collected with a free follow-up").toEqual([postsAfterOne, [2, 2, 2], 0]);
    const onFile = new Set(serpsOf().filter((x) => x.status === "done").map((x) => x.query));
    expect(PAGES.map((p) => onFile.has(p.query)), "all three searches are on file after that one drive, having cost nothing beyond the posts the drive before them paid for").toEqual([true, true, true]);
    const readFor = (q: string): boolean => winnersOf().some((w) => (w.appearances ?? []).some((a) => a.query === q) && (w.extract?.mainText ?? "").length > 0);
    expect(PAGES.map((p) => readFor(p.query)), "and the winner reads the three collections unlocked follow on the SAME drive, so no page waits another half hour for the reading its comparison needs").toEqual([true, true, true]);
    expect(logs.some((l) => l.includes("the reading landed, so the work that asked for it was drafted in the same turn")),
      "and the row whose last dependency landed is handed to the writer in that same turn, rather than being owed to the next drive").toBe(true);
    expect([...(await loadChangeProposals(T)).values()].filter((r) => (r.pagePath ?? "") === HUB).map((r) => r.status),
      "so the opportunity is finished on the drive that collected its page: two drives from a row waiting on a results page to copy the operator can act on, which is the fewest the deadline allows").toEqual(["ready"]);
  });

  /** THE PURCHASES AHEAD OF THE WALK MAY NOT STARVE THE WALK (operator's rule, 2026-09-06). Production's 19:30Z drive that day bought nine readings before its walk, for rows ranked 84 to 139, and left the
   *  walk its 110-second floor alone: 31 of its 35 funded jobs read that the drive's time box had ended before that page's turn, three hub rows among them whose own results pages and winner reads had landed
   *  on that very drive. The same shape here: three hub rows whose pages are posted and waiting, eleven lower-ranked readings owed beside them, and the drive's own clock advanced only where this file
   *  advances it, so what an arm reads off it is WHICH SIDE OF THE WALK each purchase fell on and what the drive wrote, never how long anything took. */
  it("14: the free collections its hub rows are waiting on are finished in front of the walk, the row those collections unlocked is written on that same drive, and eleven lower-ranked readings take the room behind the walk", async () => {
    const OTHERS = PAGES.slice(1);
    seedSearchHistory(OTHERS.map((p) => ({ path: p.path, query: p.query })));
    seedSiblings(OTHERS);
    seedResearchState(basis, { serps: [], winningPages: [] });
    const state = { ready: false, posted: [] as string[] }; script.search = threeTasks(state);
    const owed = PAGES.map((p, i) => owedSerp(p, [58, 63, 66][i]!));
    const one = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: owed });
    const lower = Array.from({ length: 11 }, (_, i) => ({ key: `/lower-${i}::body::ask-${i}`, kind: "factual_source", query: `lower question ${i}`, url: `/lower-${i}`, missingTopic: `lower topic ${i}`,
      rank: 84 + i * 5, reasonCode: "acquire_factual_source", reason: "owed", workKey: `/lower-${i}::body::ask-${i}::wc5::e1` }));
    state.ready = true; advance(30 * 60_000); logs.length = 0;
    await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [...owedAfter(one, owed), ...lower] });
    const walkAt = logs.findIndex((l) => l.includes("ready inventory checked before buying evidence"));
    const boughtAt = (query: string): number => logs.findIndex((l) => l.includes("a reading bought for one row's own obligation") && l.includes(`"query":"${query}"`));
    expect([walkAt >= 0, PAGES.map((p) => boughtAt(p.query) >= 0 && boughtAt(p.query) < walkAt), lower.map((n) => boughtAt(n.query)).filter((at) => at >= 0 && at < walkAt)],
      "the three pages the hub rows wait on were posted by the drive before, so finishing them costs nothing and all three are collected in front of the walk whatever their rank; and not one of the eleven lower-ranked readings is paid for in front of it, because none of them unlocks a row the last walk reached").toEqual([true, [true, true, true], []]);
    const stillOwed = new Set(((runs[runs.length - 1]!.progress as { evidenceOwed?: { query?: string }[] }).evidenceOwed ?? []).map((n) => String(n.query)));
    expect([reasoningAsked.some((a) => a.kind === "atomic_edit" && a.ask.includes(QUERY)), lower.filter((n) => boughtAt(n.query) > walkAt).length, lower.every((n) => boughtAt(n.query) > walkAt || stillOwed.has(n.query))],
      "the writer is hired for the hub row on the drive its last dependency landed; seven of the eleven are bought behind the walk on that same drive, and every one the room behind it could not pay for is still owed at its own rank for the next drive").toEqual([true, 7, true]);
    expect([...(await loadChangeProposals(T)).values()].filter((r) => (r.pagePath ?? "") === HUB).map((r) => r.status),
      "so the copy the hub row was waiting for reaches the store on that drive, where the eleven purchases in front of the walk used to take its turn").toEqual(["ready"]);
  });
});

/** THE SUBJECT A WINNER COVERS AND THIS PAGE DOES NOT (campaign, 2026-09-06). The ladder files that subject as the row's next dependency and names the winner it found it on. Production then seeded the bare label, searched it as
 *  written, read nothing that answers it and never opened the winner at all: "fact check of the hub page: failed, 0 banked; the answer is still owed", twice, after which the row owed an input nothing could supply. On the captured
 *  rows the same shape: the hub's outline names three kinds of people, the page winning its search names a fourth, and that fourth is what the row is waiting on. */
describe("the subject the winning page carries and this page does not", () => {
  const SUBJECT = "Scientists", RIVAL = "https://en.wikipedia.org/wiki/List_of_Iranians";
  const SAYS = "Famous Iranians who worked as scientists are listed here by the field each of them worked in, with the years they worked.";
  /** The winner answers the body read the fact engine makes, in the provider's own content-parsing shape; everything else is the ordinary search script. */
  const factScript = (state: { ready: boolean; posts: number; parsed: string[] }) => (path: string, payload: unknown) => {
    if (path.startsWith("on_page/content_parsing")) { state.parsed.push(String((payload as { url?: string }[] | null)?.[0]?.url ?? ""));
      return { body: { status_code: 20000, cost: 0.002, tasks: [{ status_code: 20000, result: [{ items: [{ page_content: { main_topic: [{ main_title: "List of Iranians", h_title: SUBJECT, primary_content: [{ text: SAYS }] }] } }] }] }] } }; }
    return searchScript(state)(path); };
  it("15: the missing subject is researched in the frame of the row's own search, from the winner that carries it, in one acquisition that buys no search, and what it banks is evidence the writer it then hires may stand on", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: [] });
    const state = { ready: true, posts: 0, parsed: [] as string[] }; script.search = factScript(state);
    script.reasoning = (body) => reasoningReply({ ...REASONING, fact_claim_extraction: { statements: [] },
      fact_claim_judgement: { verdict: "page_correct", proposed: SAYS, confidence: "confirmed", note: "", supporting: [{ url: RIVAL, quote: SAYS, supported: true, supportSpan: SAYS, subjectSpan: `${QUERY} ${SUBJECT}`, subjectFrom: "quote", relationSpan: "", meaningSpans: [] }],
        subjects: [{ url: RIVAL, sameEntity: true, language: "English", script: null, why: "the article covers the people this subject is about" }] } }, body);
    const need = { key: `${HUB}::body::${QUERY}`, kind: "factual_source", query: `${SUBJECT} ${QUERY}`, url: `https://${SITE}${HUB}`, missingTopic: SUBJECT, rivalUrl: RIVAL, rank: 1,
      reasonCode: "missing_information", reason: `nothing checked on file answers "${SUBJECT}"`, workKey: `${HUB}::body::${QUERY}::wc5::e1`, unlocks: { proposalId: `${T}::${HUB}::existing_edit::demand_recovery`, step: "draft" } };

    const run = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need] });

    const mine = acquisitions(run).filter((a) => a.kind === "factual_source");
    expect([mine.length, mine[0]?.outcome, state.parsed, state.posts],
      "one acquisition serves the row: the winner the requirement named is the one page read for it, and no results page is bought to rediscover a page the row already names").toEqual([1, "unlocked", [RIVAL], 0]);
    const banked = table("page_source_facts").filter((r) => String(r.subject ?? "").toLowerCase().includes(SUBJECT.toLowerCase()));
    expect([banked.length, banked[0]?.subject, banked[0]?.claim_state, banked[0]?.proposed, (banked[0]?.sources as { url: string }[] | undefined)?.map((x) => x.url)],
      "and what is banked is the missing subject carried in the frame of the search the row is about, answered in the winner's own words with the winner named behind it").toEqual([1, `${QUERY} ${SUBJECT}`, "checked", SAYS, [RIVAL]]);
    const held = await readFactChecks(T), body = (await loadOwnedPageBodies(T, [`https://${SITE}${HUB}`])).get(canonicalUrlKey(`https://${SITE}${HUB}`))!;
    const version = pageHashOf([body.title, body.h1, ...(body.headings ?? []), ...(body.passages ?? [])].filter(Boolean).join("\n"));
    expect([authorizedCorrections(held, { pageContentHash: version, evidenceBasis: await resolveCurrentBasis(T) }, T).map((f) => f.subject), reasoningAsked.some((a) => a.kind === "atomic_edit"), reasoningAsked.filter((a) => a.kind === "atomic_edit").some((a) => /\bfact-1\b/.test(a.ask) && a.ask.includes(SAYS))],
      "the fact stands against the page as this drive read it and under the basis the drafting pass works in, so it is evidence a writer's packet may carry under a fact-* id; the row's next step on this same drive is that writer; and the writer hired for this hub page is handed that fact under fact-1 in the winner's own words (journey review, 2026-09-06: the editor the bundle producer hires was handed sibling passages alone)").toEqual([[`${QUERY} ${SUBJECT}`], true, true]);
  });
});

describe("the section the winner carries, read where it starts", () => {
  const SUBJECT = "Scientists", RIVAL = "https://en.wikipedia.org/wiki/List_of_Iranians";
  const SAYS = "Famous Iranians who worked as scientists are listed here by the field each of them worked in, with the years they worked.";
  const INTRO_LINE = "This is a general list of notable people from Iran and its historical predecessors, ordered by field and by era.";
  /** A long introduction dense in the search's own words, which is where the old window landed: the densest region of the page, never the section the requirement named. */
  const INTRO = Array(60).fill(`${INTRO_LINE} Famous Iranians and Persians appear across every era of Iranian history, and the famous Iranians of each field are grouped below.`).join(" ");
  const longPage = (state: { ready: boolean; posts: number; parsed: string[] }) => (path: string, payload: unknown) => {
    if (path.startsWith("on_page/content_parsing")) { state.parsed.push(String((payload as { url?: string }[] | null)?.[0]?.url ?? ""));
      return { body: { status_code: 20000, cost: 0.002, tasks: [{ status_code: 20000, result: [{ items: [{ page_content: { main_topic: [{ main_title: "List of Iranians", h_title: "Introduction", primary_content: [{ text: INTRO }] }, { main_title: "List of Iranians", h_title: SUBJECT, primary_content: [{ text: SAYS }] }] } }] }] }] } }; }
    return searchScript(state)(path); };
  it("16: the winner's own heading opens the source window on its section, past an introduction the search's words are densest in, so the judge reads the words under the heading and not the page's opening", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: [] });
    const state = { ready: true, posts: 0, parsed: [] as string[] }; script.search = longPage(state);
    script.reasoning = (body) => reasoningReply({ ...REASONING, fact_claim_extraction: { statements: [] },
      fact_claim_judgement: { verdict: "page_correct", proposed: SAYS, confidence: "confirmed", note: "", supporting: [{ url: RIVAL, quote: SAYS, supported: true, supportSpan: SAYS, subjectSpan: `${QUERY} ${SUBJECT}`, subjectFrom: "quote", relationSpan: "", meaningSpans: [] }],
        subjects: [{ url: RIVAL, sameEntity: true, language: "English", script: null, why: "the article covers the people this subject is about" }] } }, body);
    const need = { key: `${HUB}::body::${QUERY}`, kind: "factual_source", query: `${SUBJECT} ${QUERY}`, url: `https://${SITE}${HUB}`, missingTopic: SUBJECT, rivalUrl: RIVAL, rank: 1,
      reasonCode: "missing_information", reason: `nothing checked on file answers "${SUBJECT}"`, workKey: `${HUB}::body::${QUERY}::wc5::e1`, unlocks: { proposalId: `${T}::${HUB}::existing_edit::demand_recovery`, step: "draft" } };
    const run = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need] });
    const judged = reasoningAsked.filter((a) => a.kind === "fact_claim_judgement");
    const ask = judged[0]?.ask ?? "", intros = ask.split(INTRO_LINE).length - 1;
    expect([state.parsed, judged.length, ask.includes(SAYS), ask.includes(`${SUBJECT} ${SAYS}`), intros > 0 && intros < 20],
      "the winner the requirement named is the one page read; the judge is asked once; its passage opens on the heading the requirement named with the words under it, carrying only the tail of the introduction the search's words are densest in, where the old window carried that introduction and never the section").toEqual([[RIVAL], 1, true, true, true]);
    expect(acquisitions(run).filter((a) => a.kind === "factual_source").map((a) => a.outcome), "and the reading lands as usable evidence on the first attempt").toEqual(["unlocked"]);
  });

  it("17: a subject judged undecidable before the anchor existed, whose passages carried no word of it, is read once more where its heading starts and then never re-read", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: [] });
    const state = { ready: true, posts: 0, parsed: [] as string[] }; script.search = longPage(state);
    script.reasoning = (body) => reasoningReply({ ...REASONING, fact_claim_extraction: { statements: [] },
      fact_claim_judgement: { verdict: "page_correct", proposed: SAYS, confidence: "confirmed", note: "", supporting: [{ url: RIVAL, quote: SAYS, supported: true, supportSpan: SAYS, subjectSpan: `${QUERY} ${SUBJECT}`, subjectFrom: "quote", relationSpan: "", meaningSpans: [] }],
        subjects: [{ url: RIVAL, sameEntity: true, language: "English", script: null, why: "the article covers the people this subject is about" }] } }, body);
    const need = { key: `${HUB}::body::${QUERY}`, kind: "factual_source", query: `${SUBJECT} ${QUERY}`, url: `https://${SITE}${HUB}`, missingTopic: SUBJECT, rivalUrl: RIVAL, rank: 1,
      reasonCode: "missing_information", reason: `nothing checked on file answers "${SUBJECT}"`, workKey: `${HUB}::body::${QUERY}::wc5::e1`, unlocks: { proposalId: `${T}::${HUB}::existing_edit::demand_recovery`, step: "draft" } };
    // THE PRODUCTION ROW, AS THE HUB CARRIED IT ON 2026-09-06: read once, no passage found, banked checked/undecidable with nothing read behind it, at this page version and under the rules its own shape is judged by, so every later drive answered "already researched" and nothing was ever read again.
    const owner = (await loadOwnedPageBodies(T, [`https://${SITE}${HUB}`])).get(canonicalUrlKey(`https://${SITE}${HUB}`))!;
    const version = pageHashOf([owner.title, owner.h1, ...(owner.headings ?? []), ...(owner.passages ?? [])].filter(Boolean).join("\n"));
    const subject = `${QUERY} ${SUBJECT}`;
    table("page_source_facts").push({ tenant_id: T, page_key: HUB, statement_key: claimIdentity(subject, "", "missing"), subject, current_wording: "", proposed: null,
      sources: [], agreement: "none_found", confidence: "unsupported", verdict: "undecidable", also_at: [], note: "No fetched passage carries a quote it relied on.",
      page_content_hash: version, page_locator: "missing", source_read_at: null, claim_state: "checked", rules_version: rulesVersionFor({ subject, current: "" }),
      evidence_basis: await resolveCurrentBasis(T), checked_at: "2026-09-06T12:00:00.000Z", superseded_at: null });

    const first = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need] });
    const banked = (await readFactChecks(T)).find((h) => h.statementKey === claimIdentity(subject, "", "missing"));
    expect([reasoningAsked.filter((a) => a.kind === "fact_claim_judgement").length, state.parsed, banked?.state, banked?.verdict, banked?.sourceReadAt != null,
      acquisitions(first).filter((a) => a.kind === "factual_source").map((a) => a.outcome)],
      "the settled row is reopened and read once more from the winner the requirement names, and what comes back is an answer with a source behind it").toEqual([1, [RIVAL], "checked", "page_correct", true, ["unlocked"]]);

    const second = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need] });
    expect([reasoningAsked.filter((a) => a.kind === "fact_claim_judgement").length, state.parsed, state.posts,
      acquisitions(second).filter((a) => a.kind === "factual_source").map((a) => a.outcome)],
      "and the drive after it stands on the answer already on file: the requirement unlocks its writer again with no judge asked, no winner fetched and no results page bought, which is the zero-spend rule the receipt promises").toEqual([1, [RIVAL], 0, ["unlocked"]]);
  });
});

describe("the clock the drives share", () => {
  it("advancing it is what makes a later drive later, so the whole sequence runs without waiting for a tick", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: [] });
    script.search = searchScript({ ready: true, posts: 0 });
    const at0 = clock.ms;
    await drive(["read_winner_pages"], "winning_pages");
    advance(30 * 60_000);
    const second = await drive(["read_winner_pages"], "winning_pages");
    expect([clock.ms - at0, runs.length >= 2, Date.parse(second.started_at) > at0 - 1], "two drives half an hour apart, inside one test cycle").toEqual([1_800_000, true, true]);
  });
});
