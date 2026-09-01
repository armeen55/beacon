/** AI OUTCOME MEASUREMENT (V1 Truth Convergence Phase 7). Protected here: only the canonical first reading of a question feeds a trend; a rate with nothing behind it is null and never zero; a model or mode change splits the series and is named; a Shipment is judged before against after on the same rule with its coverage visible; thin coverage is "unclear", not a verdict; a missed day stays missed; and one account never reads another's answers. Fixtures only: every read is injected, zero network, zero cost. */
import { describe, it, expect, vi } from "vitest";
import { aiOutcomes, visibilitySeries } from "@/domains/measurement/ai-outcomes";
import { aiBaselineFor, aiOutcomeForShipment, aiOutcomesForShipments } from "@/domains/measurement/shipment-ai-outcome";
import type { AiObservationRecord } from "@/domains/evidence/ai-visibility/ai-observations"; const T = "acct-a", SITE = "fixture-outdoors.example";
type RowOver = Partial<AiObservationRecord> & { day?: string; mentioned?: boolean | null };
/** One stored observation, in the shape the store actually holds. */
function row(over: RowOver = {}): AiObservationRecord {
  const { day, mentioned, ...rest } = over; const reporting_day = day ?? "2026-07-20"; const analysis = mentioned == null ? null : { ownedBrandMention: { mentioned, position: null, context: null }, competitors: [] };
  return {
    id: `obs-${reporting_day}-${rest.engine ?? "chatgpt"}-${rest.prompt_id ?? "p1"}-${rest.sample_slot ?? 0}`,
    tenant_id: T, site: SITE, prompt_id: "p1", prompt_version: 1, prompt_text: "where should I go",
    engine: "chatgpt", model_requested: null, model_served: "gpt-5", observation_mode: "api",
    reporting_day, sample_slot: 0, language: "en", location: 2840, capability_version: "v1", cache_key: null,
    requested_at: `${reporting_day}T09:00:00.000Z`, completed_at: `${reporting_day}T09:00:10.000Z`,
    cost_usd: 0, status: "observed", failure_reason: null, answer_text: "an answer", answer_hash: "abc",
    journey: { fan_outs: null, retrieved_results: null, cited_sources: null, brand_mentions: null, web_search_reported: null },
    analysis, analysis_hash: analysis ? "abc" : null, ...rest, // A settled reading carries the ANSWER's own hash: the whole answer was read. A stored partial deliberately carries a different hash, which is exactly what keeps it out of every denominator.
  } as AiObservationRecord;}
const link = (domain: string) => ({ url: `https://${domain}/page`, domain, title: null });
/** A store that answers like the real one: only the slot and the day range that were ASKED for, a named range read whole, and a fixed count never exceeded. A module that asks for the newest N rows and narrows to its range afterwards gets a truncated history here, exactly as it does in production. */
const reader = (rows: AiObservationRecord[]) =>
  vi.fn(async (_t: string, o: { limit?: number; slot?: number; fromDay?: string; toDay?: string }) =>
    rows.filter((r) => (o.slot === undefined || r.sample_slot === o.slot)
      && (!o.fromDay || r.reporting_day >= o.fromDay) && (!o.toDay || r.reporting_day <= o.toDay))
      .slice(0, o.limit ?? (o.fromDay || o.toDay ? 40_000 : 500)).map((r) => ({ ...r }))); const allDays = (report: Awaited<ReturnType<typeof aiOutcomes>>) => report.segments.flatMap((s) => s.days);
/** THE ONE CALENDAR WALK behind every fixture stretch below: each day from `from` to `to`, `perDay` answers a day, each built from that day and its index within it. */
const eachDay = (from: string, to: string, perDay: number, make: (day: string, i: number) => AiObservationRecord[]) => {
  const out: AiObservationRecord[] = [];
  for (let t = Date.parse(`${from}T00:00:00.000Z`); t <= Date.parse(`${to}T00:00:00.000Z`); t += 86_400_000)
    for (let i = 0; i < perDay; i += 1) out.push(...make(new Date(t).toISOString().slice(0, 10), i));
  return out;};
describe("the daily AI trend, over stored answers only", () => {
  it("counts the mention rate over the answers actually read, and says null when none were read", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", prompt_id: "p1", mentioned: true }),
      row({ day: "2026-07-20", prompt_id: "p2", mentioned: false }),
      row({ day: "2026-07-20", prompt_id: "p3", mentioned: null }), // answered, never analyzed
      row({ day: "2026-07-21", prompt_id: "p1", mentioned: null }),
      row({ day: "2026-07-21", prompt_id: "p2", mentioned: null }),]);
    const days = allDays(await aiOutcomes(T, { from: "2026-07-19", to: "2026-07-22", readObservations })); expect(days.map((d) => d.day)).toEqual(["2026-07-20", "2026-07-21"]);
    expect(days[0]).toMatchObject({ observed: 3, analyzed: 2, mentioning: 1, mentionRate: 0.5 }); // Three answers came back; two of them were read closely; one of those two named the account.
    expect(days[1]).toMatchObject({ observed: 2, analyzed: 0, mentioning: 0, mentionRate: null }); // NOTHING was read closely on the 21st, so the rate is null. Zero would claim AI never named them.
  });
  it("reads citations, citation rank and retrieved-but-not-cited only where the engine reported them", async () => {
    const journey = (over: Partial<AiObservationRecord["journey"]>) =>
      ({ fan_outs: null, retrieved_results: null, cited_sources: null, brand_mentions: null, web_search_reported: null, ...over }); const readObservations = reader([
      row({ day: "2026-07-20", prompt_id: "p1", mentioned: true, journey: journey({ cited_sources: [link("rival.example"), link("other.example"), link(`www.${SITE}`)] }) }), // Credited third, behind two others.
      row({ day: "2026-07-20", prompt_id: "p2", mentioned: false, journey: journey({ cited_sources: [link("rival.example")], retrieved_results: [link(SITE)] }) }), // Read the page and credited someone else.
      row({ day: "2026-07-20", prompt_id: "p3", mentioned: false }), // The engine reported nothing about its sources at all: it joins neither sample.
      row({ day: "2026-07-20", prompt_id: "p4", mentioned: true, journey: journey({ // THE SAME page of yours, read and then CREDITED, differing only by www, scheme, a trailing slash and a fragment. A page the engine cited was never a page it read and passed over.
        cited_sources: [{ url: `https://www.${SITE}/guide/`, domain: `www.${SITE}`, title: null }],
        retrieved_results: [{ url: `http://${SITE}/guide#top`, domain: SITE, title: null }] }) }),
    ]); const [day] = allDays(await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-20", readObservations })); expect(day).toMatchObject({
      citationSample: 3, ownedCiting: 2, ownedCitationRate: 0.667, ownedCitationRank: 2,
      retrievalSample: 2, ownedRetrieved: 2, retrievedNotCited: 1, retrievedNotCitedRate: 0.5,});});
  it("counts a page of yours read and passed over even when the answer credited a DIFFERENT page of yours", async () => {
    const readObservations = reader([row({ day: "2026-07-20", prompt_id: "p1", mentioned: true, journey: { // The subtraction is per PAGE, through the one canonical-url derivation. Asking only "did it credit anybody on this site" answers yes here and reports zero, so the page the engine actually read and then ignored disappears behind a neighbour of its own that happened to get the credit.
      fan_outs: null, brand_mentions: null, web_search_reported: null,
      retrieved_results: [{ url: `https://${SITE}/guide`, domain: SITE, title: null }],
      cited_sources: [{ url: `https://${SITE}/other`, domain: SITE, title: null }] } })]);
    const [day] = allDays(await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-20", readObservations })); expect(day).toMatchObject({ retrievalSample: 1, ownedRetrieved: 1, retrievedNotCited: 1, retrievedNotCitedRate: 1 });});
  it("says null for retrieved-but-not-cited when the journey never recorded what was read", async () => {
    const readObservations = reader([row({ day: "2026-07-20", mentioned: true })]); const [day] = allDays(await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-20", readObservations }));
    expect(day.retrievalSample).toBe(0); expect(day.retrievedNotCitedRate).toBeNull(); expect(day.ownedCitationRate).toBeNull(); expect(day.ownedCitationRank).toBeNull();});
  it("keeps the extra volatility samples out of the trend entirely", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", prompt_id: "p1", mentioned: false }),
      row({ day: "2026-07-20", prompt_id: "p1", sample_slot: 1, mentioned: true }),
      row({ day: "2026-07-20", prompt_id: "p1", sample_slot: 2, mentioned: true }),]); const [day] = allDays(await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-20", readObservations }));
    expect(day).toMatchObject({ observed: 1, analyzed: 1, mentioning: 0, mentionRate: 0 }); // Slot 0 said no. Two extra samples said yes and neither one may move the line.
  });
  it("counts what each engine was asked against what came back, and never invents a missed day", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", prompt_id: "p1", engine: "chatgpt", mentioned: true }),
      row({ day: "2026-07-20", prompt_id: "p2", engine: "chatgpt", status: "failed", mentioned: null }),
      row({ day: "2026-07-20", prompt_id: "p3", engine: "chatgpt", mentioned: null }), // came back, nobody has read it closely yet
      row({ day: "2026-07-20", prompt_id: "p1", engine: "claude", model_served: "claude-4", mentioned: false }),
      row({ day: "2026-07-22", prompt_id: "p1", engine: "chatgpt", mentioned: true }), // Nothing at all on the 21st. The 22nd resumes.
    ]); const report = await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-22", readObservations }); const days = allDays(report);
    expect(days.map((d) => d.day)).toEqual(["2026-07-20", "2026-07-22"]); // the 21st is missing, not zero
    expect(report.daysObserved).toBe(2); expect(days[0].byEngine).toEqual([
      { engine: "chatgpt", modelServed: "gpt-5", mode: "api", asked: 3, observed: 2, analyzed: 1, mentioning: 1, citedOwned: 0 }, // `analyzed` is each engine's OWN denominator, and it is smaller than what came back while a day is still being read: a per-engine share used to have no denominator at all and had to borrow the day's pooled one, which reports one fraction over four engines that are nothing like each other.
      { engine: "claude", modelServed: "claude-4", mode: "api", asked: 1, observed: 1, analyzed: 1, mentioning: 0, citedOwned: 0 },]);});
  it("asks the store for the day range and the first readings, so nothing is narrowed after the read", async () => {
    const readObservations = reader([row({ day: "2026-07-20", mentioned: true })]); await aiOutcomes(T, { from: "2026-07-19", to: "2026-07-21", readObservations });
    expect(readObservations).toHaveBeenCalledWith(T, { fromDay: "2026-07-19", toDay: "2026-07-21", slot: 0, projection: "overview" });}); // Asking for the newest N rows and cutting to the range afterwards spends the whole read on the newest days and on samples this trend then throws away, so the older half of the range vanishes. AND IT ASKS FOR WHAT IT READS: the overview projection, never the whole row, whose answer text and stored verdict are megabytes a trend never opens.
  /** `prompts` questions x four engines x `days` days of first readings: the shape a real account stores. */
  const history = (days: number, prompts: number) =>
    Array.from({ length: days }).flatMap((_, d) => Array.from({ length: prompts }).flatMap((__, p) =>
      (["chatgpt", "claude", "gemini", "perplexity"] as const).map((engine) =>
        row({ day: new Date(Date.parse("2026-07-01T00:00:00.000Z") + d * 86_400_000).toISOString().slice(0, 10), prompt_id: `p${p}`, engine, mentioned: true }))));
  const observedIn = (report: Awaited<ReturnType<typeof aiOutcomes>>) => allDays(report).reduce((n, d) => n + d.observed, 0);
  it("reads the WHOLE requested range, never the first page of it", async () => {
    const rows = history(28, 35); // 35 questions x 4 engines x 28 days
    expect(rows).toHaveLength(3920); const report = await aiOutcomes(T, { from: "2026-07-01", to: "2026-07-28", readObservations: reader(rows) }); const days = allDays(report);
    expect([observedIn(report), days[0]!.day, days.at(-1)!.day, days.length]).toEqual([3920, "2026-07-01", "2026-07-28", 28]); // A 2,000 row cap over the newest readings held about a fortnight, so a 28 day report was half a month.
    expect(observedIn(await aiOutcomes(T, { from: "2026-07-01", to: "2026-07-30", readObservations: reader(history(30, 50)) }))).toBe(6000);});
  it("never reads another account's answers", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", prompt_id: "p1", mentioned: true }),
      row({ day: "2026-07-20", prompt_id: "p9", tenant_id: "acct-b", mentioned: true }),]);
    const [day] = allDays(await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-20", readObservations })); expect(day.observed).toBe(1);});});
describe("the model and mode boundary", () => {
  it("splits the series the day an engine changes model, and names the break", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", model_served: "gpt-5", mentioned: true }),
      row({ day: "2026-07-21", model_served: "gpt-5", mentioned: true }),
      row({ day: "2026-07-22", model_served: "gpt-5.5", mentioned: false }),
      row({ day: "2026-07-23", model_served: "gpt-5.5", mentioned: false }),]); const { segments } = await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-23", readObservations }); expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ from: "2026-07-20", to: "2026-07-21", boundary: null }); expect(segments[1]).toMatchObject({ from: "2026-07-22", to: "2026-07-23" }); expect(segments[1].boundary).toEqual([
      { engine: "chatgpt", day: "2026-07-22", fromModel: "gpt-5", toModel: "gpt-5.5", fromMode: "api", toMode: "api" },]);
    expect(segments[1].models).toEqual([{ engine: "chatgpt", modelServed: "gpt-5.5", mode: "api" }]);});
  it("splits on a mode change too, and a silent engine never breaks the line on its own", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", mentioned: true }),
      row({ day: "2026-07-21", status: "unavailable", model_served: null, mentioned: null }), // The engine was asked and said nothing: no answer, so no evidence the instrument changed.
      row({ day: "2026-07-22", observation_mode: "consumer_search", mentioned: true }),]);
    const { segments } = await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-22", readObservations }); expect(segments).toHaveLength(2);
    expect(segments[0].days.map((d) => d.day)).toEqual(["2026-07-20", "2026-07-21"]); expect(segments[1].boundary).toEqual([
      { engine: "chatgpt", day: "2026-07-22", fromModel: "gpt-5", toModel: "gpt-5", fromMode: "api", toMode: "consumer_search" },]);});
  it("hands the chart the same cut series over a trailing window", async () => {
    const readObservations = reader([
      row({ day: "2026-07-29", model_served: "gpt-5", mentioned: true }),
      row({ day: "2026-07-31", model_served: "gpt-6", mentioned: true }),
      row({ day: "2026-06-01", model_served: "gpt-4", mentioned: true }), // outside the window
    ]); const segments = await visibilitySeries(T, 7, { readObservations, now: new Date("2026-07-31T12:00:00.000Z") }); expect(segments.flatMap((s) => s.days).map((d) => d.day)).toEqual(["2026-07-29", "2026-07-31"]);
    expect(segments).toHaveLength(2); expect(segments[1].boundary?.[0]).toMatchObject({ fromModel: "gpt-5", toModel: "gpt-6" });});});
describe("what the AI answers did around one shipped change", () => {
  const NOW = new Date("2026-07-31T12:00:00.000Z");
  /** A VERDICT LANDS AT DAY 28 (Codex, 2026-08-21): the mature clock, with the stamp's own 28 days elapsed. */
  const NOW28 = new Date("2026-08-18T12:00:00.000Z"), TO28 = "2026-08-17";
  const STAMP = "2026-07-21T10:00:00.000Z", Q = ["where should I go"]; // the searches THIS change was aimed at, which is what every fixture answer asks
  /** Every day from `from` to `to`, four questions a day, `named` of them naming the account. */
  const stretch = (from: string, to: string, named: number) =>
    eachDay(from, to, 4, (day, i) => [row({ day, prompt_id: `p${i}`, mentioned: i < named })]);
  /** BOTH SIDES ARE ONE MEASURE. The starting number written at mark time counts the answers that came back AND the ones read closely enough to say whether the account was named, and the rate divides by the second. Dividing by everything that came back made the before side a different metric from the after side, so a change was judged by a subtraction of two unlike numbers. */
  it("divides the starting number by the answers READ CLOSELY, so before and after are the same measure", async () => {
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, // 140 answers, 100 read closely, 90 naming: the rate before is 0.9, where the old count said 0.64.
      shipmentBaseline: { ai: { day: "2026-07-20", checked: 140, analyzed: 100, mentioning: 90 } } },
    { readObservations: reader(stretch("2026-07-21", TO28, 2)), now: NOW28 });
    expect(outcome?.before).toMatchObject({ day: "2026-07-20", checked: 100, mentioning: 90, rate: 0.9, from: "on_file" }); expect(outcome?.after.rate).toBe(0.5);
    expect(outcome?.direction).toBe("worsened"); expect(outcome?.line).toContain("90 of 100 before it");});
  it("says unclear when the starting day itself was barely read, however clear the days since are", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 4)); // 40 of 140 read closely that day: a fact about how much analysis finished, not about what AI said.
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 140, analyzed: 40, mentioning: 24 } }, }, { readObservations, now: NOW });
    expect(outcome?.after.rate).toBe(1); expect(outcome?.direction).toBe("unclear");});
  it("compares the starting number on file against the full 28 days, and says which way it went", async () => {
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP,
      shipmentBaseline: { ai: { day: "2026-07-20", checked: 44, analyzed: 40, mentioning: 10 } } },
    { readObservations: reader(stretch("2026-07-21", TO28, 3)), now: NOW28 });
    expect(outcome?.direction).toBe("improved"); expect(outcome?.before).toMatchObject({ day: "2026-07-20", checked: 40, mentioning: 10, rate: 0.25, from: "on_file" });
    expect(outcome?.after).toMatchObject({ from: "2026-07-21", to: TO28, rate: 0.75 }); expect(outcome?.coverage).toEqual({ daysObserved: 28, daysElapsed: 28 });
    expect(outcome?.line).toContain("on 28 of the 28 days since this was marked done");
    expect(outcome?.line).not.toMatch(/[\u2014\u2013]/); // no em or en dashes, ever
  });
  it("reports a supported early move as movement, never as a verdict, before the 28 days have run", async () => {
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, // Eleven days in, a clear rise on adequate sides: the line says it is moving, and the direction waits, because day 7 and day 14 carry movement only (Codex, 2026-08-21).
      shipmentBaseline: { ai: { day: "2026-07-20", checked: 44, analyzed: 40, mentioning: 10 } } },
    { readObservations: reader(stretch("2026-07-21", "2026-07-31", 3)), now: NOW });
    expect(outcome?.direction).toBe("no_clear_movement"); expect(outcome?.line).toContain("Moving up so far; a verdict lands once 28 days are read.");});
  it("never supports a verdict on inadequate denominators, whatever the gap", async () => {
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP,
      shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 0 } } },
    { readObservations: reader(stretch("2026-07-21", TO28, 4)), now: NOW28 });
    expect(outcome?.direction).toBe("no_clear_movement"); // 0 to 1.0 on four answers is still four answers
  });
  it("falls back to the last day of stored answers before the change when nothing was written down", async () => {
    const readObservations = reader([...stretch("2026-07-19", "2026-07-20", 3), ...stretch("2026-07-21", "2026-07-31", 1)]);
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: null } }, { readObservations, now: NOW });
    expect(outcome?.before).toMatchObject({ day: "2026-07-20", checked: 4, mentioning: 3, rate: 0.75, from: "stored_answers" });
    expect(outcome?.direction).toBe("no_clear_movement"); // Four before-answers can describe where things stood; they can never support a verdict.
  });
  it("counts the share over the answers it actually READ, so unfinished analysis is not a fall", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 4) // Every answer read closely named the account; a quarter of them have not been read yet. Dividing by everything that came back would report that backlog as AI turning against the account.
      .map((r, i) => (i % 4 === 3 ? { ...r, analysis: null, analysis_hash: null } : r)));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 10, analyzed: 10, mentioning: 10 } }, }, { readObservations, now: NOW });
    expect(outcome?.after).toMatchObject({ checked: 44, analyzed: 33, mentioning: 33, rate: 1 });
    expect(outcome?.direction).toBe("no_clear_movement"); // 1.0 to 1.0: nothing to call, and never "flat"
    expect(outcome?.line).toContain("named in 33 of the 33 finished checking");});
  it("says null, never zero, when nothing since the change has been read closely", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 3) .map((r) => ({ ...r, analysis: null, analysis_hash: null })));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 1 } }, }, { readObservations, now: NOW });
    expect(outcome?.after).toMatchObject({ analyzed: 0, mentioning: 0, rate: null }); expect(outcome?.direction).toBe("unclear");});
  it("calls the same share no clear movement, and an unsupported flat is never printed", async () => {
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP,
      shipmentBaseline: { ai: { day: "2026-07-20", checked: 44, analyzed: 40, mentioning: 20 } } },
    { readObservations: reader(stretch("2026-07-21", TO28, 2)), now: NOW28 }); expect(outcome?.direction).toBe("no_clear_movement"); expect(outcome?.line).toContain("no clear movement from");
    expect(outcome?.line).not.toContain("the same share as");});
  it("says unclear when I read fewer than half the days that have passed", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-23", 4)); // Eleven days have passed and only three carry a reading.
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 0 } }, }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("unclear"); expect(outcome?.coverage).toEqual({ daysObserved: 3, daysElapsed: 11 }); expect(outcome?.line).toContain("too little to call either way yet");});
  it("says unclear when there is nothing from before the change to compare against", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 4)); const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: null } }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("unclear"); expect(outcome?.before).toMatchObject({ from: "nothing", rate: null }); expect(outcome?.line).toContain("nothing from before the change");});
  /** ONE CHANGE, ITS OWN SEARCHES. This read used to take EVERY answer the account bought in the window, so a page nobody asked about inherited another page's rise and a Result implied a lesson those answers cannot carry. Membership is the searches the change was aimed at: the question asked, or a search the engine itself reported running to answer it. */
  it("judges a change on its own searches only, and calls an unscopable one unavailable rather than account wide", async () => {
    const elsewhere = (r: AiObservationRecord) => ({ ...r, prompt_id: `x${r.prompt_id}`, prompt_text: "best rugs to buy" });
    const readObservations = reader([...stretch("2026-07-21", "2026-07-31", 0), ...stretch("2026-07-21", "2026-07-31", 4).map(elsewhere)]); const held = { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 2 } };
    const mine = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: held }, { readObservations, now: NOW });
    const other = await aiOutcomeForShipment(T, { scopeQueries: ["best rugs to buy"], implementedAt: STAMP, shipmentBaseline: held }, { readObservations, now: NOW });
    expect([mine?.after.rate, other?.after.rate]).toEqual([0, 1]); // two pages' answers never cross, and the account-wide read would have said 0.5 on both
    const noScope = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: held }, { readObservations, now: NOW });
    expect(noScope).toMatchObject({ direction: "unclear", terminal: true, after: { checked: 0, analyzed: 0, rate: null } }); expect(noScope?.line).toContain("Not measurable");
    expect(noScope?.line).toContain("searches this change was aimed at was not kept");});
  it("ends a change that declared an AI claim with no frozen baseline as terminally Not measurable", async () => {
    const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP, scopeQueries: Q,
      aiScope: { promptIds: ["p0"], engines: ["chatgpt"], fanouts: [], stage: "owned_retrieved_not_cited" },
      shipmentBaseline: { ai: null } }, { readObservations: reader(stretch("2026-07-21", "2026-07-31", 3)), now: NOW });
    expect(outcome).toMatchObject({ direction: "unclear", terminal: true }); expect(outcome?.line).toContain("Not measurable"); expect(outcome?.line).not.toContain("Reading continues");});
  it("says unclear when most of the answers since were never read closely", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 3).map((r, i) => (i % 4 === 0 ? r : { ...r, analysis: null, analysis_hash: null })));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 1 } }, }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("unclear"); expect(outcome?.after.analyzed).toBeLessThan(outcome!.after.checked);});
  it("bounds the window at 28 days and needs a stamp to measure from at all", async () => {
    const readObservations = reader(stretch("2026-07-01", "2026-07-31", 4));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: "2026-07-01T17:00:00.000Z", shipmentBaseline: { ai: { day: "2026-06-30", checked: 4, analyzed: 4, mentioning: 4 } }, }, { readObservations, now: NOW });
    expect(outcome?.after.to).toBe("2026-07-28"); expect(outcome?.coverage).toEqual({ daysObserved: 28, daysElapsed: 28 });
    expect(await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: null }, { readObservations, now: NOW })).toBeNull();});
  it("reads the whole ledger's answers ONCE, on the lean projection, and still judges each change on its own window", async () => {
    const rows = stretch("2026-06-01", "2026-07-31", 3); const readObservations = reader(rows); const shipments = [ // EVERY shipment used to open its own paged 56 day read of WHOLE rows, all of them at once: ten shipments meant eighty round trips carrying every answer text and retrieval journey in the window, which is the exact shape that has timed a statement out on this table before.
      { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 1 } } },
      { scopeQueries: Q, implementedAt: "2026-07-05T10:00:00.000Z", shipmentBaseline: { ai: null } },
      { scopeQueries: Q, implementedAt: null },                                    // no stamp, no moment to measure from
    ]; const batch = await aiOutcomesForShipments(T, shipments, { readObservations, now: NOW }); expect(readObservations).toHaveBeenCalledTimes(1);
    expect(readObservations).toHaveBeenCalledWith(T, { fromDay: "2026-06-07", toDay: "2026-07-31", slot: 0, projection: "scoped" }); expect(batch).toHaveLength(3); expect(batch[2]).toBeNull(); // ONE union window covering every stamped shipment, and the projection NAMES what it reads: the identity, the day, the slot, the status, the stored verdict, the instrument and the journey the fan-out route needs. Never the answer text, never the whole verdict.
    for (const [i, s] of shipments.entries()) { // And each change is still judged on ITS OWN 28 days, byte for byte what it got when it read alone.
      expect(batch[i]).toEqual(await aiOutcomeForShipment(T, s, { readObservations: reader(rows), now: NOW }));}});
  /** ONE OVERSIZED READ USED TO TAKE THE WHOLE LEDGER'S AI SIDE DOWN. The union window ran from the oldest shipment to the newest, and an account asking 35 questions of 4 engines writes 140 first readings a day, so a ledger spanning a year asked for about 51,000 rows and the store refuses anything past 40,000. Every change then showed no AI outcome at all, including the ones whose own answers read fine. */
  it("reads overlapping windows once and fails only the changes whose own days could not be read", async () => {
    const rows = [...stretch("2026-01-04", "2026-02-28", 3), ...stretch("2026-06-01", "2026-07-31", 3)]; const asked: Array<{ fromDay?: string; toDay?: string }> = [];
    const readObservations = vi.fn(async (t: string, o: { fromDay?: string; toDay?: string; slot?: number }) => {
      asked.push({ fromDay: o.fromDay, toDay: o.toDay });
      if ((o.toDay ?? "") <= "2026-03-01") throw new Error("[ai_observations] read hit the 40000 row ceiling");
      return rows.filter((r) => (o.slot === undefined || r.sample_slot === o.slot)
        && (!o.fromDay || r.reporting_day >= o.fromDay) && (!o.toDay || r.reporting_day <= o.toDay) && r.tenant_id === t) .map((r) => ({ ...r }));});
    const held = { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 1 } }; const batch = await aiOutcomesForShipments(T, [
      { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: held },                        // 2026-07-21
      { scopeQueries: Q, implementedAt: "2026-07-05T10:00:00.000Z", shipmentBaseline: held },
      { scopeQueries: Q, implementedAt: "2026-07-10T10:00:00.000Z", shipmentBaseline: held },
      { scopeQueries: Q, implementedAt: "2026-02-01T10:00:00.000Z", shipmentBaseline: held },   // its own stretch, and it throws
    ], { readObservations, now: NOW });
    expect(asked).toEqual([ // Three overlapping windows are ONE read, so a day two changes both need is fetched once; the fourth change sits on its own stretch and is read on its own.
      { fromDay: "2026-01-04", toDay: "2026-02-28" },
      { fromDay: "2026-06-07", toDay: "2026-07-31" },]);
    expect(batch.slice(0, 3).map((o) => o?.after.checked)).toEqual([44, 108, 88]); // Fetched once: a day counted twice would double every one of these.
    expect(batch.slice(0, 3).map((o) => o?.direction)).toEqual(["no_clear_movement", "no_clear_movement", "no_clear_movement"]); // Verdicts wait for day 28; the two mature windows call, the eleven-day one reports movement only.
    expect(batch[3]).toMatchObject({ direction: "unclear", coverage: { daysObserved: 0, daysElapsed: 28 } }); // And the one whose answers I could not reach says so, instead of reading as a change AI never noticed.
    expect(batch[3]?.line).toBe("The answers for this period could not be read just now. They are safe, and the next refresh reads them.");});
  /** THE DAY A CHANGE SHIPPED IS THE OPERATOR'S DAY. Observations are filed under the Pacific reporting day; deriving the shipped day in UTC put every evening stamp on tomorrow, so that same evening's answers, taken AFTER the operator made the change, were counted on the BEFORE side of it. */
  it("stamps the shipped day in the operator's own zone, so an evening change counts that evening after it", async () => {
    const evening = "2026-08-05T02:00:00.000Z"; // 7 PM on the 4th where the operator is
    const readObservations = reader([
      ...stretch("2026-08-01", "2026-08-03", 0),  // clearly before, and nobody named them
      ...stretch("2026-08-04", "2026-08-16", 4),  // the evening of the change and everything after it
    ]); const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: evening, shipmentBaseline: { ai: null } },
      { readObservations, now: new Date("2026-08-17T12:00:00.000Z") });
    expect(outcome?.after.from).toBe("2026-08-04");                 // the operator's day, not the UTC one
    expect(outcome?.before.day).toBe("2026-08-03");                 // so the evening's own answers are not "before"
    expect(outcome?.after.checked).toBe(52);                        // 13 days x 4 answers, the 4th included
    expect(outcome?.direction).toBe("no_clear_movement"); // Thirteen days in on a four-answer before side supports no verdict and no movement claim; the zone boundary above is the whole of what this pins.
  });});
describe("a shipment's typed AI scope is remeasured exactly (AEO reconstruction, 2026-08-19)", () => {
  const NOW = new Date("2026-07-31T12:00:00.000Z"), STAMP = "2026-07-21T10:00:00.000Z"; const BASE = { implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 0 } } };
  it("joins on the exact prompt ids and ONLY the assistants the claim was made on, never the flattened wordings", async () => {
    const rows = [
      row({ day: "2026-07-25", prompt_id: "p1", engine: "chatgpt", mentioned: true }),
      row({ day: "2026-07-25", prompt_id: "p1", engine: "gemini", mentioned: true, sample_slot: 0 }),
      row({ day: "2026-07-25", prompt_id: "p9", prompt_text: "where should I go", mentioned: true }),]; const outcome = await aiOutcomeForShipment(T, { ...BASE, scopeQueries: ["where should I go"],
      aiScope: { promptIds: ["p1"], engines: ["chatgpt"], fanouts: [], stage: "rivals_cited_own_not_retrieved" } },
    { readObservations: reader(rows), now: NOW });
    expect(outcome?.after.checked).toBe(1); // p1 on chatgpt only: not the gemini answer, and never p9 riding a matching wording
  });
  /** A FAN-OUT IS MEASURED THE DAY IT IS TARGETED, not the day somebody promotes it to a tracked question: with only an id and a wording route, a change aimed at a follow-up search measured zero until then. */
  it("remeasures the parent answers whose stored journey RAN the fan-out, whatever they were asked", async () => {
    const ran = (over: Partial<AiObservationRecord>) => row({ day: "2026-07-25", mentioned: true,
      journey: { fan_outs: ["Haft-Seen table items list"], retrieved_results: null, cited_sources: null, brand_mentions: null, web_search_reported: null }, ...over }); const rows = [
      ran({ prompt_id: "p7", prompt_text: "what do iranians put on the nowruz table" }),  // asks something else, ran the search
      ran({ prompt_id: "p8", prompt_text: "nowruz traditions explained" }),
      row({ day: "2026-07-25", prompt_id: "p9", prompt_text: "best rugs to buy", mentioned: true }), // never ran it
    ]; const outcome = await aiOutcomeForShipment(T, { ...BASE,
      aiScope: { promptIds: [], engines: [], fanouts: ["haft seen table items list"], fanoutKey: "haft seen table items list", stage: "rivals_cited_own_not_retrieved" } },
    { readObservations: reader(rows), now: NOW });
    expect(outcome?.after.checked).toBe(2); // both parents, and never the answer that ran a different search
  });
  it("joins the answers the claim was minted from, by their own ids, whatever the question is called now", async () => {
    const rows = [
      row({ day: "2026-07-25", id: "obs-kept", prompt_id: "p-retired", prompt_text: "a wording nobody tracks any more", mentioned: true }),
      row({ day: "2026-07-25", id: "obs-other", prompt_id: "p-else", prompt_text: "best rugs to buy", mentioned: true }),]; const outcome = await aiOutcomeForShipment(T, { ...BASE,
      aiScope: { promptIds: [], engines: [], fanouts: [], observationIds: ["obs-kept"], stage: "owned_mentioned_not_cited" } },
    { readObservations: reader(rows), now: NOW }); expect(outcome?.after.checked).toBe(1);});});
/** THE CHANGE DECLARES ITS OBJECTIVE AND RESULTS JUDGES THAT ONE. Every AI card used to be graded on mentions, so a change raised because the site was read and never credited was banked as a win the moment it was named more often, which is the thing it was already doing. */
describe("a shipment is judged on the objective it declared (AEO reconstruction, 2026-08-19)", () => {
  const NOW = new Date("2026-07-31T12:00:00.000Z"), STAMP = "2026-07-21T10:00:00.000Z"; const mine = (over: Partial<AiObservationRecord> & { day?: string; mentioned?: boolean | null }) =>
    row({ prompt_id: "p1", prompt_text: "where should I go", ...over }); const journeyOf = (cited: string[] | null, read: string[] | null): AiObservationRecord["journey"] => ({
    fan_outs: null, brand_mentions: null, web_search_reported: null,
    cited_sources: cited === null ? null : cited.map((d) => ({ url: `https://${d}/page`, domain: d, title: null })),
    retrieved_results: read === null ? null : read.map((d) => ({ url: `https://${d}/page`, domain: d, title: null })),
  });
  /** Every day from `from` to `to`, four answers a day on this change's own question. */
  const days = (from: string, to: string, make: (i: number) => Partial<AiObservationRecord> & { mentioned?: boolean | null }) =>
    eachDay(from, to, 4, (day, i) => [mine({ day, ...make(i) })]); const scope = (stage: string) => ({ promptIds: ["p1"], engines: [], fanouts: [], stage });
  /** A baseline frozen over this change's own searches at an adequate size: 40 answers read closely, 10 naming, and what the 40 said about sources. Four-answer sides can never support a verdict now. */
  const frozen = (over: Record<string, unknown> = {}) => ({ ai: { day: "2026-07-20", checked: 44, analyzed: 40, mentioning: 10,
    citationSample: 40, ownedCiting: 10, rankSum: 40, rankCount: 10, retrievalSample: 40, ownedRetrieved: 10, retrievedNotCited: 10,
    engines: ["chatgpt"], models: ["gpt-5"], modes: ["api"], scopeFingerprint: "fp", ...over } });
  it("reports the citation it was aimed at, not the mentions that rose beside it", async () => {
    const readObservations = reader(days("2026-07-21", "2026-07-31", (i) => ({ mentioned: true, journey: journeyOf(i === 0 ? ["fixture-outdoors.example"] : ["rival.example"], null) }))); // Named on every answer since, up from 1 of 4. Credited on 1 of 4, exactly where it started.
    const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: frozen(), aiScope: scope("owned_mentioned_not_cited") },
      { readObservations, now: NOW }); expect(outcome?.objective).toBe("ai_citation");
    expect(outcome?.mentionDirection).toBe("improved");   // the mention line is still true
    expect(outcome?.direction).toBe("no_clear_movement"); // and it is NOT what this change is judged on
    expect(outcome?.citations.after).toEqual({ sample: 44, hits: 11, rate: 0.25 }); expect(outcome?.metricLines).toContain("Mentions rose, and the citation this change was aimed at has not moved yet.");
    expect(outcome?.line).not.toMatch(/[\u2014\u2013]/); // no em or en dashes, ever
  });
  it("reads a rise in being read as progress, and never as the win", async () => {
    // Every answer of the full 28 days read a page of yours; the baseline had 10 of 40. None credited it.
    const readObservations = reader(days("2026-07-21", "2026-08-17", () => ({ mentioned: false, journey: journeyOf(["rival.example"], ["fixture-outdoors.example"]) })));
    const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: frozen(), aiScope: scope("rivals_cited_own_not_retrieved") },
      { readObservations, now: new Date("2026-08-18T12:00:00.000Z") });
    expect(outcome?.objective).toBe("ai_retrieval"); expect(outcome?.retrieval).toEqual({ before: { sample: 40, hits: 10, rate: 0.25 }, after: { sample: 112, hits: 112, rate: 1 } });
    expect(outcome?.direction).toBe("improved"); expect(outcome?.metricLines).toContain("Read on more answers than before, and not yet credited on them: progress, not the win.");});
  it("reports where in the list the answer credited the page, where the provider reports it", async () => {
    const readObservations = reader(days("2026-07-21", "2026-07-31", () => ({ mentioned: true, journey: journeyOf(["rival.example", "fixture-outdoors.example"], null) })));
    const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: frozen(), aiScope: scope("owned_mentioned_not_cited") },
      { readObservations, now: NOW });
    expect([outcome?.citations.rankBefore, outcome?.citations.rankAfter]).toEqual([4, 2]); // Credited second on every answer since, against fourth on the frozen day.
    expect(outcome?.metricLines).toContain("Credited in position 2 on average, from position 4.");});
  it("says null, never zero, for a metric no answer on that side reported", async () => {
    const readObservations = reader(days("2026-07-21", "2026-07-31", () => ({ mentioned: true }))); // Not one answer since said which sources it used. Zero would claim AI credited the page on none of them.
    const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: frozen(), aiScope: scope("owned_retrieved_not_cited") },
      { readObservations, now: NOW }); expect(outcome?.citations.after).toEqual({ sample: 0, hits: 0, rate: null }); expect(outcome?.retrieval.after.rate).toBeNull();
    expect(outcome?.direction).toBe("unclear"); expect(outcome?.metricLines).toContain("No answer since the change reported which sources it used, so the citation cannot be read yet.");});
  it("names both instruments when two models answered, and says the instrument moved", async () => {
    const readObservations = reader([
      ...days("2026-07-21", "2026-07-25", () => ({ mentioned: true, model_served: "gpt-5" })),
      ...days("2026-07-26", "2026-07-31", () => ({ mentioned: true, model_served: "gpt-5.5" })),]);
    const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: frozen(), aiScope: scope("owned_mentioned_not_cited") },
      { readObservations, now: NOW }); expect(outcome?.instruments).toEqual([
      { engine: "chatgpt", modelServed: "gpt-5", mode: "api", answers: 20 },
      { engine: "chatgpt", modelServed: "gpt-5.5", mode: "api", answers: 24 },]);
    expect(outcome?.boundary).toBe("The instrument changed under this reading: ChatGPT moved from gpt-5 to gpt-5.5. A step here is the instrument, not the change.");
    // DOCTRINE REVERSED (Codex, 2026-08-23). This pin used to demand 44: the model never filtered the read, because emptying the after side was the feared failure. The live counter-case is worse: comparing a gpt-5 baseline against gpt-5.5 answers sells an instrument swap as the change working or failing. An answer on a model the baseline never saw now starts its OWN segment: excluded from the direction arithmetic, still listed in instruments, and named in its own sentence.
    expect(outcome?.after.checked).toBe(20); expect(outcome?.line ? [outcome.line, ...(outcome.metricLines ?? [])].join(" ") : "").toBeDefined();});
  /** THE INSTRUMENT IS THE EXACT TUPLE (Codex, 2026-08-23): engine, served model and mode TOGETHER. The marginal lists cross, and a cross authorizes pairings nobody observed; the frozen tuples are the only authority. */
  it("never lets engines and modes seen apart authorize the pairing, and names the cross as its own segment", async () => {
    const readObservations = reader([
      ...days("2026-07-21", "2026-07-31", () => ({ mentioned: true })), // the one frozen tuple: chatgpt, gpt-5, api
      ...days("2026-07-21", "2026-07-31", () => ({ mentioned: true, observation_mode: "consumer_search" })), // the read returns slot 0 only, so the cross rides the same slot
    ]); const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: frozen({
      engines: ["chatgpt", "gemini"], models: ["gpt-5", "g-web"], modes: ["api", "consumer_search"],
      instruments: ["chatgpt|gpt-5|api", "gemini|g-web|consumer_search"] }), aiScope: scope("owned_mentioned_not_cited") },
      { readObservations, now: NOW });
    // Both marginal lists contain gpt-5 and consumer_search, and the exact record still refuses the pairing.
    expect(outcome?.after.checked).toBe(44); expect(outcome?.line).toContain("44 answers arrived on ChatGPT on gpt-5 (consumer search), which this change's starting numbers never saw");});
  it("treats the same model and mode on a different engine as a new instrument, never a member", async () => {
    const readObservations = reader([ ...days("2026-07-21", "2026-07-31", () => ({ mentioned: true })),
      ...days("2026-07-21", "2026-07-31", () => ({ mentioned: true, engine: "gemini" })),]); const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP,
      shipmentBaseline: frozen({ instruments: ["chatgpt|gpt-5|api"] }), aiScope: scope("owned_mentioned_not_cited") },
      { readObservations, now: NOW });
    expect(outcome?.after.checked).toBe(44); // gpt-5 on api is not one instrument: Gemini's copy is its own segment
    expect(outcome?.line).toContain("Gemini on gpt-5 (api), which this change's starting numbers never saw");});
  /** CONTROLS SIT ON THE SAME TUPLE AS THE READING THEY ADJUST: an unaffected question answered on an instrument the comparison excludes would subtract that other instrument's weather from this verdict. */
  it("holds no control from an instrument the comparison excludes, and keeps the same rows as controls on the frozen tuple", async () => {
    const ctlDays = (from: string, to: string, make: (i: number) => Partial<AiObservationRecord> & { mentioned?: boolean | null }) =>
      eachDay(from, to, 4, (day, i) => [row({ prompt_id: "p-ctl", prompt_text: "an unaffected question", day, ...make(i) })]); const members = days("2026-07-21", "2026-07-31", () => ({ mentioned: true }));
    const on = (over: Partial<AiObservationRecord>) => [
      ...ctlDays("2026-07-15", "2026-07-20", () => ({ mentioned: false, ...over })),
      ...ctlDays("2026-07-21", "2026-07-31", () => ({ mentioned: true, ...over })),]; const ask = async (rows: AiObservationRecord[]) => aiOutcomeForShipment(T, { implementedAt: STAMP,
      shipmentBaseline: frozen({ instruments: ["chatgpt|gpt-5|api"] }), aiScope: scope("owned_mentioned_not_cited") },
      { readObservations: reader(rows), now: NOW }); const foreign = await ask([...members, ...on({ engine: "gemini", model_served: "g-web", observation_mode: "consumer_search" })]);
    expect(foreign?.controls).toBeNull(); // every control answer sits on an excluded instrument, so none holds
    expect(foreign?.line).toContain("No unaffected question of yours held enough answers over these days"); const same = await ask([...members, ...on({})]);
    expect([same?.controls?.questions, same?.controls?.mentionDrift]).toEqual([1, 1]); // 0 of 24 naming before, 44 of 44 since
  });
  /** PIN: a baseline that could not be read at mark time is never rebuilt later. The implementation is recorded either way, and the AI half says it cannot be read rather than comparing today against today. */
  it("reports an unmeasurable AI outcome when no starting numbers were frozen, and rebuilds none", async () => {
    const readObservations = reader([...days("2026-07-19", "2026-07-20", () => ({ mentioned: false })), ...days("2026-07-21", "2026-07-31", () => ({ mentioned: true }))]);
    const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: null, aiScope: scope("owned_mentioned_not_cited") },
      { readObservations, now: NOW }); expect(outcome?.direction).toBe("unclear"); expect(outcome?.before).toMatchObject({ from: "unavailable", rate: null });
    expect(outcome?.after.checked).toBe(0);              // and the days before it were NOT quietly promoted to a baseline
    expect(outcome?.terminal).toBe(true); // Not measurable is terminal, never "reading" forever
    expect(outcome?.line).toBe("Not measurable: where the AI answers stood when this was marked done was not on file, so what happened since cannot be read as a direction, and a starting point is never rebuilt after the fact. The change itself is recorded.");
  }); });
/** BEING READ AND PASSED OVER IS A BAD RATE (reviewer, 2026-08-19): every rising rate read as an improvement, so a page read MORE often and credited elsewhere MORE often came back flat on the one objective raised to stop exactly that. The whole table is here, because a sign error hides in the combination nobody wrote. */
describe("a conversion objective is graded on both halves, each on its own polarity", () => {
  const NOW = new Date("2026-08-18T12:00:00.000Z"), STAMP = "2026-07-21T10:00:00.000Z", RIVAL = "rival.example"; // The mature clock: a verdict lands at day 28 and not before (Codex, 2026-08-21).
  const links = (d: string) => [{ url: `https://${d}/page`, domain: d, title: null }];
  /** One answer to this change's own question, saying what it credited and what it read. Null on either side = the engine reported nothing there, so that answer joins no sample at all. */
  const answer = (day: string, i: number, cited: string | null, read: string | null) =>
    row({ day, id: `obs-${day}-${i}`, prompt_id: "p1", prompt_text: "where should I go", mentioned: true,
      journey: { fan_outs: null, brand_mentions: null, web_search_reported: null,
        cited_sources: cited == null ? null : links(cited), retrieved_results: read == null ? null : links(read) } });
  type Shape = [cited: string | null, read: string | null];
  const CREDITED: Shape = [SITE, SITE];           // read a page of yours and credited it
  const PASSED_OVER: Shape = [RIVAL, SITE];       // read a page of yours and credited a rival
  const ELSEWHERE: Shape = [RIVAL, RIVAL];        // never read a page of yours
  const CREDITED_UNREAD: Shape = [SITE, RIVAL];   // credited it without reporting that it read it
  const SILENT: Shape = [null, null];             // reported neither, so it is in no denominator
  /** The full 28 days since the change, four answers a day, the same four shapes every day. */
  const since = (shapes: Shape[]) =>
    eachDay("2026-07-21", "2026-08-17", shapes.length, (day, i) => [answer(day, i, ...shapes[i]!)]);
  /** The frozen starting point at an adequate size: 40 answers, `citing` of each 10 crediting the page, and `passedOver` of each 10 that read it passed over. Four-answer sides can never support a verdict now. */
  const before = (citing: number, passedOver: number) => ({ ai: { day: "2026-07-20", checked: 44, analyzed: 40, mentioning: 40,
    citationSample: 40, ownedCiting: citing * 10, rankSum: citing * 10, rankCount: citing * 10,
    retrievalSample: 40, ownedRetrieved: 40, retrievedNotCited: passedOver * 10 } }); const judged = (held: ReturnType<typeof before>, shapes: Shape[]) =>
    aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: held,
      aiScope: { promptIds: ["p1"], engines: [], fanouts: [], stage: "owned_retrieved_not_cited" } },
    { readObservations: reader(since(shapes)), now: NOW }); const CASES: Array<[string, ReturnType<typeof before>, Shape[], string]> = [
    ["credited more often and passed over less often is the win", before(1, 3), [CREDITED, CREDITED, CREDITED, PASSED_OVER], "improved"],
    ["credited more often and passed over MORE often is a loss on the thing it was raised to fix", before(1, 1), [CREDITED, CREDITED_UNREAD, PASSED_OVER, PASSED_OVER], "worsened"],
    ["credited exactly as often and passed over less often is progress, not the win", before(1, 3), [CREDITED, ELSEWHERE, PASSED_OVER, ELSEWHERE], "no_clear_movement"],
    ["credited exactly as often and passed over MORE often is a loss, never flat", before(1, 1), [CREDITED, PASSED_OVER, PASSED_OVER, ELSEWHERE], "worsened"],
    ["credited less often and passed over less often is still a loss", before(3, 3), [CREDITED, ELSEWHERE, PASSED_OVER, ELSEWHERE], "worsened"],
    ["credited less often and passed over MORE often is a loss on both halves", before(3, 1), [CREDITED, PASSED_OVER, PASSED_OVER, ELSEWHERE], "worsened"],
    ["neither half reported by any answer is unreadable, never a verdict", before(1, 1), [SILENT, SILENT, SILENT, SILENT], "unclear"],];
  it.each(CASES)("%s", async (_label, held, shapes, direction) => {
    expect((await judged(held, shapes))?.direction).toBe(direction); });
  it("says out loud that being passed over rose, on the numbers, instead of reporting no change", async () => {
    const outcome = await judged(before(1, 1), [CREDITED, PASSED_OVER, PASSED_OVER, ELSEWHERE]);
    expect([outcome?.citations.before.rate, outcome?.citations.after.rate]).toEqual([0.25, 0.25]); // Credited on exactly the share it started at, and passed over on two thirds of the answers that read the page, up from a quarter.
    expect([outcome?.retrievedNotCited.before.rate, outcome?.retrievedNotCited.after.rate]).toEqual([0.25, 0.667]);
    expect(outcome?.metricLines).toContain("Read and passed over on a larger share than before, which is the thing this change was raised to stop.");
    expect(outcome?.line).not.toMatch(/[—–]/); // no em or en dashes, ever
  });
  it("still reads a rising GOOD rate as the improvement it is", async () => {
    // The polarity is per metric, not a blanket flip: being read more often is exactly what a retrieval objective wants. It started read on ten of the forty answers on file and every answer since has read it.
    const started = { ai: { ...before(1, 1).ai, ownedRetrieved: 10, retrievedNotCited: 10 } }; const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: started,
      aiScope: { promptIds: ["p1"], engines: [], fanouts: [], stage: "rivals_cited_own_not_retrieved" } },
    { readObservations: reader(since([CREDITED, CREDITED, PASSED_OVER, PASSED_OVER])), now: NOW });
    expect([outcome?.objective, outcome?.retrieval.after.rate, outcome?.direction]).toEqual(["ai_retrieval", 1, "improved"]); }); });
/** THE CONTROLS ARE THE ACCOUNT'S OWN UNAFFECTED QUESTIONS (Codex, 2026-08-21), never bought: their drift comes off the verdict, and two assistants that disagree come back split, never averaged. */
describe("controls and per-assistant verdicts", () => {
  const NOW28 = new Date("2026-08-18T12:00:00.000Z"), STAMP = "2026-07-21T10:00:00.000Z";
  const mk = (day: string, i: number, promptId: string, promptText: string, mentioned: boolean, engine: "chatgpt" | "gemini" = "chatgpt") =>
    row({ day, id: `o-${promptId}-${engine}-${day}-${i}`, prompt_id: promptId, prompt_text: promptText, engine, mentioned }); const HELD = { ai: { day: "2026-07-20", checked: 44, analyzed: 40, mentioning: 10 } };
  const judge = (rows: AiObservationRecord[]) => aiOutcomeForShipment(T,
    { scopeQueries: ["where should I go"], implementedAt: STAMP, shipmentBaseline: HELD }, { readObservations: reader(rows), now: NOW28 });
  const C1 = "an unaffected question", C2 = "another unaffected question", MINE = "where should I go";
  it("subtracts the unaffected questions' own drift before calling a verdict", async () => {
    const outcome = await judge([ // The change's searches rose from 25 to 100 percent, and so did every unaffected question, by exactly as much: the world moved, not the change, and the receipt says so.
      ...eachDay("2026-07-14", "2026-07-20", 2, (d, i) => [mk(d, i, "c1", C1, i === 0), mk(d, i, "c2", C2, false)]),
      ...eachDay("2026-07-21", "2026-08-17", 2, (d, i) => [mk(d, i, "p1", MINE, true), mk(d, i, "c1", C1, true), mk(d, i, "c2", C2, true)])]);
    expect([outcome?.controls?.questions, outcome?.controls?.mentionDrift]).toEqual([2, 0.75]);
    expect(outcome?.direction).toBe("no_clear_movement"); // the drift ate the whole rise
    expect(outcome?.line).toContain("their movement is subtracted before anything is called"); });
  it("calls the same rise a win when the unaffected questions held still", async () => {
    const outcome = await judge([
      ...eachDay("2026-07-14", "2026-07-20", 2, (d, i) => [mk(d, i, "c1", C1, i === 0)]),
      ...eachDay("2026-07-21", "2026-08-17", 2, (d, i) => [mk(d, i, "p1", MINE, true), mk(d, i, "c1", C1, i === 0)])]); expect([outcome?.controls?.mentionDrift, outcome?.direction]).toEqual([0, "improved"]); });
  it("reports a split when two assistants genuinely disagree, never an average", async () => {
    const outcome = await judge([ // ChatGPT names the account on every answer since; Gemini stops naming it at all. Both mature, both adequately sampled, and the one honest overall answer is that they split.
      ...eachDay("2026-07-14", "2026-07-20", 2, (d, i) => [mk(d, i, "p1", MINE, i === 0), mk(d, i, "p1", MINE, i === 0, "gemini")]),
      ...eachDay("2026-07-21", "2026-08-17", 2, (d, i) => [mk(d, i, "p1", MINE, true), mk(d, i, "p1", MINE, false, "gemini")])]);
    expect(outcome?.direction).toBe("mixed"); expect(new Set(outcome?.perEngine.map((e) => e.direction))).toEqual(new Set(["improved", "worsened"])); expect(outcome?.line).toContain("The assistants disagree"); }); });
/** THE FINGERPRINT COVERS THE WHOLE SCOPE (reviewer, 2026-08-19): hashing prompt ids, cluster key and engines alone let a baseline keep the identity of a claim whose wordings, models, modes, observation ids or stage had all moved on. Membership is what it must cover; write order is not membership. */
describe("the identity of the scope a baseline was frozen over", () => {
  const DAY = "2026-07-20";
  const SCOPE = { caseKey: "fanout:haft-seen", promptIds: ["p1", "p2"], promptVersions: [1, 2], engines: ["chatgpt", "gemini"],
    models: ["gpt-5", "gpt-5.5"], modes: ["api", "consumer_search"], fanoutKey: "haft seen table items list",
    fanouts: ["alpha search", "beta search"], observationIds: ["obs-a", "obs-b"], stage: "owned_mentioned_not_cited" };
  const readObservations = vi.fn(async (_t: string, o: { day?: string }) => // A store that answers the probe AND the day it names, so every scope below freezes off the same single answer and only the scope moves.
    (o.day == null || o.day === DAY ? [row({ day: DAY, prompt_id: "p1", engine: "chatgpt", mentioned: true })] : []));
  const print = async (over: Partial<typeof SCOPE> = {}): Promise<string> =>
    (await aiBaselineFor(T, { ...SCOPE, ...over }, { readObservations }))!.scopeFingerprint!;
  it("changes when ANY field that decides membership changes", async () => {
    const prints = await Promise.all(([{}, { promptIds: ["p1", "p3"] }, { promptVersions: [1, 3] }, { engines: ["chatgpt", "claude"] },
      { models: ["gpt-5", "gpt-6"] }, { modes: ["api", "app"] }, { fanoutKey: "another cluster" }, { fanouts: ["alpha search", "gamma search"] },
      { observationIds: ["obs-a", "obs-c"] }, { stage: "owned_retrieved_not_cited" }] as Array<Partial<typeof SCOPE>>).map((o) => print(o)));
    expect(prints).toHaveLength(10);
    expect(new Set(prints).size).toBe(10); // ten scopes, ten identities: not one of them answers to another one's baseline
  });
  it("never changes when a list is merely written in another order", async () => {
    expect(await print({ promptIds: ["p2", "p1"], promptVersions: [2, 1], engines: ["gemini", "chatgpt"], models: ["gpt-5.5", "gpt-5"],
      modes: ["consumer_search", "api"], fanouts: ["beta search", "alpha search"], observationIds: ["obs-b", "obs-a"] })).toBe(await print()); }); });
