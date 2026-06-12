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
 *  the probes are an empty array — the template is invoked once.
 *  α₂'s duplicate templates take an integer occurrenceCount, so
 *  they're probed with multiple integer values to catch any
 *  plurality-formatting bug.
 *
 *  Slice 4.5.C.α₀ adds 5 no-arg indexability-remediation
 *  templates probed with a single empty-arg invocation each. */
type Probe = ReadonlyArray<unknown>;
const PROBE_SETS: Record<string, ReadonlyArray<Probe>> = {
  missingTitleCopy: [[]],
  missingMetaCopy: [[]],
  // Slice 4.5.B.α₁ (2026-05-19) — H1 family templates.
  missingH1Copy: [[]],
  weakH1Copy: [[]],
  titleH1MismatchCopy: [[]],
  // Slice 4.5.B.α₂ (2026-05-19) — count-aware duplicate-metadata
  // templates. Multiple integer probes catch any plurality bug
  // (e.g., a future "1 owned page" typo would surface).
  duplicateTitleCopy: [[2], [3], [5], [10]],
  duplicateMetaCopy: [[2], [3], [5], [10]],
  // Slice 4.5.C.α₀ (2026-05-19) — indexability remediation
  // templates. All five no-arg; predicates that emit them land
  // in Slice 4.5.C.α₁ (Tier-1) and α₂ (Tier-2).
  fixSitemapCopy: [[]],
  fixRobotsCopy: [[]],
  fixNoindexCopy: [[]],
  fixStatusCodeCopy: [[]],
  fixCanonicalCopy: [[]],
  // Slice 4.5.C.α₃a (2026-05-20) — internal-linking template.
  // No-arg; paired with the cross-snapshot `orphan-page`
  // predicate which emits at confidence: medium.
  addInternalLinkCopy: [[]],
  // Slice 4.5.C.α₃b (2026-05-20) — structured-data template.
  // No-arg; paired with the per-snapshot `missing-schema`
  // predicate which emits at confidence: low (diagnostic_only).
  addSchemaCopy: [[]],
  // Slice 4.5.E.α₁a (2026-05-21) — H2-rewrite template. No-arg.
  // Paired with the new `weak-h2` predicate which emits at
  // confidence: low → diagnostic_only routing. The LLM gateway
  // drafts the actual replacement text in α₁b.
  rewriteH2Copy: [[]],
  // Night-shift #43 (2026-06-11) — merge-pages (thin_content_overlap).
  mergePagesCopy: [[]],
  // Night-shift #44 (2026-06-11) — stale-content (stale_content).
  staleContentCopy: [[]],
  // fix_schema slice (2026-06-12) — structured-data repair template.
  // No-arg; paired with the per-snapshot `invalid-schema` predicate
  // (medium confidence, customer-queue-ready).
  fixSchemaCopy: [[]],
  // Insight Graph slice 1 (2026-06-12) — GSC low-CTR template. Args:
  // (query, impressions). Probe both a short and a long query.
  gscLowCtrCopy: [["persian tea houses", 480], ["x", 200000]],
  // Insight Graph slice 2 (2026-06-12) — striking-distance template.
  // Args: (keyword, position, volume).
  strikingDistanceCopy: [["persian rugs", 12, 590], ["k", 4, 10]],
  // Rule B (2026-06-12) — first-party striking-distance template.
  gscStrikingDistanceCopy: [["nowruz traditions", 9, 1200], ["q", 4, 100]],
  // Decay slice (2026-06-12) — fading-page template. Arg: dropPct.
  gscDecayCopy: [[25], [80]],
  // Cannibalization slice (2026-06-12). Arg: keyword.
  cannibalizationCopy: [["persian rugs"], ["x"]],
  // Keyword-gap slice (2026-06-12). Args: (keyword, volume).
  keywordGapCopy: [["nowruz gifts", 880], ["q", 10]],
  keywordGapExpandCopy: [["nowruz gifts", 880], ["q", 10]],
  internalLinkOpportunityCopy: [["The Persian Tea Ceremony"], ["x"]],
  uncitedContentCopy: [[], []],
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
