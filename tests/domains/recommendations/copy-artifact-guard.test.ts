/**
 * Expert-rec-engine Slice 2 (2026-06-16) — copy-artifact detector + the
 * checkCopyDisplaySafe composition that suppresses artifact-bearing copy.
 *
 * Closes audit RISK #3: a non-technical operator must never be handed an
 * instruction ("Change the page title to …"), a doubled verb ("Add Add …"),
 * or a duplicated brand suffix ("Title | Brand | Brand") as paste-ready copy.
 * Also pins the directive PHASE E length budgets (title 50–59/60, meta
 * 135–150/155) as a non-suppressing quality signal.
 */

import { describe, it, expect } from "vitest";

import {
  detectCopyArtifact,
  titleLengthVerdict,
  metaLengthVerdict,
  TITLE_HARD_MAX_CHARS,
  META_HARD_MAX_CHARS,
  exceedsPublishLengthLimit,
  PUSH_TITLE_MAX_CHARS,
  PUSH_META_MAX_CHARS,
} from "@/domains/recommendations/copy-artifact-guard";
import { checkCopyDisplaySafe } from "@/domains/recommendations/suggested-copy-display-guard";

describe("detectCopyArtifact — instruction artifacts", () => {
  it("flags 'Change the page title to …' (instruction, not a title)", () => {
    expect(detectCopyArtifact("Change the page title to Persian Rugs Buyer Guide")).toBe(
      "instruction_artifact",
    );
  });
  it("flags 'Update the meta description …'", () => {
    expect(
      detectCopyArtifact("Update the meta description so it mentions free shipping"),
    ).toBe("instruction_artifact");
  });
  it("flags 'Rewrite the H1 …'", () => {
    expect(detectCopyArtifact("Rewrite the H1 to lead with the city")).toBe(
      "instruction_artifact",
    );
  });
  it("does NOT flag a real title that simply contains a verb", () => {
    // "Set" here is part of legitimate product copy, not an instruction about
    // an SEO element (no title/meta/h1 object follows).
    expect(detectCopyArtifact("Set Designer Dining Tables — Handmade in Oakland")).toBeNull();
  });
  it("does NOT flag a real meta description", () => {
    expect(
      detectCopyArtifact(
        "Authentic Persian koobideh kabob recipe — ground beef, sumac, and a charcoal sear, step by step.",
      ),
    ).toBeNull();
  });
});

describe("detectCopyArtifact — repeated leading action word", () => {
  it("flags 'Add Add …'", () => {
    expect(detectCopyArtifact("Add Add a comparison table to the pricing page")).toBe(
      "repeated_action_word",
    );
  });
  it("flags 'Add a Add …'", () => {
    expect(detectCopyArtifact("Add a Add section about delivery")).toBe(
      "repeated_action_word",
    );
  });
  it("flags case-insensitively ('Update update …')", () => {
    expect(detectCopyArtifact("Update update the intro paragraph")).toBe(
      "repeated_action_word",
    );
  });
  it("does NOT flag 'Add additional …' (no real doubling)", () => {
    expect(detectCopyArtifact("Add additional shipping details")).toBeNull();
  });
});

describe("detectCopyArtifact — duplicate brand suffix", () => {
  it("flags 'Title | Brand | Brand'", () => {
    expect(detectCopyArtifact("Persian Rugs Buyer Guide | Iranopedia | Iranopedia")).toBe(
      "duplicate_brand_suffix",
    );
  });
  it("flags an em-dash duplicate ('… — Brand — Brand')", () => {
    expect(detectCopyArtifact("Best Kabob Recipes — Iranopedia — Iranopedia")).toBe(
      "duplicate_brand_suffix",
    );
  });
  it("does NOT flag a single brand suffix", () => {
    expect(detectCopyArtifact("Persian Rugs Buyer Guide | Iranopedia")).toBeNull();
  });
  it("returns null for clean / empty input", () => {
    expect(detectCopyArtifact("Persian Rugs Buyer Guide")).toBeNull();
    expect(detectCopyArtifact("")).toBeNull();
    expect(detectCopyArtifact(null)).toBeNull();
  });
});

describe("checkCopyDisplaySafe — composes the artifact rails", () => {
  it("suppresses instruction-text copy", () => {
    const r = checkCopyDisplaySafe("Change the page title to Persian Rugs Buyer Guide");
    expect(r.safe).toBe(false);
    if (!r.safe) expect(r.reason).toBe("instruction_artifact");
  });
  it("suppresses 'Add Add' copy", () => {
    const r = checkCopyDisplaySafe("Add Add a comparison table");
    expect(r.safe).toBe(false);
    if (!r.safe) expect(r.reason).toBe("repeated_action_word");
  });
  it("suppresses duplicate-brand-suffix copy", () => {
    const r = checkCopyDisplaySafe("Buyer Guide | Iranopedia | Iranopedia");
    expect(r.safe).toBe(false);
    if (!r.safe) expect(r.reason).toBe("duplicate_brand_suffix");
  });
  it("still passes clean, publishable copy", () => {
    expect(checkCopyDisplaySafe("Persian Rugs Buyer Guide | Iranopedia").safe).toBe(true);
    expect(
      checkCopyDisplaySafe(
        "Authentic Persian koobideh kabob recipe — ground beef, sumac, and a charcoal sear.",
      ).safe,
    ).toBe(true);
  });
});

describe("length budgets (directive PHASE E) — quality signal, not a suppressor", () => {
  it("title within 50–59 → ok; over 60 → long; under 50 → short", () => {
    expect(titleLengthVerdict("A".repeat(55)).status).toBe("ok");
    expect(titleLengthVerdict("A".repeat(72)).status).toBe("long");
    expect(titleLengthVerdict("A".repeat(72)).withinHardMax).toBe(false);
    expect(titleLengthVerdict("Short title").status).toBe("short");
    expect(TITLE_HARD_MAX_CHARS).toBe(60);
  });
  it("meta within 135–150 → ok; over 150 → long (155 hard max)", () => {
    expect(metaLengthVerdict("M".repeat(140)).status).toBe("ok");
    expect(metaLengthVerdict("M".repeat(152)).status).toBe("long");
    expect(metaLengthVerdict("M".repeat(152)).withinHardMax).toBe(true); // 152 <= 155
    expect(metaLengthVerdict("M".repeat(160)).withinHardMax).toBe(false);
    expect(META_HARD_MAX_CHARS).toBe(155);
  });
  it("an over-budget but otherwise-clean title is NOT suppressed by the guard", () => {
    // Length is advisory: a long-but-valid title must still render (don't hide
    // a useful rec). Only true artifacts suppress.
    const longTitle = "Persian Rugs Buyer Guide — Authentic Hand-Knotted Tabriz and Kashan Rugs";
    expect(titleLengthVerdict(longTitle).status).toBe("long");
    expect(checkCopyDisplaySafe(longTitle).safe).toBe(true);
  });
});

describe("exceedsPublishLengthLimit (audit-3 #11)", () => {
  it("flags a title over the push ceiling", () => {
    expect(exceedsPublishLengthLimit("edit_title", "x".repeat(PUSH_TITLE_MAX_CHARS + 1))).toBe(true);
  });
  it("allows a title at/under the push ceiling (headroom over the 60 ideal)", () => {
    expect(exceedsPublishLengthLimit("edit_title", "x".repeat(PUSH_TITLE_MAX_CHARS))).toBe(false);
    expect(exceedsPublishLengthLimit("edit_title", "x".repeat(65))).toBe(false);
  });
  it("flags a meta over the push ceiling", () => {
    expect(exceedsPublishLengthLimit("edit_meta", "x".repeat(PUSH_META_MAX_CHARS + 1))).toBe(true);
  });
  it("allows a meta at/under the push ceiling", () => {
    expect(exceedsPublishLengthLimit("edit_meta", "x".repeat(PUSH_META_MAX_CHARS))).toBe(false);
  });
  it("never gates non-title/meta actions on length", () => {
    expect(exceedsPublishLengthLimit("add_faq", "x".repeat(5000))).toBe(false);
    expect(exceedsPublishLengthLimit("add_section", "x".repeat(5000))).toBe(false);
  });
  it("treats null/empty as within limit", () => {
    expect(exceedsPublishLengthLimit("edit_title", null)).toBe(false);
    expect(exceedsPublishLengthLimit("edit_title", "")).toBe(false);
  });
});
