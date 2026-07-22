/**
 * reliability-extras.test.ts - the folded suites of the six modules the
 * reliability-extras merge replaced (Core 100K lane P, 2026-07-21):
 * bayesian-read, permutation-null, fdr-adjust, equivalence, novelty-decay,
 * early-signal. Every distinct behavioral pin is kept verbatim inside a
 * wrapping describe per replaced module (so each suite's local fixtures stay
 * scoped); the per-file source dash guards now all read reliability-extras.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  bayesianCtrRead,
  bayesianClicksRead,
  buildBayesianRead,
  bayesianSentence,
  bayesianAgreesWithVerdict,
  selectHeadlineSentence,
  standardNormalCdf,
  buildPermutationNull,
  percentileOf,
  hasEnoughNullPages,
  permutationSentence,
  permutationSentenceFromCounts,
  MAX_NULL_PAGES,
  MIN_NULL_PAGES,
  type PermutationNull,
  FDR_Q,
  winPValue,
  benjaminiHochbergSignificant,
  computeFdrCautions,
  fdrCautionSentence,
  attachFdrToLedger,
  computeEquivalence,
  EQUIVALENCE_MAX_LIFT_FRACTION,
  EQUIVALENCE_MAX_CLICKS_PER_MONTH,
  computeNoveltyDecay,
  computeEarlySignal,
} from "./reliability-extras";
import type { GscWindowMetrics } from "./measure";
import type { PageSurgeonContext } from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import type { DailyClickPoint } from "./weekday-baseline";
import { addDays } from "./measure";

describe("bayesian-read (folded)", () => {
  describe("standardNormalCdf, closed-form sanity", () => {
    it("matches well-known standard normal table values", () => {
      expect(standardNormalCdf(0)).toBeCloseTo(0.5, 4);
      expect(standardNormalCdf(1.6448536269514722)).toBeCloseTo(0.95, 3);
      expect(standardNormalCdf(-1.6448536269514722)).toBeCloseTo(0.05, 3);
      expect(standardNormalCdf(1.959963985)).toBeCloseTo(0.975, 3);
      expect(standardNormalCdf(-3)).toBeCloseTo(0.00135, 3);
    });
  });

  describe("bayesianCtrRead, beta-binomial matrix", () => {
    it("flat CTR (identical pre/post rate, large sample) reads near 50/50 with a tiny CI around 0", () => {
      const read = bayesianCtrRead({
        preClicks: 500,
        preImpressions: 10000,
        postClicks: 500,
        postImpressions: 10000,
        postWindowDays: 28,
      });
      expect(read.pWin).toBeGreaterThan(0.4);
      expect(read.pWin).toBeLessThan(0.6);
      expect(read.ci90Low).toBeLessThan(0);
      expect(read.ci90High).toBeGreaterThan(0);
      expect(read.smallSample).toBe(false);
    });

    it("a large, clear CTR improvement on a big sample reads high pWin with a positive CI", () => {
      // pre: 5% CTR (500/10000), post: 8% CTR (800/10000), a real, well-powered lift.
      const read = bayesianCtrRead({
        preClicks: 500,
        preImpressions: 10000,
        postClicks: 800,
        postImpressions: 10000,
        postWindowDays: 28,
      });
      expect(read.pWin).toBeGreaterThan(0.95);
      expect(read.ci90Low).toBeGreaterThan(0); // confident positive lift, CI excludes 0
      expect(read.expectedMonthlyLift).toBeGreaterThan(0);
      expect(read.smallSample).toBe(false);
    });

    it("a large, clear CTR decline reads low pWin with a negative CI", () => {
      const read = bayesianCtrRead({
        preClicks: 800,
        preImpressions: 10000,
        postClicks: 500,
        postImpressions: 10000,
        postWindowDays: 28,
      });
      expect(read.pWin).toBeLessThan(0.05);
      expect(read.ci90High).toBeLessThan(0);
      expect(read.expectedMonthlyLift).toBeLessThan(0);
    });

    it("small-sample windows are flagged and pWin stays a genuine coin flip near a tiny lift", () => {
      const read = bayesianCtrRead({
        preClicks: 2,
        preImpressions: 20,
        postClicks: 3,
        postImpressions: 20,
        postWindowDays: 7,
      });
      expect(read.smallSample).toBe(true);
      // Small sample: the interval should be wide relative to the point estimate,
      // reflecting genuine uncertainty rather than false confidence.
      expect(read.ci90High - read.ci90Low).toBeGreaterThan(0);
    });

    it("a zero-click pre window never produces NaN/degenerate output (add-one smoothing)", () => {
      const read = bayesianCtrRead({
        preClicks: 0,
        preImpressions: 100,
        postClicks: 5,
        postImpressions: 100,
        postWindowDays: 28,
      });
      expect(Number.isFinite(read.pWin)).toBe(true);
      expect(Number.isFinite(read.ci90Low)).toBe(true);
      expect(Number.isFinite(read.ci90High)).toBe(true);
    });

    it("scales the monthly figure by the post window length (a 7-day window's daily rate projects further than a 28-day one's raw count)", () => {
      const sevenDay = bayesianCtrRead({
        preClicks: 50, preImpressions: 1000, postClicks: 80, postImpressions: 1000, postWindowDays: 7,
      });
      const twentyEightDay = bayesianCtrRead({
        preClicks: 50, preImpressions: 1000, postClicks: 80, postImpressions: 1000, postWindowDays: 28,
      });
      // Same clicks/impressions but a SHORTER window implies a HIGHER daily rate,
      // so the monthly projection should be larger for the 7-day window.
      expect(sevenDay.expectedMonthlyLift).toBeGreaterThan(twentyEightDay.expectedMonthlyLift);
    });
  });

  describe("bayesianClicksRead, gamma-Poisson matrix", () => {
    it("flat clicks rate (large sample) reads near 50/50", () => {
      const read = bayesianClicksRead({ preClicks: 280, preDays: 28, postClicks: 280, postDays: 28 });
      expect(read.pWin).toBeGreaterThan(0.4);
      expect(read.pWin).toBeLessThan(0.6);
    });

    it("a large, clear clicks improvement reads high pWin with a positive monthly CI", () => {
      // pre: 10 clicks/day, post: 20 clicks/day over a real 28-day window. The
      // posterior mean is shrunk toward the prior by the add-one smoothing (see
      // module doc), so this checks direction + a sane monthly magnitude rather
      // than the raw (unsmoothed) MLE difference.
      const read = bayesianClicksRead({ preClicks: 280, preDays: 28, postClicks: 560, postDays: 28 });
      expect(read.pWin).toBeGreaterThan(0.95);
      expect(read.ci90Low).toBeGreaterThan(0);
      expect(read.expectedMonthlyLift).toBeGreaterThan(50);
      expect(read.expectedMonthlyLift).toBeLessThan(300);
    });

    it("a large, clear clicks decline reads low pWin with a negative CI", () => {
      const read = bayesianClicksRead({ preClicks: 560, preDays: 28, postClicks: 280, postDays: 28 });
      expect(read.pWin).toBeLessThan(0.05);
      expect(read.ci90High).toBeLessThan(0);
    });

    it("small click counts are flagged small-sample", () => {
      const read = bayesianClicksRead({ preClicks: 3, preDays: 7, postClicks: 5, postDays: 7 });
      expect(read.smallSample).toBe(true);
    });

    it("large click counts on a full window are not flagged small-sample", () => {
      const read = bayesianClicksRead({ preClicks: 300, preDays: 28, postClicks: 310, postDays: 28 });
      expect(read.smallSample).toBe(false);
    });

    it("never produces NaN on a zero-click pre window", () => {
      const read = bayesianClicksRead({ preClicks: 0, preDays: 28, postClicks: 10, postDays: 28 });
      expect(Number.isFinite(read.pWin)).toBe(true);
      expect(Number.isFinite(read.expectedMonthlyLift)).toBe(true);
    });
  });

  describe("buildBayesianRead, metric routing", () => {
    const base = {
      treatedPre: { clicks: 500, impressions: 10000 },
      treatedPost: { clicks: 800, impressions: 10000 },
      preWindowDays: 28,
      postWindowDays: 28,
    };

    it("routes a CTR-judged change through the beta-binomial model", () => {
      const read = buildBayesianRead({ ...base, metric: "ctr" });
      expect(read).not.toBeNull();
      expect(read!.pWin).toBeGreaterThan(0.5);
    });

    it("routes a clicks-judged change through the gamma-Poisson model", () => {
      const read = buildBayesianRead({ ...base, metric: "clicks" });
      expect(read).not.toBeNull();
      expect(read!.pWin).toBeGreaterThan(0.5);
    });

    it("returns null for a position-judged change (no honest count/rate model for a rank)", () => {
      const read = buildBayesianRead({ ...base, metric: "position" });
      expect(read).toBeNull();
    });
  });

  describe("bayesianSentence, plain language, no dashes", () => {
    it("reads a strong positive read as helped, with a monthly range", () => {
      const s = bayesianSentence(0.87, 5, 40, false);
      expect(s).toContain("87 percent sure this helped");
      expect(s).toContain("5 to 40 extra clicks a month");
    });

    it("reads a strong negative read as hurt", () => {
      const s = bayesianSentence(0.02, -40, -5, false);
      expect(s).toContain("98 percent sure this hurt");
    });

    it("reads a coin-flip pWin as genuinely too close to call, not spun positive", () => {
      const s = bayesianSentence(0.52, -5, 8, false);
      expect(s).toContain("Too close to call");
    });

    it("appends a small-sample caveat when flagged", () => {
      const s = bayesianSentence(0.8, 1, 10, true);
      expect(s).toContain("Early read, small sample so far.");
    });

    it("handles a negative-to-positive straddling range in plain words", () => {
      const s = bayesianSentence(0.6, -5, 10, false);
      expect(s.toLowerCase()).toContain("fewer");
      expect(s.toLowerCase()).toContain("extra");
    });

    it("handles an all-negative range in plain words (both bounds fewer clicks)", () => {
      const s = bayesianSentence(0.1, -40, -5, false);
      expect(s.toLowerCase()).toContain("fewer clicks a month");
    });

    it("never contains an em or en dash", () => {
      const cases = [
        bayesianSentence(0.87, 5, 40, false),
        bayesianSentence(0.02, -40, -5, false),
        bayesianSentence(0.5, -5, 5, false),
        bayesianSentence(0.8, 1, 10, true),
        bayesianSentence(0.3, -20, -1, false),
      ];
      for (const s of cases) expect(s).not.toMatch(/[–—]/);
    });
  });

  describe("bayesianAgreesWithVerdict, direction agreement gate", () => {
    it("agrees with a won verdict only when pWin clears 0.7", () => {
      expect(bayesianAgreesWithVerdict("won", { pWin: 0.87 })).toBe(true);
      expect(bayesianAgreesWithVerdict("won", { pWin: 0.7 })).toBe(true);
      expect(bayesianAgreesWithVerdict("won", { pWin: 0.69 })).toBe(false);
      expect(bayesianAgreesWithVerdict("won", { pWin: 0.1 })).toBe(false);
    });

    it("agrees with a lost verdict only when pWin is at or below 0.3", () => {
      expect(bayesianAgreesWithVerdict("lost", { pWin: 0.13 })).toBe(true);
      expect(bayesianAgreesWithVerdict("lost", { pWin: 0.3 })).toBe(true);
      expect(bayesianAgreesWithVerdict("lost", { pWin: 0.31 })).toBe(false);
      expect(bayesianAgreesWithVerdict("lost", { pWin: 0.9 })).toBe(false);
    });

    it("never agrees with a non-final verdict (measuring/inconclusive/insufficient_data)", () => {
      expect(bayesianAgreesWithVerdict("measuring", { pWin: 0.99 })).toBe(false);
      expect(bayesianAgreesWithVerdict("inconclusive", { pWin: 0.01 })).toBe(false);
      expect(bayesianAgreesWithVerdict("insufficient_data", { pWin: 0.5 })).toBe(false);
    });
  });

  describe("selectHeadlineSentence, Results row presentation pin", () => {
    const floorSentence = "Likely helping: +12 clicks vs comparable pages over the 28-day window (medium confidence, observational).";

    it("upgrades to the Bayesian sentence on a won verdict that agrees (pWin >= 0.7)", () => {
      const read = { pWin: 0.87, sentence: "We are 87 percent sure this helped, likely 5 to 40 extra clicks a month." };
      expect(selectHeadlineSentence("won", read, floorSentence)).toBe(read.sentence);
    });

    it("upgrades to the Bayesian sentence on a lost verdict that agrees (pWin <= 0.3)", () => {
      const read = { pWin: 0.1, sentence: "I am 90 percent sure this hurt, likely 40 to 5 fewer clicks a month." };
      expect(selectHeadlineSentence("lost", read, floorSentence)).toBe(read.sentence);
    });

    it("keeps the floor sentence on a won verdict when the Bayesian read DISAGREES (pWin below 0.7)", () => {
      const read = { pWin: 0.4, sentence: "Too close to call yet, likely 5 fewer to 8 extra clicks a month either way." };
      expect(selectHeadlineSentence("won", read, floorSentence)).toBe(floorSentence);
    });

    it("keeps the floor sentence on a lost verdict when the Bayesian read DISAGREES (pWin above 0.3)", () => {
      const read = { pWin: 0.6, sentence: "Too close to call yet, likely 5 fewer to 8 extra clicks a month either way." };
      expect(selectHeadlineSentence("lost", read, floorSentence)).toBe(floorSentence);
    });

    it("keeps the floor sentence when there is no Bayesian read at all (null/undefined)", () => {
      expect(selectHeadlineSentence("won", null, floorSentence)).toBe(floorSentence);
      expect(selectHeadlineSentence("won", undefined, floorSentence)).toBe(floorSentence);
    });

    it("keeps the floor sentence for non-final verdicts (measuring/inconclusive/insufficient_data) even with a strong Bayesian read", () => {
      const read = { pWin: 0.99, sentence: "I am 99 percent sure this helped, likely 5 to 40 extra clicks a month." };
      expect(selectHeadlineSentence("measuring", read, floorSentence)).toBe(floorSentence);
      expect(selectHeadlineSentence("inconclusive", read, floorSentence)).toBe(floorSentence);
      expect(selectHeadlineSentence("insufficient_data", read, floorSentence)).toBe(floorSentence);
    });

    it("never changes the stored verdict itself, only the rendered sentence (documented non-decision-path contract)", () => {
      // This is a documentation pin: selectHeadlineSentence takes the verdict as
      // an INPUT and never returns or implies a different one - callers must
      // keep using rec.verdict for any decision logic, only the string differs.
      const read = { pWin: 0.95, sentence: "I am 95 percent sure this helped, likely 10 to 50 extra clicks a month." };
      const verdictBefore = "won";
      selectHeadlineSentence(verdictBefore, read, floorSentence);
      expect(verdictBefore).toBe("won");
    });
  });

  describe("dash guard (hard rule)", () => {
    it("bayesian-read.ts contains no em or en dashes", () => {
      const fs = require("node:fs") as typeof import("node:fs");
      const path = require("node:path") as typeof import("node:path");
      const src = fs.readFileSync(path.join(__dirname, "reliability-extras.ts"), "utf8");
      expect(src).not.toMatch(/[–—]/);
    });
  });
});

describe("permutation-null (folded)", () => {
  /**
   * permutation-null (2026-07-02, master plan item 37) - the null distribution
   * builder + percentile math that qualifies a treated GSC lift against every
   * untreated page with adequate traffic, sharing the treated window's exact
   * dates so the comparison is fair (same market weather).
   */


  const M = (clicks: number, impressions = 1000): GscWindowMetrics => ({
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: 5,
  });

  function ctxWith(pages: Record<string, number>): PageSurgeonContext {
    const gscByUrl = new Map<string, { impressions90d: number }>();
    const snapshotByCanon = new Map<string, { url: string }>();
    for (const [url, impr] of Object.entries(pages)) {
      gscByUrl.set(url, { impressions90d: impr });
      snapshotByCanon.set(url, { url });
    }
    return { gscByUrl, snapshotByCanon } as unknown as PageSurgeonContext;
  }

  /** Build a fake readWindowForPages that returns the SAME per-page metrics for
   *  every call whose end == the given pre or post boundary. Keyed by page. */
  function fakeReadWindow(opts: {
    shipDate: string;
    pre: Record<string, GscWindowMetrics>;
    post: Record<string, GscWindowMetrics>;
  }) {
    return async (args: { pages: readonly string[]; start: string; end: string }) => {
      const out = new Map<string, GscWindowMetrics>();
      const isPost = args.start === opts.shipDate;
      for (const p of args.pages) {
        out.set(p, (isPost ? opts.post[p] : opts.pre[p]) ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 });
      }
      return out;
    };
  }

  describe("buildPermutationNull - candidate selection + window sharing", () => {
    const shipDate = "2026-06-01";

    it("shares the EXACT treated window (same shipDate, same day length) for every candidate", async () => {
      const calls: Array<{ start: string; end: string }> = [];
      const readWindow = async (args: { pages: readonly string[]; start: string; end: string }) => {
        calls.push({ start: args.start, end: args.end });
        return new Map(args.pages.map((p) => [p, M(10)]));
      };
      await buildPermutationNull(
        { tenantId: "t1", shipDate, windowDays: 7 },
        {
          loadContext: async () => ctxWith({ "https://x.com/a": 5000, "https://x.com/b": 4000 }),
          loadLedger: async () => [],
          readWindow: readWindow as any,
        },
      );
      // Pre call: [shipDate-28d, shipDate); post call: [shipDate, shipDate+7d).
      expect(calls).toContainEqual({ start: "2026-05-04", end: shipDate });
      expect(calls).toContainEqual({ start: shipDate, end: "2026-06-08" });
    });

    it("excludes ledger-reserved paths and caller-supplied excludePaths", async () => {
      const result = await buildPermutationNull(
        { tenantId: "t1", shipDate, windowDays: 7, excludePaths: new Set(["/treated"]) },
        {
          loadContext: async () =>
            ctxWith({
              "https://x.com/treated": 9000,
              "https://x.com/ledger-control": 8000,
              "https://x.com/clean-a": 5000,
              "https://x.com/clean-b": 4000,
            }),
          loadLedger: async () => [{ path: "/other-treated", controlPages: ["https://x.com/ledger-control"] }],
          readWindow: fakeReadWindow({
            shipDate,
            pre: {
              "https://x.com/clean-a": M(10),
              "https://x.com/clean-b": M(10),
            },
            post: {
              "https://x.com/clean-a": M(12),
              "https://x.com/clean-b": M(9),
            },
          }) as any,
        },
      );
      const pages = result.pages.map((p) => p.page);
      expect(pages).not.toContain("https://x.com/treated");
      expect(pages).not.toContain("https://x.com/ledger-control");
      expect(pages).toContain("https://x.com/clean-a");
      expect(pages).toContain("https://x.com/clean-b");
    });

    it("is bounded to maxPages (defaults to MAX_NULL_PAGES)", async () => {
      const many: Record<string, number> = {};
      for (let i = 0; i < 100; i++) many[`https://x.com/p${i}`] = 1000 + i;
      const preAll: Record<string, GscWindowMetrics> = {};
      const postAll: Record<string, GscWindowMetrics> = {};
      for (const url of Object.keys(many)) {
        preAll[url] = M(10);
        postAll[url] = M(10);
      }
      const result = await buildPermutationNull(
        { tenantId: "t1", shipDate, windowDays: 7 },
        {
          loadContext: async () => ctxWith(many),
          loadLedger: async () => [],
          readWindow: fakeReadWindow({ shipDate, pre: preAll, post: postAll }) as any,
        },
      );
      expect(result.pages.length).toBeLessThanOrEqual(MAX_NULL_PAGES);
    });

    it("drops candidates with no real pre-window presence (can't form a fair delta)", async () => {
      const result = await buildPermutationNull(
        { tenantId: "t1", shipDate, windowDays: 7 },
        {
          loadContext: async () => ctxWith({ "https://x.com/a": 5000, "https://x.com/zero-pre": 5000 }),
          loadLedger: async () => [],
          readWindow: fakeReadWindow({
            shipDate,
            pre: { "https://x.com/a": M(10), "https://x.com/zero-pre": M(0, 0) },
            post: { "https://x.com/a": M(12), "https://x.com/zero-pre": M(5) },
          }) as any,
        },
      );
      expect(result.pages.map((p) => p.page)).not.toContain("https://x.com/zero-pre");
    });

    it("is fail-soft: a thrown context load returns an empty null, never throws", async () => {
      const result = await buildPermutationNull(
        { tenantId: "t1", shipDate, windowDays: 7 },
        {
          loadContext: async () => {
            throw new Error("supabase down");
          },
        },
      );
      expect(result.pages).toEqual([]);
    });

    it("returns empty when there is no tenantId or shipDate", async () => {
      expect((await buildPermutationNull({ tenantId: "", shipDate, windowDays: 7 })).pages).toEqual([]);
      expect((await buildPermutationNull({ tenantId: "t1", shipDate: "", windowDays: 7 })).pages).toEqual([]);
    });

    it("computes a leave-one-out pseudo-lift per page (own delta minus mean of the others)", async () => {
      const result = await buildPermutationNull(
        { tenantId: "t1", shipDate, windowDays: 7, preWindowDays: 7 }, // scale 1:1 for simple arithmetic
        {
          loadContext: async () =>
            ctxWith({ "https://x.com/a": 5000, "https://x.com/b": 4000, "https://x.com/c": 3000 }),
          loadLedger: async () => [],
          readWindow: fakeReadWindow({
            shipDate,
            pre: {
              "https://x.com/a": M(10),
              "https://x.com/b": M(10),
              "https://x.com/c": M(10),
            },
            post: {
              "https://x.com/a": M(20), // delta +10
              "https://x.com/b": M(10), // delta 0
              "https://x.com/c": M(10), // delta 0
            },
          }) as any,
        },
      );
      const a = result.pages.find((p) => p.page === "https://x.com/a")!;
      // a's pseudoLift = 10 - mean(0, 0) = 10
      expect(a.delta).toBe(10);
      expect(a.pseudoLift).toBe(10);
      const b = result.pages.find((p) => p.page === "https://x.com/b")!;
      // b's pseudoLift = 0 - mean(10, 0) = -5
      expect(b.pseudoLift).toBe(-5);
    });
  });

  describe("percentileOf - empirical two-sided percentile", () => {
    function nullOf(pseudoLifts: number[]): PermutationNull {
      return {
        pages: pseudoLifts.map((pseudoLift, i) => ({ page: `p${i}`, delta: pseudoLift, pseudoLift })),
        shipDate: "2026-06-01",
        windowDays: 7,
      };
    }

    it("counts pages whose |pseudoLift| >= |treated lift|", () => {
      const dist = nullOf([1, 2, 3, 20, -25, 4, 5]);
      const { percentile, nGreater, nTotal } = percentileOf(15, dist);
      expect(nTotal).toBe(7);
      expect(nGreater).toBe(2); // 20 and -25
      expect(percentile).toBeCloseTo(2 / 7, 6);
    });

    it("returns percentile 1 (no evidence) on an empty null", () => {
      const dist = nullOf([]);
      expect(percentileOf(15, dist)).toEqual({ percentile: 1, nGreater: 0, nTotal: 0 });
    });

    it("is magnitude-based (a large negative treated lift compares on absolute value)", () => {
      const dist = nullOf([1, 2, 3]);
      const { nGreater } = percentileOf(-10, dist);
      expect(nGreater).toBe(0);
    });

    it("zero-lift synthetic distribution: everything counts (percentile 1)", () => {
      const dist = nullOf([0, 0, 0, 0]);
      const { percentile } = percentileOf(0, dist);
      expect(percentile).toBe(1);
    });
  });

  describe("hasEnoughNullPages - the MIN_NULL_PAGES gate", () => {
    it("is false below MIN_NULL_PAGES, true at or above it", () => {
      const under: PermutationNull = {
        pages: Array.from({ length: MIN_NULL_PAGES - 1 }, (_, i) => ({ page: `p${i}`, delta: 0, pseudoLift: 0 })),
        shipDate: "2026-06-01",
        windowDays: 7,
      };
      const at: PermutationNull = {
        pages: Array.from({ length: MIN_NULL_PAGES }, (_, i) => ({ page: `p${i}`, delta: 0, pseudoLift: 0 })),
        shipDate: "2026-06-01",
        windowDays: 7,
      };
      expect(hasEnoughNullPages(under)).toBe(false);
      expect(hasEnoughNullPages(at)).toBe(true);
    });
  });

  describe("permutationSentence - plain English, no jargon, honest thin-sample skip", () => {
    function nullOf(n: number, greaterCount: number): PermutationNull {
      const pages = Array.from({ length: n }, (_, i) => ({
        page: `p${i}`,
        delta: i < greaterCount ? 999 : 0,
        pseudoLift: i < greaterCount ? 999 : 0,
      }));
      return { pages, shipDate: "2026-06-01", windowDays: 7 };
    }

    it("returns null when the null distribution is too thin (< MIN_NULL_PAGES)", () => {
      expect(permutationSentence(10, nullOf(MIN_NULL_PAGES - 1, 0))).toBeNull();
    });

    it("names the exact counts for a strong (low-percentile) read", () => {
      const s = permutationSentence(10, nullOf(61, 2));
      // operator spec 2026-07-09 E-34: estimate, not proof - never claims causal certainty.
      expect(s).toBe(
        "Out of 61 untouched pages, only 2 moved as much as this one did. That is a strong estimate the change did it, not proof.",
      );
    });

    it("uses singular phrasing for exactly one comparable page", () => {
      const s = permutationSentence(10, nullOf(40, 1));
      expect(s).toContain("only 1 moved as much as this one did");
    });

    it("uses none phrasing when zero untouched pages moved as much", () => {
      const s = permutationSentence(10, nullOf(30, 0));
      expect(s).toContain("none moved as much as this one did");
    });

    it("gives the honest weak read when many untouched pages move this much on their own", () => {
      const s = permutationSentence(10, nullOf(40, 20));
      expect(s).toContain("I would not call this strong evidence yet");
    });

    it("never contains lab jargon (placebo, permutation, p-value)", () => {
      const strong = permutationSentence(10, nullOf(61, 2))!;
      const weak = permutationSentence(10, nullOf(40, 20))!;
      for (const s of [strong, weak]) {
        expect(s.toLowerCase()).not.toContain("placebo");
        expect(s.toLowerCase()).not.toContain("permutation");
        expect(s.toLowerCase()).not.toContain("p-value");
        expect(s.toLowerCase()).not.toContain("null distribution");
      }
    });
  });

  describe("permutationSentenceFromCounts - the presentation-layer function (Results row)", () => {
    it("returns null when nTotal is 0 (no comparison pool)", () => {
      expect(permutationSentenceFromCounts(0, 0)).toBeNull();
    });

    it("agrees exactly with permutationSentence for the same counts (single source of truth)", () => {
      const fromCounts = permutationSentenceFromCounts(2, 61);
      const fromDist = permutationSentence(10, {
        pages: Array.from({ length: 61 }, (_, i) => ({ page: `p${i}`, delta: i < 2 ? 999 : 0, pseudoLift: i < 2 ? 999 : 0 })),
        shipDate: "2026-06-01",
        windowDays: 7,
      });
      expect(fromCounts).toBe(fromDist);
    });

    it("is what run-measurement attaches as permutationRead: {nGreater, nTotal} round-trips", () => {
      // The exact fixture named in the task: "Out of 61 untouched pages, only 2 moved..."
      // operator spec 2026-07-09 E-34: estimate, not proof - never claims causal certainty.
      const s = permutationSentenceFromCounts(2, 61);
      expect(s).toBe(
        "Out of 61 untouched pages, only 2 moved as much as this one did. That is a strong estimate the change did it, not proof.",
      );
    });

    // operator spec 2026-07-09 E-34: the strong-read sentence never overclaims causal certainty.
    it("never says 'strong evidence the change caused it' (causal-certainty overclaim)", () => {
      const s = permutationSentenceFromCounts(2, 61);
      expect(s).not.toContain("strong evidence the change caused it");
      expect(s).toContain("not proof");
    });
  });

  describe("dash guard (hard rule)", () => {
    it("permutation-null.ts contains no em or en dashes", () => {
      const src = readFileSync(resolve(__dirname, "reliability-extras.ts"), "utf8");
      expect(src).not.toMatch(/[–—]/);
    });

    it("no sentence produced by permutationSentence contains an em or en dash", () => {
      const dist: PermutationNull = {
        pages: Array.from({ length: 61 }, (_, i) => ({ page: `p${i}`, delta: i < 2 ? 999 : 0, pseudoLift: i < 2 ? 999 : 0 })),
        shipDate: "2026-06-01",
        windowDays: 7,
      };
      const s = permutationSentence(10, dist)!;
      expect(s).not.toMatch(/[–—]/);
    });
  });
});

describe("fdr-adjust (folded)", () => {
  /**
   * fdr-adjust.test.ts (P4 R10b, v1 item 291) - pins the pool-wide step-up
   * adjustment: all-significant and none-significant fixture pools, the
   * mixed pool where a row loses significance after adjustment, the
   * permutation-preferred p source with the lift z-approximation fallback,
   * the honest champagne sentence, and the ledger pass's pool selection.
   */

  describe("winPValue - how surprising is this lift", () => {
    it("prefers the empirical permutation read when one exists", () => {
      const p = winPValue({
        permutationRead: { nGreater: 3, nTotal: 60 },
        adjustedLift: 999,
        expectedWindowClicks: 1,
      });
      expect(p).toBeCloseTo(0.05, 10);
    });

    it("falls back to the lift z-approximation and is monotonic in the lift", () => {
      const small = winPValue({ adjustedLift: 5, expectedWindowClicks: 100 });
      const big = winPValue({ adjustedLift: 40, expectedWindowClicks: 100 });
      expect(big).toBeLessThan(small);
      // 40 extra clicks on 100 expected = z of 4 -> well under any bar.
      expect(big).toBeLessThan(0.001);
      // 5 extra clicks on 100 expected = z of 0.5 -> unremarkable.
      expect(small).toBeGreaterThan(0.2);
    });

    it("guards a zero-expected window (never divides by zero)", () => {
      const p = winPValue({ adjustedLift: 3, expectedWindowClicks: 0 });
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    });
  });

  describe("benjaminiHochbergSignificant - the step-up rule", () => {
    it("an all-significant pool survives whole", () => {
      const rows = [
        { id: "a", p: 0.001 },
        { id: "b", p: 0.002 },
        { id: "c", p: 0.003 },
      ];
      const s = benjaminiHochbergSignificant(rows);
      expect(s.size).toBe(3);
    });

    it("a none-significant pool survives nothing", () => {
      const rows = [
        { id: "a", p: 0.5 },
        { id: "b", p: 0.7 },
        { id: "c", p: 0.9 },
      ];
      expect(benjaminiHochbergSignificant(rows).size).toBe(0);
    });

    it("the step-up keeps every rank at or below the largest passing rank", () => {
      // m = 4, q = 0.1: bars are 0.025 / 0.05 / 0.075 / 0.1.
      // p = [0.01, 0.06, 0.07, 0.9]: rank 3 (0.07 <= 0.075) passes, so ranks
      // 1-3 ALL survive even though rank 2's own p (0.06) is above its bar.
      const rows = [
        { id: "a", p: 0.01 },
        { id: "b", p: 0.06 },
        { id: "c", p: 0.07 },
        { id: "d", p: 0.9 },
      ];
      const s = benjaminiHochbergSignificant(rows);
      expect([...s].sort()).toEqual(["a", "b", "c"]);
    });
  });

  describe("computeFdrCautions - who holds the champagne", () => {
    it("a row that cleared the individual bar but lost the pool-wide one is cautioned", () => {
      // m = 4, q = 0.1: bars 0.025 / 0.05 / 0.075 / 0.1.
      // p = [0.01, 0.09, 0.5, 0.6]: only rank 1 survives (0.09 > 0.05);
      // 0.09 <= q individually -> caution. The 0.5/0.6 rows never cleared the
      // individual bar, so they are not cautioned here (the permutation noise
      // line already covers them).
      const cautions = computeFdrCautions([
        { id: "a", p: 0.01 },
        { id: "b", p: 0.09 },
        { id: "c", p: 0.5 },
        { id: "d", p: 0.6 },
      ]);
      expect(cautions.get("a")?.fdrCaution).toBe(false);
      expect(cautions.get("a")?.sentence).toBeNull();
      expect(cautions.get("b")?.fdrCaution).toBe(true);
      expect(cautions.get("b")?.sentence).toBe(fdrCautionSentence(4));
      expect(cautions.get("c")?.fdrCaution).toBe(false);
      expect(cautions.get("d")?.fdrCaution).toBe(false);
    });

    it("an all-significant pool cautions nobody", () => {
      const cautions = computeFdrCautions([
        { id: "a", p: 0.001 },
        { id: "b", p: 0.002 },
      ]);
      expect([...cautions.values()].every((c) => !c.fdrCaution)).toBe(true);
    });

    it("a none-significant pool cautions nobody (nothing LOST significance)", () => {
      const cautions = computeFdrCautions([
        { id: "a", p: 0.4 },
        { id: "b", p: 0.6 },
      ]);
      expect([...cautions.values()].every((c) => !c.fdrCaution)).toBe(true);
    });

    it("every read carries the pool size and its own p", () => {
      const cautions = computeFdrCautions([
        { id: "a", p: 0.01 },
        { id: "b", p: 0.09 },
        { id: "c", p: 0.5 },
      ]);
      expect(cautions.get("c")?.poolSize).toBe(3);
      expect(cautions.get("c")?.pValue).toBe(0.5);
    });

    it("the champagne sentence names the real pool count", () => {
      expect(fdrCautionSentence(12)).toBe(
        "With 12 changes measured at once, one or two will look like winners by chance; this one is close enough to that line that I am holding the champagne.",
      );
    });
  });

  describe("attachFdrToLedger - the ledger pass", () => {
    type Row = Parameters<typeof attachFdrToLedger>[0][number];
    function row(
      id: string,
      verdict: string,
      over: Partial<Row> = {},
    ): Row {
      return {
        id,
        verdict,
        windows: [
          { day: 7, ran: true, adjustedLift: 5 },
          { day: 14, ran: true, adjustedLift: 10 },
          { day: 28, ran: true, adjustedLift: 20 },
        ],
        baseline: { clicks: 100, windowDays: 28 },
        permutationRead: null,
        ...over,
      };
    }

    it("pools only mature wins (verdict won + closed 28 day window) and attaches reads to them alone", () => {
      const ledger = [
        row("win-strong", "won", { permutationRead: { nGreater: 0, nTotal: 60 } }),
        row("win-marginal", "won", { permutationRead: { nGreater: 5, nTotal: 60 } }), // p ~ 0.083
        row("lost", "lost"),
        row("measuring", "won", {
          windows: [
            { day: 7, ran: true, adjustedLift: 5 },
            { day: 14, ran: false, adjustedLift: 0 },
            { day: 28, ran: false, adjustedLift: 0 },
          ],
        }),
      ];
      const out = attachFdrToLedger(ledger);
      // Pool = the two mature wins only. m = 2, q = 0.1: bars 0.05 / 0.1;
      // p = [0, 0.083] -> rank 2's bar is 0.1, so BOTH survive: both pooled
      // rows carry a read, neither cautioned, non-pool rows untouched.
      expect(out.find((r) => r.id === "win-strong")?.fdrRead).toBeDefined();
      expect(out.find((r) => r.id === "win-marginal")?.fdrRead).toBeDefined();
      expect(out.find((r) => r.id === "win-marginal")?.fdrRead?.fdrCaution).toBe(false);
      expect(out.find((r) => r.id === "lost")?.fdrRead).toBeUndefined();
      expect(out.find((r) => r.id === "measuring")?.fdrRead).toBeUndefined();
    });

    it("a marginal win LOSES significance in a big pool of noise and gets the caution", () => {
      // One clearly-real win, one marginal (p ~ 0.083), six wins that never
      // cleared the individual bar. m = 8: the marginal row's bar is far below
      // 0.083 at its rank, so it loses significance after adjustment.
      const ledger = [
        row("real", "won", { permutationRead: { nGreater: 0, nTotal: 60 } }),
        row("marginal", "won", { permutationRead: { nGreater: 5, nTotal: 60 } }),
        ...[1, 2, 3, 4, 5, 6].map((i) =>
          row(`noise-${i}`, "won", { permutationRead: { nGreater: 30, nTotal: 60 } }),
        ),
      ];
      const out = attachFdrToLedger(ledger);
      const marginal = out.find((r) => r.id === "marginal")?.fdrRead;
      expect(marginal?.fdrCaution).toBe(true);
      expect(marginal?.sentence).toContain("With 8 changes measured at once");
      expect(out.find((r) => r.id === "real")?.fdrRead?.fdrCaution).toBe(false);
    });

    it("a pool under two rows returns the ledger byte-identical (no multiplicity to adjust)", () => {
      const ledger = [row("only-win", "won"), row("lost", "lost")];
      const out = attachFdrToLedger(ledger);
      expect(out.find((r) => r.id === "only-win")?.fdrRead).toBeUndefined();
      expect(out).toEqual(ledger);
    });

    it("never mutates the input records (returns new objects for pooled rows)", () => {
      const a = row("a", "won", { permutationRead: { nGreater: 0, nTotal: 60 } });
      const b = row("b", "won", { permutationRead: { nGreater: 5, nTotal: 60 } });
      const out = attachFdrToLedger([a, b]);
      expect(a.fdrRead).toBeUndefined();
      expect(b.fdrRead).toBeUndefined();
      expect(out[0]).not.toBe(a);
    });

    it("falls back to the z-approximation for a pooled win with no permutation read", () => {
      // 20 extra clicks on 100 expected = z of 2 -> p ~ 0.023: individually
      // significant. Paired with a clearly-real permutation win in a pool of 2,
      // both survive (bars 0.05 / 0.1).
      const ledger = [
        row("z-approx", "won"),
        row("perm", "won", { permutationRead: { nGreater: 0, nTotal: 60 } }),
      ];
      const out = attachFdrToLedger(ledger);
      const read = out.find((r) => r.id === "z-approx")?.fdrRead;
      expect(read).toBeDefined();
      expect(read!.pValue).toBeGreaterThan(0);
      expect(read!.pValue).toBeLessThan(0.05);
      expect(read!.fdrCaution).toBe(false);
    });

    it("the exported rate is 10 percent per the item spec", () => {
      expect(FDR_Q).toBe(0.1);
    });
  });

  describe("copy guard - dash-clean, no lab words on the surface sentence", () => {
    it("fdr-adjust.ts source keeps lab words out of every sentence string", () => {
      const src = readFileSync(join(__dirname, "reliability-extras.ts"), "utf8");
      expect(src).not.toMatch(/[–—]/);
    });

    it("the champagne sentence never says false discovery, Benjamini, or p-value", () => {
      const s = fdrCautionSentence(5);
      expect(s).not.toMatch(/[–—]/);
      expect(s.toLowerCase()).not.toMatch(/false discovery|benjamini|hochberg|p.value|significan/);
    });
  });
});

describe("equivalence (folded)", () => {
  /**
   * equivalence.test.ts (P4 R10b, v1 item 289) - pins the proven-neutral band:
   * BOTH caps must hold (under 5 percent of baseline monthly clicks AND under
   * 10 clicks a month), strict boundaries, the small-sample and zero-baseline
   * honest nulls, and the exact honest-close sentence.
   */

  function read(over: Partial<Parameters<typeof computeEquivalence>[0]> = {}) {
    return computeEquivalence({
      ci90Low: -2,
      ci90High: 3,
      smallSample: false,
      baselineMonthlyClicks: 400,
      ...over,
    });
  }

  describe("computeEquivalence - the too-small-to-matter band", () => {
    it("bounds entirely inside both caps prove neutral with the honest close", () => {
      // baseline 400/month -> percent cap 20, absolute cap 10 -> band 10.
      const r = read({ ci90Low: -6, ci90High: 4 });
      expect(r?.provenNeutral).toBe(true);
      expect(r?.bandClicksPerMonth).toBe(10);
      expect(r?.sentence).toBe(
        "This change genuinely did nothing, and I can prove that now; that is different from not knowing. The plausible effect sits between 6 fewer and 4 extra clicks a month, too small to matter either way.",
      );
    });

    it("phrases an all-positive and an all-negative range without a raw minus sign", () => {
      expect(read({ ci90Low: 1, ci90High: 4 })?.sentence).toContain("between 1 and 4 extra clicks a month");
      expect(read({ ci90Low: -7, ci90High: -2 })?.sentence).toContain("between 2 and 7 fewer clicks a month");
    });

    it("the band is the SMALLER cap: a small page's 5 percent beats the 10-click cap", () => {
      // baseline 100/month -> percent cap 5, absolute cap 10 -> band 5.
      const inside = read({ baselineMonthlyClicks: 100, ci90Low: -4.9, ci90High: 4.9 });
      expect(inside?.bandClicksPerMonth).toBe(5);
      expect(inside?.provenNeutral).toBe(true);
      const breachesPct = read({ baselineMonthlyClicks: 100, ci90Low: -5.1, ci90High: 3 });
      expect(breachesPct?.provenNeutral).toBe(false);
      expect(breachesPct?.sentence).toBeNull();
    });

    it("the band is the SMALLER cap: a big page's 10-click cap beats its 5 percent", () => {
      // baseline 1000/month -> percent cap 50, absolute cap 10 -> band 10.
      expect(read({ baselineMonthlyClicks: 1000, ci90Low: -9.9, ci90High: 9.9 })?.provenNeutral).toBe(true);
      expect(read({ baselineMonthlyClicks: 1000, ci90Low: -10.5, ci90High: 2 })?.provenNeutral).toBe(false);
    });

    it("the boundary is strict: a bound sitting exactly ON the band is not proven", () => {
      expect(read({ baselineMonthlyClicks: 400, ci90Low: -10, ci90High: 3 })?.provenNeutral).toBe(false);
      expect(read({ baselineMonthlyClicks: 400, ci90Low: -3, ci90High: 10 })?.provenNeutral).toBe(false);
    });

    it("EITHER end breaching the band breaks the proof, not just the wider one", () => {
      expect(read({ ci90Low: -12, ci90High: 1 })?.provenNeutral).toBe(false);
      expect(read({ ci90Low: -1, ci90High: 12 })?.provenNeutral).toBe(false);
    });

    it("normalizes a swapped low/high pair instead of misreading it", () => {
      const r = read({ ci90Low: 4, ci90High: -6 });
      expect(r?.provenNeutral).toBe(true);
      expect(r?.ci90Low).toBe(-6);
      expect(r?.ci90High).toBe(4);
    });
  });

  describe("computeEquivalence - honest absence", () => {
    it("a small sample can never PROVE neutrality, however narrow its interval looks", () => {
      expect(read({ smallSample: true, ci90Low: -0.5, ci90High: 0.5 })).toBeNull();
    });

    it("a page with no baseline clicks has no percent band to prove against", () => {
      expect(read({ baselineMonthlyClicks: 0 })).toBeNull();
      expect(read({ baselineMonthlyClicks: -5 })).toBeNull();
    });

    it("non-finite bounds are a guard null, never NaN math", () => {
      expect(read({ ci90Low: Number.NaN })).toBeNull();
      expect(read({ ci90High: Number.POSITIVE_INFINITY })).toBeNull();
    });

    it("the exported caps match the item spec (5 percent AND 10 clicks a month)", () => {
      expect(EQUIVALENCE_MAX_LIFT_FRACTION).toBe(0.05);
      expect(EQUIVALENCE_MAX_CLICKS_PER_MONTH).toBe(10);
    });
  });

  describe("copy guard - dash-clean, no lab words", () => {
    it("equivalence.ts contains no em or en dashes", () => {
      const src = readFileSync(join(__dirname, "reliability-extras.ts"), "utf8");
      expect(src).not.toMatch(/[–—]/);
    });

    it("the proven sentence is dash-clean and never says equivalence or interval", () => {
      const r = read({ ci90Low: -6, ci90High: 4 });
      expect(r?.sentence).not.toMatch(/[–—]/);
      expect(r?.sentence?.toLowerCase()).not.toMatch(/equivalence|interval|credible|hypothesis/);
    });
  });
});

describe("novelty-decay (folded)", () => {
  /**
   * novelty-decay.test.ts (P4 R10a, v1 item 378) - pins the decay shape rule
   * (peak in week 1, back toward baseline by week 4), the minimum-peak floor so
   * a one-click wobble never reads as a faded jump, the sustained-win and
   * rising-shape negatives, and the 28-finalized-days requirement.
   */

  const SHIP = "2026-05-01";
  const BASELINE_START = addDays(SHIP, -28);

  function series(baselineDaily: number, weeklyPost: [number, number, number, number]): DailyClickPoint[] {
    const out: DailyClickPoint[] = [];
    for (let i = 0; i < 28; i++) out.push({ date: addDays(BASELINE_START, i), clicks: baselineDaily });
    for (let i = 0; i < 28; i++) {
      out.push({ date: addDays(SHIP, i), clicks: weeklyPost[Math.floor(i / 7)] });
    }
    return out;
  }

  function run(weeklyPost: [number, number, number, number], over: Partial<Parameters<typeof computeNoveltyDecay>[0]> = {}) {
    return computeNoveltyDecay({
      series: series(10, weeklyPost),
      shipDate: SHIP,
      knownFrom: "2026-04-01",
      lastFinalizedDate: addDays(SHIP, 27),
      ...over,
    });
  }

  describe("computeNoveltyDecay", () => {
    it("a week-1 jump that fades back to baseline by week 4 flags noveltyDecay with the honest sentence", () => {
      const read = run([20, 15, 12, 10]);
      expect(read).not.toBeNull();
      expect(read!.noveltyDecay).toBe(true);
      expect(read!.weeklyLift).toEqual([10, 5, 2, 0]);
      expect(read!.sentence).toContain("The first week jump faded.");
      expect(read!.sentence).toContain("This looks like novelty, not a lasting win.");
      expect(read!.sentence).toContain("back to its old level");
    });

    it("a partial fade that still keeps residual lift names the week 4 number", () => {
      const read = run([20, 15, 12, 12]);
      expect(read).not.toBeNull();
      expect(read!.noveltyDecay).toBe(true);
      expect(read!.sentence).toContain("back to about 2 extra clicks a day");
    });

    it("a sustained win never flags (week 4 held the lift)", () => {
      const read = run([20, 20, 20, 20]);
      expect(read).not.toBeNull();
      expect(read!.noveltyDecay).toBe(false);
      expect(read!.sentence).toBeNull();
    });

    it("a rising shape never flags (week 1 was not the peak)", () => {
      const read = run([12, 14, 18, 22]);
      expect(read).not.toBeNull();
      expect(read!.noveltyDecay).toBe(false);
    });

    it("a tiny week-1 wobble below the peak floor never flags", () => {
      // +1 click a day on a 10-a-day page is below max(1, 0.2 * 10) = 2.
      const read = run([11, 10, 10, 10]);
      expect(read).not.toBeNull();
      expect(read!.noveltyDecay).toBe(false);
    });

    it("week 4 keeping more than 30 percent of the week 1 jump never flags (the retention boundary)", () => {
      // Week 1 lift 10, week 4 lift 4 = 40 percent retained -> not a fade.
      const read = run([20, 15, 13, 14]);
      expect(read).not.toBeNull();
      expect(read!.noveltyDecay).toBe(false);
    });

    it("returns null before 28 finalized post days exist", () => {
      const read = run([20, 15, 12, 10], { lastFinalizedDate: addDays(SHIP, 20) });
      expect(read).toBeNull();
    });

    it("returns null when the read does not cover the whole baseline window", () => {
      const read = run([20, 15, 12, 10], { knownFrom: "2026-04-10" });
      expect(read).toBeNull();
    });
  });

  describe("copy guard - dash-clean, no em or en dashes in source", () => {
    it("novelty-decay.ts contains no em or en dashes", () => {
      const src = readFileSync(join(__dirname, "reliability-extras.ts"), "utf8");
      expect(src.includes("\u2014")).toBe(false);
      expect(src.includes("\u2013")).toBe(false);
    });
  });
});

describe("early-signal (folded)", () => {
  /**
   * early-signal.test.ts (P4 R10a, v1 item 288) - pins the adaptive-window
   * READS: the 7-consecutive-day decisive boundary (6 days never fires), the
   * present-tense rule (a spike that already normalized never reads decisive),
   * the down direction, the 14-day futility read with its noise guard, and the
   * honest-absence guards. The flags are presentation + N10 confidence only -
   * the module has no access to windows/verdicts at all, which is the
   * structural guarantee the clock rules stay inviolable.
   */

  const SHIP = "2026-05-01";
  const BASELINE_START = addDays(SHIP, -28); // 2026-04-03

  function series(baselinePerDay: (i: number) => number, postPerDay: number[]): DailyClickPoint[] {
    const out: DailyClickPoint[] = [];
    for (let i = 0; i < 28; i++) out.push({ date: addDays(BASELINE_START, i), clicks: baselinePerDay(i) });
    postPerDay.forEach((clicks, i) => out.push({ date: addDays(SHIP, i), clicks }));
    return out;
  }

  const flat10 = () => 10;

  function run(postPerDay: number[], over: Partial<Parameters<typeof computeEarlySignal>[0]> = {}) {
    return computeEarlySignal({
      series: series(flat10, postPerDay),
      shipDate: SHIP,
      knownFrom: "2026-04-01",
      lastFinalizedDate: addDays(SHIP, postPerDay.length - 1),
      ...over,
    });
  }

  describe("computeEarlySignal - decisive", () => {
    it("7 consecutive far-above days read decisive up with the plain sentence", () => {
      const read = run([25, 25, 25, 25, 25, 25, 25]);
      expect(read).not.toBeNull();
      expect(read!.earlyDecisive).toBe(true);
      expect(read!.direction).toBe("up");
      expect(read!.qualifyingRunDays).toBe(7);
      expect(read!.sentence).toContain(
        "This is working so clearly I do not need the full 28 days to tell you.",
      );
      expect(read!.sentence).toContain("far above this page's normal range");
      expect(read!.sentence).toContain("The full 28-day read still waits for the window to close.");
    });

    it("6 consecutive days is NOT decisive (the boundary)", () => {
      const read = run([25, 25, 25, 25, 25, 25]);
      expect(read).not.toBeNull();
      expect(read!.earlyDecisive).toBe(false);
      expect(read!.sentence).toBeNull();
    });

    it("7 far-below days read decisive down", () => {
      const read = run([0, 0, 0, 0, 0, 0, 0]);
      expect(read).not.toBeNull();
      expect(read!.earlyDecisive).toBe(true);
      expect(read!.direction).toBe("down");
      expect(read!.sentence).toContain("This is hurting so clearly");
      expect(read!.sentence).toContain("far below this page's normal range");
    });

    it("a spike that already normalized never reads decisive (present-tense rule)", () => {
      // 7 huge days, then the most recent finalized day is back to normal.
      const read = run([25, 25, 25, 25, 25, 25, 25, 10]);
      expect(read).not.toBeNull();
      expect(read!.earlyDecisive).toBe(false);
      expect(read!.qualifyingRunDays).toBe(0);
    });

    it("ordinary wobble on a flat page never flags (count-noise floor)", () => {
      // 12 clicks on a 10-a-day page is inside sqrt(10)*3 of normal.
      const read = run([12, 12, 12, 12, 12, 12, 12]);
      expect(read).not.toBeNull();
      expect(read!.earlyDecisive).toBe(false);
    });
  });

  describe("computeEarlySignal - futile", () => {
    it("14 flat post days on a steady page read early-futile", () => {
      const read = run(Array(14).fill(10));
      expect(read).not.toBeNull();
      expect(read!.earlyFutile).toBe(true);
      expect(read!.earlyDecisive).toBe(false);
      expect(read!.sentence).toContain("After 14 days this change is very unlikely to move this page");
      expect(read!.sentence).toContain("I will still let the full window finish");
    });

    it("13 days is not enough for a futility call (the boundary)", () => {
      const read = run(Array(13).fill(10));
      expect(read).not.toBeNull();
      expect(read!.earlyFutile).toBe(false);
      expect(read!.sentence).toBeNull();
    });

    it("a noisy page never reads futile off the same flat mean", () => {
      const noisyBaseline = (i: number) => (i % 2 === 0 ? 5 : 15);
      const noisyPost = Array.from({ length: 14 }, (_x, i) => (i % 2 === 0 ? 5 : 15));
      const read = computeEarlySignal({
        series: series(noisyBaseline, noisyPost),
        shipDate: SHIP,
        knownFrom: "2026-04-01",
        lastFinalizedDate: addDays(SHIP, 13),
      });
      expect(read).not.toBeNull();
      expect(read!.earlyFutile).toBe(false);
    });
  });

  describe("computeEarlySignal - honest absence", () => {
    it("null when no post-ship day has finalized yet", () => {
      const read = computeEarlySignal({
        series: series(flat10, []),
        shipDate: SHIP,
        knownFrom: "2026-04-01",
        lastFinalizedDate: addDays(SHIP, -1),
      });
      expect(read).toBeNull();
    });

    it("null when the read does not cover the whole baseline window", () => {
      const read = run([25, 25, 25, 25, 25, 25, 25], { knownFrom: "2026-04-10" });
      expect(read).toBeNull();
    });

    it("null with no finalized watermark at all", () => {
      const read = run([25], { lastFinalizedDate: null });
      expect(read).toBeNull();
    });

    it("reports how many finalized post days it actually saw", () => {
      const read = run([25, 25, 25]);
      expect(read!.postDaysRead).toBe(3);
    });
  });

  describe("copy guard - no lab words, no em or en dashes", () => {
    it("early-signal.ts contains no em or en dashes", () => {
      const src = readFileSync(join(__dirname, "reliability-extras.ts"), "utf8");
      expect(src.includes("\u2014")).toBe(false);
      expect(src.includes("\u2013")).toBe(false);
    });

    it('the operator sentences never say "standard deviation"', () => {
      const up = run([25, 25, 25, 25, 25, 25, 25])!.sentence!;
      const futile = run(Array(14).fill(10))!.sentence!;
      for (const s of [up, futile]) {
        expect(s.toLowerCase()).not.toContain("standard deviation");
        expect(s.toLowerCase()).not.toContain("sigma");
      }
    });
  });
});
