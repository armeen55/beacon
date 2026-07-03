import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FDR_Q,
  winPValue,
  benjaminiHochbergSignificant,
  computeFdrCautions,
  fdrCautionSentence,
  attachFdrToLedger,
} from "./fdr-adjust";

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
    const src = readFileSync(join(__dirname, "fdr-adjust.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });

  it("the champagne sentence never says false discovery, Benjamini, or p-value", () => {
    const s = fdrCautionSentence(5);
    expect(s).not.toMatch(/[–—]/);
    expect(s.toLowerCase()).not.toMatch(/false discovery|benjamini|hochberg|p.value|significan/);
  });
});
