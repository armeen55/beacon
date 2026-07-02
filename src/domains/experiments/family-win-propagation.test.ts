import { describe, it, expect } from "vitest";

import {
  findFamilyPropagationCandidates,
  buildPropagationSentence,
  MAX_PROPAGATION_CANDIDATES,
  type FamilyPage,
} from "./family-win-propagation";
import { assessEligibility, deriveExperimentStates, actionFamilyOf } from "./experiment-eligibility";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { ProofWindowResult } from "@/domains/proof-gsc/measure";

const win = (day: 7 | 14 | 28, ran: boolean): ProofWindowResult => ({ day, ran, controlsUsed: 3 } as ProofWindowResult);

const rec = (over: Partial<ShippedChangeRecord> & { path: string }): ShippedChangeRecord => ({
  id: `${over.path}::2026-06-01`,
  page: `https://iranopedia.com${over.path}`,
  actionType: "add_answer_block",
  before: null,
  after: null,
  shippedAt: "2026-06-01T00:00:00.000Z",
  baseline: { clicks: 0, impressions: 2000, ctr: 0.01, position: 6, windowDays: 28 },
  targetQueries: ["q"],
  controlPages: [],
  windows: [win(7, true), win(14, true), win(28, true)],
  verdict: "won",
  confidence: "high",
  measuredAt: "2026-06-29T00:00:00.000Z",
  notes: null,
  verifiedLive: true,
  liveSourceUrl: null,
  recrawlRequestedAt: null,
  operatorVerdictOverride: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-29T00:00:00.000Z",
  ...over,
});

const page = (over: Partial<FamilyPage> & { url: string }): FamilyPage => ({
  pageLabel: over.url.split("/").filter(Boolean).at(-1) ?? "page",
  impressions: 1000,
  ...over,
});

const NOW = new Date("2026-07-02T00:00:00Z");

/** Build an eligibility map the same way the real pipeline does: derive states from the
 *  ledger, then assess each candidate path for the given lever family. */
function eligibilityFor(ledger: ShippedChangeRecord[], paths: string[], lever = "answer" as const) {
  const states = deriveExperimentStates(ledger, NOW);
  const map = new Map<string, ReturnType<typeof assessEligibility>>();
  for (const p of paths) {
    map.set(p, assessEligibility({ url: p, family: lever, states }));
  }
  return map;
}

describe("findFamilyPropagationCandidates - pure matrix", () => {
  it("win exists + siblings eligible -> proposes the SAME lever on each untreated sibling, best demand first", () => {
    const win = rec({ path: "/iran-animals/persian-cheetah", verdict: "won" });
    const siblings = [
      page({ url: "/iran-animals/persian-leopard", impressions: 500 }),
      page({ url: "/iran-animals/persian-onager", impressions: 4000 }),
      page({ url: "/iran-animals/caspian-seal", impressions: 1500 }),
    ];
    const eligibility = eligibilityFor([win], siblings.map((s) => s.url));

    const out = findFamilyPropagationCandidates({
      wonRecords: [win],
      familyPages: siblings,
      eligibility,
    });

    expect(out).toHaveLength(3);
    expect(out.map((c) => c.page)).toEqual([
      "/iran-animals/persian-onager",
      "/iran-animals/caspian-seal",
      "/iran-animals/persian-leopard",
    ]);
    for (const c of out) {
      expect(c.lever).toBe("answer");
      expect(c.pageFamily).toBe("iran-animals");
      expect(c.sourceWinPage).toBe("/iran-animals/persian-cheetah");
      expect(c.boost).toBeGreaterThan(1);
    }
  });

  it("never proposes the win page back to itself", () => {
    const win = rec({ path: "/iran-animals/persian-cheetah", verdict: "won" });
    const siblings = [page({ url: "/iran-animals/persian-cheetah", impressions: 9999 })];
    const eligibility = eligibilityFor([win], siblings.map((s) => s.url));
    const out = findFamilyPropagationCandidates({ wonRecords: [win], familyPages: siblings, eligibility });
    expect(out).toHaveLength(0);
  });

  it("sibling mid-measurement (active treatment) is EXCLUDED via the real eligibility gate", () => {
    const win = rec({ path: "/iran-animals/persian-cheetah", verdict: "won", actionType: "add_answer_block" });
    const measuring = rec({
      path: "/iran-animals/persian-onager",
      actionType: "add_answer_block",
      shippedAt: "2026-06-28T00:00:00.000Z", // recent -> still measuring at NOW
      verdict: "measuring",
      windows: [],
    });
    const ledger = [win, measuring];
    const siblings = [
      page({ url: "/iran-animals/persian-onager", impressions: 5000 }), // mid-measurement
      page({ url: "/iran-animals/caspian-seal", impressions: 900 }), // clean
    ];
    const eligibility = eligibilityFor(ledger, siblings.map((s) => s.url));

    const out = findFamilyPropagationCandidates({ wonRecords: [win], familyPages: siblings, eligibility });

    expect(out.map((c) => c.page)).toEqual(["/iran-animals/caspian-seal"]);
  });

  it("sibling that is an ACTIVE CONTROL for another experiment is excluded", () => {
    const win = rec({ path: "/iran-animals/persian-cheetah", verdict: "won", actionType: "add_answer_block" });
    const treatedElsewhere = rec({
      path: "/iran-animals/red-fox",
      actionType: "edit_title",
      shippedAt: "2026-06-28T00:00:00.000Z",
      verdict: "measuring",
      windows: [],
      controlPages: ["https://iranopedia.com/iran-animals/persian-onager"],
    });
    const ledger = [win, treatedElsewhere];
    const siblings = [page({ url: "/iran-animals/persian-onager", impressions: 5000 })];
    const eligibility = eligibilityFor(ledger, siblings.map((s) => s.url));

    const out = findFamilyPropagationCandidates({ wonRecords: [win], familyPages: siblings, eligibility });
    expect(out).toHaveLength(0);
  });

  it("sibling with a recent SAME-lever ship is excluded even if the eligibility map says clean", () => {
    const win = rec({ path: "/iran-animals/persian-cheetah", verdict: "won", actionType: "add_answer_block" });
    const siblings = [page({ url: "/iran-animals/persian-onager", impressions: 5000 })];
    const eligibility = eligibilityFor([win], siblings.map((s) => s.url));
    const recentShips = new Map([["/iran-animals/persian-onager", new Set(["add_answer_block"])]]);

    const out = findFamilyPropagationCandidates({ wonRecords: [win], familyPages: siblings, eligibility, recentShips });
    expect(out).toHaveLength(0);
  });

  it("a DIFFERENT lever recently shipped on the sibling does NOT block propagation", () => {
    const win = rec({ path: "/iran-animals/persian-cheetah", verdict: "won", actionType: "add_answer_block" });
    const siblings = [page({ url: "/iran-animals/persian-onager", impressions: 5000 })];
    const eligibility = eligibilityFor([win], siblings.map((s) => s.url));
    const recentShips = new Map([["/iran-animals/persian-onager", new Set(["edit_meta"])]]);

    const out = findFamilyPropagationCandidates({ wonRecords: [win], familyPages: siblings, eligibility, recentShips });
    expect(out).toHaveLength(1);
  });

  it("cross-family sibling is never proposed (different family, same lever)", () => {
    const win = rec({ path: "/iran-animals/persian-cheetah", verdict: "won" });
    const siblings = [page({ url: "/iran-flags/mongol-empire-flag", impressions: 9000 })];
    const eligibility = eligibilityFor([win], siblings.map((s) => s.url));
    const out = findFamilyPropagationCandidates({ wonRecords: [win], familyPages: siblings, eligibility });
    expect(out).toHaveLength(0);
  });

  it("no mature win in wonRecords -> empty, honest silence", () => {
    const siblings = [page({ url: "/iran-animals/persian-onager", impressions: 5000 })];
    const eligibility = eligibilityFor([], siblings.map((s) => s.url));
    const out = findFamilyPropagationCandidates({ wonRecords: [], familyPages: siblings, eligibility });
    expect(out).toHaveLength(0);
  });

  it("no eligible siblings -> empty", () => {
    const win = rec({ path: "/iran-animals/persian-cheetah", verdict: "won" });
    const out = findFamilyPropagationCandidates({ wonRecords: [win], familyPages: [], eligibility: new Map() });
    expect(out).toHaveLength(0);
  });

  it("is BOUNDED to MAX_PROPAGATION_CANDIDATES even with many eligible siblings", () => {
    const win = rec({ path: "/iran-animals/persian-cheetah", verdict: "won" });
    const siblings = Array.from({ length: 10 }, (_, i) =>
      page({ url: `/iran-animals/animal-${i}`, impressions: 100 * (i + 1) }),
    );
    const eligibility = eligibilityFor([win], siblings.map((s) => s.url));

    const out = findFamilyPropagationCandidates({ wonRecords: [win], familyPages: siblings, eligibility });

    expect(out.length).toBe(MAX_PROPAGATION_CANDIDATES);
    // Best demand first: the top 3 by impressions (animal-9, animal-8, animal-7).
    expect(out.map((c) => c.page)).toEqual([
      "/iran-animals/animal-9",
      "/iran-animals/animal-8",
      "/iran-animals/animal-7",
    ]);
  });

  it("respects a custom maxCandidates override", () => {
    const win = rec({ path: "/iran-animals/persian-cheetah", verdict: "won" });
    const siblings = Array.from({ length: 5 }, (_, i) => page({ url: `/iran-animals/animal-${i}`, impressions: 100 }));
    const eligibility = eligibilityFor([win], siblings.map((s) => s.url));
    const out = findFamilyPropagationCandidates({ wonRecords: [win], familyPages: siblings, eligibility, maxCandidates: 1 });
    expect(out).toHaveLength(1);
  });

  it("multiple distinct wins across families each get to propose, still globally bounded", () => {
    const winAnimals = rec({ path: "/iran-animals/persian-cheetah", verdict: "won", actionType: "add_answer_block" });
    const winFlags = rec({ path: "/iran-flags/safavid-lion-sun", verdict: "won", actionType: "edit_meta" });
    const siblings = [
      page({ url: "/iran-animals/persian-onager", impressions: 5000 }),
      page({ url: "/iran-flags/mongol-empire-flag", impressions: 8000 }),
    ];
    const states = deriveExperimentStates([winAnimals, winFlags], NOW);
    const eligibility = new Map([
      ["/iran-animals/persian-onager", assessEligibility({ url: "/iran-animals/persian-onager", family: "answer", states })],
      ["/iran-flags/mongol-empire-flag", assessEligibility({ url: "/iran-flags/mongol-empire-flag", family: "meta", states })],
    ]);

    const out = findFamilyPropagationCandidates({ wonRecords: [winAnimals, winFlags], familyPages: siblings, eligibility });
    expect(out).toHaveLength(2);
    expect(new Set(out.map((c) => c.pageFamily))).toEqual(new Set(["iran-animals", "iran-flags"]));
  });

  it("actionFamilyOf sanity: add_answer_block is the answer family (used by the eligibility fixture)", () => {
    expect(actionFamilyOf("add_answer_block")).toBe("answer");
  });
});

describe("buildPropagationSentence - Beacon voice", () => {
  it("is first person, plain business language, names the source page and the sibling", () => {
    const s = buildPropagationSentence({
      leverPlain: "a direct answer",
      sourceLabel: "cheetah",
      monthPhrase: "in June",
      siblingLabel: "persian leopard",
    });
    expect(s).toContain("This exact change");
    expect(s).toContain("already won on the cheetah page in June");
    expect(s).toContain("Same move, next page: persian leopard");
  });

  it("never emits an em or en dash (dash guard)", () => {
    const s = buildPropagationSentence({
      leverPlain: "a description change",
      sourceLabel: "famous iranian singers",
      monthPhrase: "in July",
      siblingLabel: "famous iranian actors",
    });
    expect(s).not.toMatch(/[–—]/);
  });

  it("dash guard holds across full candidate sentences from the matrix", () => {
    const win = rec({ path: "/iran-animals/persian-cheetah", verdict: "won" });
    const siblings = [page({ url: "/iran-animals/persian-onager", impressions: 5000 })];
    const eligibility = eligibilityFor([win], siblings.map((s) => s.url));
    const out = findFamilyPropagationCandidates({ wonRecords: [win], familyPages: siblings, eligibility });
    for (const c of out) {
      expect(c.sentence).not.toMatch(/[–—]/);
    }
  });
});
