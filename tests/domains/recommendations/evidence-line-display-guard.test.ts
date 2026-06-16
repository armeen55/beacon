/**
 * Expert-rec-engine Slice 1 (2026-06-16) — evidence-line display-safety guard.
 *
 * Pins the contract that closes audit cross-cutting BUG #5: every rendered
 * evidence-line string (value / label / detail) is held to the SAME display
 * rails as `why` (uuid / long-hex / internal-token / competitor) PLUS a
 * white-labeled-vendor rail, and a leaking line is SUPPRESSED (dropped), never
 * partially rendered. The vendor rail is intentionally narrow (only "Profound")
 * so legitimate tenant GSC query text mentioning an engine ("chatgpt
 * alternatives") is NOT suppressed.
 */

import { describe, it, expect } from "vitest";

import {
  isEvidenceLineDisplaySafe,
  filterDisplaySafeEvidenceLines,
  ANSWER_ENGINE_VENDOR_TERMS,
} from "@/domains/recommendations/evidence-line-display-guard";
import type { EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

function line(overrides: Partial<EvidenceLine> = {}): EvidenceLine {
  return {
    key: "headline_query",
    value: "“whole home remodel cost”",
    label: "1,800 times shown · you rank #6",
    detail:
      "You rank #6 for “whole home remodel cost”, shown 1,800 times in 90 days — a clearer title could win more visits.",
    ...overrides,
  };
}

describe("isEvidenceLineDisplaySafe", () => {
  it("keeps a clean, number-rich line", () => {
    expect(isEvidenceLineDisplaySafe(line())).toBe(true);
  });

  it("suppresses a line whose detail leaks a UUID", () => {
    expect(
      isEvidenceLineDisplaySafe(
        line({ detail: "Cited by 550e8400-e29b-41d4-a716-446655440000 in AI answers." }),
      ),
    ).toBe(false);
  });

  it("suppresses a line whose detail leaks a long hex hash", () => {
    expect(
      isEvidenceLineDisplaySafe(
        line({ value: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4" }),
      ),
    ).toBe(false);
  });

  it("suppresses a line that leaks an internal taxonomy token", () => {
    expect(
      isEvidenceLineDisplaySafe(line({ label: "trigger_signal=gsc_low_ctr" })),
    ).toBe(false);
  });

  it("suppresses a line that names a tracked competitor (context-driven)", () => {
    expect(
      isEvidenceLineDisplaySafe(
        line({ detail: "AI assistants answer this citing De Mattei, not you." }),
        { competitorNames: ["De Mattei"] },
      ),
    ).toBe(false);
    // Without the competitor context, competitor detection is inactive.
    expect(
      isEvidenceLineDisplaySafe(
        line({ detail: "AI assistants answer this citing De Mattei, not you." }),
      ),
    ).toBe(true);
  });

  it("suppresses a line that names the white-labeled vendor (Profound)", () => {
    expect(ANSWER_ENGINE_VENDOR_TERMS).toContain("Profound");
    expect(
      isEvidenceLineDisplaySafe(
        line({ detail: "Profound shows this topic is answered by a rival." }),
      ),
    ).toBe(false);
  });

  it("does NOT suppress legitimate tenant query text mentioning an engine", () => {
    // The vendor rail must not eat real GSC demand: a site can genuinely rank
    // for engine-named queries; those engine names stay allowed on evidence
    // lines (white-label of Beacon's OWN framing lives at the copy layer).
    expect(
      isEvidenceLineDisplaySafe(
        line({
          value: "“chatgpt alternatives”",
          detail: "You rank #4 for “chatgpt alternatives”, shown 2,300 times in 90 days.",
        }),
      ),
    ).toBe(true);
  });

  it("skips empty/absent fields without crashing", () => {
    expect(
      isEvidenceLineDisplaySafe({ key: "k", value: "", label: "" } as EvidenceLine),
    ).toBe(true);
  });
});

describe("filterDisplaySafeEvidenceLines", () => {
  it("drops only the leaking lines, preserving order of the safe ones", () => {
    const safeA = line({ key: "a" });
    const leak = line({ key: "b", detail: "rec_id=abc internal note" });
    const safeC = line({ key: "c", value: "“persian rugs”" });
    const out = filterDisplaySafeEvidenceLines([safeA, leak, safeC]);
    expect(out.map((l) => l.key)).toEqual(["a", "c"]);
  });

  it("returns [] for null / undefined", () => {
    expect(filterDisplaySafeEvidenceLines(null)).toEqual([]);
    expect(filterDisplaySafeEvidenceLines(undefined)).toEqual([]);
  });

  it("passes competitor context through to the per-line check", () => {
    const lines = [
      line({ key: "ok" }),
      line({ key: "leak", detail: "citing Acme Builders across answers" }),
    ];
    expect(
      filterDisplaySafeEvidenceLines(lines, { competitorNames: ["Acme Builders"] }).map(
        (l) => l.key,
      ),
    ).toEqual(["ok"]);
  });
});
