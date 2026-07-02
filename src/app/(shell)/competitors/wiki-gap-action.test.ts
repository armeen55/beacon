import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: vi.fn(async () => true) }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-iranopedia") }));
vi.mock("@/domains/wiki-gap/produce-wiki-gaps", () => ({
  produceWikiGaps: vi.fn(async () => ({
    status: "ok",
    articlesFound: 14,
    articlesChecked: 14,
    beatable: 5,
    gaps: [],
    message: "I checked 14 Wikipedia articles AI cites in your space for $0: 5 are thin or stale enough to beat.",
  })),
}));

import { findWikiGapsAction } from "./wiki-gap-action";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { produceWikiGaps } from "@/domains/wiki-gap/produce-wiki-gaps";
import { revalidatePath } from "next/cache";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isOperatorModeServer).mockResolvedValue(true);
});

describe("findWikiGapsAction - gating + receipt", () => {
  it("rejects when not in operator mode (nothing runs)", async () => {
    vi.mocked(isOperatorModeServer).mockResolvedValue(false);
    const r = await findWikiGapsAction();
    expect(r.ok).toBe(false);
    expect(produceWikiGaps).not.toHaveBeenCalled();
  });

  it("operator click -> runs the bounded batch for the current tenant + returns the honest receipt", async () => {
    const r = await findWikiGapsAction();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.articlesChecked).toBe(14);
      expect(r.beatable).toBe(5);
      expect(r.message).toContain("14 Wikipedia articles");
      expect(/[–—]/.test(r.message)).toBe(false); // dash guard
    }
    expect(produceWikiGaps).toHaveBeenCalledWith("tenant-iranopedia");
    expect(revalidatePath).toHaveBeenCalledWith("/worklist");
  });

  it("does NOT revalidate surfaces when there were no citations to check", async () => {
    vi.mocked(produceWikiGaps).mockResolvedValueOnce({
      status: "no_citations",
      articlesFound: 0,
      articlesChecked: 0,
      beatable: 0,
      gaps: [],
      message: "I did not find any AI answers citing Wikipedia in your space yet.",
    });
    const r = await findWikiGapsAction();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("no_citations");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
