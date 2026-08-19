/** VISIBILITY. What a customer READS on the one surface that answers "where do I stand, and why": headline numbers that
 *  name their own denominator, EVERY page that moved, every search Google named, the questions I ask the assistants with
 *  the runs behind them, and the whole of one run. Fixtures only, no clock, no dash, no lab word, no provider call. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseFake, type Row } from "../helpers/supabase-fake";
import { renderToStaticMarkup } from "react-dom/server";
const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], reads: [] as { max: number; cols: string }[], fetched: [] as unknown[] }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => supabaseFake({
  rows: () => store.rows, onSelect: (_t, r) => { store.reads.push({ max: r.max, cols: r.cols }); } }) }));
globalThis.fetch = (async (...a: unknown[]) => { store.fetched.push(a); throw new Error("no provider call is allowed from Visibility"); }) as typeof fetch;
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "acct-a" }));
vi.mock("@/domains/account", () => ({ requireReadyAccount: async () => ({ access: { kind: "ready" } }), loadBusinessProfile: async () => null }));
vi.mock("@/domains/decision", () => ({ loadDailyTotalsForTenant: async () => [] }));
vi.mock("@/domains/runtime", () => ({ researchRunStatus: async () => null, researchPermission: async () => "running" }));
vi.mock("@/domains/measurement", () => ({ visibilitySeries: async () => SEGMENTS }));
import type { AiOutcomeReport } from "@/domains/measurement";
import { buildFanoutEvidence, canonicalQueryKey } from "@/domains/evidence";
import { aiView, answerDetail, googleView, type AnswerRow } from "@/app/(shell)/visibility/visibility-view";
import VisibilityPage from "@/app/(shell)/visibility/page"; import type { ReactElement } from "react";

type Day = AiOutcomeReport["segments"][number]["days"][number];
const day = (d: string, r: number | null, over: Partial<Day> = {}): Day => ({ day: d, observed: 10, analyzed: 10, mentioning: Math.round((r ?? 0) * 10), mentionRate: r,
  citationSample: 8, ownedCiting: 2, ownedCitationRate: 0.25, ownedCitationRank: 1, retrievalSample: 0, ownedRetrieved: 0, retrievedNotCited: 0, retrievedNotCitedRate: null,
  byEngine: [{ engine: "chatgpt", modelServed: "a", mode: "api", asked: 10, observed: 10, analyzed: 10, mentioning: Math.round((r ?? 0) * 10), citedOwned: 2 }], ...over });
const SEGMENTS: AiOutcomeReport["segments"] = [
  { from: "2026-07-27", to: "2026-07-29", models: [], boundary: null, days: [day("2026-07-27", 0.2), day("2026-07-28", 0.2), day("2026-07-29", 0.2)] },
  { from: "2026-07-30", to: "2026-08-02", models: [], days: [day("2026-07-30", 0.4), day("2026-07-31", 0.4), day("2026-08-01", null, { observed: 0, analyzed: 0, citationSample: 0, ownedCiting: 0 }), day("2026-08-02", 0.5)],
    boundary: [{ engine: "chatgpt", day: "2026-07-30", fromModel: "a", toModel: "b", fromMode: "api", toMode: "api" }] }];
const LANDSCAPE = [{ domain: "standards.example", kind: "citation_authority" as const, why: "Engines cite it 7 times as a source and it never ranks against you.", evidence: { serpAppearances: 0, aiCitations: 7, competingQueries: 0 } }];
const TENANT = "acct-a", DAY = "2026-08-02";
const LONG_ANSWER = `You can order a haft seen set from a few specialist shops. ${"the haft seen table is the centre of nowruz. ".repeat(105)}`.slice(0, 5000).trim();
/** ONE stored reading, with more citations and fan-outs than any summary would show, and my own question echoed back among them. */
const ROW: AnswerRow = { id: "obs_7", day: DAY, promptId: "p1", promptText: "where to buy a haft seen set", engine: "chatgpt", slot: 0, answered: true,
  mentioned: true, position: 2, cited: true, competitors: ["Rival Bazaar", "Persian Goods"],
  fanOuts: [...Array.from({ length: 13 }, (_, i) => `haft seen search ${i}`), "haft seen set delivery", "Where to buy a haft seen set?"], answerText: LONG_ANSWER,
  citations: [{ url: "https://own.example/haft-seen", domain: "own.example", owned: true },
    { url: "https://standards.example/nowruz", domain: "standards.example", owned: false, passage: "the haft seen table" },
    { url: "https://standards.example/haft-seen", domain: "standards.example", owned: false },
    ...Array.from({ length: 13 }, (_, i) => ({ url: `https://shop${i}.example/a`, domain: `shop${i}.example`, owned: false }))],
  retrievedNotCited: ["https://other.example/x"], modelRequested: "gpt-x-preview", modelServed: "gpt-x", mode: "api", webSearched: true,
  // PIN: RAW instants, exactly as production hands them over. A pre-formatted fixture hid a live surface printing "Asked 2026-08-02T16:02:11.482+00:00" at a paying customer.
  askedAt: "2026-08-02T16:02:11.482+00:00", answeredAt: "2026-08-02T16:02:24.000+00:00", receipt: "answer:9f3c1a2b7d", costUsd: 0.02, failureReason: null, reading: "read" };
/** ONE reading from OUTSIDE the chosen stretch: the window read carries twice the stretch so the stretch before it can be compared, so every windowed number here has something it must exclude. */
const OLDER: AnswerRow = { ...ROW, id: "obs_1", day: "2026-07-28", position: 9 };
/** THE WINDOW AS THE ONE SHARED FAN-OUT PROJECTION SEES IT: the same rows, the same pure function Decision reads. */
const FANOUT_OBS = [ROW, OLDER].map((r) => ({ observationId: r.id, promptId: r.promptId, promptText: r.promptText, engine: r.engine, reportingDay: r.day,
  fanOutQueries: r.fanOuts, citations: r.citations?.map((c) => ({ url: c.url, domain: c.domain })) ?? null,
  retrievedResults: (r.retrievedNotCited ?? []).map((u) => ({ url: u, domain: new URL(u).hostname })) }));
const ai = (over: Partial<Parameters<typeof aiView>[0]> = {}) => aiView({ segments: SEGMENTS, rangeDays: 3, engine: null, sub: "prompts", landscape: LANDSCAPE, intel: null,
  checks: { done: 42, total: 48, answered: 40, unavailable: 2 }, day: DAY, dayRows: [ROW], window: [ROW, OLDER], focus: null, fanouts: buildFanoutEvidence(FANOUT_OBS, "own.example"), ownedPageRollup: null, trackedKeys: [canonicalQueryKey(ROW.promptText)], ...over });
const decay = (page: string, now: number, prior: number, over = {}) => ({ page, clicksNow: now, clicksPrior: prior, positionNow: 12.4, positionPrior: 6.1,
  impressionsNow: 900, impressionsPrior: 1200, windowNowEnd: "2026-08-01", ...over });
const DAYS = Array.from({ length: 28 }, (_, i) => ({ date: `2026-07-${String(i + 1).padStart(2, "0")}`, clicks: 10 + i, impressions: 400 + i * 10 }));
const google = (over: Partial<Parameters<typeof googleView>[0]> = {}) => googleView({ days: DAYS, rangeDays: 7, metric: "clicks",
  decay: [decay("/nowruz", 20, 60), decay("/haft-seen", 90, 40)], pages: new Map([["/nowruz", { page: "/nowruz", clicks90d: 80, impressions90d: 4000, ctr90d: 0.02, position90d: 9,
    topQueries: [{ query: "nowruz table", clicks: 12, impressions: 900, ctr: 0.013, position: 8.2 }] }]]), ...over });

describe("Visibility is a workspace, and every number on it names what it was counted over", () => {
  beforeEach(() => {
    store.reads.length = 0; store.fetched.length = 0;
    store.rows = Array.from({ length: 140 }, (_, i) => ({
      id: `obs_${i}`, tenant_id: TENANT, site: "own.example", prompt_id: `p${i % 35}`, prompt_version: 1, prompt_text: `question ${i % 35}`,
      engine: ["chatgpt", "claude", "gemini", "perplexity"][i % 4], sample_slot: 0, reporting_day: DAY, status: "observed",
      requested_at: `2026-08-02T${String(i % 24).padStart(2, "0")}:00:${String(i % 60).padStart(2, "0")}Z`,
      answer_text: "x".repeat(5000), answer_hash: "h", analysis: null, analysis_hash: null,
      journey: { fan_outs: null, retrieved_results: null, cited_sources: null, brand_mentions: null, web_search_reported: null } } as Row));
  });
  it("says what it cannot show without Search Console rather than drawing an empty workspace", () => {
    const bare = google({ days: [] });
    expect([bare.pages, bare.queries, bare.chart]).toEqual([null, null, null]);
    expect(bare.limitation).toContain("No Search Console numbers are on file for this account");
    // A SITE WITH CLICKS HAS PAGES: coming back with none of them is a read that did not land, and calling
    // that "Google has not reported a page yet" about an account with thousands of clicks is a plain untruth.
    const broken = google({ decay: [], pages: new Map() });
    for (const said of [broken.pages!.empty, broken.queries!.empty, broken.tiles[3]!.basis]) expect(said).toContain("That could not be read back in time just now");
  });
  // PIN: EVERY page that moved is on the page, not a top five, because a decline that is cut from the list is a decline nobody can act on.
  it("shows every page that moved with the window it was measured on, and marks the ones losing ground", () => {
    const v = google();
    expect(v.pages!.rows.map((r) => r.id)).toEqual(["/haft-seen", "/nowruz"]);
    const losing = v.pages!.rows.find((r) => r.id === "/nowruz")!;
    expect([losing.cells[2]!.text, losing.cells[2]!.tone, losing.cells[0]!.sub]).toEqual(["-40", "down", "losing ground"]);
    expect(v.pages!.note).toContain("compares the 28 days ending Aug 1 with the 28 days before them"); expect(v.pages!.note).toContain("1 page is losing clicks");
    expect(v.pages!.columns.map((c) => c.label)).toContain("Strongest search, 90 days"); // a 90 day figure inside a 28 day comparison names its OWN window
    // The searches Google named, each on the page it lands on, with its own rate rather than the site's.
    expect(v.queries!.rows[0]!.cells.map((c) => c.text)).toEqual(["nowruz table", "/nowruz", "12", "900", "1.3%", "8.2"]);
    expect(v.tiles[0]!.basis).toBe("over the last 7 reported days, against 189 over the 7 days before"); // Clicks against the stretch before it, and a rank that names the only window Google gives me per page.
    expect(v.tiles[3]!.basis).toContain("weighted by appearances across 2 pages over the 28 days ending Aug 1");
    expect(v.chart!.prior).toHaveLength(7); // the stretch before, drawn behind the line rather than described
  });
  // PIN: NOTHING CHECKED IS NOT ZERO MENTIONS. A live account had answers on file and none of them read, and the old surface
  // reported "0%" about every one of them: a customer-facing false negative built out of an empty denominator.
  it("refuses a rate over a denominator nobody has checked, and counts one citation vote per answer", () => {
    const unread = SEGMENTS.map((s) => ({ ...s, days: s.days.map((d) => ({ ...d, analyzed: 0, mentioning: 0, mentionRate: null })) }));
    const blind = ai({ segments: unread });
    expect([blind.tiles[0]!.value, blind.tiles[0]!.value.includes("0%")]).toEqual(["not checked yet", false]);
    expect(blind.tiles[0]!.basis).toContain("answers are on file and none of them are checked yet");
    const v = ai();
    expect(v.tiles[0]!.basis).toBe("9 of the 20 answers finished checking over 3 days");
    expect(v.tiles[0]!.delta).toBe("+18.3 points"); expect(v.tiles[3]!.basis).toContain("across the 1 answers over 3 days that reported where you sat"); // both windowed, both naming the window
    // 15 credited pages across 15 domains, ONE vote each: a chatty answer cannot outvote the rest of the day.
    // ONE VOTE PER ANSWER, and this answer credits standards.example on TWO pages: counting links would make it 16 votes and two crediting answers.
    expect([v.tiles[2]!.value, v.tiles[2]!.basis]).toEqual(["6.7%", "1 of the 15 times an answer credited any site on Aug 2, counting one vote per answer"]); expect(v.citations!.rows.find((r) => r.id === "standards.example")!.cells[2]!.text).toBe("1");
    expect(v.tiles[4]!.basis).toContain("Every rate above divides by what was checked, never by what was collected");
    const busy = ai({ segments: SEGMENTS.map((s) => ({ ...s, days: s.days.map((d) => ({ ...d, ownedRetrieved: 4, retrievedNotCited: 3 })) })) }); // READ AND PASSED OVER, over a denominator that is never every answer
    expect([busy.retrieval!.value, busy.retrieval!.basis, ai().retrieval, v.byEngine!.rows[0]!.cells.map((c) => c.text)]).toEqual(["75%", "9 of the 12 answers that opened a page of yours over the last 3 days credited somebody else instead, or nobody at all", null, ["ChatGPT", "30%", "6", "30"]]);
    expect(v.boundaries[0]).toContain("changed the version behind its answers on Jul 30");
    expect(v.coverage).toContain("42 of the 48 answer checks planned for today are settled");
    expect(v.coverage).toContain("Aug 1 came back with nothing, and a missed day is never filled in.");
    // A READ THAT DID NOT LAND IS NOT AN ACCOUNT WITH NO ANSWERS: the live account had 697 stored answers and one slow read told it I had never read one. And ONE READ THAT DID NOT LAND NEVER BLANKS THE OTHER TWO: the trend going missing costs the rates and the line and nothing else.
    expect(ai({ segments: null, dayRows: null, window: null }).empty).toContain("That could not be read back in time just now");
    const part = ai({ segments: null }); expect([part.empty, part.tiles.length, part.chart, part.byEngine, part.citations!.rows.length > 0, part.prompts!.rows.length > 0]).toEqual([null, 0, null, null, true, true]);
    expect(part.coverage).toContain("The daily trend could not be read back in time, so no rate, no chart and no period is claimed here.");
    for (const said of [ai({ dayRows: null, window: null }).citations!.empty, ai({ dayRows: null, window: null }).prompts!.empty]) expect(said).toContain("That could not be read back in time just now");
  });
  it("never lists a question of mine as a search an assistant thought of, and links every question to the runs behind it", () => {
    const v = ai();
    expect(v.searches!.rows.map((r) => r.cells[0]!.text)).not.toContain("Where to buy a haft seen set?"); // a capital letter and a question mark are the SAME question
    expect(v.searches!.rows.map((r) => r.cells[0]!.text)).toContain("haft seen set delivery");
    expect(v.searches!.note).toContain("A tracked question is never listed here as a search the assistant thought of.");
    const q = v.prompts!.rows[0]!;
    expect(q.href).toBe("?view=ai&prompt=p1");
    expect(q.cells.map((c) => c.text)).toEqual(["where to buy a haft seen set", "1", "100%", "0 points", "1 of 1", "2.0", "Rival Bazaar", "14", "Aug 2"]);
    expect(q.cells[2]!.sub).toBe("1 of 1 checked"); expect(v.prompts!.note).toContain("except the two columns that name Aug 2");
    expect(v.prompts!.columns.map((c) => c.label)).toContain("Credited a page of yours, Aug 2"); // a one day column never borrows the table's window
    // Sites credited: what each one IS, its share, and the page it credited most.
    const own = v.citations!.rows.find((r) => r.id === "own.example")!;
    expect([own.cells[1]!.text, own.cells[0]!.tone]).toEqual(["Your own site", "own"]);
    expect(v.citations!.rows.find((r) => r.id === "standards.example")!.cells[1]!.text).toBe("A source");
    const d = ai({ focus: { promptId: "p1", rows: [ROW, { ...ROW, id: "obs_8", engine: "claude", answered: false, mentioned: null, cited: null, fanOuts: null, citations: null }] } }).detail!; // One question opened: every run, each one linkable on its own.
    expect(d.headline).toBe("You are named in 1 of the 1 answers finished checking on this question, across 2 assistants.");
    expect(d.executions.rows[0]!.href).toBe("?view=ai&prompt=p1&reading=obs_7");
    const quiet = d.executions.rows.find((r) => r.id === "obs_8")!.cells.map((c) => c.text);
    expect(quiet).toEqual(["Aug 2", "Claude", "nothing came back", "not checked", "never reported", "never reported", "never reported"]);
    expect(d.rivals[0]).toEqual({ text: "Rival Bazaar", count: 2 });
  });
  // PIN: ONE RUN OPENS INTO THE WHOLE OF ITSELF, cut nowhere, and what the provider never reported says so.
  it("opens one run into the whole of itself, and never prints an unreported silence as a factual none", () => {
    const all = answerDetail(ROW, new Map(LANDSCAPE.map((l) => [l.domain, l.kind]))).join("\n");
    for (const s of [LONG_ANSWER, '"haft seen set delivery"', "https://own.example/haft-seen (your page)", "It named these instead of or beside you: Rival Bazaar, Persian Goods.",
      "https://standards.example/nowruz (standards.example, a source)", 'It quoted this part: "the haft seen table"', "You were named, in place 2 of the answer.",
      "It also read these and credited none of them: https://other.example/x.", "ChatGPT answered with its gpt-x model, though gpt-x-preview was asked for. It was asked directly.",
      "This reading counts for Aug 2. Asked Aug 2 at 4:02 PM UTC, answered Aug 2 at 4:02 PM UTC.", "Every word of this answer has been read closely.",
      "Stored answer receipt 9f3c1a2b. It cost $0.02 to buy once."]) expect(all, s).toContain(s);
    expect(answerDetail(ROW).filter((d) => d.startsWith("https://"))).toHaveLength(16); // every credited page, not a first ten
    expect(all.toLowerCase()).not.toContain('searched for: "where to buy a haft seen set?"');
    const quiet = answerDetail({ ...ROW, fanOuts: null, citations: null, retrievedNotCited: null, reading: "unread" }).join("\n");
    for (const s of ["ChatGPT does not report the searches it ran on this path", "so there is no claim that it credited nobody.",
      "ChatGPT does not report the pages it read but did not credit on this path.", "Nobody has read this answer closely yet"]) expect(quiet, s).toContain(s);
    for (const gone of ["It ran no searches of its own", "It credited no pages at all", "Every page it read, it credited"]) expect(quiet).not.toContain(gone);
    // A RECEIPT I CANNOT PROVE IS NOT ZERO DOLLARS, and a real charge under a cent is the same lie in miniature.
    expect(answerDetail({ ...ROW, costUsd: null }).at(-1)).toContain("What it cost was never preserved");
    expect(answerDetail({ ...ROW, costUsd: 0.004 }).at(-1)).toContain("It cost under a cent to buy once.");
    expect(answerDetail({ ...ROW, reading: "checked" })).toContain("This answer was checked for your name and your website address, and nobody has read the rest of it closely.");
  });
  /** THE REAL SURFACE: it draws off answers already bought, asks no provider anything, and loads a whole answer only for the ONE run a customer opens. */
  it("draws the AI workspace off stored answers, calls no provider, and reads a whole answer only when one run is opened", async () => {
    const draw = async (params: Record<string, string>) => {
      const page = await VisibilityPage({ searchParams: Promise.resolve(params) }) as ReactElement<{ children: ReactElement[] }>;
      const body = (page.props.children[2]! as ReactElement<{ children: ReactElement }>).props.children as ReactElement<{ tenantId: string }>;
      return renderToStaticMarkup(await (body.type as (p: { tenantId: string }) => Promise<ReactElement>)(body.props));
    };
    const listed = await draw({ view: "ai" });
    expect(listed).toContain("Where AI answers have you");
    expect(listed).toContain("question 0"); // the tracked questions themselves, not a count of them
    expect(store.reads.every((r) => !r.cols.includes("answer_text"))).toBe(true); // no screen ever pulls a day of whole answers
    const opened = await draw({ view: "ai", prompt: "p0", reading: "obs_0" });
    expect(opened).toContain("The whole of this one run");
    expect(opened).toContain("x".repeat(200)); // and the whole answer arrives, only for the run that was asked for
    expect(store.fetched).toHaveLength(0); // nothing on this path ever asks an assistant anything
  });
  it("keeps every line it says free of dashes, raw date stamps and lab words", () => {
    const v = ai(), g = google();
    const said = [...v.tiles.flatMap((t) => [t.label, t.value, t.basis]), v.coverage, v.watermark, ...v.boundaries, g.watermark, g.coverage,
      ...Object.values(v.retrieval ?? {}), ...answerDetail(ROW), // PIN: a stored instant, a mode key, a cache key and a model id all reach a customer through these lines, and every one of them was leaking raw
      ...[v.prompts, v.citations, v.searches, v.byEngine, g.pages, g.queries].flatMap((t) => [t!.note ?? "", t!.empty, ...t!.columns.map((c) => c.label), ...t!.rows.flatMap((r) => r.cells.flatMap((c) => [c.text, c.sub ?? ""]))])];
    for (const s of said) {
      expect(s, `dash or raw date stamp in: ${s}`).not.toMatch(/[–—]|\d{4}-\d{2}-\d{2}/);
      expect(s.toLowerCase(), `lab word in: ${s}`).not.toMatch(/\b(experiment|control|baseline|treatment|serp|cohort|statistically|fingerprint|lease)\b/);
    }
  });
});
