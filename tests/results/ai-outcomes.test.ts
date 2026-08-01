/** AI OUTCOME MEASUREMENT (V1 Truth Convergence Phase 7). Protected here: only the canonical first
 *  reading of a question feeds a trend; a rate with nothing behind it is null and never zero; a model or
 *  mode change splits the series and is named; a Shipment is judged before against after on the same rule
 *  with its coverage visible; thin coverage is "unclear", not a verdict; a missed day stays missed; and one
 *  account never reads another's answers. Fixtures only: every read is injected, zero network, zero cost. */
import { describe, it, expect, vi } from "vitest";

import { aiOutcomeForShipment, aiOutcomes, visibilitySeries } from "@/domains/measurement/ai-outcomes";
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
    analysis, analysis_hash: analysis ? "h" : null, ...rest,
  } as AiObservationRecord;
}

const link = (domain: string) => ({ url: `https://${domain}/page`, domain, title: null });
const reader = (rows: AiObservationRecord[]) => vi.fn(async () => rows.map((r) => ({ ...r })));
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
    ]);
    const [day] = allDays(await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-20", readObservations }));
    expect(day).toMatchObject({
      citationSample: 2, ownedCiting: 1, ownedCitationRate: 0.5, ownedCitationRank: 3,
      retrievalSample: 1, ownedRetrieved: 1, retrievedNotCited: 1, retrievedNotCitedRate: 1,
    });
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
      row({ day: "2026-07-20", prompt_id: "p1", engine: "claude", model_served: "claude-4", mentioned: false }),
      // Nothing at all on the 21st. The 22nd resumes.
      row({ day: "2026-07-22", prompt_id: "p1", engine: "chatgpt", mentioned: true }),
    ]);
    const report = await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-22", readObservations });
    const days = allDays(report);
    expect(days.map((d) => d.day)).toEqual(["2026-07-20", "2026-07-22"]); // the 21st is missing, not zero
    expect(report.daysObserved).toBe(2);
    expect(days[0].byEngine).toEqual([
      { engine: "chatgpt", modelServed: "gpt-5", mode: "api", asked: 2, observed: 1, mentioning: 1, citedOwned: 0 },
      { engine: "claude", modelServed: "claude-4", mode: "api", asked: 1, observed: 1, mentioning: 0, citedOwned: 0 },
    ]);
  });
  it("ranks the competitors the answers kept naming, bounded", async () => {
    const withRivals = (day: string, names: string[]) => row({
      day, prompt_id: `p-${day}`, mentioned: false,
      analysis: { ownedBrandMention: { mentioned: false, position: null, context: null }, competitors: names.map((name, i) => ({ name, position: i + 1 })) },
    });
    const readObservations = reader([
      withRivals("2026-07-20", ["Rival One", "Rival Two"]),
      withRivals("2026-07-21", ["Rival One"]),
    ]);
    const report = await aiOutcomes(T, { from: "2026-07-20", to: "2026-07-21", readObservations });
    expect(report.competitors[0]).toEqual({ name: "Rival One", answers: 2, meanPosition: 1 });
    expect(report.competitors[1]).toEqual({ name: "Rival Two", answers: 1, meanPosition: 2 });
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
  const STAMP = "2026-07-21T10:00:00.000Z";
  /** Every day from `from` to `to`, four questions a day, `named` of them naming the account. */
  const stretch = (from: string, to: string, named: number) => {
    const out: AiObservationRecord[] = [];
    for (let d = new Date(`${from}T00:00:00.000Z`); d <= new Date(`${to}T00:00:00.000Z`); d = new Date(d.getTime() + 86_400_000)) {
      const day = d.toISOString().slice(0, 10);
      for (let i = 0; i < 4; i += 1) out.push(row({ day, prompt_id: `p${i}`, mentioned: i < named }));
    }
    return out;
  };


  it("compares the starting number on file against every day since, and says which way it went", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 3));
    const outcome = await aiOutcomeForShipment(T, {
      implementedAt: STAMP,
      shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, mentioning: 1 } },
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
    const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: { ai: null } }, { readObservations, now: NOW });
    expect(outcome?.before).toMatchObject({ day: "2026-07-20", checked: 4, mentioning: 3, rate: 0.75, from: "stored_answers" });
    expect(outcome?.direction).toBe("worsened");
    expect(outcome?.line).toContain("down from 3 of 4 before it");
  });
  it("calls the same share flat", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 2));
    const outcome = await aiOutcomeForShipment(T, {
      implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, mentioning: 2 } },
    }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("flat");
  });
  it("says unclear when I read fewer than half the days that have passed", async () => {
    // Eleven days have passed and only three carry a reading.
    const readObservations = reader(stretch("2026-07-21", "2026-07-23", 4));
    const outcome = await aiOutcomeForShipment(T, {
      implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, mentioning: 0 } },
    }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("unclear");
    expect(outcome?.coverage).toEqual({ daysObserved: 3, daysElapsed: 11 });
    expect(outcome?.line).toContain("too little to call either way yet");
  });
  it("says unclear when there is nothing from before the change to compare against", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 4));
    const outcome = await aiOutcomeForShipment(T, { implementedAt: STAMP, shipmentBaseline: { ai: null } }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("unclear");
    expect(outcome?.before).toMatchObject({ from: "nothing", rate: null });
    expect(outcome?.line).toContain("nothing from before the change");
  });
  it("says unclear when most of the answers since were never read closely", async () => {
    const readObservations = reader(stretch("2026-07-21", "2026-07-31", 3).map((r, i) => (i % 4 === 0 ? r : { ...r, analysis: null, analysis_hash: null })));
    const outcome = await aiOutcomeForShipment(T, {
      implementedAt: STAMP, shipmentBaseline: { ai: { day: "2026-07-20", checked: 4, mentioning: 1 } },
    }, { readObservations, now: NOW });
    expect(outcome?.direction).toBe("unclear");
    expect(outcome?.after.analyzed).toBeLessThan(outcome!.after.checked);
  });
  it("bounds the window at 28 days and needs a stamp to measure from at all", async () => {
    const readObservations = reader(stretch("2026-07-01", "2026-07-31", 4));
    const outcome = await aiOutcomeForShipment(T, {
      implementedAt: "2026-07-01T00:00:00.000Z", shipmentBaseline: { ai: { day: "2026-06-30", checked: 4, mentioning: 4 } },
    }, { readObservations, now: NOW });
    expect(outcome?.after.to).toBe("2026-07-28");
    expect(outcome?.coverage).toEqual({ daysObserved: 28, daysElapsed: 28 });
    expect(await aiOutcomeForShipment(T, { implementedAt: null }, { readObservations, now: NOW })).toBeNull();
  });
});
