import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: vi.fn(async () => true) }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-iranopedia") }));
vi.mock("@/domains/serp/keyword-gap-producer", () => ({
  produceKeywordGaps: vi.fn(async () => ({
    status: "ok",
    competitors: ["supplehomes.com"],
    ownDomain: "iranopedia.com",
    calls: [],
    spentUsd: 0.44,
    plannedUsd: 0,
    cacheHits: 2,
    gapsFound: 61,
    gaps: [],
    moneyPagesFound: 8,
    cloneBriefs: [],
    message: "I checked 3 competitors on Google's index for $0.44 and found 61 keywords they win that you do not.",
  })),
}));

import { findCompetitorKeywordGapsAction } from "./keyword-gap-action";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { produceKeywordGaps } from "@/domains/serp/keyword-gap-producer";
import { revalidatePath } from "next/cache";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isOperatorModeServer).mockResolvedValue(true);
});

describe("findCompetitorKeywordGapsAction - gating + receipt", () => {
  it("rejects when not in operator mode (nothing runs, nothing spends)", async () => {
    vi.mocked(isOperatorModeServer).mockResolvedValue(false);
    const r = await findCompetitorKeywordGapsAction();
    expect(r.ok).toBe(false);
    expect(produceKeywordGaps).not.toHaveBeenCalled();
  });

  it("operator click -> runs the bounded batch for the current tenant + returns the honest receipt", async () => {
    const r = await findCompetitorKeywordGapsAction();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spentUsd).toBe(0.44);
      expect(r.gapsFound).toBe(61);
      expect(r.message).toContain("$0.44");
      expect(/[–—]/.test(r.message)).toBe(false); // dash guard
    }
    expect(produceKeywordGaps).toHaveBeenCalledWith("tenant-iranopedia");
    expect(revalidatePath).toHaveBeenCalledWith("/changes");
  });

  it("does NOT revalidate surfaces on a dry-run plan (no new data landed)", async () => {
    vi.mocked(produceKeywordGaps).mockResolvedValueOnce({
      status: "dry_run",
      competitors: ["supplehomes.com"],
      ownDomain: "iranopedia.com",
      calls: [],
      spentUsd: 0,
      plannedUsd: 0.66,
      cacheHits: 0,
      gapsFound: 0,
      gaps: [],
      moneyPagesFound: 0,
      cloneBriefs: [],
      message: "Dry run only, I spent nothing.",
    });
    const r = await findCompetitorKeywordGapsAction();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("dry_run");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
