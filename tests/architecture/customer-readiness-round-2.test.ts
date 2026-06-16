/**
 * Architecture invariant — Round 2 customer-readiness paper-cuts (2026-05-06).
 *
 * After Round 1 closed 6 high-demo-risk paper cuts, Round 2 closes
 * the next-tier issues from the same audit:
 *
 *   1. /prompts/[id] friendly slugs — `drilldown.topicId` and
 *      `drilldown.locationScope` were rendered as raw values
 *      (slugs like `cupertino_ca` or UUID-shaped keys). The new
 *      `prettifySlug` helper turns slugs into operator-readable
 *      display strings ("Cupertino, CA") and returns null for
 *      UUIDs (so the caller renders nothing).
 *   2. /recommendations empty-state copy — replaced "raw decision
 *      signals" jargon with operator-readable "today's prompt-by-
 *      prompt observations".
 *   3. /recommendations status pill — `needs_review` and
 *      `needs_fresh_edit` were both rendering as identical
 *      `status-warning` orange. Round 2 differentiates
 *      `needs_fresh_edit` with a dashed border + `status-info` blue
 *      so operators can tell "Beacon wants you to read this" from
 *      "regenerate; the prior edits were dismissed" at a glance.
 *
 * Operator scope (from the brief): copy + small render only. NO
 * production logic changes. NO LLM calls. NO queue mutation. NO
 * SYSTEM_PROMPT changes. NO persistence touched.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const PROMPTS_PAGE_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/prompts/[id]/page.tsx",
);

const PROMPTS_PAGE_SRC = readFileSync(PROMPTS_PAGE_PATH, "utf-8");

// Surface collapse (2026-06-15): Fix 2 (empty-state copy) + Fix 3 (status
// pill colors) pinned the legacy recommendations-client, which was deleted.
// The V2 card owns those surfaces now (covered by
// tests/app/recommendations/recommendations-v2-client.test.tsx). Those
// describe blocks were removed here; only the /prompts/[id] invariants
// remain.

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PROMPTS_PAGE_CODE = stripComments(PROMPTS_PAGE_SRC);

// ────────────────────────────────────────────────────────────────────────
// Fix 1 — /prompts/[id] friendly slugs
// ────────────────────────────────────────────────────────────────────────

describe("Round 2 Fix 1 — /prompts/[id] friendly slugs", () => {
  it("declares a prettifySlug helper", () => {
    expect(
      /export function prettifySlug\(/.test(PROMPTS_PAGE_CODE),
      "/prompts/[id]/page.tsx must define an exported prettifySlug helper " +
        "so unit tests + future callers can reuse the slug formatter.",
    ).toBe(true);
  });

  it("prettifySlug returns null for UUID-shaped values", () => {
    // We can't run the helper here without importing the route file,
    // so source-text-pin the UUID early-return shape.
    expect(
      /UUID_RE\s*=\s*\/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/.test(
        PROMPTS_PAGE_CODE,
      ),
      "prettifySlug must detect UUIDs via an RFC-4122 8-4-4-4-12 hex regex.",
    ).toBe(true);
    expect(
      /if\s*\(UUID_RE\.test\([\w]+\)\)\s*return null/.test(PROMPTS_PAGE_CODE),
      "prettifySlug must early-return null for UUID input so the caller " +
        "renders nothing rather than a raw UUID.",
    ).toBe(true);
  });

  it("prettifySlug recognizes US-state suffixes (cupertino_ca → Cupertino, CA)", () => {
    expect(
      /KNOWN_US_STATES\s*=\s*new Set/.test(PROMPTS_PAGE_CODE),
      "prettifySlug must reference a KNOWN_US_STATES set so geo slugs " +
        "ending in a US-state token render correctly.",
    ).toBe(true);
    // Pin the 2-char shape and at least one common state.
    expect(/"ca"/.test(PROMPTS_PAGE_CODE)).toBe(true);
    expect(/"ny"/.test(PROMPTS_PAGE_CODE)).toBe(true);
  });

  it("topicId tag is gated on prettifySlug returning a non-null value", () => {
    // Render guard: `drilldown.topicId && prettifySlug(drilldown.topicId) && (...)`
    // ensures UUID-only topicIds render NOTHING (not even an empty tag).
    expect(
      /drilldown\.topicId\s*&&\s*prettifySlug\(drilldown\.topicId\)\s*&&/.test(
        PROMPTS_PAGE_CODE,
      ),
      "topicId render must double-gate on prettifySlug so UUID topicIds " +
        "produce no UI at all (the operator brief says: don't render raw IDs).",
    ).toBe(true);
  });

  it("locationScope tag is gated on prettifySlug returning a non-null value", () => {
    expect(
      /drilldown\.locationScope\s*&&\s*prettifySlug\(drilldown\.locationScope\)\s*&&/.test(
        PROMPTS_PAGE_CODE,
      ),
      "locationScope render must double-gate on prettifySlug",
    ).toBe(true);
  });

  it("renders prettifySlug result inside the tag span (not the raw value)", () => {
    // Pin that the inner <span> uses prettifySlug(), not the raw field.
    expect(
      /<span>\{prettifySlug\(drilldown\.topicId\)\}<\/span>/.test(
        PROMPTS_PAGE_CODE,
      ),
      "topic tag must render `prettifySlug(drilldown.topicId)`, not the raw value.",
    ).toBe(true);
    expect(
      /<span>\{prettifySlug\(drilldown\.locationScope\)\}<\/span>/.test(
        PROMPTS_PAGE_CODE,
      ),
      "geo tag must render `prettifySlug(drilldown.locationScope)`, not the raw value.",
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Fix 2 (empty-state copy) + Fix 3 (status pill colors) — REMOVED 2026-06-15.
// They pinned the deleted legacy recommendations-client; the V2 card owns
// those surfaces now (recommendations-v2-client.test.tsx).
// ────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────
// Cross-fix: Round 1 invariants still hold (no scope creep)
// ────────────────────────────────────────────────────────────────────────

describe("Round 2 — Round 1 invariants still hold", () => {
  it("Round 1 forbidden phrases stay gone after Round 2 lands", () => {
    const roundOneForbidden = [
      "Stamps live_at = now",
      "live_match_kind = operator_override",
      "Pre-pivot CSV / PDF rebuild",
      "Supabase schema",
      "dual-write logs",
      "GitHub Actions logs",
      "proof run (small sample)",
      "proof-sized sample",
    ];
    const offenders: string[] = [];
    // Surface collapse (2026-06-15): the recommendations-client read was
    // dropped (file deleted); the /prompts page remains the live surface
    // this round's invariants guard.
    const all = [PROMPTS_PAGE_CODE].join("\n");
    for (const phrase of roundOneForbidden) {
      if (all.includes(phrase)) offenders.push(phrase);
    }
    expect(
      offenders,
      `Round 2 changes accidentally re-introduced Round 1 forbidden phrases: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
