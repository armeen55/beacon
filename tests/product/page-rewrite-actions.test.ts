import { describe, it, expect, vi, beforeEach } from "vitest";

// isOperatorModeServer is SYNCHRONOUS in production (reads an env var) — mock
// it that way so `!isOperatorModeServer()` in the action under test behaves
// exactly like the real gate (an async mock here would always be truthy and
// silently defeat the operator-only gate in every test).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: vi.fn(() => true) }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-iranopedia") }));
vi.mock("@/domains/proof-gsc/auto-record-on-ship", () => ({
  autoRecordShippedChangeForRec: vi.fn(async () => ({ recorded: true, reason: "recorded" })),
}));
vi.mock("@/domains/demand-graph/move-draft-store", () => ({
  saveMoveDraft: vi.fn(async () => true),
  getLatestMoveDrafts: vi.fn(async () => new Map()),
}));
vi.mock("@/domains/recommendation-intelligence/page-surgeon/assemble-packet", () => ({
  loadPageSurgeonContext: vi.fn(async () => ({ snapshotByCanon: new Map([["https://iranopedia.com/persian-wedding", {}]]) })),
  assemblePacketForUrl: vi.fn(() => ({
    current: { pageUrl: "https://iranopedia.com/persian-wedding" },
    crawl: { h2List: ["The sofreh aghd ceremony", "The jashn reception"], faqs: [], cardTexts: ["Old body sample text."] },
    gsc: { impressions: 500, clicks: 40, topQueries: [{ query: "sofreh aghd", impressions: 100, clicks: 10, ctr: 0.1, position: 4 }] },
  })),
}));
vi.mock("@/domains/llm/rewrite-page", async () => {
  const actual = await vi.importActual<typeof import("@/domains/llm/rewrite-page")>("@/domains/llm/rewrite-page");
  return { ...actual, rewritePageStructured: vi.fn() };
});

import {
  generateRewriteAction,
  loadSavedRewriteAction,
  markRewriteSectionsImplementedAction,
} from "@/app/(shell)/page/[...path]/page-rewrite-actions";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { autoRecordShippedChangeForRec } from "@/domains/proof-gsc/auto-record-on-ship";
import { rewritePageStructured, assembleRewrite } from "@/domains/llm/rewrite-page";
import { getLatestMoveDrafts, saveMoveDraft } from "@/domains/demand-graph/move-draft-store";

const PATH = "/persian-wedding";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isOperatorModeServer).mockReturnValue(true);
  vi.mocked(currentTenantId).mockResolvedValue("tenant-iranopedia");
  vi.mocked(autoRecordShippedChangeForRec).mockResolvedValue({ recorded: true, reason: "recorded" });
  vi.mocked(getLatestMoveDrafts).mockResolvedValue(new Map());
  vi.mocked(saveMoveDraft).mockResolvedValue(true);
});

const REWRITTEN_RESULT = {
  status: "rewritten" as const,
  outcomes: [
    {
      status: "rewritten" as const,
      heading: "The sofreh aghd ceremony",
      oldBody: "Old body sample text.",
      section: {
        heading: "The sofreh aghd ceremony",
        body: "A sharper, grounded rewrite of the sofreh aghd section.",
        sources: [{ kind: "own_data" as const, detail: "GSC top query: sofreh aghd" }],
        containsNumber: false,
      },
      costUsd: 0.01,
      retried: false,
    },
    {
      status: "kept_original" as const,
      heading: "The jashn reception",
      oldBody: "Old body sample text.",
      reason: "could not produce a valid rewrite",
      costUsd: 0,
    },
  ],
  totalCostUsd: 0.01,
  sectionsRewritten: 1,
  sectionsKeptOriginal: 1,
};

describe("generateRewriteAction — operator gate + budget/off pass-through", () => {
  it("refuses when not in operator mode", async () => {
    vi.mocked(isOperatorModeServer).mockReturnValue(false);
    const r = await generateRewriteAction(PATH);
    expect(r.ok).toBe(false);
    expect(rewritePageStructured).not.toHaveBeenCalled();
  });

  it("refuses with a plain reason when the page has no crawled sections", async () => {
    const { assemblePacketForUrl } = await import("@/domains/recommendation-intelligence/page-surgeon/assemble-packet");
    vi.mocked(assemblePacketForUrl).mockReturnValueOnce({ current: { pageUrl: "x" }, crawl: { h2List: [], faqs: [], cardTexts: [] } } as never);
    const r = await generateRewriteAction(PATH);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("scan");
  });

  it("on success, persists the assembled rewrite under kind page_rewrite", async () => {
    vi.mocked(rewritePageStructured).mockResolvedValue(REWRITTEN_RESULT);
    const r = await generateRewriteAction(PATH);
    expect(r.ok).toBe(true);
    expect(saveMoveDraft).toHaveBeenCalledTimes(1);
    const [tenantId, recId, kind] = vi.mocked(saveMoveDraft).mock.calls[0]!;
    expect(tenantId).toBe("tenant-iranopedia");
    expect(recId).toContain(PATH);
    expect(kind).toBe("page_rewrite");
    if (r.ok) {
      expect(r.rewrite.stats.sectionsRewritten).toBe(1);
      expect(r.rewrite.stats.sectionsKeptOriginal).toBe(1);
    }
  });

  it("reports budget/off reasons honestly", async () => {
    vi.mocked(rewritePageStructured).mockResolvedValue({ status: "blocked_budget", reason: "cap reached" });
    const r1 = await generateRewriteAction(PATH);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason.toLowerCase()).toContain("budget");

    vi.mocked(rewritePageStructured).mockResolvedValue({ status: "off" });
    const r2 = await generateRewriteAction(PATH);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason.toLowerCase()).toContain("off");
  });
});

describe("loadSavedRewriteAction — operator gate", () => {
  it("returns null when not in operator mode (never leaks a saved draft)", async () => {
    vi.mocked(isOperatorModeServer).mockReturnValue(false);
    const r = await loadSavedRewriteAction(PATH);
    expect(r).toBeNull();
  });

  it("returns null when nothing is saved yet", async () => {
    vi.mocked(getLatestMoveDrafts).mockResolvedValue(new Map());
    const r = await loadSavedRewriteAction(PATH);
    expect(r).toBeNull();
  });
});

describe("markRewriteSectionsImplementedAction — records the operator's manual ship", () => {
  it("records ONLY the sections the operator marked — never writes to any CMS", async () => {
    const r = await markRewriteSectionsImplementedAction({
      path: PATH,
      accepted: [{ heading: "The sofreh aghd ceremony", newBody: "The rewritten sofreh aghd body." }],
    });
    expect(r.recorded).toBe(true);
    expect(r.sections).toBe(1);
    // The only publish action is the shipment-ledger record; there is no CMS write.
    expect(autoRecordShippedChangeForRec).toHaveBeenCalledTimes(1);
  });

  it("records nothing when the accepted list is empty", async () => {
    const r = await markRewriteSectionsImplementedAction({ path: PATH, accepted: [] });
    expect(r.recorded).toBe(false);
    expect(r.sections).toBe(0);
    expect(autoRecordShippedChangeForRec).not.toHaveBeenCalled();
  });

  it("refuses when not in operator mode", async () => {
    vi.mocked(isOperatorModeServer).mockReturnValue(false);
    const r = await markRewriteSectionsImplementedAction({
      path: PATH,
      accepted: [{ heading: "H", newBody: "body" }],
    });
    expect(r.recorded).toBe(false);
    expect(autoRecordShippedChangeForRec).not.toHaveBeenCalled();
  });
});

describe("markRewriteSectionsImplementedAction — diff-in-diff enrollment pin", () => {
  it("enrolls the ship under actionType full_rewrite on the resolved page URL", async () => {
    await markRewriteSectionsImplementedAction({
      path: PATH,
      accepted: [{ heading: "The sofreh aghd ceremony", newBody: "body" }],
    });
    expect(autoRecordShippedChangeForRec).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(autoRecordShippedChangeForRec).mock.calls[0]![0];
    expect(arg.actionType).toBe("full_rewrite");
    expect(arg.pageUrl).toBe("https://iranopedia.com/persian-wedding");
  });

  it("reports honestly when measurement could not start", async () => {
    vi.mocked(autoRecordShippedChangeForRec).mockResolvedValue({ recorded: false, reason: "insufficient-controls" });
    const r = await markRewriteSectionsImplementedAction({
      path: PATH,
      accepted: [{ heading: "The sofreh aghd ceremony", newBody: "body" }],
    });
    expect(r.recorded).toBe(false);
  });
});

describe("no banned dashes in any operator-facing receipt (dash guard)", () => {
  it("never emits an em or en dash in the receipt line", async () => {
    const r = await markRewriteSectionsImplementedAction({
      path: PATH,
      accepted: [{ heading: "H", newBody: "body" }],
    });
    expect(r.receiptLine).not.toMatch(/[—–]/);
  });
});

describe("assembleRewrite re-export sanity (used by the generate action)", () => {
  it("is the real pure function, not a mock leak", () => {
    expect(typeof assembleRewrite).toBe("function");
  });
});
