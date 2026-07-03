/**
 * claim-conflict-trigger tests (BEACON_500 R13 / N3, 2026-07-03): the exact
 * pinned conflict sentence, the cap, the byte-identical empty case, and the
 * candidate-row contract (evidence-backed, medium confidence, watch action -
 * no promotion-eligibility entry exists for claim_conflict, so it can never
 * auto-push).
 */
import { describe, expect, it } from "vitest";

import { claimConflictCandidates, MAX_CLAIM_CONFLICT_CANDIDATES } from "./claim-conflict-trigger";
import type { ClaimConflict } from "./claim-graph";

const persepolis: ClaimConflict = {
  subjectLabel: "the year Persepolis was built",
  subjectKey: "built|persepolis::date",
  a: { claimId: "cl-a", value: "515 BC", pageUrl: "https://site.com/persepolis", pagePath: "/persepolis" },
  b: { claimId: "cl-b", value: "518 BC", pageUrl: "https://site.com/iran-history", pagePath: "/iran-history" },
};

const conflictN = (n: number): ClaimConflict => ({
  subjectLabel: `the number for "subject ${n}"`,
  subjectKey: `subject${n}::number`,
  a: { claimId: `cl-a${n}`, value: "10", pageUrl: `https://site.com/a${n}`, pagePath: `/a${n}` },
  b: { claimId: `cl-b${n}`, value: "20", pageUrl: `https://site.com/b${n}`, pagePath: `/b${n}` },
});

describe("claimConflictCandidates", () => {
  it("emits the exact pinned conflict sentence", () => {
    const rows = claimConflictCandidates({ tenantId: "tenant-x", conflicts: [persepolis], signalAt: "2026-07-03T00:00:00.000Z" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.customer_copy).toBe(
      "Two of your pages disagree about the year Persepolis was built (515 BC on /persepolis, 518 BC on /iran-history). Pick one and I will keep them consistent.",
    );
  });

  it("anchors on the first side's owned page with evidence and medium confidence", () => {
    const row = claimConflictCandidates({ tenantId: "tenant-x", conflicts: [persepolis], signalAt: "2026-07-03T00:00:00.000Z" })[0]!;
    expect(row.trigger_signal).toBe("claim_conflict");
    expect(row.action_type).toBe("watch");
    expect(row.target_url).toBe("https://site.com/persepolis");
    expect(row.confidence).toBe("medium");
    expect(row.evidence.length).toBeGreaterThan(0);
    expect(row.evidence[0]!.detail).toContain("515 BC");
    expect(row.evidence[0]!.detail).toContain("518 BC");
    expect(row.dedupe_key).toBeTruthy();
    expect(row.cooldown_key).toBeTruthy();
    expect(row.safety_flags).toEqual([]);
  });

  it("caps at MAX_CLAIM_CONFLICT_CANDIDATES (3)", () => {
    const conflicts = [persepolis, conflictN(1), conflictN(2), conflictN(3), conflictN(4)];
    const rows = claimConflictCandidates({ tenantId: "tenant-x", conflicts, signalAt: "2026-07-03T00:00:00.000Z" });
    expect(MAX_CLAIM_CONFLICT_CANDIDATES).toBe(3);
    expect(rows).toHaveLength(3);
  });

  it("is byte-identical empty when there are no conflicts", () => {
    expect(claimConflictCandidates({ tenantId: "tenant-x", conflicts: [], signalAt: "2026-07-03T00:00:00.000Z" })).toEqual([]);
  });

  it("never emits an em or en dash in customer copy or operator evidence", () => {
    const rows = claimConflictCandidates({
      tenantId: "tenant-x",
      conflicts: [persepolis, conflictN(9)],
      signalAt: "2026-07-03T00:00:00.000Z",
    });
    for (const row of rows) {
      expect(row.customer_copy).not.toMatch(/[–—]/);
      expect(row.operator_evidence).not.toMatch(/[–—]/);
    }
  });
});
