/**
 * Architecture invariants — UX.3 ExecutiveStrip + needs_review reframe
 * (2026-05-07).
 *
 * Pins the source-level contract of the new Recommendations strip:
 *   - file exists; component is pure presentation
 *   - no paid APIs / fetch / mutations
 *   - customer-safe copy (no internal jargon)
 *   - "Why this order?" disclosure rendered
 *   - data builder is exported for tests
 *   - RecommendationsClient wires the strip ABOVE the Toolbar
 *   - Derived "Needs review" label has been reframed to "Needs more evidence"
 *   - The reframed pill's tooltip mentions "before shipping" semantics
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const STRIP = join(
  REPO_ROOT,
  "src/components/recommendations/executive-strip.tsx",
);
const CLIENT = join(
  REPO_ROOT,
  "src/app/(shell)/recommendations/recommendations-client.tsx",
);

const STRIP_SRC = readFileSync(STRIP, "utf8");
const CLIENT_SRC = readFileSync(CLIENT, "utf8");

function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*import\s+[^;]+;\s*$/gm, "")
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*[^;]+;\s*$/gm, "");
}

describe("UX.3 — files exist + correct exports", () => {
  it("strip component exists at src/components/recommendations/executive-strip.tsx", () => {
    expect(existsSync(STRIP)).toBe(true);
  });

  it("strip exports the component + the data builder + the row type", () => {
    expect(STRIP_SRC).toMatch(/export function ExecutiveStrip/);
    expect(STRIP_SRC).toMatch(/export function buildExecutiveStripData/);
    expect(STRIP_SRC).toMatch(/export type ExecutiveStripRow/);
    expect(STRIP_SRC).toMatch(/export type EvidenceDistribution/);
  });
});

describe("UX.3 — strip is pure presentation (no mutations / paid APIs)", () => {
  it("does NOT mutate or call paid APIs", () => {
    expect(STRIP_SRC).not.toMatch(/\.upsert\(/);
    expect(STRIP_SRC).not.toMatch(/\.insert\(/);
    expect(STRIP_SRC).not.toMatch(/\.update\(/);
    expect(STRIP_SRC).not.toMatch(/\.delete\(/);
    expect(STRIP_SRC).not.toMatch(/\bfetch\(/);
    expect(STRIP_SRC).not.toMatch(/from\s+["']@\/adapters\//);
    expect(STRIP_SRC).not.toMatch(/from\s+["']openai["']/);
    expect(STRIP_SRC).not.toMatch(/from\s+["']@anthropic/);
    expect(STRIP_SRC).not.toContain("runNativePoll");
    expect(STRIP_SRC).not.toContain("runWebsiteScan");
  });

  it("uses no client-state hooks (component is presentation-only)", () => {
    // The strip computes nothing; data is passed in. No useState /
    // useEffect / useTransition. Allowed: useMemo upstream in the
    // client wrapper, but not in the strip itself.
    expect(STRIP_SRC).not.toMatch(/\buseTransition\b/);
    expect(STRIP_SRC).not.toMatch(/\buseState\b/);
    expect(STRIP_SRC).not.toMatch(/\buseEffect\b/);
  });
});

describe("UX.3 — customer-safe copy", () => {
  it("strip does NOT render scary/internal language", () => {
    const code = stripComments(STRIP_SRC);
    expect(code).not.toMatch(/\bcron\b/i);
    expect(code).not.toMatch(/\bSupabase\b/i);
    expect(code).not.toMatch(/\bGitHub\b/i);
    expect(code).not.toMatch(/\bschema\b/i);
    expect(code).not.toMatch(/\bSQL\b/);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\bUTC\b/);
    expect(code).not.toMatch(/\baccount_id\b/);
    expect(code).not.toMatch(/\btenant_id\b/);
  });

  it("strip renders the 4 required headlines", () => {
    expect(STRIP_SRC).toMatch(/Monitored/);
    expect(STRIP_SRC).toMatch(/Need review/);
    expect(STRIP_SRC).toMatch(/Top opportunity/);
    expect(STRIP_SRC).toMatch(/Evidence strength/);
  });

  it("strip renders the 'Why this order?' inline disclosure", () => {
    expect(STRIP_SRC).toMatch(/Why this order\?/);
    expect(STRIP_SRC).toMatch(/data-rec-strip-rank-explainer="true"/);
  });

  it("strip renders the 'Open recommendation' CTA on top opportunity", () => {
    expect(STRIP_SRC).toMatch(/Open recommendation/);
  });

  it("Need-review card uses 'More evidence needed before shipping' language", () => {
    expect(STRIP_SRC).toMatch(/More evidence needed before shipping/);
  });
});

describe("UX.3 — RecommendationsClient wiring", () => {
  it("imports ExecutiveStrip + buildExecutiveStripData", () => {
    expect(CLIENT_SRC).toMatch(
      /import \{[\s\S]*?ExecutiveStrip[\s\S]*?buildExecutiveStripData[\s\S]*?ExecutiveStripRow[\s\S]*?\} from "@\/components\/recommendations\/executive-strip"/,
    );
  });

  it("renders <ExecutiveStrip> in the main return tree", () => {
    expect(CLIENT_SRC).toMatch(/<ExecutiveStrip[\s\S]{0,400}\/>/);
  });

  it("ExecutiveStrip renders BEFORE the Toolbar (top of page)", () => {
    const stripIdx = CLIENT_SRC.indexOf("<ExecutiveStrip");
    const toolbarIdx = CLIENT_SRC.indexOf("<Toolbar");
    expect(stripIdx).toBeGreaterThan(-1);
    expect(toolbarIdx).toBeGreaterThan(-1);
    expect(stripIdx).toBeLessThan(toolbarIdx);
  });

  it("strip rows are projected from the existing allRows (no new data load)", () => {
    expect(CLIENT_SRC).toMatch(/stripRows[\s\S]{0,500}allRows\.map/);
    expect(CLIENT_SRC).toMatch(/derived:\s*r\.derivedConfidence/);
    expect(CLIENT_SRC).toMatch(/rank:\s*r\.rank/);
  });
});

describe("UX.3 — derived 'needs_review' reframed to 'Needs more evidence'", () => {
  it("DERIVED_PILL_LABEL.needs_review === 'Needs more evidence'", () => {
    // Source-level pin so a future regression that reverts the copy
    // is caught at build time.
    expect(CLIENT_SRC).toMatch(
      /needs_review:\s*"Needs more evidence"/,
    );
    expect(CLIENT_SRC).not.toMatch(
      /needs_review:\s*"Needs review",/,
    );
  });

  it("the derived pill tooltip mentions 'shipping' for needs_review (operator clarity)", () => {
    // The derived pill's title attribute now branches on needs_review
    // and explains the shipping-readiness semantics. We accept either
    // phrasing ("recommend shipping" or "before shipping") to keep
    // the assertion robust to copy edits.
    expect(CLIENT_SRC).toMatch(
      /derived\s*===\s*"needs_review"[\s\S]{0,500}shipping/,
    );
  });
});
