/**
 * T2 + T3 (operator audit, 2026-05-05) — /today action-card + win-card
 * copy hygiene.
 *
 * Pre-T2: action cards leaked raw `citations_per_day` chip + a
 *   "Pattern-based" badge for the heuristic basis (a customer-safe
 *   "OR HIDE" was the operator's preferred fix).
 * Pre-T2: findings strip rendered "533 schema missing for page type
 *   · 103 invalid schema · 67 other" — internal-diagnostic copy on the
 *   default surface.
 * Pre-T3: win-card default rationale led with "+1083%" / "Z-score 20.6"
 *   / "high confidence" — three statistics + a confidence label in the
 *   first sentence.
 *
 * Post-T2:
 *   • action-card hides the evidenceBasis badge entirely when basis is
 *     `heuristic` (the lowest-evidence tier; "Pattern-based" leaked
 *     internal taxonomy).
 *   • action-card translates known internal `expectedMetric` keys
 *     (citations_per_day, primary_rate, etc.) to operator-readable
 *     copy via `friendlyExpectedMetric`. Unknown raw snake_case keys
 *     drop the chip entirely.
 *   • findings strip default copy is "{N} page issues — {M} urgent"
 *     with the type breakdown moved BEHIND the link (still on /pages,
 *     and surfaced in the link's `title` tooltip on hover).
 *
 * Post-T3:
 *   • Default win-card rationale is two short sentences, no stats:
 *     "Citations increased after this change. URL-level signal
 *     detected; not proof of causation."
 *   • Z-score, exact %, window math, methodology disclaimer move into
 *     `lineageBullets` (rendered behind "Why we suggest this" expansion).
 *   • When relative-% is extreme (>= 300%), pctBullet is OMITTED so
 *     the operator never reads "+1083%" — absolute /day takes its
 *     place.
 *
 * Source-text invariant rather than DOM render — the components are
 * `"use client"` with hooks; pinning the lexical contract on copy
 * strings + branching shape is more robust than a brittle DOM probe.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const ACTION_CARD_PATH = join(
  REPO_ROOT,
  "src/components/today/action-card.tsx",
);
const ACTION_QUEUE_PATH = join(
  REPO_ROOT,
  "src/components/today/today-action-queue.tsx",
);
const TODAY_DATA_PATH = join(REPO_ROOT, "src/app/(shell)/today-data.ts");

const ACTION_CARD_SRC = readFileSync(ACTION_CARD_PATH, "utf-8");
const ACTION_QUEUE_SRC = readFileSync(ACTION_QUEUE_PATH, "utf-8");
const TODAY_DATA_SRC = readFileSync(TODAY_DATA_PATH, "utf-8");

// ---------------------------------------------------------------------------
// T2 — action card no longer leaks "Pattern-based" badge or raw metric keys
// ---------------------------------------------------------------------------

describe("T2 — action-card hides the heuristic badge", () => {
  it("evidenceBasis badge is gated to NON-heuristic tiers", () => {
    expect(
      ACTION_CARD_SRC.includes(
        'action.evidenceBasis && action.evidenceBasis !== "heuristic"',
      ),
      "action-card.tsx must hide the evidenceBasis badge when basis === 'heuristic' (T2)",
    ).toBe(true);
  });
});

describe("T2 — action-card translates internal expectedMetric keys", () => {
  it("friendlyExpectedMetric helper exists and maps citations_per_day", () => {
    expect(
      ACTION_CARD_SRC.includes("function friendlyExpectedMetric"),
      "action-card.tsx must declare a friendlyExpectedMetric helper (T2)",
    ).toBe(true);
    expect(
      ACTION_CARD_SRC.includes('citations_per_day: "Expected: more AI citations"'),
      "friendlyExpectedMetric must map 'citations_per_day' to operator-readable copy (T2)",
    ).toBe(true);
  });

  it("default chip drops raw snake_case identifiers", () => {
    // The chip render path now wraps the value through friendlyExpectedMetric
    // and short-circuits when the helper returns null.
    expect(
      ACTION_CARD_SRC.includes("friendlyExpectedMetric(action.expectedMetric)"),
      "action-card.tsx must wrap action.expectedMetric through friendlyExpectedMetric (T2)",
    ).toBe(true);
  });

  it("the bare {action.expectedMetric} render is gone", () => {
    // Before T2: <span>{action.expectedMetric}</span> rendered the raw
    // snake_case key. After T2 the value flows through the helper.
    const stripped = ACTION_CARD_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^[ \t]*\/\/.*$/gm,
      "",
    );
    expect(
      stripped.match(/>\s*\{action\.expectedMetric\}\s*</),
      "action-card.tsx must NOT render `{action.expectedMetric}` directly into JSX text (T2)",
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T2 — findings strip simplified
// ---------------------------------------------------------------------------

describe("T2 — findings strip default no longer leaks the type breakdown", () => {
  it("default link text is the simple summary, NOT typeBreakdownLabel", () => {
    // Pre-T2 the link rendered `findings.typeBreakdownLabel ?? fallback` —
    // typeBreakdownLabel won the default. Post-T2 the simple summary is
    // first, with typeBreakdownLabel surfaced via the link's `title` tooltip.
    expect(
      ACTION_QUEUE_SRC.includes("{findings.totalCount} page issue"),
      "today-action-queue.tsx must default to '{N} page issue(s)' summary (T2)",
    ).toBe(true);
  });

  it("typeBreakdownLabel is surfaced via the link's title tooltip", () => {
    expect(
      ACTION_QUEUE_SRC.includes("title={findings.typeBreakdownLabel ?? undefined}"),
      "today-action-queue.tsx must keep the type breakdown reachable via tooltip (T2)",
    ).toBe(true);
  });

  it("the breakdown render shape ('533 schema missing · 103 …') no longer appears in the default text", () => {
    // The default render path was:
    //   {findings.typeBreakdownLabel ?? `${findings.totalCount} page issue${...}`}
    // We pin the absence of the `??` fallback shape that surfaced the
    // typeBreakdownLabel as default text.
    const stripped = ACTION_QUEUE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^[ \t]*\/\/.*$/gm,
      "",
    );
    expect(
      stripped.match(/\{findings\.typeBreakdownLabel\s*\?\?\s*`/),
      "today-action-queue.tsx must NOT use typeBreakdownLabel as the default link text (T2)",
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T3 — win-card default rationale calmed down
// ---------------------------------------------------------------------------

describe("T3 — default win-card rationale leads with calm copy", () => {
  it("default rationale is the two short calm sentences", () => {
    expect(
      TODAY_DATA_SRC.includes(
        "Citations ${directionDefault} after this change. URL-level signal detected; not proof of causation.",
      ),
      "today-data.ts win-card must use 'Citations <direction> after this change. URL-level signal detected; not proof of causation.' as default rationale (T3)",
    ).toBe(true);
  });

  it("default rationale does NOT inline Z-score", () => {
    // The old rationale string wove `Z-score ${...}` into the default
    // text. Pin its absence in the new default rationale literal.
    // We grep specifically inside the 'rationale =' assignment.
    const idx = TODAY_DATA_SRC.indexOf(
      'const rationale = `Citations ${directionDefault} after this change.',
    );
    expect(idx).toBeGreaterThan(0);
    const slice = TODAY_DATA_SRC.slice(idx, idx + 220);
    expect(
      slice.includes("Z-score"),
      "Default win-card rationale literal must NOT include 'Z-score' (T3)",
    ).toBe(false);
  });

  it("default rationale does NOT inline a relative percent", () => {
    const idx = TODAY_DATA_SRC.indexOf(
      'const rationale = `Citations ${directionDefault} after this change.',
    );
    const slice = TODAY_DATA_SRC.slice(idx, idx + 220);
    expect(slice.includes("h.deltaPct")).toBe(false);
    expect(slice.includes("toFixed(0)}%")).toBe(false);
  });
});

describe("T3 — exact stats live in lineageBullets (expansion-only)", () => {
  it("Z-score bullet exists with the expected shape", () => {
    expect(
      TODAY_DATA_SRC.includes(
        "Z-score ${h.landingZ.toFixed(1)} (${h.confidence} confidence).",
      ),
      "Z-score bullet must use 'Z-score N.N (X confidence).' shape (T3)",
    ).toBe(true);
  });

  it("absolute /day delta bullet exists", () => {
    expect(
      TODAY_DATA_SRC.includes(
        "In the post-change window, citations ${directionVerb} by ~${absDeltaPerDay.toFixed(1)}/day.",
      ),
      "Absolute /day bullet must use 'In the post-change window, citations <verb> by ~N/day.' shape (T3)",
    ).toBe(true);
  });

  it("methodology disclaimer bullet exists", () => {
    expect(
      TODAY_DATA_SRC.includes(
        "URL-level correlation",
      ),
      "Methodology disclaimer 'URL-level correlation' must be present in lineageBullets (T3)",
    ).toBe(true);
    expect(
      TODAY_DATA_SRC.includes("not proof of causation"),
      "Methodology disclaimer must include 'not proof of causation' (T3)",
    ).toBe(true);
  });

  it("lineageBullets is included on the pushed action card", () => {
    expect(
      TODAY_DATA_SRC.match(
        /winningActions\.push\(\{[\s\S]*?lineageBullets,?\s*\}\)/,
      ),
      "winning action push must include lineageBullets (T3)",
    ).not.toBeNull();
  });
});

describe("T3 — extreme relative-% omits the pct bullet (operator brief)", () => {
  it("isExtremePct gate is set at 300%", () => {
    expect(
      TODAY_DATA_SRC.includes("Math.abs(h.deltaPct) >= 3.0"),
      "today-data.ts must gate the pct bullet at >= 3.0 (300%) — operator brief T3",
    ).toBe(true);
  });

  it("pctBullet is conditional on !isExtremePct", () => {
    expect(
      TODAY_DATA_SRC.match(
        /pctBullet\s*=\s*\n?\s*h\.deltaPct\s*!==\s*null\s*&&\s*!isExtremePct/,
      ),
      "pctBullet must be guarded by !isExtremePct (T3)",
    ).not.toBeNull();
  });
});
