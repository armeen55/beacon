/**
 * auto-measure-recrawl.test.ts (MASTER PLAN v2 N11, 2026-07-02).
 *
 * Pins the nightly-assist prioritization added to auto-measure.ts:
 *   - BEACON_GSC_SITE_URL unset ⇒ 0 spent, no attach/inspect calls at all
 *     (operator-substrate gate, same posture as load-gsc-signal.ts).
 *   - rows whose recrawl is already confirmed are never inspected.
 *   - bounded to MAX_RECRAWL_INSPECTIONS_PER_PASS, oldest-shipped-first.
 *   - a gscUrlInspect failure for one row never blocks the rest of the batch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const attachRecrawlClockForLedgerMock = vi.fn();
vi.mock("./attach-recrawl-clock", () => ({
  attachRecrawlClockForLedger: (...args: unknown[]) => attachRecrawlClockForLedgerMock(...args),
}));

const gscUrlInspectMock = vi.fn();
vi.mock("@/lib/connectors/gsc/client", () => ({
  gscUrlInspect: (...args: unknown[]) => gscUrlInspectMock(...args),
}));

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: () => ({}) }),
}));

import { __testing, MAX_RECRAWL_INSPECTIONS_PER_PASS } from "./auto-measure";
import type { ShippedChangeRecord } from "./shipped-change-store";

const NOW = new Date("2026-07-02T12:00:00Z");

function rec(id: string, shippedAt: string, page = `https://x.com/${id}`): ShippedChangeRecord {
  return {
    id,
    page,
    path: `/${id}`,
    actionType: "edit_meta",
    before: null,
    after: null,
    shippedAt,
    baseline: { clicks: 0, impressions: 0, ctr: 0, position: 0, windowDays: 28 },
    targetQueries: [],
    controlPages: [],
    windows: [],
    verdict: "measuring",
    confidence: "low",
    measuredAt: null,
    notes: null,
    verifiedLive: true,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null,
    createdAt: shippedAt,
    updatedAt: shippedAt,
  };
}

const ORIGINAL_ENV = process.env.BEACON_GSC_SITE_URL;
const ORIGINAL_TENANT_ENV = process.env.BEACON_TENANT_ID;

describe("prioritizeRecrawlInspections", () => {
  beforeEach(() => {
    attachRecrawlClockForLedgerMock.mockReset();
    gscUrlInspectMock.mockReset();
    // Tenant-isolation gate (2026-07-09): the env property only applies to
    // the tenant BEACON_TENANT_ID names, mirroring sync-search-analytics'
    // resolveProperty. Tests run as that tenant unless they say otherwise.
    process.env.BEACON_TENANT_ID = "tenant-1";
  });
  afterEach(() => {
    if (ORIGINAL_ENV == null) delete process.env.BEACON_GSC_SITE_URL;
    else process.env.BEACON_GSC_SITE_URL = ORIGINAL_ENV;
    if (ORIGINAL_TENANT_ENV == null) delete process.env.BEACON_TENANT_ID;
    else process.env.BEACON_TENANT_ID = ORIGINAL_TENANT_ENV;
  });

  it("BEACON_GSC_SITE_URL unset ⇒ 0 spent, never calls attach or inspect", async () => {
    delete process.env.BEACON_GSC_SITE_URL;
    const spent = await __testing.prioritizeRecrawlInspections("tenant-1", [rec("a", "2026-06-20")], NOW);
    expect(spent).toBe(0);
    expect(attachRecrawlClockForLedgerMock).not.toHaveBeenCalled();
    expect(gscUrlInspectMock).not.toHaveBeenCalled();
  });

  it("BEACON_GSC_SITE_URL set for a DIFFERENT tenant ⇒ 0 spent (tenant-isolation gate)", async () => {
    process.env.BEACON_GSC_SITE_URL = ["sc-domain", "example.com"].join(":");
    process.env.BEACON_TENANT_ID = "tenant-other";
    const spent = await __testing.prioritizeRecrawlInspections("tenant-1", [rec("a", "2026-06-20")], NOW);
    expect(spent).toBe(0);
    expect(attachRecrawlClockForLedgerMock).not.toHaveBeenCalled();
    expect(gscUrlInspectMock).not.toHaveBeenCalled();
  });

  it("BEACON_TENANT_ID unset ⇒ 0 spent even when the site URL is set (fail closed)", async () => {
    process.env.BEACON_GSC_SITE_URL = ["sc-domain", "example.com"].join(":");
    delete process.env.BEACON_TENANT_ID;
    const spent = await __testing.prioritizeRecrawlInspections("tenant-1", [rec("a", "2026-06-20")], NOW);
    expect(spent).toBe(0);
    expect(gscUrlInspectMock).not.toHaveBeenCalled();
  });

  it("rows with a confirmed recrawl are skipped, unconfirmed rows are inspected", async () => {
    process.env.BEACON_GSC_SITE_URL = ["sc-domain", "example.com"].join(":");
    attachRecrawlClockForLedgerMock.mockResolvedValue(
      new Map([
        ["a", { recrawlConfirmedAt: "2026-06-25T00:00:00.000Z" }], // already confirmed
        ["b", { recrawlConfirmedAt: null }], // still pending
      ]),
    );
    gscUrlInspectMock.mockResolvedValue({ url: "https://x.com/b", indexing_state: "INDEXING_ALLOWED" });

    const spent = await __testing.prioritizeRecrawlInspections(
      "tenant-1",
      [rec("a", "2026-06-20"), rec("b", "2026-06-21")],
      NOW,
    );

    expect(spent).toBe(1);
    expect(gscUrlInspectMock).toHaveBeenCalledTimes(1);
    expect(gscUrlInspectMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", inspectionUrl: "https://x.com/b" }),
    );
  });

  it("bounded to MAX_RECRAWL_INSPECTIONS_PER_PASS, oldest-shipped-first", async () => {
    process.env.BEACON_GSC_SITE_URL = ["sc-domain", "example.com"].join(":");
    const rows = Array.from({ length: MAX_RECRAWL_INSPECTIONS_PER_PASS + 5 }, (_, i) =>
      rec(`r${i}`, `2026-06-${String(10 + i).padStart(2, "0")}`),
    );
    attachRecrawlClockForLedgerMock.mockResolvedValue(
      new Map(rows.map((r) => [r.id, { recrawlConfirmedAt: null }])),
    );
    gscUrlInspectMock.mockResolvedValue({ url: "x" });

    const spent = await __testing.prioritizeRecrawlInspections("tenant-1", rows, NOW);

    expect(spent).toBe(MAX_RECRAWL_INSPECTIONS_PER_PASS);
    expect(gscUrlInspectMock).toHaveBeenCalledTimes(MAX_RECRAWL_INSPECTIONS_PER_PASS);
    // oldest-shipped-first: r0..r7 (the earliest ship dates), never r8-r12.
    const inspectedUrls = gscUrlInspectMock.mock.calls.map((c) => (c[0] as { inspectionUrl: string }).inspectionUrl);
    expect(inspectedUrls).toEqual(rows.slice(0, MAX_RECRAWL_INSPECTIONS_PER_PASS).map((r) => r.page));
  });

  it("a gscUrlInspect failure for one row never blocks the rest of the batch", async () => {
    process.env.BEACON_GSC_SITE_URL = ["sc-domain", "example.com"].join(":");
    attachRecrawlClockForLedgerMock.mockResolvedValue(
      new Map([
        ["a", { recrawlConfirmedAt: null }],
        ["b", { recrawlConfirmedAt: null }],
      ]),
    );
    gscUrlInspectMock.mockImplementation((args: { inspectionUrl: string }) =>
      args.inspectionUrl.endsWith("/a") ? Promise.reject(new Error("boom")) : Promise.resolve({ url: args.inspectionUrl }),
    );

    const spent = await __testing.prioritizeRecrawlInspections(
      "tenant-1",
      [rec("a", "2026-06-20"), rec("b", "2026-06-21")],
      NOW,
    );

    expect(spent).toBe(1); // only "b" counted; "a" failed silently
  });

  it("attachRecrawlClockForLedger throwing degrades to 0 spent, never propagates", async () => {
    process.env.BEACON_GSC_SITE_URL = ["sc-domain", "example.com"].join(":");
    attachRecrawlClockForLedgerMock.mockRejectedValue(new Error("supabase down"));

    const spent = await __testing.prioritizeRecrawlInspections("tenant-1", [rec("a", "2026-06-20")], NOW);
    expect(spent).toBe(0);
    expect(gscUrlInspectMock).not.toHaveBeenCalled();
  });
});
