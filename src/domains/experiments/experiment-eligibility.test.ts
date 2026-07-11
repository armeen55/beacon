import { describe, it, expect } from "vitest";

import {
  actionFamilyOf,
  familiesCollide,
  deriveExperimentStates,
  activeTreatmentPaths,
  cleanControlPaths,
  assessEligibility,
  cautionOf,
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
  operatorVerdictOverride: null, calibrationVersion: null,
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

describe("E-39 admit-with-caution - the live batch is no longer frozen out", () => {
  const states = deriveExperimentStates(liveLedger, NOW);

  it("all 10 treated pages are ADMITTED WITH CAUTION for a NEW title test (same_family_measuring), never frozen", () => {
    for (const p of TREATED) {
      const e = assessEligibility({ url: p, family: "title", states });
      expect(e.eligible).toBe(true);
      expect(e.reason).toBe("same_family_measuring");
      const c = cautionOf(e);
      expect(c?.reason).toBe("same_family_measuring");
      expect(c?.lowersConfidenceOneTier).toBe(true);
      expect((c?.copy.length ?? 0)).toBeGreaterThan(0);
      expect(c?.copy).not.toMatch(/[\u2014\u2013]/); // no em/en dashes on operator copy
    }
  });

  it("all 17 comparison pages are ADMITTED WITH CAUTION (active_control), never frozen out", () => {
    for (const p of CONTROLS) {
      const e = assessEligibility({ url: p, family: "title", states });
      expect(e.eligible).toBe(true);
      expect(e.reason).toBe("active_control");
      const c = cautionOf(e);
      expect(c?.reason).toBe("active_control");
      expect((c?.relatedProofIds.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it("a META edit on a comparison page is admitted with caution (active_control), not blocked", () => {
    const e = assessEligibility({ url: "/iran-animals/asiatic-cheetah", family: "meta", states });
    expect(e.eligible).toBe(true);
    expect(e.reason).toBe("active_control");
  });

  it("a treated page getting a META edit is admitted with caution (compound_edit)", () => {
    const e = assessEligibility({ url: "/iran-animals/persian-wolf", family: "meta", states });
    expect(e.eligible).toBe(true);
    expect(e.reason).toBe("compound_edit");
    expect(cautionOf(e)?.reason).toBe("compound_edit");
  });

  it("an UNRELATED page (a flag) stays fully clean (no caution)", () => {
    const e = assessEligibility({ url: "/iran-flags/parthian-empire-flag", family: "title", states });
    expect(e.eligible).toBe(true);
    expect(e.reason).toBe("clean");
    expect(cautionOf(e)).toBeNull();
  });

  it("an explicit release CLEARS the comparison-page caution (fully clean)", () => {
    const flagged = assessEligibility({ url: "/iran-animals/caracal", family: "meta", states });
    expect(flagged.eligible).toBe(true);
    expect(flagged.reason).toBe("active_control");
    const released = assessEligibility({ url: "/iran-animals/caracal", family: "meta", states, allowControlOverride: true });
    expect(released.eligible).toBe(true);
    expect(released.reason).toBe("clean");
  });
});

describe("E-39 hard blocks stay hard (genuine hazards, not inconvenience)", () => {
  it("a proven loss on the same family stays a HARD block (recent_no_lift), never admit-with-caution", () => {
    const lost = [rec({ path: "/y", actionType: "edit_title", verdict: "lost", measuredAt: NOW.toISOString() })];
    const states = deriveExperimentStates(lost, NOW);
    const e = assessEligibility({ url: "/y", family: "title", states });
    expect(e.eligible).toBe(false);
    if (!e.eligible) expect(e.reason).toBe("recent_no_lift");
    expect(cautionOf(e)).toBeNull();
  });

  it("high-risk / ownership-uncertain / stale-research stay HARD blocks", () => {
    const states = deriveExperimentStates([], NOW);
    expect(assessEligibility({ url: "/z", family: "title", states, external: { highRisk: true } })).toMatchObject({ eligible: false, reason: "high_risk_page" });
    expect(assessEligibility({ url: "/z", family: "title", states, external: { ownershipUncertain: true } })).toMatchObject({ eligible: false, reason: "ownership_uncertain" });
    expect(assessEligibility({ url: "/z", family: "title", states, external: { staleResearch: true } })).toMatchObject({ eligible: false, reason: "stale_research" });
  });

  it("last_clean_donor is a HARD block ONLY when releasing would leave zero comparables", () => {
    const states = deriveExperimentStates(liveLedger, NOW);
    // Without the flag, a comparison page is admit-with-caution (editable).
    const caution = assessEligibility({ url: "/iran-animals/caracal", family: "meta", states });
    expect(caution.eligible).toBe(true);
    // With the flag (the caller found this is the last clean comparable), HARD block.
    const blocked = assessEligibility({ url: "/iran-animals/caracal", family: "meta", states, external: { lastCleanDonor: true } });
    expect(blocked.eligible).toBe(false);
    if (!blocked.eligible) expect(blocked.reason).toBe("last_clean_donor");
  });

  it("fewer than 2 defensible controls routes to a LOWER-confidence caution, never a freeze (D3)", () => {
    const states = deriveExperimentStates([], NOW);
    const thin = assessEligibility({ url: "/z", family: "title", states, external: { insufficientControls: true } });
    expect(thin.eligible).toBe(true); // NOT frozen
    expect(thin.reason).toBe("insufficient_controls");
    expect(cautionOf(thin)?.lowersConfidenceOneTier).toBe(true);
  });
});

describe("E-39 own-tenant only - assessEligibility is pure over ONE tenant's states", () => {
  it("a page that only exists in tenant B's ledger reads CLEAN against tenant A's states (no cross-tenant leak)", () => {
    // Tenant A's ledger locks its own animals; tenant B ships on a DIFFERENT page.
    const tenantAStates = deriveExperimentStates(liveLedger, NOW);
    const tenantBOnlyPage = "/tenant-b-only/some-page";
    const e = assessEligibility({ url: tenantBOnlyPage, family: "title", states: tenantAStates });
    expect(e.eligible).toBe(true);
    expect(e.reason).toBe("clean"); // tenant A's measurements never touch tenant B's page
    // And tenant B's own states never see tenant A's locked animals.
    const tenantBStates = deriveExperimentStates(
      [rec({ path: tenantBOnlyPage, actionType: "edit_title", controlPages: [] })],
      NOW,
    );
    expect(tenantBStates.has("/iran-animals/persian-wolf")).toBe(false);
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

  it("external hard-block flags layer on top (high-risk stays a freeze)", () => {
    const states = deriveExperimentStates([], NOW);
    expect(assessEligibility({ url: "/z", family: "title", states, external: { highRisk: true } })).toMatchObject({ eligible: false, reason: "high_risk_page" });
  });
});
