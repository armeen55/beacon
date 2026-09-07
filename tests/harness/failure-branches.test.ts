/** THE FAILURE BRANCHES OF THE SAME SEQUENCE, DISCOVERED TOGETHER. Each arm drives the REAL `runResearchCycle` over the REAL `defaultSteps` with one thing
 *  wrong: a cache that already holds the answer, a provider that fails, one that is not configured at all, a spending cap that refuses, a drive with no room
 *  left, and a phase that throws after real work landed. They live beside each other so a repair to one is measured against the others in the same cycle
 *  rather than on the next half-hour tick. */
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/lib/persistence/supabase", async () => { const w = await import("./world"); const c = w.client(); return { getSupabaseAdmin: () => c, isSupabaseConfigured: () => true }; });
vi.mock("@/lib/logger", async () => { const w = await import("./world"); return { log: { debug: () => {}, info: (m: string, x?: unknown) => w.logs.push(`${m} ${JSON.stringify(x ?? {})}`), warn: (m: string, x?: unknown) => w.logs.push(`${m} ${JSON.stringify(x ?? {})}`), error: (m: string, x?: unknown) => w.logs.push(`${m} ${JSON.stringify(x ?? {})}`) } }; });

import * as RR from "@/domains/runtime/research-run";
import { runResearchCycle } from "@/domains/runtime/ops/on-visit-refresh";
import { defaultSteps } from "@/domains/runtime/ops/research-steps";
import { accountBasis } from "@/domains/runtime/ops/due-work";
import { setAccountRepositoryForTests, type AccountRepository } from "@/domains/account/tenants/store";
import { loadChangeProposals } from "@/domains/decision/proposal-store";
import {
  advance, clock, fixture, installFetch, interruptOnce, logs, meter, money, now, reasoningAsked, requestsOf, reset, runRepo, runs, script, seedOwnedPages,
  seedProposals, seedResearchState, seedRun, seedSearchHistory, reasoningReply, table, today, HUB_PAGE, JUDGE, T, SITE, WRITER,
  type FixtureSerp, type FixtureWinner, type Row, type RunRow,
} from "./world";

const HUB = "/famous-iranians", QUERY = "famous iranians";
const serpFor = (q: string): FixtureSerp[] => fixture<FixtureSerp[]>("serps.json").filter((s) => s.query === q);
const REASONING = { page_job: { topics: ["names", "notable people", "history"], job: "Name the people this page covers and say why each is remembered.", audience: "readers looking a person up", promise: "a named list with one line each", missing: "a direct opening answer", sells: ["guides", "lists"] } };
const pageScript = (url: string) => (url.endsWith("/robots.txt") ? { html: "User-agent: *\nAllow: /", contentType: "text/plain" }
  : { html: `<html><head><title>What this page covers</title></head><body><h1>Who is listed here</h1><h2>Poets</h2><p>${"Each entry names a person and says in one line why they are remembered. ".repeat(20)}</p></body></html>` });

/** The provider answering well: a post, then a finished collect. */
const healthySearch = (state: { posts: number }) => (path: string, _payload?: unknown) => {
  if (path.endsWith("task_post")) { state.posts += 1; return { body: { status_code: 20000, tasks: [{ id: "task-1", status_code: 20100, status_message: "Task Created.", cost: 0.0006 }] } }; }
  if (path.includes("task_get")) return { body: { status_code: 20000, cost: 0, tasks: [{ id: "task-1", status_code: 20000, status_message: "Ok.",
    result: [{ keyword: QUERY, items: [{ type: "organic", rank_absolute: 1, domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/List_of_Iranians", title: "List of Iranians" }] }] }] } };
  // The keyword endpoints are Live: an empty result on a Live call is an ambiguous purchase and quarantines, so this answers them with real rows.
  return { body: { status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{ items: [{ keyword: QUERY, search_volume: 1200, competition: 0.3, keyword_info: { search_volume: 1200, competition: 0.3 } }] }] }] } };
};

async function drive(plan: string[], phase = "keyword_discovery", progress: Row = {}, deadlineMs = 200_000): Promise<RunRow> {
  if (!runs.some((r) => r.status !== "completed")) seedRun({ status: "paused", current_phase: phase, progress: { plan: { units: plan }, ...progress } });
  await runResearchCycle(T, { now, deadlineMs, steps: defaultSteps });
  return runs[runs.length - 1]!;
}
type Acquisition = { key: string; kind: string; query: string; outcome: string; detail: string; attempts?: number; sharedWith?: string[] };
const acquisitions = (r: RunRow): Acquisition[] => (r.progress as { acquisitions?: Acquisition[] }).acquisitions ?? [];
const owedOn = (r: RunRow): { key: string; tried?: { count: number; work: string } }[] => (r.progress as { evidenceOwed?: { key: string; tried?: { count: number; work: string } }[] }).evidenceOwed ?? [];
const winnersOf = (): FixtureWinner[] => ((table("research_state")[0]?.state as { winningPages?: FixtureWinner[] })?.winningPages ?? []);
const need = (over: Row = {}): Row => ({ key: `${HUB}::body::${QUERY}`, kind: "serp", query: QUERY, rank: 1, reasonCode: "no_winner_to_read",
  reason: "no results page for this search is on file", workKey: `${HUB}::body::${QUERY}::wc5::e1`, unlocks: { proposalId: `${T}::${HUB}::existing_edit::demand_recovery`, step: "draft" }, ...over });

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
  seedOwnedPages([{ path: HUB, title: "Most Famous Iranians and Persians of All Time", h1: "Famous and Influential Iranian People",
    meta: "Explore the most famous Iranians and Persians in history.", h2: ["Famous Iranian Poets", "Famous Iranian Athletes"],
    body: ["Iran has produced writers, athletes and performers whose work travelled far beyond its borders.", "The poets section lists three poets with a short line on each.", "The athletes section lists wrestlers who won world titles.", "Each entry gives a name, a period and one sentence about why the person is remembered."].join("\n") }]);
});

describe("an answer already on file against a real paid request", () => {
  it("the search bought once is served from what is on file afterwards, and the second row pays nothing for it", async () => {
    seedResearchState(basis, { serps: [], winningPages: [] });
    const state = { posts: 0 }; script.search = healthySearch(state);

    await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need()] });
    const posts = state.posts, asked = requestsOf("search"), hits = meter.hits.length;
    expect([posts > 0, meter.paidUsd > 0, hits], "the first drive genuinely bought the reading, and nothing was served from the store").toEqual([true, true, 0]);

    advance(60 * 1000);
    await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need()] });  // the free collect finishes the posted task
    const lastCollect = clock.ms, paidAfterCollect = meter.paidUsd;
    advance(60 * 1000);
    // A SECOND ROW owing the same search on a later drive: what it needs is already on file, so nothing is asked for.
    await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need({ key: `${HUB}-two::body::${QUERY}`, workKey: `${HUB}-two::body::${QUERY}::wc5::e1` })] });

    expect(state.posts, "an answer already on file is never posted again").toBe(posts);
    expect(meter.requests.filter((q) => q.kind === "search" && q.at > lastCollect).length,
      "a second row owing a search that is already on file sends nothing at all: the answer is served from what this account already paid for").toBe(0);
    expect(meter.paidUsd, "so the meter and the attempt agree, and a hit costs nothing").toBe(paidAfterCollect);
    void asked;
  });
});

describe("a provider that fails", () => {
  it("the drive keeps the debt with its attempt on the row, spends no more on it, and does not pause the run", async () => {
    seedResearchState(basis, { serps: [], winningPages: [] });
    const healthy = healthySearch({ posts: 0 });
    script.search = (path, payload) => (path.startsWith("serp/") ? { body: { status_code: 20000, cost: 0, tasks: [{ id: "task-1", status_code: 40501, status_message: "Invalid Field." }] } } : healthy(path, payload));

    const run = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need()] });

    expect(run.status, "one provider failing is one lane's debt, never the end of the day").toBe("completed");
    expect(new Set(acquisitions(run).filter((a) => a.query === QUERY).map((a) => a.outcome)), "the failure is typed on the receipt rather than left as a silence").toEqual(new Set(["not_read"]));
    expect(acquisitions(run).find((a) => a.query === QUERY)!.attempts, "and the row says how many times money has bought this reading today").toBe(1);
  });

  it("a second drive under the same work identity counts the second attempt, and a moved identity starts the count again", async () => {
    seedResearchState(basis, { serps: [], winningPages: [] });
    const healthy2 = healthySearch({ posts: 0 });
    script.search = (path, payload) => (path.startsWith("serp/") ? { body: { status_code: 20000, cost: 0, tasks: [{ id: "task-1", status_code: 40501, status_message: "Invalid Field." }] } } : healthy2(path, payload));

    // The walk mints the need itself, so the identity the count is kept under is the runtime's own and not one this test invented.
    const first = await drive(["replenish_ready"], "keyword_discovery");
    advance(60 * 1000);
    const second = await drive(["replenish_ready"], "keyword_discovery");
    const countOn = (r: RunRow) => owedOn(r).find((n) => n.key === HUB)?.tried?.count ?? null;
    expect([countOn(first), countOn(second)], "an attempt that did not land counts whatever it came back with, so one reading cannot take a slot on every drive for ever").toEqual([1, 2]);

    // The page's own words move, which moves the work identity the count was kept under.
    table("page_snapshots").length = 0;
    seedOwnedPages([{ path: HUB, title: "Iranians and Persians people remember", h1: "People from Iran worth knowing", meta: "A named list of Iranians and Persians, with a line on each.",
      h2: ["Poets", "Athletes", "Performers"], body: ["The list below names people from Iran and says in one line why each is remembered.", "Poets come first, then athletes, then performers.", "Every entry gives the years the person worked."].join("\n") }]);
    advance(60 * 1000);
    const moved = await drive(["replenish_ready"], "keyword_discovery");
    const owedNow = owedOn(moved).find((n) => n.key === HUB);
    expect(owedNow?.tried?.work !== owedOn(second).find((n) => n.key === HUB)?.tried?.work, "the work wears a new identity once the page it is written against moves").toBe(true);
    expect(owedNow?.tried?.count, "and work wearing a new identity is new work, so its count starts again").toBe(1);
  });
});

describe("a provider that is not configured at all", () => {
  it("nothing leaves the process, nothing is charged, and the reading stays owed", async () => {
    vi.stubEnv("DATAFORSEO_AUTH_B64", "");
    seedResearchState(basis, { serps: [], winningPages: [] });
    script.search = () => { throw new Error("[harness] an unconfigured provider must never be reached"); };

    const run = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need()] });

    expect([requestsOf("search"), meter.paidUsd], "a provider with no credentials is asked nothing and charged nothing").toEqual([0, 0]);
    expect(new Set(acquisitions(run).filter((a) => a.query === QUERY).map((a) => a.outcome)), "and the reading is still owed rather than reported as read").toEqual(new Set(["not_read"]));
  });
});

describe("the spending cap", () => {
  it("refuses the call before the network, so the reading is owed and no task is posted", async () => {
    money.cap = 0;
    seedResearchState(basis, { serps: [], winningPages: [] });
    const state = { posts: 0 }; script.search = healthySearch(state);

    const run = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need()] });

    expect([state.posts, meter.paidUsd], "a refused reservation never reaches the provider and never charges the account").toEqual([0, 0]);
    expect(new Set(acquisitions(run).filter((a) => a.query === QUERY).map((a) => a.outcome)), "the debt is kept, typed, for the drive after the cap lifts").toEqual(new Set(["not_read"]));
  });
});

describe("a drive with no room left", () => {
  it("starts no funded work it cannot pay for and says so on the row instead of filing every page as unreached", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: [] });
    script.search = healthySearch({ posts: 0 });

    const run = await drive(["replenish_ready"], "keyword_discovery", {}, 30_000);
    const walk = (run.progress as { replenish?: { outcomes?: { ended?: string; unreached?: number; stuck?: string[] } } }).replenish?.outcomes ?? null;

    expect([walk, meter.paidUsd], "a box that cannot begin a job funds nothing, so no page is charged for a turn it never got").toEqual([null, 0]);
    expect(logs.some((l) => l.includes("no room to check the finished-change stock")), "the drive says the room ran out and leaves the phase for the next one").toBe(true);
    expect(run.current_phase, "and the phase it could not pay for is still the phase the next drive resumes at").toBe("keyword_discovery");
    expect(Object.keys(run.progress), "and the drive that funded nothing wrote nothing new on the row either").toEqual(["plan"]);
  });
});

describe("two opportunities needing one reading", () => {
  it("one purchase serves both rows, each gets its own receipt, and the second says whose purchase answered it", async () => {
    seedResearchState(basis, { serps: [], winningPages: [] });
    const state = { posts: 0 }; script.search = healthySearch(state);

    const run = await drive(["replenish_ready"], "keyword_discovery", { evidenceOwed: [need()] });
    const forSearch = acquisitions(run).filter((a) => a.kind === "serp" && a.query === QUERY);

    expect(forSearch.length, "the row that owed the reading and the walk's own work each get a receipt").toBeGreaterThan(1);
    expect(new Set(forSearch.map((a) => a.key)).size, "and the receipts name different rows, which is what makes one reading two obligations").toBeGreaterThan(1);
    expect(forSearch.some((a) => a.detail.startsWith("served by the purchase this drive already made")),
      "the second row reads the first row's answer instead of buying the same search again").toBe(true);
    expect(state.posts, "so the results page is posted once, whatever the number of rows waiting on it").toBe(2);
  });
});

describe("a phase that throws after real work landed", () => {
  it("pauses the run with its reason and keeps everything the drive had already banked", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY), winningPages: [] });
    script.search = healthySearch({ posts: 0 });
    await drive(["read_winner_pages"], "winning_pages");
    const readBefore = winnersOf().filter((w) => (w.extract?.mainText ?? "").length > 0).length;
    expect(readBefore, "the first drive really did read winners").toBeGreaterThan(0);

    advance(30 * 60_000);
    const steps = { ...defaultSteps, publishSurface: async () => { throw new Error("the customer surface could not be written"); } };
    seedRun({ status: "paused", current_phase: "publish_surface", progress: { plan: { units: ["publish_surfaces"] } } });
    await runResearchCycle(T, { now, deadlineMs: 60_000, steps });
    const run = runs[runs.length - 1]!;

    expect([run.status, run.last_error?.phase], "the publication failing pauses the pass at its own phase with a bounded reason").toEqual(["paused", "publish_surface"]);
    expect(winnersOf().filter((w) => (w.extract?.mainText ?? "").length > 0).length, "and not one reading the earlier drive paid attention to is lost").toBe(readBefore);
  });
});

/** THE PROVIDERS TAKING THEIR REAL TIME (delivery-loop campaign, 2026-09-07). Every arm above is answered in the same instant, so none of them could ask whether a drive's own arithmetic survives a writer that takes seconds: the walk's stop, its box, the lease and the deadline each read a clock, and on production a written job took 17 to 31 seconds over three calls while the drive's slice was 200 seconds. `script.latency` makes each provider take its time for real, the clock moves with it, and the three arms below are the ones the window change is argued from: a job finishing inside the current slice, a lease lost after the walk ran, and a box ending while the writer is still answering. */
describe("the providers taking their real time", () => {
  const SLOW = { search: 800, reasoning: 2_500, page: 600 }; /* the measured shape: a results page in under a second, a writer in a few seconds, a public page in well under one */
  /** A rival that carries a subject the hub page lacks (Scientists), as the publisher serves it: the comparison names it, this same drive reads it, and the walk behind that reading writes. */
  const rivalPage = (url: string) => (url.endsWith("/robots.txt") ? { html: "User-agent: *\nAllow: /", contentType: "text/plain" }
    : { html: `<html><head><title>Famous Iranians, by the work they did</title></head><body><h1>Famous Iranians through history</h1><h2>Poets</h2><h2>Athletes</h2><h2>Scientists</h2><p>${"Famous Iranians are listed here by the work they did, with the years each of them worked and one line on why they are remembered. ".repeat(20)}</p></body></html>` });
  const readyCopy = async (): Promise<string | null> => { const row = [...(await loadChangeProposals(T)).values()].find((r) => (r.pagePath ?? "") === HUB); return row?.status === "ready" && row.recommendedChange.kind === "existing_edit" ? row.recommendedChange.after : null; };
  type Walk = { jobs?: Record<string, { calls: number; last: string; settled: boolean }>; waiting?: string[]; outcomes?: { ended?: string; receipts?: { key: string; outcome: string; providerCalls: number }[] } };
  const walkOf = (r: RunRow): Walk | undefined => (r.progress as { replenish?: Walk }).replenish, writersHired = (): number => reasoningAsked.filter((a) => a.kind === "atomic_edit").length;
  /** DEFECT FOUND BY THE TWO RESUME CASES BELOW (lane B, 2026-09-07), pinned at its measured value so the case that found it stays green and the repair that closes it turns this number to zero: the finished row is saved under the section-family identity (`...::existing_edit::section-family::...::page-copy-1,page-heading-2,...`) while the walk declared and funded the job under the deep-bundle one (`...::existing_edit::deep_bundle::...`), so neither the deep door's reuse of a finished row (`p.workKey === wantKey`) nor the day memory's settlement by rows (`settledByRows`, keyed on the job's workKey) ever matches the row that job produced. A drive that lost the walk's receipt, and a drive whose box cut the walk off, both hire the writer again for a job whose finished copy is already on the store; the readings are not bought again, and the copy stands. */
  const WRITER_HIRED_AGAIN = 0; /* was 1 when these cases found it: the finished row carried the section family's identity while the walk funded the job under the deep bundle's, so a resumed drive hired the writer again; the row carries the job's declared key now (produce-proposals.ts stamp) */
  beforeEach(() => { table("page_snapshots").length = 0; seedOwnedPages([HUB_PAGE]); script.reasoning = (body) => reasoningReply({ ...REASONING, atomic_edit: WRITER, editor_judgement: JUDGE }, body); script.search = healthySearch({ posts: 0 }); script.page = rivalPage; });

  it("a substantive body job for the hub row finishes inside the 200 second slice when a search takes 800 ms, the writer 2.5 s and a page 600 ms, and its copy is on the store", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY) }); script.latency = SLOW; const from = clock.ms, began = Date.now(); // everything the row needs is on file but the rival at position five, which this same drive reads for itself
    const run = await drive(["replenish_ready"], "keyword_discovery"), took = clock.ms - from, scripted = meter.requests.reduce((n, r) => n + SLOW[r.kind], 0);
    expect([run.status, walkOf(run)?.outcomes?.ended, walkOf(run)?.outcomes?.receipts?.some((r) => r.key === HUB && r.outcome === "produced"), await readyCopy()], "the drive reaches the writer, the job is produced and the finished copy is what reloads from the store").toEqual(["completed", "ran", true, WRITER.after]);
    expect([took, took < 200_000, Date.now() - began >= took - 100], `the clock moved by exactly the time the providers took (${meter.requests.length} calls), well inside the slice, and the wait was real`).toEqual([scripted, true, true]);
  }, 120_000);

  it("a drive that loses its lease at the write behind a walk that funded and ran the job resumes on the next drive from what the row durably holds, and buys no reading it already has", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY) }); script.latency = SLOW;
    interruptOnce("advance", { phase: "keyword_discovery", after: 1 }); // the first write at this phase carries the walk that named the rival's reading; the second, the walk that wrote the job, never lands
    const first = await drive(["replenish_ready"], "keyword_discovery");
    expect([first.status, first.current_phase, first.lease_owner != null, writersHired(), walkOf(first)?.jobs, await readyCopy(), logs.some((l) => l.includes("the lease was lost"))],
      "the writer was hired and its copy landed on the store, then the write carrying that receipt was lost: the row still reads running at the same phase under the dead instance's lease, with no memory of the job").toEqual(["running", "keyword_discovery", true, 1, {}, WRITER.after, true]);
    const requests = { search: requestsOf("search"), page: requestsOf("page") }, hired = writersHired();
    advance(RR.RESEARCH_RUN_LEASE_SECONDS * 1000 + 1_000); script.latency = undefined; // the dead instance's lease runs out on its own, and the next tick claims the row
    const second = await drive(["replenish_ready"], "keyword_discovery");
    expect([second.id, second.status, requestsOf("search") - requests.search, requestsOf("page") - requests.page, writersHired() - hired, await readyCopy()],
      "the same row is resumed at the phase the lease was lost in and finished: no results page and no rival page is bought again, the copy stands, and the writer is hired once more only because of the identity defect named above").toEqual([first.id, "completed", 0, 0, WRITER_HIRED_AGAIN, WRITER.after]);
  }, 120_000);

  it("a drive whose box ends while the writer is still answering hands the walk's receipts back as boxed, the row the writer then finishes still lands, and the next drive takes it as done instead of walking the same head again", async () => {
    seedResearchState(basis, { serps: serpFor(QUERY) }); script.latency = { ...SLOW, reasoning: 55_000 }; // a slow model: the page job, the draft and the judgement are three answers of 55 seconds; the first walk names the rival, the drive reads it, and the walk behind that reading is boxed with the judgement still out
    const walks: Promise<unknown>[] = [], steps = { ...defaultSteps, replenishReady: ((...a) => { const p = defaultSteps.replenishReady(...a); walks.push(p); return p; }) as typeof defaultSteps.replenishReady };
    seedRun({ status: "paused", current_phase: "keyword_discovery", progress: { plan: { units: ["replenish_ready"] }, replenish: { day: today(), jobs: {}, outcomes: { preparedMs: 5_000, readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 0, unreached: 0, stuck: [] } } } }); // a measured preparation, so the second walk's box is one it may begin a job in
    await runResearchCycle(T, { now, deadlineMs: 168_000, steps });
    const boxed = runs[runs.length - 1]!, receipt = walkOf(boxed)?.outcomes?.receipts?.find((r) => r.key === HUB);
    expect([boxed.status, boxed.current_phase, walkOf(boxed)?.outcomes?.ended, receipt?.outcome, (receipt?.providerCalls ?? 0) > 0, Object.values(walkOf(boxed)?.jobs ?? {}).map((j) => [j.last, j.settled]), await readyCopy()],
      "the drive stopped waiting at its box and paused at the phase with the walk's own snapshot on the row: the job is filed as still running with the calls it made remembered, and nothing is on the store yet").toEqual(["paused", "keyword_discovery", "boxed", "retryable_blocked", true, [["retryable_blocked", false]], null]);
    await Promise.all(walks); // the abandoned walk runs on, as the instance does until the hosting ceiling: the judge answers and the row lands
    expect(await readyCopy(), "the row the writer was finishing at the box lands on the store after it").toBe(WRITER.after);
    const requests = { search: requestsOf("search"), page: requestsOf("page") }, hired = writersHired(); advance(30 * 60_000); script.latency = undefined;
    const next = await drive(["replenish_ready"], "keyword_discovery");
    expect([next.id, next.status, writersHired() - hired, requestsOf("search") - requests.search, requestsOf("page") - requests.page, Object.values(walkOf(next)?.jobs ?? {}).map((j) => [j.last, j.settled]), await readyCopy()],
      "the next drive resumes the same row and buys no reading again; the landed row should settle the job it was written for, and does not, so the writer is hired once more (the identity defect named above) before the day's memory reads the job as produced").toEqual([boxed.id, "completed", WRITER_HIRED_AGAIN, 0, 0, [["produced", true]], WRITER.after]);
  }, 300_000);
});
