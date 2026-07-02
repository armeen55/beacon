import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock every I/O boundary; keep validateCreatePage + winnability math real.
vi.mock("@/domains/demand-graph/load-graph", () => ({ loadDemandGraphForTenant: vi.fn() }));
vi.mock("@/domains/demand-graph/move-draft-store", () => ({
  saveMoveDraft: vi.fn(async () => true),
  getLatestMoveDrafts: vi.fn(async () => new Map()),
}));
vi.mock("./dataforseo-serp", () => ({ runSerpQuery: vi.fn() }));
vi.mock("./dataforseo-keywords", () => ({ readAllCachedKeywordDemand: vi.fn(async () => []) }));
vi.mock("@/domains/llm/structured-drafter", () => ({ draftCreatePageStructured: vi.fn(async () => ({ status: "off" })) }));
vi.mock("./dataforseo-labs", () => ({
  runBulkKeywordDifficulty: vi.fn(),
  runBulkDomainRanks: vi.fn(),
  runBacklinksSummary: vi.fn(),
}));

import { prepareCreatePageVerdicts, parsePreparedVerdict } from "./prepare-create-page-verdicts";
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";
import { runSerpQuery } from "./dataforseo-serp";
import { runBulkKeywordDifficulty, runBulkDomainRanks, runBacklinksSummary } from "./dataforseo-labs";

type Move = {
  demandKey: string;
  label: string;
  gap: string;
  components: { demand: number };
  competitorUrls: string[];
  aeoEvidence?: { fanoutQueries?: string[]; prompts?: string[] };
};

function move(label: string, demandKey = label): Move {
  return { demandKey, label, gap: "create_page", components: { demand: 10 }, competitorUrls: [] };
}

const CONTENT_SNAPSHOT = (query: string) => ({
  query,
  results: [
    { rank: 1, domain: "theknot.com", url: "https://theknot.com/x", title: "x" },
    { rank: 2, domain: "brides.com", url: "https://brides.com/y", title: "y" },
    { rank: 3, domain: "history.com", url: "https://history.com/z", title: "z" },
    { rank: 4, domain: "wikipedia.org", url: "https://wikipedia.org/w", title: "w" },
    { rank: 5, domain: "vogue.com", url: "https://vogue.com/v", title: "v" },
  ],
  features: [],
  source: "dataforseo" as const,
  fetchedAt: "2026-07-02T00:00:00Z",
});

function serpOk(query: string) {
  return { status: "ok" as const, plan: {} as never, snapshot: CONTENT_SNAPSHOT(query), costUsd: 0.003, detail: "ok" };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadDemandGraphForTenant).mockResolvedValue({
    graph: {
      pageNodes: [{ url: "https://iranopedia.com/home", isOwned: true, gscImpressions: 500 }],
      moves: [move("persian wedding sofreh")],
    },
  } as never);
  vi.mocked(runSerpQuery).mockImplementation(async (q: string) => serpOk(q) as never);
  vi.mocked(runBulkKeywordDifficulty).mockResolvedValue({ status: "dry_run", plan: {} as never, rows: [], costUsd: 0, detail: "dry" } as never);
  vi.mocked(runBulkDomainRanks).mockResolvedValue({ status: "dry_run", plan: {} as never, rows: [], costUsd: 0, detail: "dry" } as never);
  vi.mocked(runBacklinksSummary).mockResolvedValue({ status: "dry_run", plan: {} as never, rows: [], costUsd: 0, detail: "dry" } as never);
});

describe("prepareCreatePageVerdicts + winnability integration (item 18)", () => {
  it("BATCHES difficulty/domain-rank/backlinks reads ONCE per run, not per candidate", async () => {
    vi.mocked(loadDemandGraphForTenant).mockResolvedValue({
      graph: {
        pageNodes: [{ url: "https://iranopedia.com/home", isOwned: true, gscImpressions: 500 }],
        moves: [move("persian wedding sofreh"), move("persian tea culture")],
      },
    } as never);
    await prepareCreatePageVerdicts("tenant-iranopedia", { skipBriefs: true });
    expect(runBulkKeywordDifficulty).toHaveBeenCalledTimes(1);
    expect(runBulkDomainRanks).toHaveBeenCalledTimes(1);
    expect(runBacklinksSummary).toHaveBeenCalledTimes(1);
    // Both candidate labels went in ONE difficulty call.
    const [keywords] = vi.mocked(runBulkKeywordDifficulty).mock.calls[0];
    expect(keywords).toEqual(expect.arrayContaining(["persian wedding sofreh", "persian tea culture"]));
  });

  it("no winnability reads when there are no candidates (never calls the batched reads on empty runs)", async () => {
    vi.mocked(loadDemandGraphForTenant).mockResolvedValue({
      graph: { pageNodes: [], moves: [] },
    } as never);
    await prepareCreatePageVerdicts("tenant-iranopedia", { skipBriefs: true });
    expect(runBulkKeywordDifficulty).not.toHaveBeenCalled();
    expect(runBulkDomainRanks).not.toHaveBeenCalled();
    expect(runBacklinksSummary).not.toHaveBeenCalled();
  });

  it("dry-run/no-data reads leave the verdict SERP-shape-only (unchanged from pre-item-18 behavior)", async () => {
    const summary = await prepareCreatePageVerdicts("tenant-iranopedia", { skipBriefs: true, now: () => new Date("2026-07-02T00:00:00Z") });
    expect(summary.winnabilityCostUsd).toBe(0);
    const [, , , content] = vi.mocked(saveMoveDraft).mock.calls[0];
    const persisted = parsePreparedVerdict(content as string);
    expect(persisted?.verdict).toBe("build"); // content SERP, no arithmetic downgrade
    expect(persisted?.winnability).toBeUndefined();
  });

  it("a HARD difficulty read downgrades the persisted verdict from build to wait, with the number in the reason", async () => {
    vi.mocked(runBulkKeywordDifficulty).mockResolvedValue({
      status: "ok",
      plan: {} as never,
      rows: [{ keyword: "persian wedding sofreh", difficulty: 78 }],
      costUsd: 0.05,
      detail: "1 rows",
    } as never);
    const summary = await prepareCreatePageVerdicts("tenant-iranopedia", { skipBriefs: true });
    expect(summary.winnabilityCostUsd).toBeCloseTo(0.05);
    const [, , , content] = vi.mocked(saveMoveDraft).mock.calls[0];
    const persisted = parsePreparedVerdict(content as string);
    expect(persisted?.verdict).toBe("wait");
    expect(persisted?.winnability?.band).toBe("hard");
    expect(persisted?.reason).toMatch(/78 of 100 difficulty/);
  });

  it("a REJECT-band difficulty read downgrades the persisted verdict to reject", async () => {
    vi.mocked(runBulkKeywordDifficulty).mockResolvedValue({
      status: "ok",
      plan: {} as never,
      rows: [{ keyword: "persian wedding sofreh", difficulty: 91 }],
      costUsd: 0.05,
      detail: "1 rows",
    } as never);
    const summary = await prepareCreatePageVerdicts("tenant-iranopedia", { skipBriefs: true });
    const [, , , content] = vi.mocked(saveMoveDraft).mock.calls[0];
    const persisted = parsePreparedVerdict(content as string);
    expect(persisted?.verdict).toBe("reject");
    expect(persisted?.winnability?.band).toBe("reject");
    expect(summary.skipped).toBe(0); // still a real, persisted verdict (not a skip)
  });

  it("domain ranks + backlinks reads feed the same arithmetic (their-avg vs your-count cited in the sentence)", async () => {
    vi.mocked(runBulkDomainRanks).mockResolvedValue({
      status: "ok",
      plan: {} as never,
      rows: [
        { domain: "theknot.com", rank: 40 },
        { domain: "brides.com", rank: 35 },
        { domain: "history.com", rank: 30 },
      ],
      costUsd: 0.05,
      detail: "3 rows",
    } as never);
    vi.mocked(runBacklinksSummary).mockResolvedValue({
      status: "ok",
      plan: {} as never,
      rows: [
        { url: "https://theknot.com/x", referringDomains: 210, backlinks: 900 },
        { url: "https://iranopedia.com/home", referringDomains: 3, backlinks: 10 },
      ],
      costUsd: 0.05,
      detail: "2 rows",
    } as never);
    await prepareCreatePageVerdicts("tenant-iranopedia", { skipBriefs: true });
    const [, , , content] = vi.mocked(saveMoveDraft).mock.calls[0];
    const persisted = parsePreparedVerdict(content as string);
    expect(persisted?.winnability).toBeDefined();
    expect(persisted?.reason).toMatch(/linking domains/);
  });

  it("never emits an em or en dash in the persisted reason (dash guard)", async () => {
    vi.mocked(runBulkKeywordDifficulty).mockResolvedValue({
      status: "ok",
      plan: {} as never,
      rows: [{ keyword: "persian wedding sofreh", difficulty: 82 }],
      costUsd: 0.05,
      detail: "1 rows",
    } as never);
    await prepareCreatePageVerdicts("tenant-iranopedia", { skipBriefs: true });
    const [, , , content] = vi.mocked(saveMoveDraft).mock.calls[0];
    const persisted = parsePreparedVerdict(content as string);
    expect(persisted?.reason ?? "").not.toMatch(/[–—]/);
  });
});
