/** AI OUTCOME MEASUREMENT (V1 Truth Convergence Phase 7). Protected here: only the canonical first reading of a question feeds a trend; a rate with nothing behind it is null and never zero; a model or mode change splits the series and is named; a Shipment is judged before against after on the same rule with its coverage visible; thin coverage is "unclear", not a verdict; a missed day stays missed; and one account never reads another's answers. Fixtures only: every read is injected, zero network, zero cost. */
import { describe, it, expect, vi } from "vitest";

import { aiOutcomeForShipment, aiOutcomes, aiOutcomesForShipments, visibilitySeries } from "@/domains/measurement/ai-outcomes";
import type { AiObservationRecord } from "@/domains/evidence/ai-visibility/ai-observations";

const T = "acct-a", SITE = "fixture-outdoors.example";

type RowOver = Partial<AiObservationRecord> & { day?: string; mentioned?: boolean | null };

/** One stored observation, in the shape the store actually holds. */
function row(over: RowOver = {}): AiObservationRecord {
  const { day, mentioned, ...rest } = over;
  const reporting_day = day ?? "2026-07-20";
  const analysis = mentioned == null ? null : { ownedBrandMention: { mentioned, position: null, context: null }, competitors: [] };
  return {
    id: `obs-${reporting_day}-${rest.engine ?? "chatgpt"}-${rest.prompt_id ?? "p1"}-${rest.sample_slot ?? 0}`,
    tenant_id: T, site: SITE, prompt_id: "p1", prompt_version: 1, prompt_text: "where should I go",
    engine: "chatgpt", model_requested: null, model_served: "gpt-5", observation_mode: "api",
    reporting_day, sample_slot: 0, language: "en", location: 2840, capability_version: "v1", cache_key: null,
    requested_at: `${reporting_day}T09:00:00.000Z`, completed_at: `${reporting_day}T09:00:10.000Z`,
    cost_usd: 0, status: "observed", failure_reason: null, answer_text: "an answer", answer_hash: "abc",
    journey: { fan_outs: null, retrieved_results: null, cited_sources: null, brand_mentions: null, web_search_reported: null },
    // A settled reading carries the ANSWER's own hash: the whole answer was read. A stored partial deliberately carries a different hash, which is exactly what keeps it out of every denominator.
    analysis, analysis_hash: analysis ? "abc" : null, ...rest,
  } as AiObservationRecord;
}

const link = (domain: string) => ({ url: `https://${domain}/page`, domain, title: null });
/** A store that answers like the real one: only the slot and the day range that were ASKED for, a named range read whole, and a fixed count never exceeded. A module that asks for the newest N rows and narrows to its range afterwards gets a truncated history here, exactly as it does in production. */
const reader = (rows: AiObservationRecord[]) =>
  vi.fn(async (_t: string, o: { limit?: number; slot?: number; fromDay?: string; toDay?: string }) =>
    rows.filter((r) => (o.slot === undefined || r.sample_slot === o.slot)
      && (!o.fromDay || r.reporting_day >= o.fromDay) && (!o.toDay || r.reporting_day <= o.toDay))
      .slice(0, o.limit ?? (o.fromDay || o.toDay ? 40_000 : 500)).map((r) => ({ ...r })));
const allDays = (report: Awaited<ReturnType<typeof aiOutcomes>>) => report.segments.flatMap((s) => s.days);

describe("the daily AI trend, over stored answers only", () => {
  it("counts the mention rate over the answers actually read, and says null when none were read", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", prompt_id: "p1", mentioned: true }),
      row({ day: "2026-07-20", prompt_id: "p2", mentioned: false }),
      row({ day: "2026-07-20", prompt_id: "p3", mentioned: null }), // answered, never analyzed
      row({ day: "2026-07-21", prompt_id: "p1", mentioned: null }),
      row({ day: "2026-07-21", prompt_id: "p2", mentioned: null }),
    ]);
    const days = allDays(await aiOutcomes(T, { from: "2026-07-19", to: "2026-07-22", readObservations }));
    expect(days.map((d) => d.day)).toEqual(["2026-07-20", "2026-07-21"]);
    // Three answers came back; two of them were read closely; one of those two named the account.
    expect(days[0]).toMatchObject({ observed: 3, analyzed: 2, mentioning: 1, mentionRate: 0.5 });
    // NOTHING was read closely on the 21st, so the rate is null. Zero would claim AI never named them.
    expect(days[1]).toMatchObject({ observed: 2, analyzed: 0, mentioning: 0, mentionRate: null });
  });
  it("reads citations, citation rank and retrieved-but-not-cited only where the engine reported them", async () => {
    const journey = (over: Partial<AiObservationRecord["journey"]>) =>
      ({ fan_outs: null, retrieved_results: null, cited_sources: null, brand_mentions: null, web_search_reported: null, ...over });
    const readObservations = reader([
      // Credited third, behind two others.
      row({ day: "2026-07-20", prompt_id: "p1", mentioned: true, journey: journey({ cited_sources: [link("rival.example"), link("other.example"), link(`www.${SITE}`)] }) }),
      // Read the page and credited someone else.
      row({ day: "2026-07-20", prompt_id: "p2", mentioned: false, journey: journey({ cited_sources: [link("rival.example")], retrieved_results: [link(SITE)] }) }),
      // The engine reported nothing about its sources at all: it joins neither sample.
      row({ day: "2026-07-20", prompt_id: "p3", mentioned: false }),
      // THE SAME page of yours, read and then CREDITED, differing only by www, scheme, a trailing slash and a fragment. A page the engine cited was never a page it read and passed over.
      row({ day: "2026-07-20", prompt_id: "p4", mentioned: true, journey: journey({
        cited_sources: [{ url: `https://www.${SITE}/guide/`, domain: `www.${SITE}`, title: null }],
        retrieved_results: [{ url: `http://${SITE}/guide#top`, domain: SITE, title: null }] }) }),
    ]);
    const [day] = allDays(await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-20", readObservations }));
    expect(day).toMatchObject({
      citationSample: 3, ownedCiting: 2, ownedCitationRate: 0.667, ownedCitationRank: 2,
      retrievalSample: 2, ownedRetrieved: 2, retrievedNotCited: 1, retrievedNotCitedRate: 0.5,
    });
  });
  it("counts a page of yours read and passed over even when the answer credited a DIFFERENT page of yours", async () => {
    // The subtraction is per PAGE, through the one canonical-url derivation. Asking only "did it credit anybody on this site" answers yes here and reports zero, so the page the engine actually read and then ignored disappears behind a neighbour of its own that happened to get the credit.
    const readObservations = reader([row({ day: "2026-07-20", prompt_id: "p1", mentioned: true, journey: {
      fan_outs: null, brand_mentions: null, web_search_reported: null,
      retrieved_results: [{ url: `https://${SITE}/guide`, domain: SITE, title: null }],
      cited_sources: [{ url: `https://${SITE}/other`, domain: SITE, title: null }] } })]);
    const [day] = allDays(await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-20", readObservations }));
    expect(day).toMatchObject({ retrievalSample: 1, ownedRetrieved: 1, retrievedNotCited: 1, retrievedNotCitedRate: 1 });
  });
  it("says null for retrieved-but-not-cited when the journey never recorded what was read", async () => {
    const readObservations = reader([row({ day: "2026-07-20", mentioned: true })]);
    const [day] = allDays(await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-20", readObservations }));
    expect(day.retrievalSample).toBe(0);
    expect(day.retrievedNotCitedRate).toBeNull();
    expect(day.ownedCitationRate).toBeNull();
    expect(day.ownedCitationRank).toBeNull();
  });
  it("keeps the extra volatility samples out of the trend entirely", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", prompt_id: "p1", mentioned: false }),
      row({ day: "2026-07-20", prompt_id: "p1", sample_slot: 1, mentioned: true }),
      row({ day: "2026-07-20", prompt_id: "p1", sample_slot: 2, mentioned: true }),
    ]);
    const [day] = allDays(await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-20", readObservations }));
    // Slot 0 said no. Two extra samples said yes and neither one may move the line.
    expect(day).toMatchObject({ observed: 1, analyzed: 1, mentioning: 0, mentionRate: 0 });
  });
  it("counts what each engine was asked against what came back, and never invents a missed day", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", prompt_id: "p1", engine: "chatgpt", mentioned: true }),
      row({ day: "2026-07-20", prompt_id: "p2", engine: "chatgpt", status: "failed", mentioned: null }),
      row({ day: "2026-07-20", prompt_id: "p3", engine: "chatgpt", mentioned: null }), // came back, nobody has read it closely yet
      row({ day: "2026-07-20", prompt_id: "p1", engine: "claude", model_served: "claude-4", mentioned: false }),
      // Nothing at all on the 21st. The 22nd resumes.
      row({ day: "2026-07-22", prompt_id: "p1", engine: "chatgpt", mentioned: true }),
    ]);
    const report = await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-22", readObservations });
    const days = allDays(report);
    expect(days.map((d) => d.day)).toEqual(["2026-07-20", "2026-07-22"]); // the 21st is missing, not zero
    expect(report.daysObserved).toBe(2);
    expect(days[0].byEngine).toEqual([
      // `analyzed` is each engine's OWN denominator, and it is smaller than what came back while a day is still being read: a per-engine share used to have no denominator at all and had to borrow the day's pooled one, which reports one fraction over four engines that are nothing like each other.
      { engine: "chatgpt", modelServed: "gpt-5", mode: "api", asked: 3, observed: 2, analyzed: 1, mentioning: 1, citedOwned: 0 },
      { engine: "claude", modelServed: "claude-4", mode: "api", asked: 1, observed: 1, analyzed: 1, mentioning: 0, citedOwned: 0 },
    ]);
  });
  it("asks the store for the day range and the first readings, so nothing is narrowed after the read", async () => {
    const readObservations = reader([row({ day: "2026-07-20", mentioned: true })]);
    await aiOutcomes(T, { from: "2026-07-19", to: "2026-07-21", readObservations });
    // Asking for the newest N rows and cutting to the range afterwards spends the whole read on the newest days and on samples this trend then throws away, so the older half of the range vanishes. AND IT ASKS FOR WHAT IT READS: the overview projection, never the whole row, whose answer text and stored verdict are megabytes a trend never opens.
    expect(readObservations).toHaveBeenCalledWith(T, { fromDay: "2026-07-19", toDay: "2026-07-21", slot: 0, projection: "overview" });
  });
  /** `prompts` questions x four engines x `days` days of first readings: the shape a real account stores. */
  const history = (days: number, prompts: number) =>
    Array.from({ length: days }).flatMap((_, d) => Array.from({ length: prompts }).flatMap((__, p) =>
      (["chatgpt", "claude", "gemini", "perplexity"] as const).map((engine) =>
        row({ day: new Date(Date.parse("2026-07-01T00:00:00.000Z") + d * 86_400_000).toISOString().slice(0, 10), prompt_id: `p${p}`, engine, mentioned: true }))));
  const observedIn = (report: Awaited<ReturnType<typeof aiOutcomes>>) => allDays(report).reduce((n, d) => n + d.observed, 0);
  it("reads the WHOLE requested range, never the first page of it", async () => {
    const rows = history(28, 35); // 35 questions x 4 engines x 28 days
    expect(rows).toHaveLength(3920);
    const report = await aiOutcomes(T, { from: "2026-07-01", to: "2026-07-28", readObservations: reader(rows) });
    const days = allDays(report);
    // A 2,000 row cap over the newest readings held about a fortnight, so a 28 day report was half a month.
    expect([observedIn(report), days[0]!.day, days.at(-1)!.day, days.length]).toEqual([3920, "2026-07-01", "2026-07-28", 28]);
    expect(observedIn(await aiOutcomes(T, { from: "2026-07-01", to: "2026-07-30", readObservations: reader(history(30, 50)) }))).toBe(6000);
  });
  it("never reads another account's answers", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", prompt_id: "p1", mentioned: true }),
      row({ day: "2026-07-20", prompt_id: "p9", tenant_id: "acct-b", mentioned: true }),
    ]);
    const [day] = allDays(await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-20", readObservations }));
    expect(day.observed).toBe(1);
  });
});

describe("the model and mode boundary", () => {
  it("splits the series the day an engine changes model, and names the break", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", model_served: "gpt-5", mentioned: true }),
      row({ day: "2026-07-21", model_served: "gpt-5", mentioned: true }),
      row({ day: "2026-07-22", model_served: "gpt-5.5", mentioned: false }),
      row({ day: "2026-07-23", model_served: "gpt-5.5", mentioned: false }),
    ]);
    const { segments } = await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-23", readObservations });
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ from: "2026-07-20", to: "2026-07-21", boundary: null });
    expect(segments[1]).toMatchObject({ from: "2026-07-22", to: "2026-07-23" });
    expect(segments[1].boundary).toEqual([
      { engine: "chatgpt", day: "2026-07-22", fromModel: "gpt-5", toModel: "gpt-5.5", fromMode: "api", toMode: "api" },
    ]);
    expect(segments[1].models).toEqual([{ engine: "chatgpt", modelServed: "gpt-5.5", mode: "api" }]);
  });
  it("splits on a mode change too, and a silent engine never breaks the line on its own", async () => {
    const readObservations = reader([
      row({ day: "2026-07-20", mentioned: true }),
      // The engine was asked and said nothing: no answer, so no evidence the instrument changed.
      row({ day: "2026-07-21", status: "unavailable", model_served: null, mentioned: null }),
      row({ day: "2026-07-22", observation_mode: "consumer_search", mentioned: true }),
    ]);
    const { segments } = await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-22", readObservations });
    expect(segments).toHaveLength(2);
    expect(segments[0].days.map((d) => d.day)).toEqual(["2026-07-20", "2026-07-21"]);
    expect(segments[1].boundary).toEqual([
      { engine: "chatgpt", day: "2026-07-22", fromModel: "gpt-5", toModel: "gpt-5", fromMode: "api", toMode: "consumer_search" },
    ]);
  });
  it("hands the chart the same cut series over a trailing window", async () => {
    const readObservations = reader([
      row({ day: "2026-07-29", model_served: "gpt-5", mentioned: true }),
      row({ day: "2026-07-31", model_served: "gpt-6", mentioned: true }),
      row({ day: "2026-06-01", model_served: "gpt-4", mentioned: true }), // outside the window
    ]);
    const segments = await visibilitySeries(T, 7, { readObservations, now: new Date("2026-07-31T12:00:00.000Z") });
    expect(segments.flatMap((s) => s.days).map((d) => d.day)).toEqual(["2026-07-29", "2026-07-31"]);
    expect(segments).toHaveLength(2);
    expect(segments[1].boundary?.[0]).toMatchObject({ fromModel: "gpt-5", toModel: "gpt-6" });
  });
});

describe("what the AI answers did around one shipped change", () => {
  const NOW = new Date("2026-07-31T12:00:00.000Z");
  const STAMP = "2026-07-21T10:00:00.000Z", Q = ["where should I go"]; // the searches THIS change was aimed at, which is what every fixture answer asks
  /** Every day from `from` to `to`, four questions a day, `named` of them naming the account. */
  const stretch = (from: string, to: string, named: number) => {
    const out: AiObservationRecord[] = [];
    for (let d = new Date(`${from}T00:00:00.000Z`); d <= new Date(`${to}T00:00:00.000Z`); d = new Date(d.getTime() + 86_400_000)) {
      const day = d.toISOString().slice(0, 10);
      for (let i = 0; i < 4; i += 1) out.push(row({ day, prompt_id: `p${i}`, mentioned: i < named }));
    }
    return out;
  };
  /** BOTH SIDES ARE ONE MEASURE. The starting number written at mark time counts the answers that came back AND the ones read closely enough to say whether the account was named, and the rate divides by the second. Dividing by everything that came back made the before side a different metric from the after side, so a change was judged by a subtraction of two unlike numbers. */
  it("divides the starting number by the answers READ CLOSELY, so before and after are the same measure", async () => {
    // 140 answers, 100 read closely, 60 naming the account: the rate before is 0.6. Counted the old way it was 0.43, which is BELOW the 0.5 the answers since have run at, so the same day's data read as a rise.
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 2));
    const outcome = await aiOutcomeForShipment(T, {
      scopeQueries: Q, implementedAt: STAMP,
      shipmentBaseline: { ai: { day: "2026-07-20", checked: 140, analyzed: 100, mentioning: 60 } },
    }, { readObservations, now: NOW });
    expect(outcome?.before).toMatchObject({ day: "2026-07-20", checked: 100, mentioning: 60, rate: 0.6, from: "on_file" });
    expect(outcome?.after.rate).toBe(0.5);
    expect(outcome?.direction).toBe("worsened");
    expect(outcome?.line).toContain("60 of 100 before it");
  });
  it("recounts a starting number written the old way from that day's own answers, and asks for that exact day", async () => {
    // A baseline written before `analyzed` existed carries no denominator I can trust, and it is write-once, so it is never rewritten. The day itself is still on file, well outside the 28 days ahead of the stamp, so the store is asked for that one day and the before side is recounted the same way as the after.
    const readObservations = reader([...stretch("2026-06-10", "2026-06-10", 3), ...stretch("2026-07-21", "2026-07-31", 3)]);
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-06-10", checked: 8, mentioning: 2 } }, }, { readObservations, now: NOW });
    expect(readObservations).toHaveBeenCalledWith(T, { fromDay: "2026-06-10", toDay: "2026-06-10", slot: 0, projection: "outcome" });
    expect(outcome?.before).toMatchObject({ day: "2026-06-10", checked: 4, mentioning: 3, rate: 0.75, from: "stored_answers" });
    expect(outcome?.direction).toBe("flat"); // 0.75 then, 0.75 now. The stored 2 of 8 would have read as a rise.
  });
  it("refuses to turn a starting number counted the old way into a direction when its day is gone", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 4));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-05-01", checked: 8, mentioning: 2 } }, }, { readObservations, now: NOW });
    expect(outcome?.before).toMatchObject({ day: "2026-05-01", rate: null, from: "on_file_legacy" });
    expect(outcome?.direction).toBe("unclear");
    expect(outcome?.line).toContain("counted a different way");
    expect(outcome?.line).not.toMatch(/[—–]/);
  });
  it("says unclear when the starting day itself was barely read, however clear the days since are", async () => {
    // 40 of 140 answers read closely on the day this change starts from. The share those 40 carry is a fact about how much analysis finished that day, not about what AI said, so it is not one end of a direction.
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 4));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 140, analyzed: 40, mentioning: 24 } }, }, { readObservations, now: NOW });
    expect(outcome?.after.rate).toBe(1);
    expect(outcome?.direction).toBe("unclear");
  });
  it("compares the starting number on file against every day since, and says which way it went", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 3));
    const outcome = await aiOutcomeForShipment(T, {
      scopeQueries: Q, implementedAt: STAMP,
      shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 1 } },
    }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("improved");
    expect(outcome?.before).toMatchObject({ day: "2026-07-20", checked: 4, mentioning: 1, rate: 0.25, from: "on_file" });
    expect(outcome?.after).toMatchObject({ from: "2026-07-21", to: "2026-07-31", checked: 44, mentioning: 33, rate: 0.75 });
    expect(outcome?.coverage).toEqual({ daysObserved: 11, daysElapsed: 11 });
    expect(outcome?.line).toContain("on 11 of the 11 days since you marked this done");
    expect(outcome?.line).not.toMatch(/[\u2014\u2013]/); // no em or en dashes, ever
  });
  it("falls back to the last day of stored answers before the change when nothing was written down", async () => {
    const readObservations = reader([
      ...stretch("2026-07-19", "2026-07-20", 3), // the last day before the change is the one it uses
      ...stretch("2026-07-21", "2026-07-31", 1),
    ]);
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: null } }, { readObservations, now: NOW });
    expect(outcome?.before).toMatchObject({ day: "2026-07-20", checked: 4, mentioning: 3, rate: 0.75, from: "stored_answers" });
    expect(outcome?.direction).toBe("worsened");
    expect(outcome?.line).toContain("down from 3 of 4 before it");
  });
  it("counts the share over the answers it actually READ, so unfinished analysis is not a fall", async () => {
    // Every answer read closely named the account; a quarter of them have not been read yet. Dividing by everything that came back would report that backlog as AI turning against the account.
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 4)
      .map((r, i) => (i % 4 === 3 ? { ...r, analysis: null, analysis_hash: null } : r)));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 10, analyzed: 10, mentioning: 10 } }, }, { readObservations, now: NOW });
    expect(outcome?.after).toMatchObject({ checked: 44, analyzed: 33, mentioning: 33, rate: 1 });
    expect(outcome?.direction).toBe("flat");
    expect(outcome?.line).toContain("named in 33 of the 33 I have finished checking");
  });
  it("says null, never zero, when nothing since the change has been read closely", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 3)
      .map((r) => ({ ...r, analysis: null, analysis_hash: null })));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 1 } }, }, { readObservations, now: NOW });
    expect(outcome?.after).toMatchObject({ analyzed: 0, mentioning: 0, rate: null });
    expect(outcome?.direction).toBe("unclear");
  });
  it("calls the same share flat", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 2));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 2 } }, }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("flat");
  });
  it("says unclear when I read fewer than half the days that have passed", async () => {
    // Eleven days have passed and only three carry a reading.
    const readObservations = reader(stretch("2026-07-21", "2026-07-23", 4));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 0 } }, }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("unclear");
    expect(outcome?.coverage).toEqual({ daysObserved: 3, daysElapsed: 11 });
    expect(outcome?.line).toContain("too little to call either way yet");
  });
  it("says unclear when there is nothing from before the change to compare against", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 4));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: null } }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("unclear");
    expect(outcome?.before).toMatchObject({ from: "nothing", rate: null });
    expect(outcome?.line).toContain("nothing from before the change");
  });
  /** ONE CHANGE, ITS OWN SEARCHES. This read used to take EVERY answer the account bought in the window, so a page nobody asked about inherited another page's rise and a Result implied a lesson those answers cannot carry. Membership is the searches the change was aimed at: the question asked, or a search the engine itself reported running to answer it. */
  it("judges a change on its own searches only, and calls an unscopable one unavailable rather than account wide", async () => {
    const elsewhere = (r: AiObservationRecord) => ({ ...r, prompt_id: `x${r.prompt_id}`, prompt_text: "best rugs to buy" });
    const readObservations = reader([...stretch("2026-07-21", "2026-07-31", 0), ...stretch("2026-07-21", "2026-07-31", 4).map(elsewhere)]);
    const held = { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 2 } };
    const mine = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: held }, { readObservations, now: NOW });
    const other = await aiOutcomeForShipment(T, { scopeQueries: ["best rugs to buy"], implementedAt: STAMP, shipmentBaseline: held }, { readObservations, now: NOW });
    expect([mine?.after.rate, other?.after.rate]).toEqual([0, 1]); // two pages' answers never cross, and the account-wide read would have said 0.5 on both
    const noScope = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: held }, { readObservations, now: NOW });
    expect(noScope).toMatchObject({ direction: "unclear", after: { checked: 0, analyzed: 0, rate: null } });
    expect(noScope?.line).toContain("which searches this change was aimed at");
  });
  it("says unclear when most of the answers since were never read closely", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 3).map((r, i) => (i % 4 === 0 ? r : { ...r, analysis: null, analysis_hash: null })));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 1 } }, }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("unclear");
    expect(outcome?.after.analyzed).toBeLessThan(outcome!.after.checked);
  });
  it("bounds the window at 28 days and needs a stamp to measure from at all", async () => {
    const readObservations = reader(stretch("2026-07-01", "2026-07-31", 4));
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: "2026-07-01T17:00:00.000Z", shipmentBaseline: { ai: { day: "2026-06-30", checked: 4, analyzed: 4, mentioning: 4 } }, }, { readObservations, now: NOW });
    expect(outcome?.after.to).toBe("2026-07-28");
    expect(outcome?.coverage).toEqual({ daysObserved: 28, daysElapsed: 28 });
    expect(await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: null }, { readObservations, now: NOW })).toBeNull();
  });
  it("reads the whole ledger's answers ONCE, on the lean projection, and still judges each change on its own window", async () => {
    // EVERY shipment used to open its own paged 56 day read of WHOLE rows, all of them at once: ten shipments meant eighty round trips carrying every answer text and retrieval journey in the window, which is the exact shape that has timed a statement out on this table before.
    const rows = stretch("2026-06-01", "2026-07-31", 3);
    const readObservations = reader(rows);
    const shipments = [
      { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 1 } } },
      { scopeQueries: Q, implementedAt: "2026-07-05T10:00:00.000Z", shipmentBaseline: { ai: null } },
      { scopeQueries: Q, implementedAt: null },                                    // no stamp, no moment to measure from
    ];
    const batch = await aiOutcomesForShipments(T, shipments, { readObservations, now: NOW });
    expect(readObservations).toHaveBeenCalledTimes(1);
    // ONE union window covering every stamped shipment, and the projection NAMES what it reads: the identity, the day, the slot, the status and the stored verdict. Never the answer text, never the journey.
    expect(readObservations).toHaveBeenCalledWith(T, { fromDay: "2026-06-07", toDay: "2026-07-31", slot: 0, projection: "outcome" });
    expect(batch).toHaveLength(3);
    expect(batch[2]).toBeNull();
    // And each change is still judged on ITS OWN 28 days, byte for byte what it got when it read alone.
    for (const [i, s] of shipments.entries()) {
      expect(batch[i]).toEqual(await aiOutcomeForShipment(T, s, { readObservations: reader(rows), now: NOW }));
    }
  });
  /** ONE OVERSIZED READ USED TO TAKE THE WHOLE LEDGER'S AI SIDE DOWN. The union window ran from the oldest shipment to the newest, and an account asking 35 questions of 4 engines writes 140 first readings a day, so a ledger spanning a year asked for about 51,000 rows and the store refuses anything past 40,000. Every change then showed no AI outcome at all, including the ones whose own answers read fine. */
  it("reads overlapping windows once and fails only the changes whose own days could not be read", async () => {
    const rows = [...stretch("2026-01-04", "2026-02-28", 3), ...stretch("2026-06-01", "2026-07-31", 3)];
    const asked: Array<{ fromDay?: string; toDay?: string }> = [];
    const readObservations = vi.fn(async (t: string, o: { fromDay?: string; toDay?: string; slot?: number }) => {
      asked.push({ fromDay: o.fromDay, toDay: o.toDay });
      if ((o.toDay ?? "") <= "2026-03-01") throw new Error("[ai_observations] read hit the 40000 row ceiling");
      return rows.filter((r) => (o.slot === undefined || r.sample_slot === o.slot)
        && (!o.fromDay || r.reporting_day >= o.fromDay) && (!o.toDay || r.reporting_day <= o.toDay) && r.tenant_id === t)
        .map((r) => ({ ...r }));
    });
    const held = { ai: { day: "2026-07-20", checked: 4, analyzed: 4, mentioning: 1 } };
    const batch = await aiOutcomesForShipments(T, [
      { scopeQueries: Q, implementedAt: STAMP, shipmentBaseline: held },                        // 2026-07-21
      { scopeQueries: Q, implementedAt: "2026-07-05T10:00:00.000Z", shipmentBaseline: held },
      { scopeQueries: Q, implementedAt: "2026-07-10T10:00:00.000Z", shipmentBaseline: held },
      { scopeQueries: Q, implementedAt: "2026-02-01T10:00:00.000Z", shipmentBaseline: held },   // its own stretch, and it throws
    ], { readObservations, now: NOW });
    // Three overlapping windows are ONE read, so a day two changes both need is fetched once; the fourth change sits on its own stretch and is read on its own.
    expect(asked).toEqual([
      { fromDay: "2026-01-04", toDay: "2026-02-28" },
      { fromDay: "2026-06-07", toDay: "2026-07-31" },
    ]);
    // Fetched once: a day counted twice would double every one of these.
    expect(batch.slice(0, 3).map((o) => o?.after.checked)).toEqual([44, 108, 88]);
    expect(batch.slice(0, 3).map((o) => o?.direction)).toEqual(["improved", "improved", "improved"]);
    // And the one whose answers I could not reach says so, instead of reading as a change AI never noticed.
    expect(batch[3]).toMatchObject({ direction: "unclear", coverage: { daysObserved: 0, daysElapsed: 28 } });
    expect(batch[3]?.line).toBe("I could not read the answers for this period just now. They are safe and I will read them on the next refresh.");
  });
  /** THE DAY A CHANGE SHIPPED IS THE OPERATOR'S DAY. Observations are filed under the Pacific reporting day; deriving the shipped day in UTC put every evening stamp on tomorrow, so that same evening's answers, taken AFTER the operator made the change, were counted on the BEFORE side of it. */
  it("stamps the shipped day in the operator's own zone, so an evening change counts that evening after it", async () => {
    const evening = "2026-08-05T02:00:00.000Z"; // 7 PM on the 4th where the operator is
    const readObservations = reader([
      ...stretch("2026-08-01", "2026-08-03", 0),  // clearly before, and nobody named them
      ...stretch("2026-08-04", "2026-08-16", 4),  // the evening of the change and everything after it
    ]);
    const outcome = await aiOutcomeForShipment(T, { scopeQueries: Q, implementedAt: evening, shipmentBaseline: { ai: null } },
      { readObservations, now: new Date("2026-08-17T12:00:00.000Z") });
    expect(outcome?.after.from).toBe("2026-08-04");                 // the operator's day, not the UTC one
    expect(outcome?.before.day).toBe("2026-08-03");                 // so the evening's own answers are not "before"
    expect(outcome?.after.checked).toBe(52);                        // 13 days x 4 answers, the 4th included
    expect(outcome?.direction).toBe("improved");
  });
});
