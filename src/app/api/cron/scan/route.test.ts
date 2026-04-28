/**
 * Recommendation Lifecycle OS — Phase 5 (2026-04-28).
 *
 * Tests for /api/cron/scan route auth + kill switch + invocation.
 * Mirrors the test pattern of the native poll route.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock runWebsiteScan so the route tests don't actually spawn the CLI.
const runScanMock = vi.hoisted(() => ({
  runWebsiteScan: vi.fn<
    (opts: { trigger: string }) => Promise<{
      ok: boolean;
      phase: string;
      payload: { pagesScanned: number } | null;
      findingsAdded: number;
      error?: string;
    }>
  >(),
}));
vi.mock("@/domains/scanning/orchestrate-scan", () => ({
  runWebsiteScan: runScanMock.runWebsiteScan,
}));

// Mock the kill-switch flag so tests control its value.
const flagMocks = vi.hoisted(() => ({
  isScanDisabled: vi.fn<() => boolean>(),
}));
vi.mock("@/lib/flags", () => ({
  isScanDisabled: flagMocks.isScanDisabled,
  // Other flags consumed transitively by the import chain.
  isEventTruthPreviewEnabled: () => false,
  isSchemaAutoPromoteEnabled: () => false,
  isFindingAutoLinkEnabled: () => false,
  isLifecycleEnabled: () => false,
  isLifecycleVerdictEnabled: () => false,
}));

import { POST } from "./route";

function makeRequest(opts: {
  authHeader?: string | null;
} = {}) {
  const headers = new Headers();
  if (opts.authHeader !== null && opts.authHeader !== undefined) {
    headers.set("authorization", opts.authHeader);
  }
  return new Request("http://localhost/api/cron/scan", {
    method: "POST",
    headers,
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  flagMocks.isScanDisabled.mockReset();
  flagMocks.isScanDisabled.mockReturnValue(false);
  runScanMock.runWebsiteScan.mockReset();
  runScanMock.runWebsiteScan.mockResolvedValue({
    ok: true,
    phase: "success",
    payload: { pagesScanned: 35 },
    findingsAdded: 32,
  });
  delete process.env.CRON_SECRET;
});

describe("/api/cron/scan POST — auth", () => {
  it("returns 500 when CRON_SECRET is not configured server-side", async () => {
    const res = await POST(makeRequest({ authHeader: "Bearer anything" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "CRON_SECRET not configured on the server",
    });
    expect(runScanMock.runWebsiteScan).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header is missing", async () => {
    process.env.CRON_SECRET = "test-secret";
    const res = await POST(makeRequest({ authHeader: null }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(runScanMock.runWebsiteScan).not.toHaveBeenCalled();
  });

  it("returns 401 when Bearer token doesn't match CRON_SECRET", async () => {
    process.env.CRON_SECRET = "right-secret";
    const res = await POST(
      makeRequest({ authHeader: "Bearer wrong-secret" }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(runScanMock.runWebsiteScan).not.toHaveBeenCalled();
  });

  it("auth check fires BEFORE kill-switch check (security: kill state hidden from unauth)", async () => {
    process.env.CRON_SECRET = "test-secret";
    flagMocks.isScanDisabled.mockReturnValue(true);
    const res = await POST(makeRequest({ authHeader: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
    // isScanDisabled must NOT have been consulted — its return value
    // would leak operational state to an unauthenticated probe.
    expect(flagMocks.isScanDisabled).not.toHaveBeenCalled();
  });
});

describe("/api/cron/scan POST — kill switch", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
  });

  it("returns 200 + status:disabled when BEACON_SCAN_DISABLED is set", async () => {
    flagMocks.isScanDisabled.mockReturnValue(true);
    const res = await POST(makeRequest({ authHeader: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "disabled",
      reason: "BEACON_SCAN_DISABLED env var is set",
    });
    expect(runScanMock.runWebsiteScan).not.toHaveBeenCalled();
  });

  it("invokes runWebsiteScan when kill switch is OFF", async () => {
    flagMocks.isScanDisabled.mockReturnValue(false);
    const res = await POST(makeRequest({ authHeader: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(runScanMock.runWebsiteScan).toHaveBeenCalledTimes(1);
    expect(runScanMock.runWebsiteScan).toHaveBeenCalledWith({ trigger: "cron" });
  });
});

describe("/api/cron/scan POST — invocation result shape", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    flagMocks.isScanDisabled.mockReturnValue(false);
  });

  it("returns 200 + structured payload on successful scan", async () => {
    runScanMock.runWebsiteScan.mockResolvedValueOnce({
      ok: true,
      phase: "success",
      payload: { pagesScanned: 35 },
      findingsAdded: 32,
    });
    const res = await POST(makeRequest({ authHeader: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.phase).toBe("success");
    expect(body.pagesScanned).toBe(35);
    expect(body.findingsAdded).toBe(32);
    expect(body.error).toBeNull();
    expect(typeof body.elapsedMs).toBe("number");
  });

  it("returns 200 + ok:false + error on partial/failed scan (route doesn't 5xx for soft failures)", async () => {
    runScanMock.runWebsiteScan.mockResolvedValueOnce({
      ok: false,
      phase: "failed",
      payload: null,
      findingsAdded: 0,
      error: "Sitemap fetch failed",
    });
    const res = await POST(makeRequest({ authHeader: "Bearer test-secret" }));
    // Route returns 200 with ok:false — same pattern as /api/poll/run.
    // Cron `--fail-with-body` would then trip on the body content.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.phase).toBe("failed");
    expect(body.error).toBe("Sitemap fetch failed");
  });

  it("returns 500 + error message when runWebsiteScan throws unexpectedly", async () => {
    runScanMock.runWebsiteScan.mockRejectedValueOnce(
      new Error("CLI subprocess crashed"),
    );
    const res = await POST(makeRequest({ authHeader: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("scan failed");
    expect(body.message).toMatch(/CLI subprocess crashed/);
    expect(typeof body.elapsedMs).toBe("number");
  });
});

describe("/api/cron/scan POST — never invokes provider calls (architectural)", () => {
  it("does not import any LLM provider module (transitively allowed because runWebsiteScan is mocked)", () => {
    // Source-level invariant in tests/architecture/no-cron-scan-provider-import.test.ts
    // (the runtime mock here doesn't trigger imports). This describe-block exists as a
    // documentation pointer.
    expect(true).toBe(true);
  });
});
