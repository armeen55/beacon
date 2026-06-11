/**
 * 2026-06-11 (night shift, #48) — unified queue ordering score.
 * Pins: drafted beats undrafted regardless of confidence; confidence
 * orders within draftedness; max-over-group semantics.
 */

import { describe, it, expect } from "vitest";

import { queueGroupScore } from "@/domains/recommendations/load-queue";

describe("queueGroupScore", () => {
  it("drafted-low beats undrafted-high (approvable on sight wins)", () => {
    expect(queueGroupScore([{ proposed_text: "draft", confidence: "low" }]))
      .toBeGreaterThan(queueGroupScore([{ proposed_text: null, confidence: "high" }]));
  });

  it("confidence orders within drafted groups", () => {
    const high = queueGroupScore([{ proposed_text: "d", confidence: "high" }]);
    const med = queueGroupScore([{ proposed_text: "d", confidence: "medium" }]);
    const low = queueGroupScore([{ proposed_text: "d", confidence: "low" }]);
    expect(high).toBeGreaterThan(med);
    expect(med).toBeGreaterThan(low);
  });

  it("max-over-group: one drafted edit lifts the whole rec", () => {
    expect(
      queueGroupScore([
        { proposed_text: null, confidence: "low" },
        { proposed_text: "d", confidence: "medium" },
      ]),
    ).toBe(queueGroupScore([{ proposed_text: "d", confidence: "medium" }]));
  });

  it("empty drafts don't count as drafted", () => {
    expect(queueGroupScore([{ proposed_text: "", confidence: "high" }])).toBe(
      queueGroupScore([{ proposed_text: null, confidence: "high" }]),
    );
  });
});
