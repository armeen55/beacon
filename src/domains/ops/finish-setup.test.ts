import { describe, it, expect, vi, beforeEach } from "vitest";

type ConnInfo = { status: "connected" | "disconnected" };

let wixInfo: ConnInfo = { status: "disconnected" };
let wixMap: Array<{ url: string }> = [];
let indexNowConfig: unknown = null;
let businessConfig: { revenueModel?: unknown } = {};
let gscReadiness: { property: string | null } = { property: null };
let backfillProgress: { status: "in_progress" | "complete" } | null = null;
let envDigestTo = "";
let envResendKey = "";

vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: async () => wixInfo,
}));
vi.mock("@/lib/connectors/wix/url-map", () => ({
  getWixUrlMap: async () => wixMap,
}));
vi.mock("@/lib/connectors/indexnow/config-store", () => ({
  getIndexNowConfig: async () => indexNowConfig,
}));
vi.mock("@/lib/business-config", () => ({
  getBusinessConfigForCurrentTenant: async () => businessConfig,
}));
vi.mock("@/lib/connectors/gsc/readiness", () => ({
  loadGscReadiness: async () => gscReadiness,
}));
vi.mock("@/lib/connectors/gsc/deep-backfill", () => ({
  readBackfillProgress: async () => backfillProgress,
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-test",
}));

import { loadFinishSetupChecklist } from "./finish-setup";

beforeEach(() => {
  wixInfo = { status: "disconnected" };
  wixMap = [];
  indexNowConfig = null;
  businessConfig = {};
  gscReadiness = { property: null };
  backfillProgress = null;
  envDigestTo = "";
  envResendKey = "";
  vi.stubEnv("BEACON_DIGEST_TO", envDigestTo);
  vi.stubEnv("RESEND_API_KEY", envResendKey);
});

describe("loadFinishSetupChecklist", () => {
  it("everything undone (including prerequisites met): returns all 5 items", async () => {
    // wix_page_mapping and gsc_full_backfill only apply once their prerequisite
    // exists (Wix connected; GSC has a resolved property) - set those so this
    // test genuinely exercises "everything is undone", not "nothing applies yet".
    wixInfo = { status: "connected" };
    gscReadiness = { property: "https://www.example.com/" };
    const items = await loadFinishSetupChecklist();
    const kinds = items.map((i) => i.kind).sort();
    expect(kinds).toEqual(
      ["digest_email", "gsc_full_backfill", "indexnow_key", "revenue_model", "wix_page_mapping"].sort(),
    );
  });

  it("with no prerequisites met yet, only the unconditional items show", async () => {
    // Default fixtures: Wix disconnected, GSC has no resolved property.
    const items = await loadFinishSetupChecklist();
    const kinds = items.map((i) => i.kind).sort();
    expect(kinds).toEqual(["digest_email", "indexnow_key", "revenue_model"].sort());
  });

  it("wix_page_mapping self-hides when Wix isn't connected (nothing to map yet)", async () => {
    wixInfo = { status: "disconnected" };
    const items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "wix_page_mapping")).toBeUndefined();
  });

  it("wix_page_mapping shows when Wix is connected but the url map is empty", async () => {
    wixInfo = { status: "connected" };
    wixMap = [];
    const items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "wix_page_mapping")).toBeDefined();
  });

  it("wix_page_mapping hides once the url map has rows", async () => {
    wixInfo = { status: "connected" };
    wixMap = [{ url: "/example" }];
    const items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "wix_page_mapping")).toBeUndefined();
  });

  it("digest_email hides once BOTH env names are present", async () => {
    vi.stubEnv("BEACON_DIGEST_TO", "owner@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_abc123");
    const items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "digest_email")).toBeUndefined();
  });

  it("digest_email still shows when only one of the two env vars is set", async () => {
    vi.stubEnv("BEACON_DIGEST_TO", "owner@example.com");
    vi.stubEnv("RESEND_API_KEY", "");
    const items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "digest_email")).toBeDefined();
  });

  it("indexnow_key hides once a config row exists", async () => {
    indexNowConfig = { key: "abc", connected_at: "2026-07-01T00:00:00.000Z" };
    const items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "indexnow_key")).toBeUndefined();
  });

  it("gsc_full_backfill self-hides when GSC has no resolved property yet", async () => {
    gscReadiness = { property: null };
    const items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "gsc_full_backfill")).toBeUndefined();
  });

  it("gsc_full_backfill shows when a property exists but backfill never started", async () => {
    gscReadiness = { property: "https://www.example.com/" };
    backfillProgress = null;
    const items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "gsc_full_backfill")).toBeDefined();
  });

  it("gsc_full_backfill shows while in_progress, hides once complete", async () => {
    gscReadiness = { property: "https://www.example.com/" };
    backfillProgress = { status: "in_progress" };
    let items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "gsc_full_backfill")).toBeDefined();

    backfillProgress = { status: "complete" };
    items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "gsc_full_backfill")).toBeUndefined();
  });

  it("revenue_model hides once a revenueModel is configured", async () => {
    businessConfig = { revenueModel: { kind: "rpm", rpmUsd: 5 } };
    const items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "revenue_model")).toBeUndefined();
  });

  it("everything done: returns an empty checklist (the card self-hides)", async () => {
    wixInfo = { status: "connected" };
    wixMap = [{ url: "/example" }];
    vi.stubEnv("BEACON_DIGEST_TO", "owner@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_abc123");
    indexNowConfig = { key: "abc", connected_at: "2026-07-01T00:00:00.000Z" };
    gscReadiness = { property: "https://www.example.com/" };
    backfillProgress = { status: "complete" };
    businessConfig = { revenueModel: { kind: "rpm", rpmUsd: 5 } };
    const items = await loadFinishSetupChecklist();
    expect(items).toEqual([]);
  });

  it("a read failure on one item counts it as not-done rather than crashing the whole checklist", async () => {
    // getBusinessConfigForCurrentTenant throws -> revenue_model item stays visible (fail-soft).
    vi.mocked(await import("@/lib/business-config")).getBusinessConfigForCurrentTenant = vi
      .fn()
      .mockRejectedValue(new Error("boom"));
    const items = await loadFinishSetupChecklist();
    expect(items.find((i) => i.kind === "revenue_model")).toBeDefined();
  });
});
