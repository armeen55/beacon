/**
 * Architecture invariant — Slice 4.5.B.α₀ customer-copy vocab
 * (2026-05-19).
 *
 * Behavioral scan over every exported customer-copy template in
 * `src/domains/recommendation-intelligence/customer-copy-templates.ts`.
 * Each template invocation MUST return a string that passes:
 *
 *   1. No internal taxonomy tokens. Forbidden substrings (case-
 *      sensitive): `trigger_signal`, `action_type`, `actionType`,
 *      `evidence_tier`, `derivedConfidence`, `Mode A`, `Mode B`,
 *      `Mode C`, `aiSearchSignal`, `actualSearchQueries`,
 *      `source_rec_id`, `rec_stable_key`.
 *   2. No revenue / causal overclaim (carry-over from Section 9):
 *      `drove`, `caused`, `generated`, `revenue`, `dollars`, `$`,
 *      `ROI`.
 *   3. No connector-internal names (carry-over from Section 9
 *      `edit-outcomes-tile-vocab`): `Google Analytics`, `GA4`,
 *      `CallRail`.
 *   4. No UUID-shape strings.
 *   5. No `primary recommendation` raw label (Section 6 lock).
 *
 * The behavioral test calls every exported template with a range
 * of plausible inputs and runs the scan on each output. This
 * catches both static leaks (token in the template literal) and
 * dynamic leaks (caller-supplied arg interpolated into copy).
 *
 * α₀ ships 2 templates (`missingTitleCopy`, `missingMetaCopy`),
 * both no-argument. Later slices add more templates that take
 * arguments — the test machinery is set up so each new template
 * registers a probe set.
 */

import { describe, expect, it } from "vitest";

import * as templates from "@/domains/recommendation-intelligence/customer-copy-templates";

const FORBIDDEN_SUBSTRINGS_CASE_SENSITIVE: ReadonlyArray<string> = [
  "trigger_signal",
  "action_type",
  "actionType",
  "evidence_tier",
  "derivedConfidence",
  "Mode A",
  "Mode B",
  "Mode C",
  "aiSearchSignal",
  "actualSearchQueries",
  "source_rec_id",
  "rec_stable_key",
  "Google Analytics",
  "GA4",
  "CallRail",
];

const FORBIDDEN_SUBSTRINGS_CASE_INSENSITIVE: ReadonlyArray<string> = [
  "drove",
  "caused",
  "generated",
  "revenue",
  "dollars",
  "roi",
  "primary recommendation",
];

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Each template gets a probe set. α₀+α₁ templates are no-arg, so
 *  the probes are an empty array — the template is invoked once. */
type Probe = ReadonlyArray<unknown>;
const PROBE_SETS: Record<string, ReadonlyArray<Probe>> = {
  missingTitleCopy: [[]],
  missingMetaCopy: [[]],
  // Slice 4.5.B.α₁ (2026-05-19) — H1 family templates.
  missingH1Copy: [[]],
  weakH1Copy: [[]],
  titleH1MismatchCopy: [[]],
};

function scanForViolations(output: string): string[] {
  const violations: string[] = [];
  for (const tok of FORBIDDEN_SUBSTRINGS_CASE_SENSITIVE) {
    if (output.includes(tok)) violations.push(`case-sensitive token: ${tok}`);
  }
  const lowered = output.toLowerCase();
  for (const tok of FORBIDDEN_SUBSTRINGS_CASE_INSENSITIVE) {
    if (lowered.includes(tok)) violations.push(`case-insensitive token: ${tok}`);
  }
  if (UUID_RE.test(output)) violations.push("UUID-shape string");
  // Allow `$` only when escaped or inside a price example; for α₀
  // templates we forbid literal `$` entirely (revenue leak vector).
  if (output.includes("$")) violations.push(`literal "$" character`);
  return violations;
}

describe("recommendation-intelligence-customer-copy-vocab", () => {
  it("every exported function in customer-copy-templates has a probe set registered", () => {
    const exportedFns = Object.entries(templates)
      .filter(([, v]) => typeof v === "function")
      .map(([k]) => k);
    expect(exportedFns.length).toBeGreaterThanOrEqual(2);
    for (const name of exportedFns) {
      expect(
        PROBE_SETS[name],
        `Add a probe set for new template '${name}' to this invariant test.`,
      ).toBeDefined();
    }
  });

  it.each(Object.keys(PROBE_SETS))(
    "template `%s` output passes all customer-copy vocab rules",
    (name) => {
      const probes = PROBE_SETS[name]!;
      const fn = (templates as Record<string, unknown>)[name];
      expect(typeof fn).toBe("function");
      for (const probe of probes) {
        const output = (fn as (...args: unknown[]) => unknown).apply(
          null,
          probe as unknown[],
        );
        expect(typeof output).toBe("string");
        const violations = scanForViolations(output as string);
        expect(
          violations,
          `template '${name}' output "${String(output)}" violated: ${violations.join(", ")}`,
        ).toEqual([]);
      }
    },
  );
});
