/**
 * Architecture invariant — Section 7 C7e off-site recommendations
 * section safe-copy discipline (2026-05-22).
 *
 * C7e adds a read-only "Off-site opportunities" section at the bottom of
 * /recommendations (`src/app/(shell)/recommendations/off-site-
 * opportunities-section.tsx`). It REUSES the C7d `OffSiteAuthorityTile`
 * (whose copy is pinned by `off-site-customer-tile-safe-copy`); this
 * invariant pins the NEW copy the section itself introduces (the
 * manual-follow-up context label) to the same vocabulary floor.
 *
 *   FORBIDDEN (customer-visible text): missing, we checked,
 *   automatically, request reviews now, improve rankings, drove, caused,
 *   generated, led to, ` made `, revenue, dollars, sales, leads,
 *   guaranteed, `$`, Mode A/B/C, ` GBP `.
 *
 *   FORBIDDEN (anywhere in source): request_gbp_reviews, pursue_local_pr.
 *
 *   POSITIVE (sanity): the section frames itself as "Off-site
 *   opportunities" + "manual follow-up".
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SECTION =
  "src/app/(shell)/recommendations/off-site-opportunities-section.tsx";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** String + template static segments (skipping ${...}). */
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

const SECTION_SRC = read(SECTION);
const SECTION_ACTIVE = stripComments(SECTION_SRC);
const VISIBLE = extractCustomerVisibleText(SECTION_ACTIVE);
const VISIBLE_LOWER = VISIBLE.toLowerCase();

const FORBIDDEN_VISIBLE: ReadonlyArray<{ phrase: string; rationale: string }> = [
  { phrase: "missing", rationale: "Scary form." },
  { phrase: "we checked", rationale: "Implies unperformed verification." },
  { phrase: "automatically", rationale: "Automation framing." },
  { phrase: "request reviews now", rationale: "Review-solicitation CTA." },
  { phrase: "improve rankings", rationale: "Causal/ranking claim." },
  { phrase: "drove", rationale: "Causal verb." },
  { phrase: "caused", rationale: "Causal verb." },
  { phrase: "generated", rationale: "Causal verb." },
  { phrase: "led to", rationale: "Causal phrase." },
  { phrase: " made ", rationale: "Causal verb." },
  { phrase: "revenue", rationale: "Revenue framing." },
  { phrase: "dollars", rationale: "Revenue framing." },
  { phrase: "sales", rationale: "Revenue framing." },
  { phrase: "leads", rationale: "Lead-causality framing." },
  { phrase: "guaranteed", rationale: "Outcome guarantee." },
  { phrase: "$", rationale: "Dollar sign — revenue framing." },
  { phrase: "mode a", rationale: "Operator-only label." },
  { phrase: "mode b", rationale: "Operator-only label." },
  { phrase: "mode c", rationale: "Operator-only label." },
  { phrase: " gbp ", rationale: "Abbreviation — use full form." },
];

const FORBIDDEN_SOURCE_TOKENS: ReadonlyArray<{ token: string; rationale: string }> = [
  { token: "request_gbp_reviews", rationale: "Policy-risk action; never customer-surfaced." },
  { token: "pursue_local_pr", rationale: "Policy-risk action; never customer-surfaced." },
];

describe("Architecture — Section 7 C7e off-site recommendations section safe copy", () => {
  it("extracts a non-trivial amount of visible text (sanity)", () => {
    expect(VISIBLE.length).toBeGreaterThan(30);
  });

  for (const rule of FORBIDDEN_VISIBLE) {
    it(`section visible text does not contain '${rule.phrase.trim()}'`, () => {
      const idx = VISIBLE_LOWER.indexOf(rule.phrase.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(VISIBLE.length, idx + rule.phrase.length + 40);
        throw new Error(
          `Forbidden phrase '${rule.phrase}' in ${SECTION} visible text.\n` +
            `Rationale: ${rule.rationale}\nExcerpt: ...${VISIBLE.slice(start, end)}...`,
        );
      }
      expect(idx).toBe(-1);
    });
  }

  for (const rule of FORBIDDEN_SOURCE_TOKENS) {
    it(`section source never names '${rule.token}'`, () => {
      expect(
        SECTION_ACTIVE.includes(rule.token),
        `${SECTION} must never reference the policy-risk action '${rule.token}'. ${rule.rationale}`,
      ).toBe(false);
    });
  }

  it("section frames itself as off-site opportunities / manual follow-up (positive sanity)", () => {
    expect(VISIBLE).toContain("Off-site opportunities");
    expect(VISIBLE.toLowerCase()).toContain("manual follow-up");
  });
});
