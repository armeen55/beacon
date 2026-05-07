/**
 * Tests for src/domains/attribution/verdict-provenance.ts — Trust Sprint
 * Mini-Phase T3.2 (2026-05-06).
 *
 * The honesty contract: trust labels MUST track the audit findings.
 *   - Abstains are TRUSTWORTHY (not_enough_data / too_early / nothing_yet /
 *     not_enough_native_baseline / not_implemented).
 *   - helping/hurting on a clean window with `live_at` populated → DIRECTIONAL.
 *   - helping/hurting on a window touching contaminated dates (2026-04-23,
 *     2026-04-26, 2026-05-06) → UNRELIABLE.
 *   - helping/hurting on a sparse pre-window (< 5 full poll days) → UNRELIABLE.
 *   - helping/hurting with `live_at` missing → still DIRECTIONAL but with
 *     an explicit caveat naming the timestamp fallback.
 */

import { describe, expect, it } from "vitest";
import {
  buildVerdictProvenance,
  windowTouchesContaminatedDate,
  CONTAMINATED_DATES,
  type VerdictProvenance,
} from "./verdict-provenance";

const REQUIRED: ReadonlyArray<keyof VerdictProvenance> = [
  "id",
  "label",
  "verdictLabel",
  "trustLevel",
  "anchorDate",
  "anchorSource",
  "preWindowLabel",
  "postWindowLabel",
  "preDays",
  "postDays",
  "caveats",
  "plainEnglish",
  "operatorDetail",
];

function assertCommonShape(p: VerdictProvenance): void {
  for (const field of REQUIRED) {
    expect(p, `${p.id}: missing field ${field}`).toHaveProperty(field);
  }
  expect(p.id).toMatch(/^[a-z][a-z0-9-]*$/);
  expect(p.caveats).toBeInstanceOf(Array);
  expect(p.operatorDetail).toBeInstanceOf(Array);
  expect(typeof p.plainEnglish).toBe("string");
  expect(p.plainEnglish.length).toBeGreaterThan(0);
}

describe("verdict-provenance: required fields", () => {
  it("returns all required fields for a helping verdict with full provenance", () => {
    assertCommonShape(
      buildVerdictProvenance({
        id: "verdict-x",
        verdict: "helping",
        anchorDate: "2026-05-01",
        anchorSource: "live_at",
        preStartISO: "2026-04-17",
        preEndISO: "2026-04-30",
        postStartISO: "2026-05-02",
        postEndISO: "2026-05-06",
        preDays: 14,
        postDays: 5,
        preFullPollDays: 10,
        postFullPollDays: 5,
        muPre: 5,
        muPost: 12,
        zScore: 3.5,
        sustainUp: 5,
        sustainDown: 0,
        confidence: "high",
      }),
    );
  });

  it("returns all required fields for a not_enough_data abstain", () => {
    assertCommonShape(
      buildVerdictProvenance({
        id: "verdict-x",
        verdict: "not_enough_data",
        anchorDate: "2026-05-01",
        anchorSource: "live_at",
        preStartISO: null,
        preEndISO: null,
        postStartISO: null,
        postEndISO: null,
        preDays: 0,
        postDays: 0,
      }),
    );
  });
});

describe("verdict-provenance: trust label honesty (audit-anchored)", () => {
  it("not_enough_data is TRUSTWORTHY abstain", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "not_enough_data",
      anchorDate: null,
      anchorSource: "unknown",
      preStartISO: null,
      preEndISO: null,
      postStartISO: null,
      postEndISO: null,
      preDays: 0,
      postDays: 0,
    });
    expect(p.trustLevel).toBe("trustworthy");
    expect(p.plainEnglish.toLowerCase()).toContain("trustworthy abstain");
  });

  it("too_early is TRUSTWORTHY abstain", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "too_early",
      anchorDate: "2026-05-01",
      anchorSource: "live_at",
      preStartISO: "2026-04-17",
      preEndISO: "2026-04-30",
      postStartISO: "2026-05-02",
      postEndISO: "2026-05-04",
      preDays: 14,
      postDays: 3,
    });
    expect(p.trustLevel).toBe("trustworthy");
  });

  it("nothing_yet is TRUSTWORTHY abstain", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "nothing_yet",
      anchorDate: "2026-04-15",
      anchorSource: "live_at",
      preStartISO: "2026-04-01",
      preEndISO: "2026-04-14",
      postStartISO: "2026-04-16",
      postEndISO: "2026-05-06",
      preDays: 14,
      postDays: 21,
    });
    expect(p.trustLevel).toBe("trustworthy");
  });

  it("not_enough_native_baseline is TRUSTWORTHY abstain", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "not_enough_native_baseline",
      anchorDate: "2026-04-23",
      anchorSource: "live_at",
      preStartISO: "2026-04-09",
      preEndISO: "2026-04-22",
      postStartISO: "2026-04-24",
      postEndISO: "2026-05-06",
      preDays: 14,
      postDays: 13,
    });
    expect(p.trustLevel).toBe("trustworthy");
  });

  it("not_implemented is TRUSTWORTHY abstain", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "not_implemented",
      anchorDate: "2026-05-01",
      anchorSource: "live_at",
      preStartISO: null,
      preEndISO: null,
      postStartISO: null,
      postEndISO: null,
      preDays: 0,
      postDays: 0,
    });
    expect(p.trustLevel).toBe("trustworthy");
  });

  it("helping with clean window + live_at = DIRECTIONAL by default", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "helping",
      anchorDate: "2026-05-02",
      anchorSource: "live_at",
      // Clean window: avoids 2026-04-23, 2026-04-26, 2026-05-06.
      preStartISO: "2026-04-27",
      preEndISO: "2026-05-01",
      postStartISO: "2026-05-03",
      postEndISO: "2026-05-05",
      preDays: 5,
      postDays: 3,
      preFullPollDays: 5,
      postFullPollDays: 3,
      muPre: 5,
      muPost: 11,
      zScore: 3.5,
      sustainUp: 3,
      sustainDown: 0,
    });
    expect(p.trustLevel).toBe("directional");
  });

  it("hurting with clean window + live_at = DIRECTIONAL by default", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "hurting",
      anchorDate: "2026-05-02",
      anchorSource: "live_at",
      preStartISO: "2026-04-27",
      preEndISO: "2026-05-01",
      postStartISO: "2026-05-03",
      postEndISO: "2026-05-05",
      preDays: 5,
      postDays: 3,
      preFullPollDays: 5,
      postFullPollDays: 3,
      muPre: 8,
      muPost: 2,
      zScore: -3.0,
      sustainUp: 0,
      sustainDown: 3,
    });
    expect(p.trustLevel).toBe("directional");
  });

  it("helping touching contaminated 2026-04-23 in pre-window = DIRECTIONAL with strong caveat (T2 cleaned the data)", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "helping",
      anchorDate: "2026-04-30",
      anchorSource: "live_at",
      preStartISO: "2026-04-16",
      preEndISO: "2026-04-29", // covers 2026-04-23 and 2026-04-26
      postStartISO: "2026-05-01",
      postEndISO: "2026-05-04",
      preDays: 14,
      postDays: 4,
      preFullPollDays: 10,
      postFullPollDays: 4,
      muPre: 5,
      muPost: 11,
      zScore: 3.0,
      sustainUp: 4,
      sustainDown: 0,
    });
    // Per T3.2 brief: "unreliable OR strong caveat". Post-T2 the data is
    // cleaned, so we surface the strong caveat (directional) rather than
    // calling it unreliable on contamination alone.
    expect(p.trustLevel).toBe("directional");
    expect(p.caveats.some((c) => c.includes("2026-04-23"))).toBe(true);
  });

  it("hurting touching contaminated 2026-05-06 in post-window = DIRECTIONAL with strong caveat", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "hurting",
      anchorDate: "2026-05-02",
      anchorSource: "live_at",
      preStartISO: "2026-04-18",
      preEndISO: "2026-05-01",
      postStartISO: "2026-05-03",
      postEndISO: "2026-05-06",
      preDays: 14,
      postDays: 4,
      preFullPollDays: 10,
      postFullPollDays: 4,
      muPre: 8,
      muPost: 2,
      zScore: -2.5,
      sustainUp: 0,
      sustainDown: 4,
    });
    expect(p.trustLevel).toBe("directional");
    expect(p.caveats.some((c) => c.includes("2026-05-06"))).toBe(true);
  });

  it("helping with < 5 full pre-poll days = UNRELIABLE", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "helping",
      anchorDate: "2026-05-01",
      anchorSource: "live_at",
      preStartISO: "2026-04-17",
      preEndISO: "2026-04-30",
      postStartISO: "2026-05-02",
      postEndISO: "2026-05-04",
      preDays: 14,
      postDays: 3,
      preFullPollDays: 2, // sparse — only 2 full days
      postFullPollDays: 3,
      muPre: 0.2,
      muPost: 1,
      zScore: 2.5,
      sustainUp: 3,
      sustainDown: 0,
    });
    expect(p.trustLevel).toBe("unreliable");
    expect(p.caveats.some((c) => c.toLowerCase().includes("sparse"))).toBe(true);
    expect(p.caveats.some((c) => c.toLowerCase().includes("2 day"))).toBe(true);
  });
});

describe("verdict-provenance: caveats", () => {
  it("missing live_at on helping/hurting surfaces a caveat about timestamp fallback", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "helping",
      anchorDate: "2026-05-02",
      anchorSource: "timestamp",
      // Clean window so the caveat we're testing is the timestamp-fallback one.
      preStartISO: "2026-04-27",
      preEndISO: "2026-05-01",
      postStartISO: "2026-05-03",
      postEndISO: "2026-05-05",
      preDays: 5,
      postDays: 3,
      preFullPollDays: 5,
      postFullPollDays: 3,
      muPre: 5,
      muPost: 11,
      zScore: 3.5,
      sustainUp: 3,
      sustainDown: 0,
    });
    // Trust level stays DIRECTIONAL (timestamp fallback is not unreliable on its own)
    expect(p.trustLevel).toBe("directional");
    expect(p.caveats.some((c) => c.includes("changelog timestamp"))).toBe(true);
  });

  it("unknown anchor surfaces a caveat about no anchor", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "not_enough_data",
      anchorDate: null,
      anchorSource: "unknown",
      preStartISO: null,
      preEndISO: null,
      postStartISO: null,
      postEndISO: null,
      preDays: 0,
      postDays: 0,
    });
    expect(p.caveats.some((c) => c.toLowerCase().includes("change date is unknown"))).toBe(true);
  });

  it("sampling-guard demotion surfaces a caveat", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "nothing_yet",
      anchorDate: "2026-05-01",
      anchorSource: "live_at",
      preStartISO: "2026-04-17",
      preEndISO: "2026-04-30",
      postStartISO: "2026-05-02",
      postEndISO: "2026-05-06",
      preDays: 14,
      postDays: 5,
      samplingGuardDemotion: {
        from: "helping",
        to: "nothing_yet",
        reason: "proof_day_in_post_window",
      },
    });
    expect(
      p.caveats.some(
        (c) =>
          c.toLowerCase().includes("sampling guard") &&
          c.toLowerCase().includes("proof"),
      ),
    ).toBe(true);
  });

  it("pre-window touching pre-cutover dates surfaces an imported-data caveat", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "nothing_yet",
      anchorDate: "2026-04-25",
      anchorSource: "live_at",
      preStartISO: "2026-04-11", // before NATIVE_REGIME_START
      preEndISO: "2026-04-24",
      postStartISO: "2026-04-26",
      postEndISO: "2026-05-06",
      preDays: 14,
      postDays: 11,
    });
    expect(
      p.caveats.some(
        (c) =>
          c.toLowerCase().includes("native ai polling") ||
          c.toLowerCase().includes("historical"),
      ),
    ).toBe(true);
  });
});

describe("verdict-provenance: customer-safe copy invariants", () => {
  it("customer summary line never contains raw Z-score or Greek notation", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "helping",
      anchorDate: "2026-05-01",
      anchorSource: "live_at",
      preStartISO: "2026-04-27",
      preEndISO: "2026-05-01",
      postStartISO: "2026-05-03",
      postEndISO: "2026-05-05",
      preDays: 5,
      postDays: 3,
      preFullPollDays: 5,
      postFullPollDays: 3,
      muPre: 5,
      muPost: 11,
      zScore: 3.5,
      sustainUp: 3,
      sustainDown: 0,
      confidence: "high",
    });
    const customerFields = [
      p.label,
      p.verdictLabel,
      p.preWindowLabel,
      p.postWindowLabel,
      p.normalRangeLabel ?? "",
      p.changeStrengthLabel ?? "",
      p.sustainLabel ?? "",
      p.plainEnglish,
      ...p.caveats,
    ];
    for (const field of customerFields) {
      // No raw "Z-score" mention
      expect(field, `customer field leaks "Z-score": ${field}`).not.toMatch(/z[ -]?score/i);
      // No Greek mu / sigma symbols
      expect(field, `customer field leaks Greek μ: ${field}`).not.toContain("μ");
      expect(field, `customer field leaks Greek σ: ${field}`).not.toContain("σ");
      // No "mu_pre" / "sigma_pre" debug variable names
      expect(field, `customer field leaks debug var: ${field}`).not.toMatch(/mu_pre|mu_post|sigma_pre|sigma_post/);
      // No raw SQL/table names
      expect(field).not.toContain("daily_metric_snapshots");
      expect(field).not.toContain("prompt_answer_observations");
      expect(field).not.toMatch(/\bSELECT\b/);
      expect(field).not.toMatch(/\bFROM\s+/);
    }
  });

  it("operatorDetail intentionally contains Z-score + raw math (for debug)", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "helping",
      anchorDate: "2026-05-01",
      anchorSource: "live_at",
      preStartISO: "2026-04-17",
      preEndISO: "2026-04-30",
      postStartISO: "2026-05-02",
      postEndISO: "2026-05-04",
      preDays: 14,
      postDays: 3,
      muPre: 5,
      muPost: 11,
      zScore: 3.5,
      sustainUp: 3,
      sustainDown: 0,
    });
    expect(p.operatorDetail.some((d) => d.includes("Z-score"))).toBe(true);
    expect(p.operatorDetail.some((d) => d.includes("mu_pre"))).toBe(true);
    expect(p.operatorDetail.some((d) => d.includes("anchor_source"))).toBe(true);
  });

  it("never calls helping verdicts 'proof' in any customer-facing field", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "helping",
      anchorDate: "2026-05-01",
      anchorSource: "live_at",
      preStartISO: "2026-04-17",
      preEndISO: "2026-04-30",
      postStartISO: "2026-05-02",
      postEndISO: "2026-05-04",
      preDays: 14,
      postDays: 3,
      preFullPollDays: 10,
      muPre: 5,
      muPost: 11,
      zScore: 3.5,
      sustainUp: 3,
      sustainDown: 0,
    });
    // It's OK to say "not proof of causation"; it's NOT OK to say "proof".
    // We check that every standalone "proof" appearance is paired with "not".
    const customerFields = [
      p.label,
      p.verdictLabel,
      p.plainEnglish,
      ...p.caveats,
    ];
    for (const f of customerFields) {
      const proofMatches = f.matchAll(/\bproof\b/gi);
      for (const m of proofMatches) {
        const before = f.slice(Math.max(0, m.index! - 12), m.index!).toLowerCase();
        expect(
          before.includes("not"),
          `Found unqualified "proof" in customer field: ${f}`,
        ).toBe(true);
      }
    }
  });

  it("no raw UUIDs in any customer-facing field", () => {
    const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "helping",
      anchorDate: "2026-05-01",
      anchorSource: "live_at",
      preStartISO: "2026-04-17",
      preEndISO: "2026-04-30",
      postStartISO: "2026-05-02",
      postEndISO: "2026-05-04",
      preDays: 14,
      postDays: 3,
      muPre: 5,
      muPost: 11,
      zScore: 3.5,
      sustainUp: 3,
      sustainDown: 0,
    });
    const customerFields = [
      p.label,
      p.verdictLabel,
      p.plainEnglish,
      p.preWindowLabel,
      p.postWindowLabel,
      ...p.caveats,
    ];
    for (const f of customerFields) {
      expect(f).not.toMatch(UUID);
    }
  });
});

describe("verdict-provenance: contaminated-date helper", () => {
  it("CONTAMINATED_DATES exposes the canonical 3-date list from T2 audit", () => {
    expect(CONTAMINATED_DATES).toEqual(["2026-04-23", "2026-04-26", "2026-05-06"]);
  });

  it("windowTouchesContaminatedDate detects each contaminated date in range", () => {
    expect(windowTouchesContaminatedDate("2026-04-22", "2026-04-24")).toBe(true);
    expect(windowTouchesContaminatedDate("2026-04-25", "2026-04-27")).toBe(true);
    expect(windowTouchesContaminatedDate("2026-05-05", "2026-05-07")).toBe(true);
  });

  it("windowTouchesContaminatedDate returns false for clean ranges", () => {
    expect(windowTouchesContaminatedDate("2026-04-01", "2026-04-22")).toBe(false);
    expect(windowTouchesContaminatedDate("2026-05-07", "2026-05-10")).toBe(false);
  });

  it("returns false when either bound is null", () => {
    expect(windowTouchesContaminatedDate(null, "2026-05-07")).toBe(false);
    expect(windowTouchesContaminatedDate("2026-04-01", null)).toBe(false);
    expect(windowTouchesContaminatedDate(null, null)).toBe(false);
  });
});

describe("verdict-provenance: plainEnglish honesty", () => {
  it("trustworthy abstains say 'trustworthy abstain'", () => {
    for (const verdict of [
      "not_enough_data",
      "too_early",
      "nothing_yet",
      "not_enough_native_baseline",
      "not_implemented",
    ] as const) {
      const p = buildVerdictProvenance({
        id: "v",
        verdict,
        anchorDate: "2026-05-01",
        anchorSource: "live_at",
        preStartISO: null,
        preEndISO: null,
        postStartISO: null,
        postEndISO: null,
        preDays: 0,
        postDays: 0,
      });
      expect(
        p.plainEnglish.toLowerCase(),
        `${verdict} plainEnglish should say "trustworthy abstain"`,
      ).toContain("trustworthy abstain");
    }
  });

  it("directional helping says 'directional signal'", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "helping",
      anchorDate: "2026-05-02",
      anchorSource: "live_at",
      // Clean window
      preStartISO: "2026-04-27",
      preEndISO: "2026-05-01",
      postStartISO: "2026-05-03",
      postEndISO: "2026-05-05",
      preDays: 5,
      postDays: 3,
      preFullPollDays: 5,
      muPre: 5,
      muPost: 11,
      zScore: 3.5,
      sustainUp: 3,
      sustainDown: 0,
    });
    expect(p.plainEnglish.toLowerCase()).toContain("directional signal");
  });

  it("unreliable helping (sparse pre-window) says 'unreliable'", () => {
    const p = buildVerdictProvenance({
      id: "v",
      verdict: "helping",
      anchorDate: "2026-05-02",
      anchorSource: "live_at",
      preStartISO: "2026-04-27",
      preEndISO: "2026-05-01",
      postStartISO: "2026-05-03",
      postEndISO: "2026-05-05",
      preDays: 5,
      postDays: 3,
      preFullPollDays: 2, // sparse — triggers unreliable
      muPre: 0.2,
      muPost: 1,
      zScore: 2.5,
      sustainUp: 3,
      sustainDown: 0,
    });
    expect(p.plainEnglish.toLowerCase()).toContain("unreliable");
  });
});
