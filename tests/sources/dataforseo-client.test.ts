/**
 * Canonical DataForSEO client: zero-fetch proofs for not_configured/dry_run/
 * capped, actual-cost + provenance + idempotency on ok, typed errors otherwise.
 */

import { describe, it, expect, vi } from "vitest";

import { dataForSeoRequest, dataForSeoIdempotencyKey } from "@/domains/evidence/dataforseo/client";
import type { DataForSeoRequestArgs, DataForSeoClientDeps } from "@/domains/evidence/dataforseo/types";

const ENDPOINT = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
const CONFIGURED_ENV = { BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc123", DATAFORSEO_DRY_RUN: "false" };
const NOW = new Date("2026-07-23T12:00:00.000Z");
const PAYLOAD = [{ keyword: "koobideh", location_code: 2840, language_code: "en", depth: 10 }];

function baseArgs(overrides: Partial<DataForSeoRequestArgs> = {}): DataForSeoRequestArgs {
  return {
    tenantId: "tenant-fixture",
    endpoint: ENDPOINT,
    payload: PAYLOAD,
    estCostUsd: 0.003,
    location: 2840,
    language: "en",
    payloadSummary: "koobideh",
    perfDetail: "serp",
    now: NOW,
    ...overrides,
  };
}

function baseDeps(overrides: Partial<DataForSeoClientDeps> = {}): Partial<DataForSeoClientDeps> {
  return {
    env: { ...CONFIGURED_ENV } as unknown as NodeJS.ProcessEnv,
    spentThisMonthUsd: async () => 0,
    recordSpend: async () => {},
    fetchImpl: vi.fn() as unknown as typeof fetch,
    globalBreaker: async () => ({ tripped: false }),
    ...overrides,
  };
}

function okResponse(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

describe("dataForSeoRequest — the canonical money gauntlet", () => {
  it("(a) missing credentials -> not_configured with ZERO fetch calls", async () => {
    const fetchImpl = vi.fn();
    const res = await dataForSeoRequest(
      baseArgs(),
      baseDeps({ env: { DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv, fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(res.state).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("(b) DATAFORSEO_DRY_RUN honored -> dry_run echoes the exact request shape, ZERO fetch", async () => {
    const fetchImpl = vi.fn();
    const res = await dataForSeoRequest(
      baseArgs(),
      baseDeps({
        env: { ...CONFIGURED_ENV, DATAFORSEO_DRY_RUN: "true" } as unknown as NodeJS.ProcessEnv,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(res.state).toBe("dry_run");
    if (res.state === "dry_run") {
      expect(res.request).toEqual({
        endpoint: ENDPOINT,
        method: "POST",
        location: 2840,
        language: "en",
        payload: PAYLOAD,
      });
      expect(res.estCostUsd).toBe(0.003);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("(c) per-platform cap reached -> capped with ZERO fetch calls", async () => {
    const fetchImpl = vi.fn();
    const res = await dataForSeoRequest(
      baseArgs(),
      baseDeps({ spentThisMonthUsd: async () => 1000, fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(res.state).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("(c) unknown spend -> capped (fail closed) with ZERO fetch calls", async () => {
    const fetchImpl = vi.fn();
    const res = await dataForSeoRequest(
      baseArgs(),
      baseDeps({ spentThisMonthUsd: async () => null, fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(res.state).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("(c) global breaker tripped -> capped BEFORE the per-platform cap, ZERO fetch", async () => {
    const fetchImpl = vi.fn();
    const spentThisMonthUsd = vi.fn(async () => 0);
    const res = await dataForSeoRequest(
      baseArgs(),
      baseDeps({
        globalBreaker: async () => ({ tripped: true, reason: "global ceiling reached" }),
        spentThisMonthUsd,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(res.state).toBe("capped");
    if (res.state === "capped") expect(res.detail).toBe("global ceiling reached");
    expect(fetchImpl).not.toHaveBeenCalled();
    // The outer breaker short-circuits: the per-platform ledger is never even read.
    expect(spentThisMonthUsd).not.toHaveBeenCalled();
  });

  it("(d) ok -> records the ACTUAL cost from the response + stamps provenance + idempotency", async () => {
    const recordSpend = vi.fn(async () => {});
    const fetchImpl = okResponse({ cost: 0.0021, tasks: [] });
    const res = await dataForSeoRequest(baseArgs(), baseDeps({ recordSpend, fetchImpl }));
    expect(res.state).toBe("ok");
    if (res.state === "ok") {
      expect(res.costUsd).toBe(0.0021);
      expect(recordSpend).toHaveBeenCalledWith("tenant-fixture", 0.0021);
      expect(res.provenance).toMatchObject({
        provider: "dataforseo",
        endpoint: ENDPOINT,
        payloadSummary: "koobideh",
        location: 2840,
        language: "en",
        timestamp: NOW.toISOString(),
        costUsd: 0.0021,
      });
      expect(res.provenance.idempotencyKey).toBe(res.idempotencyKey);
      expect(res.idempotencyKey).toMatch(/^dfs_[0-9a-f]{32}$/);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("(d) ok -> falls back to the estimated cost when the response omits a cost field", async () => {
    const recordSpend = vi.fn(async () => {});
    const fetchImpl = okResponse({ tasks: [] });
    const res = await dataForSeoRequest(baseArgs(), baseDeps({ recordSpend, fetchImpl }));
    expect(res.state).toBe("ok");
    if (res.state === "ok") expect(res.costUsd).toBe(0.003);
    expect(recordSpend).toHaveBeenCalledWith("tenant-fixture", 0.003);
  });

  it("non-2xx -> error carrying the status; a thrown fetch -> error with null status", async () => {
    const res1 = await dataForSeoRequest(
      baseArgs(),
      baseDeps({ fetchImpl: vi.fn(async () => new Response("nope", { status: 429 })) as unknown as typeof fetch }),
    );
    expect(res1.state).toBe("error");
    if (res1.state === "error") expect(res1.status).toBe(429);

    const res2 = await dataForSeoRequest(
      baseArgs(),
      baseDeps({
        fetchImpl: vi.fn(async () => {
          throw new Error("boom");
        }) as unknown as typeof fetch,
      }),
    );
    expect(res2.state).toBe("error");
    if (res2.state === "error") expect(res2.status).toBeNull();
  });

  it("(e) the same logical task twice yields the same idempotency key", async () => {
    const fetchImpl = okResponse({ cost: 0.002, tasks: [] });
    const r1 = await dataForSeoRequest(baseArgs(), baseDeps({ fetchImpl }));
    const r2 = await dataForSeoRequest(baseArgs(), baseDeps({ fetchImpl }));
    expect(r1.idempotencyKey).toBe(r2.idempotencyKey);
    // A different tenant is a different logical task -> a different key.
    const rOther = await dataForSeoRequest(baseArgs({ tenantId: "tenant-other" }), baseDeps({ fetchImpl }));
    expect(rOther.idempotencyKey).not.toBe(r1.idempotencyKey);
  });

  it("(e) dataForSeoIdempotencyKey is deterministic and day/payload sensitive", () => {
    const morning = dataForSeoIdempotencyKey({ endpoint: ENDPOINT, payload: PAYLOAD, tenantId: "t", now: NOW });
    const sameDayEvening = dataForSeoIdempotencyKey({
      endpoint: ENDPOINT,
      payload: PAYLOAD,
      tenantId: "t",
      now: new Date("2026-07-23T23:59:59.000Z"),
    });
    expect(morning).toBe(sameDayEvening);
    const nextDay = dataForSeoIdempotencyKey({
      endpoint: ENDPOINT,
      payload: PAYLOAD,
      tenantId: "t",
      now: new Date("2026-07-24T00:00:00.000Z"),
    });
    expect(nextDay).not.toBe(morning);
    const otherPayload = dataForSeoIdempotencyKey({
      endpoint: ENDPOINT,
      payload: [{ keyword: "different" }],
      tenantId: "t",
      now: NOW,
    });
    expect(otherPayload).not.toBe(morning);
  });
});
