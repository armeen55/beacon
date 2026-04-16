import { describe, expect, it } from "vitest";
import type { Finding } from "@/domains/scanning/types";
import {
  recommendationLineageBullets,
  serializeFindingForToday,
} from "@/lib/today-proof-serialize";

const minimalFinding = (over: Partial<Finding> = {}): Finding => ({
  id: "f1",
  type: "title_changed",
  url: "https://example.com/a",
  pagePath: "/a",
  detectedAt: "2026-01-01T12:00:00.000Z",
  scanRunId: "run-known",
  previousState: "Old",
  currentState: "New",
  severity: "medium",
  priority: "important",
  priorityScore: 5,
  summary: "Title changed",
  suggestedAction: "Review",
  status: "pending",
  resolvedAt: null,
  linkedChangeId: null,
  promotionStatus: "none",
  resolutionNote: null,
  suppressUntil: null,
  citationCount: 0,
  isHomepage: false,
  contradictsChangelog: false,
  tenant_id: "tenant-test",
  ...over,
});

describe("serializeFindingForToday", () => {
  it("sets crawlProofHref when scanRunId matches a known observation run", () => {
    const ids = new Set(["run-known"]);
    const s = serializeFindingForToday(minimalFinding(), ids);
    expect(s.crawlProofHref).toBe("/observations/run-known");
    expect(s.scanRunId).toBe("run-known");
    expect(s.provenanceSummary).toMatch(/consecutive full-site HTML/i);
  });

  it("omits crawlProofHref when batch id is not in the observation index", () => {
    const ids = new Set(["other"]);
    const s = serializeFindingForToday(minimalFinding({ scanRunId: "scan-ephemeral" }), ids);
    expect(s.crawlProofHref).toBeNull();
    expect(s.scanRunId).toBe("scan-ephemeral");
    expect(s.provenanceSummary).toBeTruthy();
  });
});

describe("recommendationLineageBullets", () => {
  it("matches stable snapshot for a typical primary-style recommendation", () => {
    expect(
      recommendationLineageBullets({
        sourceEvidence: "Citations concentrated on /pricing",
        type: "strengthen_structure",
        sourceChangeId: "chg-1",
        dataFreshness: "Based on data through 2026-02-01",
      }),
    ).toMatchInlineSnapshot(`
      [
        "Evidence: Citations concentrated on /pricing",
        "Signal type: strengthen structure",
        "Grounded in a scorecard change row when you act from Changes.",
        "Based on data through 2026-02-01",
      ]
    `);
  });

  it("omits optional lines when change id and freshness are absent", () => {
    expect(
      recommendationLineageBullets({
        sourceEvidence: "Pattern signal",
        type: "investigate",
        sourceChangeId: null,
        dataFreshness: null,
      }),
    ).toEqual([
      "Evidence: Pattern signal",
      "Signal type: investigate",
    ]);
  });
});
