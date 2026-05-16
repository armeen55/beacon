/**
 * Architecture invariant — Section 5.A / forbidden-vocab on the
 * compute + loader source (2026-05-16).
 *
 * Section 12 N4 carry-over: even though the compute + loader are
 * server-internal (no customer copy emitted directly from these
 * files), their comments and identifier choices form the
 * authoritative source for any future customer-facing surface
 * Section 5.B builds. Forbidding the locked vocabulary here
 * pre-ratchets the discipline.
 *
 * Categories:
 *   • Causal verbs: drove, caused, generated, " made ", "led to"
 *   • Revenue framing: $, revenue, dollars, sales, leads
 *   • Operator-only Mode labels (Section 6 H8 carry-over):
 *     "Mode A", "Mode B", "Mode C"
 *   • Promise verbs: "will improve rankings", "will drive",
 *     "will make AI cite"
 *   • Prescriptive: "you must", "you need to"
 *   • Cross-section vocabulary leakage: "primary recommendation"
 *     / "primary_recommendation" — Section 5's repeat-citation
 *     surfaces must stay non-overlapping with Section 6's primary-
 *     recommendation surfaces. Source-text mention of those
 *     phrases in Section 5 files would invite a customer-surface
 *     bridge that violates Section 6 Mode A/B/C silence.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const TARGETS = [
  "src/domains/citation-lifecycle/compute-repeat-citation.ts",
  "src/domains/citation-lifecycle/load-repeat-citation.ts",
] as const;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Strip template-literal interpolation sequences `${...}` so the
 * forbidden-`$` scan doesn't trip on legitimate code like
 * `` `recommended_edits:${tenantId}` ``. The `$` ban targets
 * revenue framing (Section 9), not template syntax. This matches
 * the pattern used by Section 6 / Section 7 forbidden-vocab
 * invariants when scanning code that emits template literals.
 */
function stripTemplateInterpolations(src: string): string {
  // Greedy-balanced replacement: walk the source and drop any
  // `${...}` chunk. The brace counter handles nested object
  // literals inside template substitutions.
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "$" && src[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

const FORBIDDEN: ReadonlyArray<{ phrase: string; rationale: string }> = [
  { phrase: "drove", rationale: "Causal verb — Section 5 describes observation, not causation." },
  { phrase: "caused", rationale: "Causal verb." },
  { phrase: "generated", rationale: "Causal verb." },
  { phrase: " made ", rationale: "Causal verb (space-bounded so we don't trip on 'made up of')." },
  { phrase: "led to", rationale: "Causal verb." },
  { phrase: "$", rationale: "Revenue framing — Section 9 territory; no $ on Section 5 surfaces." },
  { phrase: "revenue", rationale: "Revenue framing." },
  { phrase: "dollars", rationale: "Revenue framing." },
  { phrase: "sales", rationale: "Revenue framing." },
  { phrase: "leads", rationale: "Revenue framing." },
  { phrase: "Mode A", rationale: "Section 6 H8 operator-only label." },
  { phrase: "Mode B", rationale: "Section 6 H8 operator-only label." },
  { phrase: "Mode C", rationale: "Section 6 H8 operator-only label." },
  { phrase: "will improve rankings", rationale: "Promise verb — descriptive only." },
  { phrase: "will drive", rationale: "Promise verb." },
  { phrase: "will make AI cite", rationale: "Promise verb." },
  { phrase: "you must", rationale: "Prescriptive — Beacon describes, doesn't dictate." },
  { phrase: "you need to", rationale: "Prescriptive." },
  { phrase: "primary recommendation", rationale: "Section 6 scope — must not bleed into Section 5 source." },
  { phrase: "primary_recommendation", rationale: "Section 6 schema name — must not appear in Section 5 source." },
];

describe("Architecture — repeat-citation source forbidden vocab", () => {
  for (const rel of TARGETS) {
    const active = stripTemplateInterpolations(
      stripComments(readFileSync(resolve(REPO_ROOT, rel), "utf-8")),
    );
    for (const { phrase, rationale } of FORBIDDEN) {
      it(`${rel}: does NOT contain '${phrase}'`, () => {
        const idx = active.indexOf(phrase);
        if (idx >= 0) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(active.length, idx + phrase.length + 40);
          throw new Error(
            `${rel}: forbidden vocab '${phrase}' present (offset ${idx}).\n` +
              `Rationale: ${rationale}\n` +
              `Excerpt: ...${active.slice(start, end)}...`,
          );
        }
        expect(idx).toBe(-1);
      });
    }
  }
});
