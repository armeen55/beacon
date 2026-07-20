import { describe, it, expect } from "vitest";
import { countReplicateRecsForChange } from "./replicate-count";
import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { MinedPattern, PlaybookBrief } from "@/domains/pages/playbook";

/**
 * Pins the "Replicate this pattern" CTA count semantics that the change-detail
 * page previously derived from the full recommendation engine
 * (`allRecs.filter(r => r.type === "replicate" && r.sourceChangeId === id).length`).
 *
 * The extracted `countReplicateRecsForChange` must return the SAME number the
 * engine's replicate branch would have produced. These fixtures exercise every
 * branch the count depends on: pattern matching (by source-page URL and by
 * description), the proven-page exclusion, URL normalization, the best-proven
 * (highest topScore) tie-break, and the per-change attribution of the count.
 */

// Minimal fixtures — only the fields the counter reads are populated. Casts keep
// the fixtures small without reconstructing the full domain shapes.
function row(opts: {
  id: string;
  url: string | null;
  desc?: string;
  verdict: string;
  direction: string;
  events: number;
  topScore: number;
}): ScorecardRowWithImpact {
  return {
    verdict: opts.verdict,
    impact: { direction: opts.direction },
    totalEventsLinked: opts.events,
    topScore: opts.topScore,
    change: {
      id: opts.id,
      url: opts.url,
      change_description: opts.desc ?? "",
    },
  } as unknown as ScorecardRowWithImpact;
}

const patterns = [
  {
    id: "p1",
    type: "faq_schema_package",
    sourcePages: [{ url: "https://x.com/a" }],
  },
] as unknown as MinedPattern[];

// Two proven-positive changes both bucket to pattern p1:
//   c1 matches p1 by source-page URL (https://x.com/a) — topScore 90
//   c2 matches p1 by description ("faq schema") — topScore 50
// bestProven for p1 is therefore always c1.
const impactRows: ScorecardRowWithImpact[] = [
  row({
    id: "c1",
    url: "https://x.com/a",
    verdict: "validated",
    direction: "positive",
    events: 3,
    topScore: 90,
  }),
  row({
    id: "c2",
    url: "https://x.com/b",
    desc: "added faq schema",
    verdict: "partial",
    direction: "positive",
    events: 2,
    topScore: 50,
  }),
  // Not proven-positive (negative direction) — must be ignored entirely.
  row({
    id: "c3",
    url: "https://x.com/f",
    desc: "faq tweak",
    verdict: "validated",
    direction: "negative",
    events: 4,
    topScore: 99,
  }),
];

const briefs = [
  // qualifies → resolves to bestProven c1 (pageUrl carries a trailing slash to
  // exercise normalization; still not a proven page, so not excluded).
  { id: "b1", patternId: "p1", pageUrl: "https://x.com/c/" },
  // excluded: page a already carries a proven change.
  { id: "b2", patternId: "p1", pageUrl: "https://x.com/a" },
  // skipped: pattern p2 has no proven change.
  { id: "b3", patternId: "p2", pageUrl: "https://x.com/d" },
  // qualifies → resolves to bestProven c1.
  { id: "b4", patternId: "p1", pageUrl: "https://x.com/e" },
] as unknown as PlaybookBrief[];

describe("countReplicateRecsForChange", () => {
  it("counts every qualifying brief whose best-proven change is the target (c1 → 2)", () => {
    // b1 and b4 both qualify and both resolve to c1 as best-proven. b2 is
    // excluded (proven page), b3 is skipped (unproven pattern).
    expect(
      countReplicateRecsForChange({ changeId: "c1", impactRows, patterns, briefs }),
    ).toBe(2);
  });

  it("returns 0 for a proven change that is never the best-proven (c2 → 0)", () => {
    // c2 is in the p1 bucket but c1 outranks it on topScore, so no brief ever
    // sources a replicate rec from c2.
    expect(
      countReplicateRecsForChange({ changeId: "c2", impactRows, patterns, briefs }),
    ).toBe(0);
  });

  it("returns 0 for an unrelated / non-existent change id", () => {
    expect(
      countReplicateRecsForChange({ changeId: "zzz", impactRows, patterns, briefs }),
    ).toBe(0);
  });

  it("returns 0 when there are no briefs", () => {
    expect(
      countReplicateRecsForChange({ changeId: "c1", impactRows, patterns, briefs: [] }),
    ).toBe(0);
  });
});
