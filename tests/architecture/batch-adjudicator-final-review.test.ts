import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * BEACON 500 item 12 - FINAL REVIEW architectural pins.
 *
 * The batch adjudicator is a REVIEWER, never a gatekeeper. These pins hold the
 * contract in source:
 *  1. NO NEW EGRESS: batch-adjudicator.ts routes through callStructuredLLM
 *     (the single gated/budgeted OpenAI entry) and never references
 *     api.openai.com itself - so the llm-safety-invariants allowlist needs no
 *     new entry.
 *  2. WIRING: the nightly preview builder runs the review AFTER the picks are
 *     final (post buildDailyPlanRecord), attach-only on record.selected, with
 *     a fail-open catch - and never reassigns/filters the selected picks.
 *  3. SURFACE: the daily card renders the one amber caution line in BOTH the
 *     preview and execution cards, gated to a real concern, plain language
 *     ("final review", never "adjudicator"/"LLM"), and it never gates apply.
 *  4. DASH GUARD: no em/en/figure/bar dash anywhere in the new module or the
 *     card file.
 *  5. The gpt-5-mini timeout stays >= 90s (the silent 40s-fallback lesson).
 */

const REPO_ROOT = resolve(__dirname, "../..");
const ADJUDICATOR = resolve(REPO_ROOT, "src/domains/llm/batch-adjudicator.ts");
const PREVIEW_BUILDER = resolve(REPO_ROOT, "src/domains/experiments/build-today-preview.ts");
const CARD = resolve(REPO_ROOT, "src/app/(shell)/daily-experiments-section.tsx");

const BANNED_DASH = /[‒–—―]/; // figure, en, em, horizontal bar

const adjudicatorSrc = readFileSync(ADJUDICATOR, "utf8");
const builderSrc = readFileSync(PREVIEW_BUILDER, "utf8");
const cardSrc = readFileSync(CARD, "utf8");

describe("item 12 - no new OpenAI egress point", () => {
  it("batch-adjudicator.ts never references api.openai.com (routes through callStructuredLLM)", () => {
    expect(adjudicatorSrc).not.toMatch(/api\.openai\.com/);
    expect(adjudicatorSrc).toMatch(/callStructuredLLM/);
    expect(adjudicatorSrc).toMatch(/from "\.\/structured-drafter"/);
  });

  it("keeps the gpt-5-mini timeout at 90s or more (never the silent 40s fallback again)", () => {
    const m = adjudicatorSrc.match(/timeoutMs:\s*([\d_]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1]!.replace(/_/g, ""))).toBeGreaterThanOrEqual(90_000);
  });

  it("fails open LOUDLY in source (an unmissable console.warn, not a silent return)", () => {
    expect(adjudicatorSrc).toMatch(/console\.warn\(/);
    expect(adjudicatorSrc).toMatch(/FINAL REVIEW FAILED OPEN/);
  });
});

describe("item 12 - preview-builder wiring is additive and post-final", () => {
  it("imports the one helper from the llm domain", () => {
    expect(builderSrc).toMatch(/import \{ applyFinalReviewToPicks \} from "@\/domains\/llm\/batch-adjudicator"/);
  });

  it("runs the review AFTER the plan record is built (picks already final)", () => {
    const built = builderSrc.indexOf("buildDailyPlanRecord({");
    const reviewed = builderSrc.indexOf("applyFinalReviewToPicks(record.selected");
    expect(built).toBeGreaterThan(-1);
    expect(reviewed).toBeGreaterThan(built);
  });

  it("is fail-open at the call site (a rejected review can never sink the preview)", () => {
    expect(builderSrc).toMatch(/applyFinalReviewToPicks\(record\.selected,?[^)]*\)\.catch\(/);
  });

  it("never filters or reassigns the selected picks around the review (attach-only)", () => {
    expect(builderSrc).not.toMatch(/record\.selected\s*=/);
    expect(builderSrc).not.toMatch(/record\.selected\.(filter|sort|splice)\(/);
  });
});

describe("item 12 - the card's caution line", () => {
  it("renders the caution copy in plain first-person business language", () => {
    expect(cardSrc).toContain("One caution from the final review:");
  });

  it("appears on BOTH the preview card and the execution card", () => {
    const uses = cardSrc.match(/<FinalReviewCaution e=\{e\} \/>/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });

  it("is silent unless the review flagged a real concern (verdict + non-empty text)", () => {
    expect(cardSrc).toMatch(/c\.verdict !== "concern" \|\| !c\.concern\) return null/);
  });

  it("never leaks lab words on the surface (no adjudicator/LLM in the caution component)", () => {
    const component = cardSrc.slice(cardSrc.indexOf("function FinalReviewCaution"), cardSrc.indexOf("function ExpectationLines"));
    expect(component.length).toBeGreaterThan(0);
    expect(component).not.toMatch(/adjudicat/i);
    expect(component.replace(/LLM read[^"]*/g, "")).not.toMatch(/\bLLM\b/);
  });

  it("does not gate apply/approve on the caution (flags never block)", () => {
    // teamCheck is consulted in exactly one place: the display-only caution
    // component. No action handler or disabled= expression can read it.
    const refs = cardSrc.match(/teamCheck/g) ?? [];
    expect(refs.length).toBe(1);
    const component = cardSrc.slice(cardSrc.indexOf("function FinalReviewCaution"), cardSrc.indexOf("function ExpectationLines"));
    expect(component).toContain("teamCheck");
  });
});

describe("item 12 - dash guard (hyphens only, everywhere)", () => {
  it("batch-adjudicator.ts contains zero banned dashes", () => {
    expect(BANNED_DASH.test(adjudicatorSrc)).toBe(false);
  });

  it("the daily card file contains zero banned dashes", () => {
    expect(BANNED_DASH.test(cardSrc)).toBe(false);
  });
});
