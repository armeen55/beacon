/**
 * Tests for abstention (BEACON_500 N49) - calibrated abstention / law 2.
 *
 * Coverage:
 *  - sufficiency rule: any one of the three signals => ready; none => watching
 *  - the honest hold sentence + "ready" sentence naming what backs the move
 *  - byte-identical-when-all-evidenced (partitionByEvidence held is empty)
 *  - held-for-evidence count line (singular/plural/zero)
 */

import { describe, expect, it } from "vitest";
import {
  assessAbstention,
  hasSufficientEvidence,
  partitionByEvidence,
  heldForEvidenceLine,
  WATCHING_SENTENCE,
  type AbstentionEvidence,
} from "./abstention";

const NONE: AbstentionEvidence = {
  hasDemandSignal: false,
  hasCompetitorTeardown: false,
  hasBehaviorOrGscSignal: false,
};

describe("assessAbstention - sufficiency rule", () => {
  it("holds when NONE of the three signals is present (pure proxy guess)", () => {
    const v = assessAbstention(NONE);
    expect(v.state).toBe("watching");
    expect(v.presentSignals).toEqual([]);
    expect(v.sentence).toBe(WATCHING_SENTENCE);
  });

  it("is ready with demand alone", () => {
    const v = assessAbstention({ ...NONE, hasDemandSignal: true });
    expect(v.state).toBe("ready");
    expect(v.presentSignals).toEqual(["demand"]);
    expect(v.sentence).toContain("real search demand");
  });

  it("is ready with a competitor teardown alone", () => {
    const v = assessAbstention({ ...NONE, hasCompetitorTeardown: true });
    expect(v.state).toBe("ready");
    expect(v.presentSignals).toEqual(["competitor"]);
    expect(v.sentence).toContain("a competitor already covering this");
  });

  it("is ready with a first-party behavior/GSC signal alone", () => {
    const v = assessAbstention({ ...NONE, hasBehaviorOrGscSignal: true });
    expect(v.state).toBe("ready");
    expect(v.presentSignals).toEqual(["behavior_or_gsc"]);
    expect(v.sentence).toContain("this page's own search numbers moving");
  });

  it("names all present signals when several corroborate", () => {
    const v = assessAbstention({
      hasDemandSignal: true,
      hasCompetitorTeardown: true,
      hasBehaviorOrGscSignal: true,
    });
    expect(v.state).toBe("ready");
    expect(v.presentSignals).toEqual(["demand", "competitor", "behavior_or_gsc"]);
    expect(v.sentence).toContain("real search demand");
    expect(v.sentence).toContain("a competitor already covering this");
    expect(v.sentence).toContain("this page's own search numbers moving");
  });

  it("no sentence carries a banned dash or a lab word", () => {
    for (const v of [
      assessAbstention(NONE),
      assessAbstention({ ...NONE, hasDemandSignal: true }),
    ]) {
      expect(v.sentence).not.toMatch(/[—–]/);
      expect(v.sentence.toLowerCase()).not.toMatch(/\b(experiment|control|baseline|treatment|serp)\b/);
    }
  });
});

describe("hasSufficientEvidence - the boolean predicate", () => {
  it("false only when nothing is present", () => {
    expect(hasSufficientEvidence(NONE)).toBe(false);
    expect(hasSufficientEvidence({ ...NONE, hasDemandSignal: true })).toBe(true);
    expect(hasSufficientEvidence({ ...NONE, hasCompetitorTeardown: true })).toBe(true);
    expect(hasSufficientEvidence({ ...NONE, hasBehaviorOrGscSignal: true })).toBe(true);
  });
});

describe("partitionByEvidence - the final-filter seam", () => {
  type Item = { id: string; ev: AbstentionEvidence };
  const extract = (i: Item) => i.ev;

  it("BYTE-IDENTICAL when every item is evidenced: held is empty, ready is the input in order", () => {
    const items: Item[] = [
      { id: "a", ev: { ...NONE, hasDemandSignal: true } },
      { id: "b", ev: { ...NONE, hasCompetitorTeardown: true } },
      { id: "c", ev: { ...NONE, hasBehaviorOrGscSignal: true } },
    ];
    const { ready, held } = partitionByEvidence(items, extract);
    expect(held).toEqual([]);
    expect(ready.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("holds only the un-evidenced items, each with its watching verdict", () => {
    const items: Item[] = [
      { id: "a", ev: { ...NONE, hasDemandSignal: true } },
      { id: "b", ev: NONE },
      { id: "c", ev: NONE },
    ];
    const { ready, held } = partitionByEvidence(items, extract);
    expect(ready.map((r) => r.id)).toEqual(["a"]);
    expect(held.map((h) => h.item.id)).toEqual(["b", "c"]);
    expect(held.every((h) => h.verdict.state === "watching")).toBe(true);
    expect(held.every((h) => h.verdict.sentence === WATCHING_SENTENCE)).toBe(true);
  });

  it("an empty batch yields empty ready and held", () => {
    const { ready, held } = partitionByEvidence<Item>([], extract);
    expect(ready).toEqual([]);
    expect(held).toEqual([]);
  });
});

describe("heldForEvidenceLine - the honest count surface", () => {
  it("is null when nothing is held (absence says everything is backed)", () => {
    expect(heldForEvidenceLine(0)).toBeNull();
    expect(heldForEvidenceLine(-1)).toBeNull();
  });

  it("is singular for one", () => {
    expect(heldForEvidenceLine(1)).toBe(
      "1 possible move is waiting for more evidence before I recommend it.",
    );
  });

  it("is plural for many, with the count", () => {
    expect(heldForEvidenceLine(6)).toBe(
      "6 possible moves are waiting for more evidence before I recommend them.",
    );
  });

  it("no line carries a banned dash", () => {
    expect(heldForEvidenceLine(6)).not.toMatch(/[—–]/);
  });
});
