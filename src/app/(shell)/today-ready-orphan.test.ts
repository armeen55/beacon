/**
 * buildReadyOrphanMove (row-existence fallback, 2026-07-20) - a VALID ready
 * prepared pack whose URL never earned a live queue row is synthesized into a
 * surfaced TodayMove. This pins the two load-bearing guarantees:
 *   (f) the SAME draft-quality gate still demotes a bad draft out of "ready",
 *   - the synthesized row carries only real prepared evidence (no fabricated
 *     demand) and names itself via inclusionReason.
 * today-moves-data.ts composes many heavy sources, so we mock server-only and
 * exercise the pure builder directly (same posture as moves-data-swr.test.ts).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, cache: <T>(fn: T) => fn };
});

import { buildReadyOrphanMove } from "./today-moves-data";
import type { PreparedMovePack } from "@/domains/demand-graph/prepared-move-pack";
import type { DraftQualityResult } from "@/domains/drafts/draft-quality";

const pack = (over: Partial<PreparedMovePack> = {}): PreparedMovePack =>
  ({
    version: 1,
    tenantId: "tenant-iranopedia",
    moveId: "https://iranopedia.com/cuisine",
    moveType: "edit_page",
    parentType: "ctr_move",
    targetUrl: "https://iranopedia.com/cuisine",
    proposedSlug: null,
    primaryQuery: "persian cuisine",
    secondaryQueries: [],
    specialistOpinions: [],
    routerDecision: { action: "edit_title", rationale: "Sharpen the title to the query.", confidenceLevel: "medium" },
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    structuredDraft: { kind: "atomic_edit", value: { after: "The Complete Guide to Persian Cuisine" } },
    experiment: null,
    implementationChecklist: [],
    costSpent: { llmUsd: 0, serpUsd: 0 },
    confidence: "medium",
    evidenceHash: "h",
    generatedAt: "2026-07-18T00:00:00.000Z",
    staleAt: "2026-08-01T00:00:00.000Z",
    preparedStatus: "ready_to_review",
    ...over,
  }) as unknown as PreparedMovePack;

const quality = (status: DraftQualityResult["status"], copyAllowed: boolean): DraftQualityResult =>
  ({ status, copyAllowed, reasons: [], confidence: "high" }) as unknown as DraftQualityResult;

describe("buildReadyOrphanMove", () => {
  it("surfaces a ready pack as a ready row with real prepared evidence and inclusionReason", () => {
    const m = buildReadyOrphanMove(pack(), "https://iranopedia.com/cuisine", quality("ready", true));
    expect(m.action).toBe("edit_title");
    expect(m.targetUrl).toBe("https://iranopedia.com/cuisine");
    expect(m.inclusionReason).toBe("prepared_ready");
    expect(m.preparedDraftText).toBe("The Complete Guide to Persian Cuisine");
    expect(m.preparedChecklist?.readyToReview).toBe(true);
    // No fabricated demand - honest empties.
    expect(m.demand).toBeNull();
    expect(m.score).toBe(0);
  });

  it("(f) a quality-FAILING draft is still demoted out of ready", () => {
    const m = buildReadyOrphanMove(pack(), "https://iranopedia.com/cuisine", quality("generic_rejected", false));
    expect(m.preparedStatus).toBe("ready_to_review"); // the pack still claims ready...
    expect(m.preparedChecklist?.readyToReview).toBe(false); // ...but the gate demotes it
  });

  it("a non-ready pack never reads as ready even with passing quality", () => {
    const m = buildReadyOrphanMove(
      pack({ preparedStatus: "competitors_read", structuredDraft: null }),
      "https://iranopedia.com/cuisine",
      null,
    );
    expect(m.preparedChecklist?.readyToReview).toBe(false);
  });
});
