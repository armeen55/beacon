import { describe, it, expect } from "vitest";
import {
  isoWeekKey,
  isoWeekStartDate,
  compareIsoWeeks,
  canonicalizeSovEngine,
  projectObservationForSov,
  computeNativeWeeklySov,
  computeProfoundWeeklySov,
  computeLlmMentionsSovReadings,
  mergeSovWeekly,
  computeSovTrend,
  detectSovDropAlerts,
  MIN_PROMPTS_PER_CELL,
  SOV_DROP_THRESHOLD_POINTS,
  type NativeSovInputRow,
  type NativeSovCell,
  type ProfoundSovInputRow,
} from "./sov-weekly";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

// ---------------------------------------------------------------------------
// ISO week bucketing
// ---------------------------------------------------------------------------

describe("isoWeekKey - ISO 8601 week numbering", () => {
  it("buckets a Thursday into its own calendar year's week 1", () => {
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
  });

  it("rolls a late-December Monday forward into next year's week 1 (ISO edge case)", () => {
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01");
  });

  it("handles a real ISO 53-week year boundary (2020 has 53 weeks)", () => {
    expect(isoWeekKey("2020-12-31")).toBe("2020-W53");
    expect(isoWeekKey("2021-01-01")).toBe("2020-W53");
  });

  it("is stable for any timestamp within the same UTC day", () => {
    expect(isoWeekKey("2026-07-01T00:00:00Z")).toBe(isoWeekKey("2026-07-01T23:59:59Z"));
  });

  it("accepts a Date object identically to an ISO string", () => {
    expect(isoWeekKey(new Date("2026-07-02T12:00:00Z"))).toBe(isoWeekKey("2026-07-02"));
  });
});

describe("isoWeekStartDate + compareIsoWeeks", () => {
  it("round-trips: isoWeekKey(isoWeekStartDate(k)) === k", () => {
    for (const k of ["2026-W01", "2026-W27", "2020-W53", "2024-W10"]) {
      expect(isoWeekKey(isoWeekStartDate(k))).toBe(k);
    }
  });

  it("orders weeks chronologically even when string-sort would get it wrong across years", () => {
    const weeks = ["2026-W02", "2025-W52", "2026-W01"];
    const sorted = [...weeks].sort(compareIsoWeeks);
    expect(sorted).toEqual(["2025-W52", "2026-W01", "2026-W02"]);
  });
});

// ---------------------------------------------------------------------------
// Engine canonicalization
// ---------------------------------------------------------------------------

describe("canonicalizeSovEngine", () => {
  it("maps native-poll platform labels to SovEngineId", () => {
    expect(canonicalizeSovEngine("chatgpt")).toBe("chatgpt");
    expect(canonicalizeSovEngine("perplexity")).toBe("perplexity");
    expect(canonicalizeSovEngine("gemini")).toBe("gemini");
    expect(canonicalizeSovEngine("claude")).toBe("claude");
  });

  it("maps the legacy openai alias to chatgpt", () => {
    expect(canonicalizeSovEngine("openai")).toBe("chatgpt");
  });

  it("is case-insensitive", () => {
    expect(canonicalizeSovEngine("ChatGPT")).toBe("chatgpt");
    expect(canonicalizeSovEngine("PERPLEXITY")).toBe("perplexity");
  });

  it("returns null for unknown or empty platforms (never guessed)", () => {
    expect(canonicalizeSovEngine("google_aio")).toBeNull();
    expect(canonicalizeSovEngine("")).toBeNull();
    expect(canonicalizeSovEngine(null)).toBeNull();
    expect(canonicalizeSovEngine(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// projectObservationForSov
// ---------------------------------------------------------------------------

function obs(overrides: Partial<Parameters<typeof projectObservationForSov>[0]> = {}) {
  return {
    prompt_id: "p1",
    platform: "chatgpt",
    topic: "what is nowruz",
    tracked_brand_mentioned: true,
    observed_at: "2026-06-01T00:00:00Z",
    metadata: {},
    ...overrides,
  };
}

describe("projectObservationForSov", () => {
  it("projects a well-formed native-poll row", () => {
    const row = projectObservationForSov(obs());
    expect(row).not.toBeNull();
    expect(row!.engine).toBe("chatgpt");
    expect(row!.mentioned).toBe(true);
    expect(row!.topic.length).toBeGreaterThan(0);
  });

  it("drops rows with an unrecognized platform", () => {
    expect(projectObservationForSov(obs({ platform: "google_aio" }))).toBeNull();
  });

  it("drops rows with an unusable timestamp", () => {
    expect(projectObservationForSov(obs({ observed_at: "" }))).toBeNull();
    expect(projectObservationForSov(obs({ observed_at: "not-a-date" }))).toBeNull();
  });

  it("uses the fallback topic resolver when the row's own topic is empty", () => {
    const row = projectObservationForSov(obs({ topic: "" }), (id) => (id === "p1" ? "Persian wedding customs" : null));
    expect(row).not.toBeNull();
    expect(row!.topic.toLowerCase()).toContain("persian wedding");
  });

  it("drops the row when neither the topic nor the fallback resolves to anything", () => {
    expect(projectObservationForSov(obs({ topic: "" }))).toBeNull();
    expect(projectObservationForSov(obs({ topic: "" }), () => null)).toBeNull();
  });

  it("prefers metadata.prompt_text for the human-readable prompt text", () => {
    const row = projectObservationForSov(
      obs({ topic: "nowruz", metadata: { prompt_text: "When is Nowruz 2026?" } }),
    );
    expect(row!.promptText).toBe("When is Nowruz 2026?");
  });
});

// ---------------------------------------------------------------------------
// computeNativeWeeklySov (share math)
// ---------------------------------------------------------------------------

const nrow = (p: Partial<NativeSovInputRow>): NativeSovInputRow => ({
  promptId: "p1",
  promptText: "question",
  engine: "chatgpt",
  topic: "nowruz",
  mentioned: false,
  observedAtIso: "2026-06-01T00:00:00Z",
  ...p,
});

describe("computeNativeWeeklySov - share math", () => {
  it("computes owned share as distinct-prompts-mentioned / distinct-prompts-polled", () => {
    const cells = computeNativeWeeklySov([
      nrow({ promptId: "p1", mentioned: true }),
      nrow({ promptId: "p2", mentioned: true }),
      nrow({ promptId: "p3", mentioned: false }),
      nrow({ promptId: "p4", mentioned: false }),
    ]);
    expect(cells).toHaveLength(1);
    const cell = cells[0]!;
    expect(cell.promptsPolled).toBe(4);
    expect(cell.promptsMentioned).toBe(2);
    expect(cell.ownedShare).toBeCloseTo(0.5);
  });

  it("counts a prompt once even if observed multiple times in the same week (mentioned wins)", () => {
    const cells = computeNativeWeeklySov([
      nrow({ promptId: "p1", mentioned: false, observedAtIso: "2026-06-01T00:00:00Z" }),
      nrow({ promptId: "p1", mentioned: true, observedAtIso: "2026-06-02T00:00:00Z" }),
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0]!.promptsPolled).toBe(1);
    expect(cells[0]!.promptsMentioned).toBe(1);
    expect(cells[0]!.ownedShare).toBe(1);
  });

  it("separates cells by engine, topic, and ISO week independently", () => {
    const cells = computeNativeWeeklySov([
      nrow({ engine: "chatgpt", topic: "nowruz", observedAtIso: "2026-06-01T00:00:00Z" }),
      nrow({ engine: "perplexity", topic: "nowruz", observedAtIso: "2026-06-01T00:00:00Z" }),
      nrow({ engine: "chatgpt", topic: "persian rugs", observedAtIso: "2026-06-01T00:00:00Z" }),
      nrow({ engine: "chatgpt", topic: "nowruz", observedAtIso: "2026-06-15T00:00:00Z" }),
    ]);
    const keys = cells.map((c) => `${c.engine}::${c.topic}::${c.weekKey}`);
    expect(new Set(keys).size).toBe(4);
  });

  it("flags belowFloor when promptsPolled is under MIN_PROMPTS_PER_CELL", () => {
    const cells = computeNativeWeeklySov([nrow({ promptId: "p1" }), nrow({ promptId: "p2" })]);
    expect(cells[0]!.promptsPolled).toBe(2);
    expect(cells[0]!.promptsPolled).toBeLessThan(MIN_PROMPTS_PER_CELL);
    expect(cells[0]!.belowFloor).toBe(true);
  });

  it("clears belowFloor once promptsPolled reaches the floor", () => {
    const cells = computeNativeWeeklySov([
      nrow({ promptId: "p1" }),
      nrow({ promptId: "p2" }),
      nrow({ promptId: "p3" }),
    ]);
    expect(cells[0]!.belowFloor).toBe(false);
  });

  it("returns an empty array for no input", () => {
    expect(computeNativeWeeklySov([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeProfoundWeeklySov
// ---------------------------------------------------------------------------

const prow = (p: Partial<ProfoundSovInputRow>): ProfoundSovInputRow => ({
  categoryId: "cat-1",
  date: "2026-06-01",
  assetName: "Rival Co",
  shareOfVoice: 0.3,
  mentionsCount: 5,
  executions: 20,
  isOwned: false,
  ...p,
});

describe("computeProfoundWeeklySov", () => {
  it("separates owned share from the top competitor's share", () => {
    const cells = computeProfoundWeeklySov([
      prow({ assetName: "Iranopedia", isOwned: true, shareOfVoice: 0.4, mentionsCount: 8 }),
      prow({ assetName: "Rival A", isOwned: false, shareOfVoice: 0.3, mentionsCount: 6 }),
      prow({ assetName: "Rival B", isOwned: false, shareOfVoice: 0.1, mentionsCount: 2 }),
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0]!.ownShareOfVoice).toBeCloseTo(0.4);
    expect(cells[0]!.topCompetitor?.assetName).toBe("Rival A");
    expect(cells[0]!.topCompetitor?.mentions).toBe(6);
  });

  it("picks the top competitor by mentions, not by shareOfVoice", () => {
    const cells = computeProfoundWeeklySov([
      prow({ assetName: "Rival A", shareOfVoice: 0.05, mentionsCount: 20 }),
      prow({ assetName: "Rival B", shareOfVoice: 0.5, mentionsCount: 3 }),
    ]);
    expect(cells[0]!.topCompetitor?.assetName).toBe("Rival A");
  });

  it("drops rows with no categoryId or an unparsable date", () => {
    const cells = computeProfoundWeeklySov([
      prow({ categoryId: "" }),
      prow({ date: "not-a-date" }),
    ]);
    expect(cells).toEqual([]);
  });

  it("returns topCompetitor null when only owned rows exist", () => {
    const cells = computeProfoundWeeklySov([prow({ isOwned: true, assetName: "Iranopedia" })]);
    expect(cells[0]!.topCompetitor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeLlmMentionsSovReadings
// ---------------------------------------------------------------------------

describe("computeLlmMentionsSovReadings", () => {
  it("picks the top-count domain per topic", () => {
    const readings = computeLlmMentionsSovReadings([
      {
        topic: "nowruz",
        mentions: [
          { domain: "rival.com", count: 3 },
          { domain: "iranopedia.com", count: 1 },
        ],
        fetchedAt: "2026-06-01T00:00:00Z",
      },
    ]);
    expect(readings[0]!.topDomain).toBe("rival.com");
    expect(readings[0]!.topDomainCount).toBe(3);
  });

  it("returns null topDomain for a topic with no mentions", () => {
    const readings = computeLlmMentionsSovReadings([{ topic: "empty", mentions: [], fetchedAt: "2026-06-01T00:00:00Z" }]);
    expect(readings[0]!.topDomain).toBeNull();
    expect(readings[0]!.topDomainCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// mergeSovWeekly - honest source labeling, never averaged
// ---------------------------------------------------------------------------

describe("mergeSovWeekly - source labeling", () => {
  it("labels the native series 'native_poll' and the Profound series 'profound_visibility'", () => {
    const native = computeNativeWeeklySov([
      nrow({ promptId: "p1", mentioned: true }),
      nrow({ promptId: "p2", mentioned: false }),
      nrow({ promptId: "p3", mentioned: false }),
    ]);
    const profound = computeProfoundWeeklySov([
      prow({ categoryId: "nowruz", date: "2026-06-01", isOwned: true, assetName: "Iranopedia", shareOfVoice: 0.6 }),
    ]);
    const merged = mergeSovWeekly(native, profound);
    const row = merged.find((m) => m.topic === "nowruz");
    expect(row?.nativeByEngine[0]?.source).toBe("native_poll");
    expect(row?.profound?.source).toBe("profound_visibility");
  });

  it("never blends the two numbers into one field - each keeps its own share field", () => {
    const native = computeNativeWeeklySov([nrow({ promptId: "p1", mentioned: true, topic: "nowruz" })]);
    const profound = computeProfoundWeeklySov([
      prow({ categoryId: "nowruz", date: "2026-06-01", isOwned: true, shareOfVoice: 0.6 }),
    ]);
    const merged = mergeSovWeekly(native, profound);
    const row = merged.find((m) => m.topic === "nowruz")!;
    // native's ownedShare and profound's ownShareOfVoice are structurally
    // distinct fields on distinct sub-objects - not merged into one number.
    expect(row.nativeByEngine[0]).toHaveProperty("ownedShare");
    expect(row.profound).toHaveProperty("ownShareOfVoice");
    expect(row.nativeByEngine[0]).not.toHaveProperty("ownShareOfVoice");
    expect(row.profound).not.toHaveProperty("ownedShare");
  });

  it("keeps a topic+week row when only one source has data for it", () => {
    const native = computeNativeWeeklySov([nrow({ promptId: "p1", topic: "only-native" })]);
    const merged = mergeSovWeekly(native, []);
    const row = merged.find((m) => m.topic === "only-native")!;
    expect(row.nativeByEngine.length).toBe(1);
    expect(row.profound).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeSovTrend
// ---------------------------------------------------------------------------

describe("computeSovTrend", () => {
  function fullCell(weekKey: string, mentionedCount: number, polled: number, engine: NativeSovCell["engine"] = "chatgpt", topic = "nowruz"): NativeSovCell {
    const promptTextById: Record<string, string> = {};
    const mentionedPromptIds: string[] = [];
    for (let i = 0; i < polled; i++) {
      const id = `p${i}`;
      promptTextById[id] = `question ${i}`;
      if (i < mentionedCount) mentionedPromptIds.push(id);
    }
    return {
      engine,
      topic,
      weekKey,
      promptsPolled: polled,
      promptsMentioned: mentionedCount,
      ownedShare: polled > 0 ? mentionedCount / polled : 0,
      belowFloor: polled < MIN_PROMPTS_PER_CELL,
      promptTextById,
      mentionedPromptIds,
    };
  }

  it("computes week-over-week points as a percentage-point difference", () => {
    const cells = [fullCell("2026-W20", 4, 5), fullCell("2026-W21", 1, 5)];
    const trends = computeSovTrend(cells);
    expect(trends).toHaveLength(1);
    expect(trends[0]!.weekOverWeekPoints).toBeCloseTo(-60, 5); // 20% - 80% = -60pts
    expect(trends[0]!.trendPhrase).toBe("down 60 pts");
  });

  it("reports 'up N pts' for an improving series", () => {
    const cells = [fullCell("2026-W20", 1, 5), fullCell("2026-W21", 4, 5)];
    const trends = computeSovTrend(cells);
    expect(trends[0]!.trendPhrase).toBe("up 60 pts");
  });

  it("reports 'flat' for an unchanged share", () => {
    const cells = [fullCell("2026-W20", 2, 5), fullCell("2026-W21", 2, 5)];
    expect(computeSovTrend(cells)[0]!.trendPhrase).toBe("flat");
  });

  it("never computes week-over-week points when either side is below the floor", () => {
    const cells = [fullCell("2026-W20", 1, 2), fullCell("2026-W21", 1, 5)];
    const trend = computeSovTrend(cells)[0]!;
    expect(trend.weekOverWeekPoints).toBeNull();
    expect(trend.trendPhrase).toBe("still collecting");
  });

  it("computes a 4-week trend only when both the latest and 4-back weeks clear the floor", () => {
    const cells = [
      fullCell("2026-W17", 1, 5),
      fullCell("2026-W18", 2, 5),
      fullCell("2026-W19", 2, 5),
      fullCell("2026-W20", 2, 5),
      fullCell("2026-W21", 4, 5),
    ];
    const trend = computeSovTrend(cells)[0]!;
    expect(trend.fourWeekPoints).toBeCloseTo(60, 5); // 80% - 20%
  });

  it("keeps engine + topic series independent", () => {
    const cells = [
      fullCell("2026-W20", 1, 5, "chatgpt", "nowruz"),
      fullCell("2026-W20", 4, 5, "perplexity", "nowruz"),
    ];
    const trends = computeSovTrend(cells);
    expect(trends).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// detectSovDropAlerts - drop detection + flipped-prompt naming
// ---------------------------------------------------------------------------

describe("detectSovDropAlerts", () => {
  function cellFromRows(weekKey: string, rows: Array<{ id: string; text: string; mentioned: boolean }>, engine: NativeSovCell["engine"] = "perplexity", topic = "date questions"): NativeSovCell {
    const promptTextById: Record<string, string> = {};
    const mentionedPromptIds: string[] = [];
    for (const r of rows) {
      promptTextById[r.id] = r.text;
      if (r.mentioned) mentionedPromptIds.push(r.id);
    }
    return {
      engine,
      topic,
      weekKey,
      promptsPolled: rows.length,
      promptsMentioned: mentionedPromptIds.length,
      ownedShare: rows.length > 0 ? mentionedPromptIds.length / rows.length : 0,
      belowFloor: rows.length < MIN_PROMPTS_PER_CELL,
      promptTextById,
      mentionedPromptIds,
    };
  }

  it("fires when owned share falls by at least the threshold, naming the flipped prompts", () => {
    const prior = cellFromRows("2026-W20", [
      { id: "p1", text: "When is Nowruz 2026", mentioned: true },
      { id: "p2", text: "What date is Chaharshanbe Suri", mentioned: true },
      { id: "p3", text: "When is Persian new year", mentioned: true },
      { id: "p4", text: "What day does spring start in Iran", mentioned: false },
      { id: "p5", text: "unrelated", mentioned: false },
    ]);
    const current = cellFromRows("2026-W21", [
      { id: "p1", text: "When is Nowruz 2026", mentioned: false },
      { id: "p2", text: "What date is Chaharshanbe Suri", mentioned: false },
      { id: "p3", text: "When is Persian new year", mentioned: true },
      { id: "p4", text: "What day does spring start in Iran", mentioned: false },
      { id: "p5", text: "unrelated", mentioned: false },
    ]);
    const alerts = detectSovDropAlerts([prior, current]);
    expect(alerts).toHaveLength(1);
    const alert = alerts[0]!;
    expect(alert.dropPoints).toBeCloseTo(40, 5); // 60% -> 20%
    expect(alert.droppedToZero).toBe(false);
    expect(alert.flippedPrompts.map((p) => p.promptId).sort()).toEqual(["p1", "p2"]);
    expect(alert.headline).toContain("Perplexity");
    expect(alert.headline).toContain("date questions");
    expect(alert.headline).toContain("When is Nowruz 2026");
    expect(alert.headline).toContain("What date is Chaharshanbe Suri");
  });

  it("does not fire below the drop threshold (a 1-of-10 dip is 10 points, under the 15pt floor)", () => {
    const rows10 = (mentionedCount: number) =>
      Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, text: `q${i}`, mentioned: i < mentionedCount }));
    const prior = cellFromRows("2026-W20", rows10(5)); // 50%
    const current = cellFromRows("2026-W21", rows10(4)); // 40%, a 10pt drop
    expect(detectSovDropAlerts([prior, current])).toEqual([]);
  });

  it("fires right at the drop threshold boundary (exactly 15 points)", () => {
    const rows20 = (mentionedCount: number) =>
      Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, text: `q${i}`, mentioned: i < mentionedCount }));
    const prior = cellFromRows("2026-W20", rows20(10)); // 50%
    const current = cellFromRows("2026-W21", rows20(7)); // 35%, exactly 15pts
    const alerts = detectSovDropAlerts([prior, current]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.dropPoints).toBeCloseTo(15, 5);
  });

  it("fires on a fall to zero from nonzero regardless of point size", () => {
    const prior = cellFromRows("2026-W20", [
      { id: "p1", text: "q1", mentioned: true },
      { id: "p2", text: "q2", mentioned: false },
      { id: "p3", text: "q3", mentioned: false },
    ]);
    const current = cellFromRows("2026-W21", [
      { id: "p1", text: "q1", mentioned: false },
      { id: "p2", text: "q2", mentioned: false },
      { id: "p3", text: "q3", mentioned: false },
    ]);
    const alerts = detectSovDropAlerts([prior, current]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.droppedToZero).toBe(true);
    expect(alerts[0]!.headline.toLowerCase()).toContain("stopped mentioning");
  });

  it("never alerts when either week is below MIN_PROMPTS_PER_CELL (never off one prompt)", () => {
    const prior = cellFromRows("2026-W20", [{ id: "p1", text: "q1", mentioned: true }]);
    const current = cellFromRows("2026-W21", [{ id: "p1", text: "q1", mentioned: false }]);
    expect(prior.promptsPolled).toBeLessThan(MIN_PROMPTS_PER_CELL);
    expect(detectSovDropAlerts([prior, current])).toEqual([]);
  });

  it("only names a prompt as flipped when it was polled in BOTH weeks (not simply dropped from rotation)", () => {
    const prior = cellFromRows("2026-W20", [
      { id: "p1", text: "q1", mentioned: true },
      { id: "p2", text: "q2", mentioned: true },
      { id: "p3", text: "q3", mentioned: false },
    ]);
    // p2 is not polled at all this week - it must NOT be named as flipped.
    const current = cellFromRows("2026-W21", [
      { id: "p1", text: "q1", mentioned: false },
      { id: "p4", text: "q4", mentioned: false },
      { id: "p5", text: "q5", mentioned: false },
    ]);
    const alerts = detectSovDropAlerts([prior, current]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.flippedPrompts.map((p) => p.promptId)).toEqual(["p1"]);
  });

  it("requires at least 2 weeks of history to detect a drop", () => {
    const only = cellFromRows("2026-W20", [
      { id: "p1", text: "q1", mentioned: true },
      { id: "p2", text: "q2", mentioned: true },
      { id: "p3", text: "q3", mentioned: true },
    ]);
    expect(detectSovDropAlerts([only])).toEqual([]);
  });

  it("sorts alerts worst-drop-first", () => {
    const small = [
      cellFromRows("2026-W20", [
        { id: "a1", text: "a1", mentioned: true },
        { id: "a2", text: "a2", mentioned: true },
        { id: "a3", text: "a3", mentioned: false },
      ], "chatgpt", "small-drop"),
      cellFromRows("2026-W21", [
        { id: "a1", text: "a1", mentioned: false },
        { id: "a2", text: "a2", mentioned: true },
        { id: "a3", text: "a3", mentioned: false },
      ], "chatgpt", "small-drop"),
    ];
    const big = [
      cellFromRows("2026-W20", [
        { id: "b1", text: "b1", mentioned: true },
        { id: "b2", text: "b2", mentioned: true },
        { id: "b3", text: "b3", mentioned: true },
      ], "chatgpt", "big-drop"),
      cellFromRows("2026-W21", [
        { id: "b1", text: "b1", mentioned: false },
        { id: "b2", text: "b2", mentioned: false },
        { id: "b3", text: "b3", mentioned: false },
      ], "chatgpt", "big-drop"),
    ];
    const alerts = detectSovDropAlerts([...small, ...big]);
    expect(alerts[0]!.topic).toBe("big-drop");
  });

  it("never emits a headline containing an em or en dash", () => {
    const prior = cellFromRows("2026-W20", [
      { id: "p1", text: "q1", mentioned: true },
      { id: "p2", text: "q2", mentioned: true },
      { id: "p3", text: "q3", mentioned: true },
    ]);
    const current = cellFromRows("2026-W21", [
      { id: "p1", text: "q1", mentioned: false },
      { id: "p2", text: "q2", mentioned: false },
      { id: "p3", text: "q3", mentioned: true },
    ]);
    const alerts = detectSovDropAlerts([prior, current]);
    for (const a of alerts) {
      expect(hasBannedDash(a.headline)).toBe(false);
    }
  });
});

describe("constants", () => {
  it("MIN_PROMPTS_PER_CELL and SOV_DROP_THRESHOLD_POINTS are the documented values", () => {
    expect(MIN_PROMPTS_PER_CELL).toBe(3);
    expect(SOV_DROP_THRESHOLD_POINTS).toBe(15);
  });
});
