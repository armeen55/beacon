/**
 * Architecture invariant — Section 7 C7d off-site customer-tile
 * safe-copy discipline (2026-05-22).
 *
 * C7d ships the FIRST customer-facing off-site surface
 * (`src/components/today/off-site-authority-tile.tsx`). The existing
 * `off-site-authority-customer-copy` invariant scans ONLY the operator
 * diagnostic page, so the customer tile's copy would otherwise be
 * unguarded. This invariant pins the tile's customer-visible vocabulary
 * floor (Section 7 locked invariant #3 + the C7d contract):
 *
 *   FORBIDDEN (customer-visible text):
 *     - scary framing: missing, we checked
 *     - automation framing: automatically, request reviews now
 *     - causal/ranking/revenue: improve rankings, drove, caused,
 *       generated, led to, ` made `, revenue, dollars, sales, leads,
 *       guaranteed, `$`
 *     - operator-only labels: Mode A / Mode B / Mode C
 *     - abbreviation: ` GBP ` (full "Google Business Profile" required)
 *
 *   FORBIDDEN (anywhere in source — action-type identifiers the tile
 *   must never name/render):
 *     - request_gbp_reviews  (review-solicitation policy)
 *     - pursue_local_pr      (PR-outreach policy)
 *
 *   POSITIVE (sanity): the tile uses the safe presence vocabulary
 *   ("Connected" / "Configured") + the "Worth a manual review" framing.
 *
 * The visible-text extractor mirrors the operator-copy invariant's
 * character-level walk (string literals + template static segments,
 * skipping `${...}` substitutions) so the `$` check is robust.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TILE = "src/components/today/off-site-authority-tile.tsx";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Accumulate visible-text candidates: quoted string-literal contents +
 *  template-literal static segments (skipping ${...} expressions). */
function extractCustomerVisibleText(src: string): string {
  const segments: string[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      const start = i;
      while (i < len && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        i += 1;
      }
      segments.push(src.slice(start, i));
      i += 1;
      continue;
    }
    if (ch === "`") {
      i += 1;
      let chunkStart = i;
      while (i < len && src[i] !== "`") {
        if (src[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        if (src[i] === "$" && i + 1 < len && src[i + 1] === "{") {
          if (i > chunkStart) segments.push(src.slice(chunkStart, i));
          i += 2;
          let depth = 1;
          while (i < len && depth > 0) {
            if (src[i] === "{") depth += 1;
            else if (src[i] === "}") depth -= 1;
            i += 1;
          }
          chunkStart = i;
          continue;
        }
        i += 1;
      }
      if (i > chunkStart) segments.push(src.slice(chunkStart, i));
      i += 1;
      continue;
    }
    i += 1;
  }
  return segments.join("\n");
}

const TILE_SRC = read(TILE);
const TILE_ACTIVE = stripComments(TILE_SRC);
const VISIBLE = extractCustomerVisibleText(TILE_ACTIVE);
const VISIBLE_LOWER = VISIBLE.toLowerCase();

const FORBIDDEN_VISIBLE: ReadonlyArray<{ phrase: string; rationale: string }> = [
  { phrase: "missing", rationale: "Scary form — use neutral framing (Section 7 #3)." },
  { phrase: "we checked", rationale: "Implies a verification Beacon didn't perform." },
  { phrase: "automatically", rationale: "No auto-claim/auto-post framing." },
  { phrase: "request reviews now", rationale: "Review-solicitation CTA." },
  { phrase: "improve rankings", rationale: "Causal/ranking claim." },
  { phrase: "drove", rationale: "Causal verb." },
  { phrase: "caused", rationale: "Causal verb." },
  { phrase: "generated", rationale: "Causal verb." },
  { phrase: "led to", rationale: "Causal phrase." },
  { phrase: " made ", rationale: "Causal verb (with spaces)." },
  { phrase: "revenue", rationale: "Revenue framing." },
  { phrase: "dollars", rationale: "Revenue framing." },
  { phrase: "sales", rationale: "Revenue framing." },
  { phrase: "leads", rationale: "Lead-causality framing." },
  { phrase: "guaranteed", rationale: "Outcome guarantee." },
  { phrase: "$", rationale: "Dollar sign — revenue framing." },
  { phrase: "mode a", rationale: "Operator-only label." },
  { phrase: "mode b", rationale: "Operator-only label." },
  { phrase: "mode c", rationale: "Operator-only label." },
  { phrase: " gbp ", rationale: "Abbreviation — use 'Google Business Profile'." },
];

const FORBIDDEN_SOURCE_TOKENS: ReadonlyArray<{ token: string; rationale: string }> = [
  { token: "request_gbp_reviews", rationale: "Policy-risk action; never on the customer tile." },
  { token: "pursue_local_pr", rationale: "Policy-risk action; never on the customer tile." },
];

describe("Architecture — Section 7 C7d off-site tile safe copy", () => {
  it("extracts a non-trivial amount of visible text (sanity)", () => {
    expect(VISIBLE.length).toBeGreaterThan(60);
  });

  for (const rule of FORBIDDEN_VISIBLE) {
    it(`tile visible text does not contain '${rule.phrase.trim()}'`, () => {
      const idx = VISIBLE_LOWER.indexOf(rule.phrase.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(VISIBLE.length, idx + rule.phrase.length + 40);
        throw new Error(
          `Forbidden phrase '${rule.phrase}' in ${TILE} visible text.\n` +
            `Rationale: ${rule.rationale}\nExcerpt: ...${VISIBLE.slice(start, end)}...`,
        );
      }
      expect(idx).toBe(-1);
    });
  }

  for (const rule of FORBIDDEN_SOURCE_TOKENS) {
    it(`tile source never names '${rule.token}'`, () => {
      expect(
        TILE_ACTIVE.includes(rule.token),
        `${TILE} must never reference the policy-risk action '${rule.token}'. ${rule.rationale}`,
      ).toBe(false);
    });
  }

  it("tile uses the safe presence + manual-review vocabulary (positive sanity)", () => {
    expect(VISIBLE).toContain("Connected");
    expect(VISIBLE).toContain("Configured");
    expect(VISIBLE).toContain("Worth a manual review");
    // Full form, never the bare abbreviation.
    expect(VISIBLE).toContain("Google Business Profile");
  });

  it("tile allowlists exactly the 3 non-policy-risk review actions", () => {
    expect(TILE_ACTIVE).toContain("claim_gbp");
    expect(TILE_ACTIVE).toContain("claim_or_optimize_yelp");
    expect(TILE_ACTIVE).toContain("optimize_gbp_profile");
  });
});
