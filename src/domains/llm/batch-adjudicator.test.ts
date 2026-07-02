import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Isolate from the budget store, exactly like structured-drafter.test.ts: the
// gate is controlled deterministically and spend recording is observable.
const { checkBudgetMock, recordSpendMock } = vi.hoisted(() => ({
  checkBudgetMock: vi.fn(),
  recordSpendMock: vi.fn(),
}));
vi.mock("@/domains/recommendations/adjudicator-budget", () => ({
  checkBudget: checkBudgetMock,
  recordSpend: recordSpendMock,
}));

import { adjudicateBatch, applyFinalReviewToPicks, type AdjudicationPick } from "./batch-adjudicator";
import type { CompleteFn } from "./structured-drafter";

/**
 * batch-adjudicator tests (BEACON 500 item 12) - pin the FINAL REVIEW trust
 * contract: budget-gated, schema-validated, retry-once, numeric-fidelity
 * firewalled, and FAIL-OPEN-LOUD (an LLM failure can never block the batch or
 * silently pass; "off" config stays silent). Zero real LLM calls - the
 * completion fn is injected.
 */

const PICKS: AdjudicationPick[] = [
  {
    id: "tenant-iranopedia::2026-07-02::ab12cd34ef56::/chaharshanbe-suri",
    url: "https://iranopedia.com/chaharshanbe-suri",
    targetQuery: "chaharshanbe suri 2026 date",
    proposedText: "Chaharshanbe Suri is the Persian festival of fire held on the eve of the last Wednesday before Nowruz.",
    whyNow: "People searching this page want the date, and the page never states it near the top.",
  },
  {
    id: "tenant-iranopedia::2026-07-02::ab12cd34ef56::/persian-cat-colors",
    url: "https://iranopedia.com/persian-cat-colors",
    targetQuery: "persian cat colors",
    proposedText: "Persian cats come in solid, silver, shaded, tabby, and bicolor coats. See the full color guide with photos.",
    whyNow: "The page ranks on page two while searchers want a quick list of coat colors.",
  },
];

const CONCERN_TEXT = "The search asks for the 2026 date but the new text only defines the festival.";

const validResponse = {
  picks: [
    { pickId: PICKS[0]!.id, verdict: "concern", concern: CONCERN_TEXT },
    { pickId: PICKS[1]!.id, verdict: "looks_right" },
  ],
};

/** A completion fn replaying a fixed queue (last response repeats). */
function fakeComplete(responses: Array<{ text: string } | { error: string }>): CompleteFn {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)]!;
}

const ORIGINAL_PROVIDER = process.env.BEACON_LLM_PROVIDER;
let warnSpy: ReturnType<typeof vi.spyOn>;

/** Only the adjudicator's LOUD fail-open warns (the structured drafter's own
 *  log.warn also lands on console.warn; that one is not under test here). */
const loudWarns = () => warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("FINAL REVIEW FAILED OPEN"));

beforeEach(() => {
  process.env.BEACON_LLM_PROVIDER = "openai";
  checkBudgetMock.mockResolvedValue({ allowed: true, remaining: 10 });
  recordSpendMock.mockResolvedValue(undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env.BEACON_LLM_PROVIDER = ORIGINAL_PROVIDER;
  warnSpy.mockRestore();
  vi.clearAllMocks();
});

describe("adjudicateBatch - gate + budget", () => {
  it("is OFF (zero flags, silent, no call) when BEACON_LLM_PROVIDER is not openai", async () => {
    process.env.BEACON_LLM_PROVIDER = "deterministic";
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(validResponse) }]));
    const r = await adjudicateBatch(PICKS, { complete });
    expect(r.size).toBe(0);
    expect(complete).not.toHaveBeenCalled();
    expect(loudWarns().length).toBe(0); // off is expected config, not a failure
  });

  it("respects the budget gate: blocked cap means zero flags, a LOUD warn, and no call", async () => {
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(validResponse) }]));
    const r = await adjudicateBatch(PICKS, { complete });
    expect(r.size).toBe(0);
    expect(complete).not.toHaveBeenCalled();
    expect(loudWarns().length).toBe(1);
  });

  it("returns an empty map without calling anything for an empty batch", async () => {
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(validResponse) }]));
    const r = await adjudicateBatch([], { complete });
    expect(r.size).toBe(0);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("adjudicateBatch - one call, per-pick verdicts", () => {
  it("returns the concern and the looks_right verdict addressed to the right picks", async () => {
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(validResponse) }]));
    const r = await adjudicateBatch(PICKS, { complete });
    expect(complete).toHaveBeenCalledTimes(1); // ONE bounded call for the whole batch
    expect(r.get(PICKS[0]!.id)).toEqual({ verdict: "concern", concern: CONCERN_TEXT });
    expect(r.get(PICKS[1]!.id)).toEqual({ verdict: "looks_right" });
  });

  it("sends every pick's path, top search, proposed text, and evidence in the single prompt", async () => {
    let seenUser = "";
    const complete: CompleteFn = async ({ user }) => {
      seenUser = user;
      return { text: JSON.stringify(validResponse) };
    };
    await adjudicateBatch(PICKS, { complete });
    for (const p of PICKS) {
      expect(seenUser).toContain(p.id);
      expect(seenUser).toContain(p.targetQuery);
      expect(seenUser).toContain(p.whyNow!);
    }
    expect(seenUser).toContain("/chaharshanbe-suri"); // path, not the full host
  });

  it("drops a verdict addressed to a pickId that was never sent", async () => {
    const withStranger = {
      picks: [...validResponse.picks, { pickId: "someone::else", verdict: "concern", concern: "Not one of ours." }],
    };
    const r = await adjudicateBatch(PICKS, { complete: fakeComplete([{ text: JSON.stringify(withStranger) }]) });
    expect(r.size).toBe(2);
    expect(r.has("someone::else")).toBe(false);
  });

  it("drops a concern verdict that carries no reason (a flag with no reason is noise)", async () => {
    const empty = {
      picks: [
        { pickId: PICKS[0]!.id, verdict: "concern", concern: "   " },
        { pickId: PICKS[1]!.id, verdict: "looks_right" },
      ],
    };
    const r = await adjudicateBatch(PICKS, { complete: fakeComplete([{ text: JSON.stringify(empty) }]) });
    expect(r.has(PICKS[0]!.id)).toBe(false);
    expect(r.get(PICKS[1]!.id)).toEqual({ verdict: "looks_right" });
  });
});

describe("adjudicateBatch - retry-once + fail-open-loud", () => {
  it("retries ONCE past invalid JSON, then succeeds (spend recorded per call)", async () => {
    const r = await adjudicateBatch(PICKS, {
      complete: fakeComplete([{ text: "not json" }, { text: JSON.stringify(validResponse) }]),
    });
    expect(r.get(PICKS[0]!.id)?.verdict).toBe("concern");
    expect(recordSpendMock).toHaveBeenCalledTimes(2);
    expect(loudWarns().length).toBe(0);
  });

  it("FAILS OPEN LOUDLY to zero flags when both attempts are invalid", async () => {
    const r = await adjudicateBatch(PICKS, { complete: fakeComplete([{ text: "nope" }, { text: "still nope" }]) });
    expect(r.size).toBe(0); // zero flags, batch untouched
    const loud = loudWarns();
    expect(loud.length).toBe(1);
    expect(String(loud[0]![0])).toContain(`${PICKS.length} picks`);
  });

  it("FAILS OPEN LOUDLY on transport errors (the batch is never blocked)", async () => {
    const r = await adjudicateBatch(PICKS, { complete: fakeComplete([{ error: "timeout" }, { error: "timeout" }]) });
    expect(r.size).toBe(0);
    expect(loudWarns().length).toBe(1);
  });

  it("rejects a concern longer than 140 chars (schema), then fails open loud", async () => {
    const long = {
      picks: [{ pickId: PICKS[0]!.id, verdict: "concern", concern: "x".repeat(160) }],
    };
    const r = await adjudicateBatch(PICKS, { complete: fakeComplete([{ text: JSON.stringify(long) }]) });
    expect(r.size).toBe(0);
    expect(loudWarns().length).toBe(1);
  });
});

describe("adjudicateBatch - content firewalls on concern text", () => {
  it("REJECTS a concern with an invented multi-digit number (numeric-fidelity firewall)", async () => {
    const invented = {
      picks: [
        { pickId: PICKS[0]!.id, verdict: "concern", concern: "This page loses 87 percent of its clicks to the mismatch." },
        { pickId: PICKS[1]!.id, verdict: "looks_right" },
      ],
    };
    const r = await adjudicateBatch(PICKS, { complete: fakeComplete([{ text: JSON.stringify(invented) }]) });
    expect(r.size).toBe(0); // firewalled -> fail open to zero flags
    expect(loudWarns().length).toBe(1);
  });

  it("allows a concern that reuses a number FROM the pick's own evidence (2026)", async () => {
    const r = await adjudicateBatch(PICKS, { complete: fakeComplete([{ text: JSON.stringify(validResponse) }]) });
    expect(r.get(PICKS[0]!.id)?.concern).toContain("2026");
  });

  it("sanitizes an em dash in the concern to a hyphen instead of rejecting (dash guard)", async () => {
    const dashed = {
      picks: [
        { pickId: PICKS[0]!.id, verdict: "concern", concern: "The search wants a date—the text gives a definition." },
        { pickId: PICKS[1]!.id, verdict: "looks_right" },
      ],
    };
    const r = await adjudicateBatch(PICKS, { complete: fakeComplete([{ text: JSON.stringify(dashed) }]) });
    const concern = r.get(PICKS[0]!.id)?.concern ?? "";
    expect(concern.length).toBeGreaterThan(0);
    expect(concern).not.toMatch(/[‒–—―]/);
    expect(concern).toContain(" - ");
  });
});

describe("applyFinalReviewToPicks - attach-only wiring", () => {
  type Pick = AdjudicationPick & { teamCheck?: { verdict: "looks_right" | "concern"; concern?: string }; extra?: string };
  const clone = (): Pick[] => PICKS.map((p) => ({ ...p, extra: "untouched" }));

  it("attaches teamCheck additively and returns the flagged count", async () => {
    const picks = clone();
    const flagged = await applyFinalReviewToPicks(picks, { complete: fakeComplete([{ text: JSON.stringify(validResponse) }]) });
    expect(flagged).toBe(1);
    expect(picks[0]!.teamCheck).toEqual({ verdict: "concern", concern: CONCERN_TEXT });
    expect(picks[1]!.teamCheck).toEqual({ verdict: "looks_right" });
  });

  it("NEVER drops, reorders, or rewrites picks - flags are attach-only", async () => {
    const picks = clone();
    const before = picks.map((p) => p.id);
    await applyFinalReviewToPicks(picks, { complete: fakeComplete([{ text: JSON.stringify(validResponse) }]) });
    expect(picks.map((p) => p.id)).toEqual(before); // same length, same order
    expect(picks.every((p) => p.extra === "untouched")).toBe(true); // no other field touched
  });

  it("leaves teamCheck ABSENT (not looks_right) when the review is off", async () => {
    process.env.BEACON_LLM_PROVIDER = "deterministic";
    const picks = clone();
    const flagged = await applyFinalReviewToPicks(picks, { complete: fakeComplete([{ text: JSON.stringify(validResponse) }]) });
    expect(flagged).toBe(0);
    expect(picks.every((p) => p.teamCheck === undefined)).toBe(true);
  });

  it("leaves teamCheck absent and the batch intact when the review fails open", async () => {
    const picks = clone();
    const flagged = await applyFinalReviewToPicks(picks, { complete: fakeComplete([{ text: "garbage" }]) });
    expect(flagged).toBe(0);
    expect(picks.length).toBe(2);
    expect(picks.every((p) => p.teamCheck === undefined)).toBe(true);
    expect(loudWarns().length).toBe(1);
  });
});
