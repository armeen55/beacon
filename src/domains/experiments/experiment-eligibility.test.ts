import { describe, it, expect } from "vitest";

import {
  actionFamilyOf,
  familiesCollide,
  deriveExperimentStates,
  activeTreatmentPaths,
  cleanControlPaths,
  assessEligibility,
  type ExperimentFamily,
} from "./experiment-eligibility";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

const TREATED = [
  "persian-wolf", "persian-leopard", "persian-onager", "persian-cobra", "persian-horned-viper",
  "caspian-horse", "caspian-red-deer", "booted-eagle", "red-fox", "baluchistan-black-bear",
].map((s) => `/iran-animals/${s}`);
const CONTROLS = [
  "persian-cat", "caracal", "pallas-cat", "green-sea-turtle", "striped-hyena", "eurasian-lynx",
  "mugger-crocodile", "asiatic-cheetah", "caspian-seal", "white-bellied-sea-eagle", "bezoar-ibex",
  "houbara-bustard", "transcaspian-urial", "goitered-gazelle", "luristan-newt", "asian-green-bee-eater",
  "caspian-snowcock",
].map((s) => `/iran-animals/${s}`);
const NOW = new Date("2026-07-01T00:00:00Z");

const rec = (over: Partial<ShippedChangeRecord> & { path: string }): ShippedChangeRecord => ({
  id: `${over.path}::2026-06-30`,
  page: `https://iranopedia.com${over.path}`,
  actionType: "edit_title",
  before: null,
  after: null,
  shippedAt: "2026-06-30T00:00:00.000Z",
  baseline: { clicks: 0, impressions: 100, ctr: 0, position: 5, windowDays: 28 },
  targetQueries: ["q"],
  controlPages: [],
  windows: [],
  verdict: "measuring",
  confidence: "low",
  measuredAt: null,
  notes: null,
  verifiedLive: true,
  liveSourceUrl: null,
  recrawlRequestedAt: null,
  operatorVerdictOverride: null,
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
  ...over,
});

// The real batch: 10 measuring title experiments, each anchored by the 17 control animals.
const liveLedger: ShippedChangeRecord[] = TREATED.map((p) =>
  rec({ path: p, actionType: "edit_title", controlPages: CONTROLS.map((c) => `https://iranopedia.com${c}`) }),
);

describe("actionFamilyOf / familiesCollide", () => {
  it("classifies levers into families", () => {
    expect(actionFamilyOf("edit_title")).toBe("title");
    expect(actionFamilyOf("edit_meta")).toBe("meta");
    expect(actionFamilyOf("change_title_meta")).toBe("title_meta");
    expect(actionFamilyOf("add_answer_block")).toBe("answer");
    expect(actionFamilyOf("add_internal_links")).toBe("link");
  });
  it("title vs meta are DISTINCT (meta-vs-title is a valid design), but title/title_meta collide", () => {
    expect(familiesCollide("title", "meta")).toBe(false);
    expect(familiesCollide("title", "title_meta")).toBe(true);
    expect(familiesCollide("meta", "title_meta")).toBe(true);
  });
});

describe("the live batch — Phase-0/1 protection", () => {
  const states = deriveExperimentStates(liveLedger, NOW);

  it("all 10 treated pages are ineligible for a NEW title test (same_family_measuring)", () => {
    for (const p of TREATED) {
      const e = assessEligibility({ url: p, family: "title", states });
      expect(e.eligible).toBe(false);
      if (!e.eligible) expect(e.reason).toBe("same_family_measuring");
    }
  });

  it("all 17 control pages are ineligible (active_control) — protecting the diff-in-diff", () => {
    for (const p of CONTROLS) {
      const e = assessEligibility({ url: p, family: "title", states });
      expect(e.eligible).toBe(false);
      if (!e.eligible) {
        expect(e.reason).toBe("active_control");
        expect(e.relatedProofIds && e.relatedProofIds.length).toBeGreaterThan(0);
      }
    }
  });

  it("TOMORROW's meta-on-control collision is caught: meta on a control animal is blocked by default", () => {
    const e = assessEligibility({ url: "/iran-animals/asiatic-cheetah", family: "meta", states });
    expect(e.eligible).toBe(false);
    if (!e.eligible) expect(e.reason).toBe("active_control"); // needs explicit release/reassign
  });

  it("a treated page getting a META edit = compound_edit (different family, blocked by default)", () => {
    const e = assessEligibility({ url: "/iran-animals/persian-wolf", family: "meta", states });
    expect(e.eligible).toBe(false);
    if (!e.eligible) expect(e.reason).toBe("compound_edit");
  });

  it("an UNRELATED page (a flag) stays eligible (clean)", () => {
    expect(assessEligibility({ url: "/iran-flags/parthian-empire-flag", family: "title", states }).eligible).toBe(true);
  });

  it("a control can be treated ONLY with an explicit override (no silent control→treatment)", () => {
    const blocked = assessEligibility({ url: "/iran-animals/caracal", family: "meta", states });
    expect(blocked.eligible).toBe(false);
    const released = assessEligibility({ url: "/iran-animals/caracal", family: "meta", states, allowControlOverride: true });
    expect(released.eligible).toBe(true);
  });
});

describe("settling releases pages + family-specific no-lift", () => {
  it("a settled 28-day experiment releases the page (eligible again)", () => {
    const settled = [rec({ path: "/x", verdict: "won", measuredAt: NOW.toISOString(), windows: [] })];
    const states = deriveExperimentStates(settled, NOW);
    expect(assessEligibility({ url: "/x", family: "title", states }).eligible).toBe(true);
  });

  it("a LOST title test blocks another title test, but a CONTENT test is allowed", () => {
    const lost = [rec({ path: "/y", actionType: "edit_title", verdict: "lost", measuredAt: NOW.toISOString() })];
    const states = deriveExperimentStates(lost, NOW);
    const title = assessEligibility({ url: "/y", family: "title", states });
    expect(title.eligible).toBe(false);
    if (!title.eligible) expect(title.reason).toBe("recent_no_lift");
    expect(assessEligibility({ url: "/y", family: "content", states }).eligible).toBe(true);
  });
});

describe("contamination guard helpers", () => {
  it("activeTreatmentPaths returns the 10 measuring treated paths (controls are NOT treatments)", () => {
    const active = activeTreatmentPaths(liveLedger, NOW);
    expect(active.size).toBe(10);
    for (const p of TREATED) expect(active.has(p)).toBe(true);
    for (const c of CONTROLS) expect(active.has(c)).toBe(false);
  });

  it("cleanControlPaths drops a control that itself became a treatment (the tomorrow scenario)", () => {
    const active = new Set(["/iran-animals/asiatic-cheetah"]); // meta-tested tomorrow
    const cleaned = cleanControlPaths(CONTROLS.map((c) => `https://iranopedia.com${c}`), active);
    expect(cleaned.some((c) => c.includes("asiatic-cheetah"))).toBe(false);
    expect(cleaned.length).toBe(CONTROLS.length - 1);
  });

  it("external candidate flags layer on top (high-risk / ownership / stale / controls)", () => {
    const states = deriveExperimentStates([], NOW);
    expect(assessEligibility({ url: "/z", family: "title", states, external: { highRisk: true } })).toMatchObject({ reason: "high_risk_page" });
    expect(assessEligibility({ url: "/z", family: "title", states, external: { insufficientControls: true } })).toMatchObject({ reason: "insufficient_controls" });
  });
});
