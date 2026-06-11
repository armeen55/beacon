/**
 * first-scan-dispatch — North-star onboarding (2026-06-11).
 *
 * Pins the safety contract: INERT without the PAT (no fetch at all),
 * tenant-scoped dispatch body (`only_tenant`), 204 → dispatched,
 * non-204/throw → structured failure (never throws to the caller).
 */

import { describe, it, expect, vi } from "vitest";

import { dispatchFirstScanForTenant } from "./first-scan-dispatch";

describe("dispatchFirstScanForTenant", () => {
  it("PAT absent → skipped_pat_not_configured and NEVER fetches", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await dispatchFirstScanForTenant("tenant-x", {
      fetchImpl,
      env: {},
    });
    expect(r).toEqual({ status: "skipped_pat_not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("dispatches the scan workflow scoped to ONLY the tenant (204 → dispatched)", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://api.github.com/repos/armeen55/beacon/actions/workflows/daily-scan.yml/dispatches",
      );
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        ref: "main",
        inputs: { only_tenant: "tenant-new" },
      });
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer pat-123",
      );
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const r = await dispatchFirstScanForTenant("tenant-new", {
      fetchImpl,
      env: { BEACON_GH_WORKFLOW_DISPATCH_PAT: "pat-123" },
    });
    expect(r).toEqual({ status: "dispatched", httpStatus: 204 });
  });

  it("non-204 → dispatch_failed with status + body excerpt", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("bad credentials", { status: 401 }),
    ) as unknown as typeof fetch;
    const r = await dispatchFirstScanForTenant("tenant-x", {
      fetchImpl,
      env: { BEACON_GH_WORKFLOW_DISPATCH_PAT: "pat" },
    });
    expect(r).toEqual({
      status: "dispatch_failed",
      httpStatus: 401,
      error: "bad credentials",
    });
  });

  it("a thrown fetch never throws to the caller (failure-soft)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await dispatchFirstScanForTenant("tenant-x", {
      fetchImpl,
      env: { BEACON_GH_WORKFLOW_DISPATCH_PAT: "pat" },
    });
    expect(r.status).toBe("dispatch_failed");
  });
});
