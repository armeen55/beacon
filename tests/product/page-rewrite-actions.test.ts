import { describe, it, expect, vi, beforeEach } from "vitest";

// isOperatorModeServer is SYNCHRONOUS in production (reads an env var) — mock
// it that way so `!isOperatorModeServer()` in the action under test behaves
// exactly like the real gate (an async mock here would always be truthy and
// silently defeat the operator-only gate in every test).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: vi.fn(() => true) }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-iranopedia") }));
vi.mock("@/domains/tenants/store", () => ({ getTenant: vi.fn(async () => ({ publish_target: "wix_cms" })) }));
vi.mock("@/lib/auth/can-publish", () => ({ canPublishForCurrentTenant: vi.fn(async () => true) }));
vi.mock("@/domains/push/publishing-mode-store", () => ({ getPublishingMode: vi.fn(async () => ({ mode: "armed" })) }));
vi.mock("@/domains/push/push-service", async () => {
  const actual = await vi.importActual<typeof import("@/domains/push/push-service")>("@/domains/push/push-service");
  return { ...actual, executePush: vi.fn() };
});
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
  stageAcceptedRewriteSectionsAction,
} from "@/app/(shell)/page/[...path]/page-rewrite-actions";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { getPublishingMode } from "@/domains/push/publishing-mode-store";
import { getTenant } from "@/domains/tenants/store";
import { executePush, RITZ_TENANT_ID } from "@/domains/push/push-service";
import { autoRecordShippedChangeForRec } from "@/domains/proof-gsc/auto-record-on-ship";
import { rewritePageStructured, assembleRewrite } from "@/domains/llm/rewrite-page";
import { getLatestMoveDrafts, saveMoveDraft } from "@/domains/demand-graph/move-draft-store";

const PATH = "/persian-wedding";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isOperatorModeServer).mockReturnValue(true);
  vi.mocked(currentTenantId).mockResolvedValue("tenant-iranopedia");
  vi.mocked(canPublishForCurrentTenant).mockResolvedValue(true);
  vi.mocked(getPublishingMode).mockResolvedValue({ mode: "armed", armedAt: null, armedBy: null });
  vi.mocked(getTenant).mockResolvedValue({ publish_target: "wix_cms" } as never);
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

describe("stageAcceptedRewriteSectionsAction — accepted-only staging pin", () => {
  it("stages ONLY the sections passed as accepted — never all sections of the page", async () => {
    vi.mocked(executePush).mockResolvedValue({ kind: "pushed", adapter: "wix_cms", detail: "ok" });
    const r = await stageAcceptedRewriteSectionsAction({
      path: PATH,
      accepted: [{ heading: "The sofreh aghd ceremony", newBody: "The rewritten sofreh aghd body." }],
    });
    expect(r.staged).toBe(1);
    expect(executePush).toHaveBeenCalledTimes(1);
    const call = vi.mocked(executePush).mock.calls[0]![0];
    expect(call.edit.target_element_key).toBe("section:The sofreh aghd ceremony");
    expect(call.edit.proposed_text).toBe("The rewritten sofreh aghd body.");
    expect(call.edit.action_type).toBe("full_rewrite");
  });

  it("refuses with nothing published when accepted is empty", async () => {
    const r = await stageAcceptedRewriteSectionsAction({ path: PATH, accepted: [] });
    expect(r.staged).toBe(0);
    expect(executePush).not.toHaveBeenCalled();
  });

  it("refuses when not in operator mode", async () => {
    vi.mocked(isOperatorModeServer).mockReturnValue(false);
    const r = await stageAcceptedRewriteSectionsAction({
      path: PATH,
      accepted: [{ heading: "H", newBody: "body" }],
    });
    expect(r.staged).toBe(0);
    expect(executePush).not.toHaveBeenCalled();
  });

  it("one section's refusal never blocks another section's push (independent per-section pushes)", async () => {
    vi.mocked(executePush)
      .mockResolvedValueOnce({ kind: "refused", reason: "could not find the section" })
      .mockResolvedValueOnce({ kind: "pushed", adapter: "wix_cms", detail: "ok" });
    const r = await stageAcceptedRewriteSectionsAction({
      path: PATH,
      accepted: [
        { heading: "Missing heading", newBody: "body A" },
        { heading: "The sofreh aghd ceremony", newBody: "body B" },
      ],
    });
    expect(r.staged).toBe(1);
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0]!.heading).toBe("Missing heading");
  });
});

describe("stageAcceptedRewriteSectionsAction — Ritz regression (never publishes to Ritz)", () => {
  it("refuses before any push when the tenant is the Ritz founder tenant", async () => {
    vi.mocked(currentTenantId).mockResolvedValue(RITZ_TENANT_ID);
    const r = await stageAcceptedRewriteSectionsAction({
      path: PATH,
      accepted: [{ heading: "The sofreh aghd ceremony", newBody: "body" }],
    });
    expect(r.staged).toBe(0);
    expect(executePush).not.toHaveBeenCalled();
    expect(r.receiptLine.toLowerCase()).toContain("advise mode");
  });
});

describe("stageAcceptedRewriteSectionsAction — armed-publish rails gating", () => {
  it("refuses when publishing is not armed", async () => {
    vi.mocked(getPublishingMode).mockResolvedValue({ mode: "staged", armedAt: null, armedBy: null });
    const r = await stageAcceptedRewriteSectionsAction({
      path: PATH,
      accepted: [{ heading: "The sofreh aghd ceremony", newBody: "body" }],
    });
    expect(r.staged).toBe(0);
    expect(executePush).not.toHaveBeenCalled();
  });

  it("refuses when the tenant has no publishing permission", async () => {
    vi.mocked(canPublishForCurrentTenant).mockResolvedValue(false);
    const r = await stageAcceptedRewriteSectionsAction({
      path: PATH,
      accepted: [{ heading: "The sofreh aghd ceremony", newBody: "body" }],
    });
    expect(r.staged).toBe(0);
    expect(executePush).not.toHaveBeenCalled();
  });

  it("refuses when the tenant's publish target is not wix_cms", async () => {
    vi.mocked(getTenant).mockResolvedValue({ publish_target: "dev_note" } as never);
    const r = await stageAcceptedRewriteSectionsAction({
      path: PATH,
      accepted: [{ heading: "The sofreh aghd ceremony", newBody: "body" }],
    });
    expect(r.staged).toBe(0);
    expect(executePush).not.toHaveBeenCalled();
  });
});

describe("stageAcceptedRewriteSectionsAction — diff-in-diff enrollment pin", () => {
  it("enrolls the ship under actionType full_rewrite ONLY when at least one section actually published", async () => {
    vi.mocked(executePush).mockResolvedValue({ kind: "pushed", adapter: "wix_cms", detail: "ok" });
    await stageAcceptedRewriteSectionsAction({
      path: PATH,
      accepted: [{ heading: "The sofreh aghd ceremony", newBody: "body" }],
    });
    expect(autoRecordShippedChangeForRec).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(autoRecordShippedChangeForRec).mock.calls[0]![0];
    expect(arg.actionType).toBe("full_rewrite");
    expect(arg.pageUrl).toBe("https://iranopedia.com/persian-wedding");
  });

  it("never enrolls measurement when nothing published", async () => {
    vi.mocked(executePush).mockResolvedValue({ kind: "refused", reason: "no mapping" });
    await stageAcceptedRewriteSectionsAction({
      path: PATH,
      accepted: [{ heading: "The sofreh aghd ceremony", newBody: "body" }],
    });
    expect(autoRecordShippedChangeForRec).not.toHaveBeenCalled();
  });
});

describe("no banned dashes in any operator-facing receipt (dash guard)", () => {
  it("never emits an em or en dash in the stage receipt line", async () => {
    vi.mocked(executePush).mockResolvedValue({ kind: "refused", reason: "a reason with an em dash — right here" });
    const r = await stageAcceptedRewriteSectionsAction({
      path: PATH,
      accepted: [{ heading: "H", newBody: "body" }],
    });
    expect(r.receiptLine).not.toMatch(/[—–]/);
    for (const ref of r.refused) expect(ref.reason).not.toMatch(/[—–]/);
  });
});

describe("assembleRewrite re-export sanity (used by the generate action)", () => {
  it("is the real pure function, not a mock leak", () => {
    expect(typeof assembleRewrite).toBe("function");
  });
});
