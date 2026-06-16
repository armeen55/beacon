/**
 * SAFETY #273 follow-up (2026-06-15) — directive drafts vs publishable copy
 * in `validateDeterministicDraftSafety`.
 *
 * The deterministic promotion gate (`holdUnsafeDraft` → this validator)
 * must apply the PUBLISHED-PROSE style rules (em dash / leading self-claim
 * superlative / bare brand short form) ONLY to publishable-copy drafts
 * (edit_title / edit_meta / change_h1 — the new STRING gets pasted onto the
 * live page). DIRECTIVE drafts (fix_*, add_schema, add_proof_section,
 * add_answer_block, add_internal_link, fix_page_experience) carry an
 * operator INSTRUCTION in `proposed_text`, never published verbatim — their
 * instruction text legitimately uses em dashes, so those style rules must
 * NOT blank them.
 *
 * Regression: before this fix, every answer-block / sources / clarity /
 * schema / robots-ai directive (whose template uses an em dash) was reverted
 * to a content-free "go look at this page" card on every re-promote (the
 * SAFETY #273 gate landed 2026-06-14, after those directives last promoted).
 *
 * The CORRECTNESS gates (placeholder, unsupported brand claim) still run for
 * every action type — a directive must never carry "[insert X]" or an
 * unsupported social-proof claim either.
 */

import { describe, it, expect } from "vitest";

import { validateDeterministicDraftSafety } from "./specific-edit-validator";

// Unknown tenant → no curated brand-name style + empty brand assertions, so
// the brand gates are inert and we isolate the em-dash / superlative scoping.
const TENANT = "tenant-directive-safety-test";

// Representative real directive instruction text (mirrors the
// composeAnswerBlockDirective / composeClarityDirective templates): natural
// operator-facing prose that uses a standalone em dash.
const ANSWER_BLOCK_DIRECTIVE =
  "Add a 2-3 sentence direct answer (about 40-60 words) as the FIRST content block, right under the headline — before any intro. Keep it as visible body text — don't rely on FAQ markup.";
const CLARITY_DIRECTIVE =
  "Microsoft Clarity recorded rage clicks on this page — a strong signal that something looks interactive but isn't responding.";
const SCHEMA_DIRECTIVE =
  "Add this JSON-LD block to the page <head> (extend the @type if a more specific one fits — Article, FAQPage, Product).";
// Refresh-play directives (2026-06-16) — update_intro (gsc_decay / stale)
// and merge_pages (thin overlap). Their grounded templates use em dashes.
const DECAY_DIRECTIVE =
  "This page brought in about 120 clicks from Google a month ago and is down to about 72 — a drop of roughly 40%. Refresh the top section first — update any dated facts, then re-state the page's main answer.";
const MERGE_DIRECTIVE =
  "Two thin pages on one topic split your strength — pick the stronger page, fold this page's unique points into it, and redirect this URL there (a 301 redirect).";

describe("validateDeterministicDraftSafety — directive vs publishable copy (#273)", () => {
  it("DIRECTIVE drafts with em dashes pass (em-dash style rule skipped)", () => {
    for (const [actionType, proposedText] of [
      ["add_answer_block", ANSWER_BLOCK_DIRECTIVE],
      ["fix_page_experience", CLARITY_DIRECTIVE],
      ["add_schema", SCHEMA_DIRECTIVE],
      ["add_proof_section", "Add a short Sources section citing references — academic, institutional, or established publications."],
      ["fix_robots", "Remove the Disallow blocks so AI assistants can read — and recommend — this site."],
      ["update_intro", DECAY_DIRECTIVE],
      ["merge_pages", MERGE_DIRECTIVE],
    ] as const) {
      const verdict = validateDeterministicDraftSafety({
        tenantId: TENANT,
        proposedText,
        displayLabel: null,
        actionType,
      });
      expect(verdict.ok, `${actionType} should pass`).toBe(true);
    }
  });

  it("PUBLISHABLE-COPY drafts with em dashes are rejected (style rule armed)", () => {
    for (const actionType of ["edit_title", "edit_meta", "change_h1"]) {
      const verdict = validateDeterministicDraftSafety({
        tenantId: TENANT,
        proposedText: "Custom homes in Palo Alto — built for you.",
        displayLabel: null,
        actionType,
      });
      expect(verdict.ok, `${actionType} should fail on em dash`).toBe(false);
      if (!verdict.ok) {
        expect(verdict.field).toBe("proposed_text");
        expect(verdict.reason).toContain("em dash");
      }
    }
  });

  it("UNKNOWN / missing action type keeps the gate armed (safe default)", () => {
    const emDashText = "Two clauses — joined by an em dash.";
    for (const actionType of [undefined, null, "some_future_copy_type"]) {
      const verdict = validateDeterministicDraftSafety({
        tenantId: TENANT,
        proposedText: emDashText,
        displayLabel: null,
        actionType,
      });
      expect(verdict.ok, `actionType=${String(actionType)} should fail`).toBe(
        false,
      );
    }
  });

  it("CORRECTNESS gates still run for directives: placeholder text is rejected", () => {
    const verdict = validateDeterministicDraftSafety({
      tenantId: TENANT,
      proposedText: "TODO: add the answer block here later.",
      displayLabel: null,
      actionType: "add_answer_block",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.field).toBe("proposed_text");
  });

  it("clean publishable copy (no em dash) passes", () => {
    const verdict = validateDeterministicDraftSafety({
      tenantId: TENANT,
      proposedText: "Custom Home Builds in Palo Alto, built for you.",
      displayLabel: "Improve this page's title",
      actionType: "edit_title",
    });
    expect(verdict.ok).toBe(true);
  });
});
