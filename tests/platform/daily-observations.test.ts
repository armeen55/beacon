/** The daily AI-answer plan (V1 Truth Convergence Phase 1): ONE canonical reading per tracked question, per
 *  engine, per UTC day; core questions first and oldest-missing-first; an already-answered pair is never asked
 *  twice; extra readings only on an explicit ask, only after the canonical round, never past three; a version
 *  bump is a NEW measurement identity; an engine I cannot ask is excluded and blocks nobody. Plus the read-back
 *  step: one gateway call per NEW answer hash, and zero calls on a re-run. Fixtures only, zero network. */
import { describe, it, expect } from "vitest";
import type { AiObservationView, DueObservation } from "@/domains/evidence/ai-visibility/ai-observations";
import {
  DAILY_OBSERVATION_BATCH, MAX_SAMPLES_PER_DAY, extraSampleVerdict, planObservations, requestExtraSample,
  runAnswerAnalyses, selectAnalysisTargets, utcReportingDay,
} from "@/domains/runtime/ops/daily-observations";
import { applyTrackedSelection, type TrackedPromptRow } from "@/domains/runtime/prompt-set";
import type { AnswerAnalysis } from "@/domains/decision/llm/schemas";

const DAY = "2026-07-31", ENGINES: DueObservation["engine"][] = ["chatgpt", "claude", "gemini", "perplexity"];
const T = "acct-a";
/** Three approved questions, oldest first, all on series 1. */
const q = (id: string, createdAt: string, core = true, version = 1) => ({ id, text: `question ${id}`, version, core, createdAt });
const PROMPTS = [q("p1", "2026-01-01"), q("p2", "2026-02-01"), q("p3", "2026-03-01")];
/** One stored observation row in the reader's own view shape. */
const seen = (o: Partial<AiObservationView> & { promptId: string; engine: string }): AiObservationView => ({
  id: `obs-${o.promptId}-${o.engine}-${o.slot ?? 0}-${o.day ?? DAY}`, version: 1, slot: 0, day: DAY, status: "observed",
  observedAt: null, promptText: "", answerText: null, answerHash: null, analysis: null, analysisHash: null, ...o,
});
const key = (d: { promptId: string; version: number; engine: string; slot: number }) => `${d.promptId}|${d.version}|${d.engine}|${d.slot}`;
/** Every pair answered on `day`, so the canonical round is complete. */
const fullDay = (day = DAY, slot = 0) => PROMPTS.flatMap((p) => ENGINES.map((e) => seen({ promptId: p.id, engine: e, slot, day })));

describe("daily observation plan", () => {
  it("plans exactly one slot-0 reading per question and engine, oldest question first, and never re-asks a pair already answered today", () => {
    const all = planObservations(DAY, { prompts: PROMPTS, observed: [], maxBatch: 99 });
    expect(all).toHaveLength(12); // 3 questions x 4 engines, slot 0 only
    expect(all.every((d) => d.slot === 0 && d.version === 1)).toBe(true);
    // Oldest-missing-first: nothing has ever been read, so the OLDEST question leads, engines in fixed order.
    expect(all.slice(0, 5).map((d) => `${d.promptId}|${d.engine}`))
      .toEqual(["p1|chatgpt", "p1|claude", "p1|gemini", "p1|perplexity", "p2|chatgpt"]);
    // A pair read TODAY is done; a pair read on an EARLIER day is still owed today (no backfill of the old day).
    const partial = planObservations(DAY, { prompts: PROMPTS, observed: [
      seen({ promptId: "p1", engine: "chatgpt" }),
      seen({ promptId: "p2", engine: "chatgpt", day: "2026-07-30", observedAt: "2026-07-30T00:00:00.000Z" }),
    ], maxBatch: 99 });
    expect(partial.some((d) => d.promptId === "p1" && d.engine === "chatgpt")).toBe(false);
    expect(partial.some((d) => d.promptId === "p2" && d.engine === "chatgpt")).toBe(true);
    expect(partial).toHaveLength(11);
    // A pair read YESTERDAY is fresher than one never read, so it goes AFTER the never-read pairs.
    expect(partial.at(-1)).toMatchObject({ promptId: "p2", engine: "chatgpt" });
    // A missed day is never asked about again: yesterday plans nothing new for a today-only reader.
    expect(planObservations("2026-07-30", { prompts: PROMPTS, observed: fullDay("2026-07-30"), maxBatch: 99 })).toEqual([]);
  });

  it("puts core questions first and caps the plan to one bounded batch", () => {
    const mixed = [q("z-legacy", "2020-01-01", false), ...PROMPTS];
    const plan = planObservations(DAY, { prompts: mixed, observed: [], maxBatch: 99 });
    expect(plan[0]).toMatchObject({ promptId: "p1", engine: "chatgpt" }); // core beats the older non-core row
    expect(plan.slice(0, 12).every((d) => d.promptId !== "z-legacy")).toBe(true);
    const wide = [...mixed, q("p4", "2026-04-01"), q("p5", "2026-05-01")]; // 6 questions x 4 engines is more than one pass may plan
    expect(planObservations(DAY, { prompts: wide, observed: [] })).toHaveLength(DAILY_OBSERVATION_BATCH);
  });

  it("excludes an engine it cannot ask without blocking the engines it can", () => {
    const plan = planObservations(DAY, {
      prompts: PROMPTS, observed: [], engines: ["chatgpt", "claude", "gemini"], unsupportedPairs: ["p2|claude"], maxBatch: 99,
    });
    expect(plan.some((d) => d.engine === "perplexity")).toBe(false);
    expect(plan.some((d) => d.promptId === "p2" && d.engine === "claude")).toBe(false);
    expect(plan.filter((d) => d.promptId === "p2")).toHaveLength(2); // p2 still gets every engine that works
    expect(plan).toHaveLength(8);
  });

  it("treats a version bump as a NEW measurement identity, and prompt-set bumps it on a rewording and on a revival", () => {
    // Series 1 was fully read today. Bump the question to series 2 and it is owed again, under the new identity.
    const bumped = [{ ...PROMPTS[0]!, version: 2 }, PROMPTS[1]!, PROMPTS[2]!];
    const plan = planObservations(DAY, { prompts: bumped, observed: fullDay(), maxBatch: 99 });
    expect(plan).toHaveLength(4);
    expect(plan.every((d) => d.promptId === "p1" && d.version === 2)).toBe(true);
    // And the writer is what bumps it. A rewording retires the old row untouched and mints a fresh series;
    // dropping a question then bringing it back is a real gap, so the revival starts series 2 on the SAME id.
    const row = (id: string, text: string, is_active: boolean, version: number): TrackedPromptRow => ({
      id, tenant_id: T, account_id: T, text, topic_id: null, location_scope: null, service_scope: null,
      intent_type: "category", platforms: ["chatgpt", "claude", "gemini", "perplexity"], tags: ["core_v1"],
      is_active, version, core: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    });
    const rows = Array.from({ length: 12 }, (_, i) => row(`k${i}`, `kept question ${i}`, i !== 11, i === 11 ? 3 : 1));
    const ctx = { tenantId: T, basis: "basis_a", nowIso: "2026-07-31T00:00:00.000Z" };
    const out = applyTrackedSelection(rows, { keepIds: rows.map((r) => r.id), edits: [{ id: "k0", newText: "reworded question" }], additions: [] }, ctx);
    expect(out.ok).toBe(true);
    const writes = out.ok ? out.writes : [];
    expect(writes.find((w) => w.id === "k0")).toMatchObject({ is_active: false, version: 1 }); // history keeps its series
    expect(writes.find((w) => w.is_active && w.text === "reworded question")).toMatchObject({ version: 1, core: true }); // a fresh id starts at series 1
    expect(writes.find((w) => w.id === "k11")).toMatchObject({ is_active: true, version: 4 }); // the revival is a new series on the same id
    expect(writes.find((w) => w.id === "k1")).toBeUndefined(); // an untouched keep is never rewritten, so its series never moves
  });
});

describe("extra readings", () => {
  const base = { prompts: PROMPTS, observed: [] as AiObservationView[] };
  it("refuses an extra reading before today's canonical round is done, grants one after it, and refuses at three", () => {
    const early = extraSampleVerdict(DAY, { ...base, observed: [seen({ promptId: "p1", engine: "chatgpt" })] });
    expect(early.granted).toBe(false);
    expect(early.due).toEqual([]);
    expect(early.reason).toContain("11 question and engine pairs");
    expect(early.reason).not.toMatch(/[\u2014\u2013]/); // Beacon voice: no em or en dash, ever

    const after = extraSampleVerdict(DAY, { ...base, observed: fullDay() });
    expect(after.granted).toBe(true);
    expect(after.due).toHaveLength(12);
    expect(after.due.every((d) => d.slot === 1)).toBe(true);

    const twice = extraSampleVerdict(DAY, { ...base, observed: [...fullDay(), ...fullDay(DAY, 1)] });
    expect(twice.granted && twice.due.every((d) => d.slot === 2)).toBe(true);

    const full = extraSampleVerdict(DAY, { ...base, observed: [...fullDay(), ...fullDay(DAY, 1), ...fullDay(DAY, 2)] });
    expect(full.granted).toBe(false);
    expect(full.due).toEqual([]);
    expect(full.reason).toContain(`${MAX_SAMPLES_PER_DAY} readings`);
  });

  it("never plans slot 1 or 2 without an explicit ask, and stops at three even when asked", () => {
    expect(planObservations(DAY, { ...base, observed: fullDay(), maxBatch: 99 })).toEqual([]); // complete day, no ask, no work
    const capped = planObservations(DAY, { ...base, observed: [...fullDay(), ...fullDay(DAY, 1), ...fullDay(DAY, 2)], extraSample: true, maxBatch: 99 });
    expect(capped).toEqual([]);
    const one = planObservations(DAY, { ...base, observed: fullDay(), extraSample: true, maxBatch: 99 });
    expect(new Set(one.map(key)).size).toBe(12);
  });

  it("refuses honestly rather than guessing when it cannot read where today stands", async () => {
    const out = await requestExtraSample(T, DAY, {
      readPrompts: async () => null,
      readObservations: async () => { throw new Error("db down"); },
    });
    expect([out.granted, out.due]).toEqual([false, []]);
    expect(out.reason).toContain("could not read");
  });
});

describe("reading the answers back", () => {
  const analysis = {
    sections: [], claims: [{ subject: "acme", text: "Acme is open on Sundays" }], topicEntities: ["Acme"],
    ownedBrandMention: { mentioned: true, position: 1, context: null }, competitors: [],
    contentTypesRecommended: [], questionsAnswered: [], materialOmissions: [], caveats: [],
  } as unknown as AnswerAnalysis;
  const row = (id: string, answerHash: string, analysisHash: string | null, analysed: boolean): AiObservationView => ({
    id, promptId: `p-${id}`, version: 1, engine: "chatgpt", slot: 0, day: DAY, status: "observed", observedAt: null,
    promptText: "who is open on sunday", answerText: "Acme is open on Sundays.", answerHash,
    analysis: analysed ? { ok: true } : null, analysisHash,
  });

  it("analyses only what is new: one call per fresh answer hash, none for an answer already read, and nothing at all on a re-run", async () => {
    const fresh = row("a", "h1", null, false);          // never analysed
    const stale = row("b", "h2-new", "h2-old", true);   // the answer changed under an old analysis
    const done = row("c", "h3", "h3", true);            // already read at this exact hash
    expect(selectAnalysisTargets([fresh, stale, done]).map((r) => r.id)).toEqual(["a", "b"]);

    const calls: string[] = [], saved: Array<[string, string]> = [];
    const deps = {
      readObservations: async () => [fresh, stale, done],
      analyze: async (i: { question: string }) => { calls.push(i.question); return analysis; },
      persist: async (_t: string, id: string, _a: AnswerAnalysis, hash: string) => void saved.push([id, hash]),
      readPrompts: async () => null,
    };
    expect(await runAnswerAnalyses(T, DAY, deps)).toBe(2);
    expect(calls).toEqual(["who is open on sunday", "who is open on sunday"]);
    expect(saved).toEqual([["a", "h1"], ["b", "h2-new"]]);

    // The same pass again, with the analyses now on file: zero calls, zero cents.
    calls.length = 0;
    const settled = [row("a", "h1", "h1", true), row("b", "h2-new", "h2-new", true), done];
    expect(await runAnswerAnalyses(T, DAY, { ...deps, readObservations: async () => settled })).toBe(0);
    expect(calls).toEqual([]);
  });

  it("is bounded per pass, counts only what actually persisted, and never lets a failure become a saved analysis", async () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`r${i}`, `h${i}`, null, false));
    let attempts = 0;
    const written = await runAnswerAnalyses(T, DAY, {
      readObservations: async () => many,
      analyze: async () => { attempts += 1; return attempts === 1 ? null : analysis; }, // the first answer could not be read back
      persist: async (_t, id) => { if (id === "r2") throw new Error("write lost"); },
      readPrompts: async () => null,
    });
    expect(attempts).toBe(5);   // bounded per pass
    expect(written).toBe(3);    // 5 attempted, 1 produced nothing, 1 write was lost
  });

  it("reports the reporting day as the UTC day the cycle key is built from", () => {
    expect(utcReportingDay(Date.parse("2026-07-31T23:59:59.000Z"))).toBe("2026-07-31");
    expect(utcReportingDay(Date.parse("2026-08-01T00:00:01.000Z"))).toBe("2026-08-01");
  });
});
