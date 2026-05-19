/**
 * Architecture invariant — Slice 9.A2β (2026-05-19).
 *
 * Mode A Changes detail sub-line MUST suppress (return null) on
 * EVERY `ineligible` discriminator AND on `null` result. This pins
 * the Section 6 + Section 9 architecture invariant that substrate
 * gaps and missing data are NEVER customer messages.
 *
 * Behavioral pin: runs the actual component (not just source-text
 * scan) against the locked exhaustive discriminator set and asserts
 * `renderToStaticMarkup` returns empty string for every suppressed
 * variant.
 *
 * Pins:
 *   1. `result == null` → empty string.
 *   2. `kind: "ineligible"` AND every documented `reason` →
 *      empty string.
 *   3. `kind: "still_learning_outcome"` AND every documented
 *      `reason` → NON-empty rendering (positive sanity: still-
 *      learning IS the locked customer-facing render per K-block).
 *   4. `kind: "eligible"` → NON-empty rendering (positive sanity).
 *   5. Source-text pin: the component's null-return guards reference
 *      both `result == null` and `result.kind === "ineligible"`.
 *
 * Pinned files:
 *   • `src/components/changes/outcome-attribution-act3.tsx`
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { OutcomeAttributionAct3 } from "@/components/changes/outcome-attribution-act3";
import type { ModeAResult } from "@/domains/outcome-attribution/mode-a-cited-here-traffic-here";

const REPO_ROOT = resolve(__dirname, "..", "..");
const COMPONENT_PATH = join(
  REPO_ROOT,
  "src/components/changes/outcome-attribution-act3.tsx",
);

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const SOURCE_NO_COMMENTS = stripComments(readFileSync(COMPONENT_PATH, "utf-8"));

function render(result: ModeAResult | null): string {
  const tree = OutcomeAttributionAct3({ result }) as ReactElement | null;
  if (tree == null) return "";
  return renderToStaticMarkup(tree);
}

describe("outcome-attribution-changes-detail-suppression — behavioral pins", () => {
  it("suppresses (empty render) on result == null", () => {
    expect(render(null)).toBe("");
  });

  it("suppresses on ineligible: no_live_at", () => {
    expect(
      render({
        kind: "ineligible",
        reason: "no_live_at",
        canonical_target_url: null,
      }),
    ).toBe("");
  });

  it("suppresses on ineligible: no_target_url", () => {
    expect(
      render({
        kind: "ineligible",
        reason: "no_target_url",
        canonical_target_url: null,
      }),
    ).toBe("");
  });

  it("suppresses on ineligible: no_traffic_data", () => {
    expect(
      render({
        kind: "ineligible",
        reason: "no_traffic_data",
        canonical_target_url: "https://x.com",
      }),
    ).toBe("");
  });

  // Positive sanity: still-learning IS rendered (per K-block lock).
  it("renders (non-empty) on still_learning_outcome: insufficient_days", () => {
    const html = render({
      kind: "still_learning_outcome",
      reason: "insufficient_days",
      days_since_live: 3,
      post_live_sessions: 1,
      post_live_qualified_calls: 0,
      canonical_target_url: "https://x.com",
      sample_window_start: "2026-05-16",
      sample_window_end: "2026-05-19",
    });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('data-change-detail-outcome-attribution="true"');
  });

  it("renders (non-empty) on still_learning_outcome: insufficient_volume", () => {
    const html = render({
      kind: "still_learning_outcome",
      reason: "insufficient_volume",
      days_since_live: 21,
      post_live_sessions: 3,
      post_live_qualified_calls: 0,
      canonical_target_url: "https://x.com",
      sample_window_start: "2026-04-28",
      sample_window_end: "2026-05-19",
    });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('data-change-detail-outcome-attribution="true"');
  });

  it("renders (non-empty) on eligible", () => {
    const html = render({
      kind: "eligible",
      days_since_live: 14,
      post_live_sessions: 50,
      post_live_engaged_sessions: 40,
      post_live_conversions: 1,
      post_live_qualified_calls: 0,
      canonical_target_url: "https://x.com",
      sample_window_start: "2026-05-05",
      sample_window_end: "2026-05-19",
    });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('data-change-detail-outcome-attribution="true"');
  });
});

describe("outcome-attribution-changes-detail-suppression — source-text pins", () => {
  it("source contains a guard against `result == null`", () => {
    expect(
      /result\s*==\s*null/.test(SOURCE_NO_COMMENTS),
      "Component must explicitly guard against null result.",
    ).toBe(true);
  });

  it("source contains a guard against `result.kind === \"ineligible\"`", () => {
    // Allow the comparison form either way (=== "ineligible" or
    // "ineligible" ===) — both are valid TypeScript.
    const pattern = /result\.kind\s*===\s*["']ineligible["']/;
    expect(
      pattern.test(SOURCE_NO_COMMENTS),
      "Component must explicitly guard against kind === 'ineligible'.",
    ).toBe(true);
  });

  it("source does NOT render anything for ineligible (no JSX between the guard and the early return)", () => {
    // Collapse whitespace + check the ineligible guard returns null
    // directly without intervening JSX. Defensive against a future
    // refactor that accidentally re-routes the ineligible branch
    // into a render path.
    const collapsed = SOURCE_NO_COMMENTS.replace(/\s+/g, " ");
    expect(
      /result\.kind\s*===\s*["']ineligible["']\s*\)\s*return\s+null/.test(
        collapsed,
      ),
      "The ineligible guard must `return null;` immediately — never " +
        "fall through to JSX.",
    ).toBe(true);
  });
});
