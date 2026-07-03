import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: vi.fn(async () => true) }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-iranopedia") }));

const buildRetrievalIndexMock = vi.fn();
vi.mock("@/domains/retrieval-twin/build-index", () => ({
  buildRetrievalIndex: (...args: unknown[]) => buildRetrievalIndexMock(...args),
}));

const buildCitationLikelihoodReportMock = vi.fn();
vi.mock("@/domains/retrieval-twin/citation-likelihood", () => ({
  buildCitationLikelihoodReport: (...args: unknown[]) => buildCitationLikelihoodReportMock(...args),
}));

vi.mock("@/domains/demand-graph/competitor-page-audit", () => ({
  getCompetitorAuditsForTenant: vi.fn(async () => new Map([["https://wikipedia.org/nowruz", { fetchStatus: "ok", url: "https://wikipedia.org/nowruz" }]])),
}));

vi.mock("@/domains/demand-graph/load-graph", () => ({
  loadDemandGraphForTenantCached: vi.fn(async () => ({
    graph: { pageNodes: [{ url: "https://iranopedia.com/nowruz", isOwned: true }] },
  })),
}));

import { checkAnswerRaceAction } from "./retrieval-twin-action";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { revalidatePath } from "next/cache";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isOperatorModeServer).mockResolvedValue(true);
});

describe("checkAnswerRaceAction - gating + receipt", () => {
  it("rejects when not in operator mode (nothing runs)", async () => {
    vi.mocked(isOperatorModeServer).mockResolvedValue(false);
    const r = await checkAnswerRaceAction();
    expect(r.ok).toBe(false);
    expect(buildRetrievalIndexMock).not.toHaveBeenCalled();
  });

  it("operator click -> runs the bounded index for the current tenant + returns the honest receipt", async () => {
    buildRetrievalIndexMock.mockResolvedValue({
      status: "ok",
      chunksEmbedded: 42,
      cacheHits: 10,
      spentUsd: 0.008,
      message: "I indexed 20 of your pages and 5 competitor pages into 42 passages (30 yours, 12 competitor) for $0.0080. 10 passages came from my cache at no extra cost.",
    });
    buildCitationLikelihoodReportMock.mockResolvedValue({
      questions: [{ sentence: "For \"what is nowruz\", your page's best passage ranks 3rd of 8. The passage to beat is wikipedia.org's passage." }],
    });
    const r = await checkAnswerRaceAction();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("ok");
      expect(r.chunksEmbedded).toBe(42);
      expect(r.spentUsd).toBe(0.008);
      expect(r.exampleSentence).toContain("what is nowruz");
      expect(/[–—]/.test(r.message)).toBe(false); // dash guard
      expect(r.exampleSentence && /[–—]/.test(r.exampleSentence)).toBe(false);
    }
    expect(buildRetrievalIndexMock).toHaveBeenCalledWith("tenant-iranopedia");
    expect(revalidatePath).toHaveBeenCalledWith("/worklist");
  });

  it("does NOT revalidate surfaces when there was no content to index", async () => {
    buildRetrievalIndexMock.mockResolvedValue({
      status: "no_content",
      chunksEmbedded: 0,
      cacheHits: 0,
      spentUsd: 0,
      message: "I do not have enough owned pages or competitor teardowns indexed yet to build the answer-race index.",
    });
    const r = await checkAnswerRaceAction();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("no_content");
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(buildCitationLikelihoodReportMock).not.toHaveBeenCalled();
  });

  it("never throws when the example report step fails - the index receipt still returns", async () => {
    buildRetrievalIndexMock.mockResolvedValue({ status: "ok", chunksEmbedded: 5, cacheHits: 0, spentUsd: 0.001, message: "ok" });
    buildCitationLikelihoodReportMock.mockRejectedValue(new Error("boom"));
    const r = await checkAnswerRaceAction();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.exampleSentence).toBeNull();
  });
});
