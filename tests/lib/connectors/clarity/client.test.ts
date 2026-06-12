/**
 * Connect-cards slice (2026-06-12) — Clarity Data Export parser.
 * Defensive parsing of the metric-array response (field naming
 * varies by metric); fail-soft null on no-token/error.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let _token: unknown = {
  provider: "clarity",
  api_token: "tok",
  connected_at: "2026-06-12T00:00:00Z",
};
vi.mock("@/lib/connector-store", () => ({
  getConnectorToken: async () => _token,
}));

import { fetchClarityUrlMetrics } from "@/lib/connectors/clarity/client";

const SAMPLE = [
  {
    metricName: "Traffic",
    information: [
      { totalSessionCount: "120", Url: "https://x.com/a" },
      { totalSessionCount: "40", Url: "https://x.com/b" },
    ],
  },
  {
    metricName: "RageClickCount",
    information: [{ subTotal: 7, Url: "https://x.com/a" }],
  },
  {
    metricName: "DeadClickCount",
    information: [{ subTotal: 3, Url: "https://x.com/b" }],
  },
];

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 403,
      json: async () => body,
    })),
  );
}

describe("fetchClarityUrlMetrics", () => {
  it("groups metrics by URL across the metric array", async () => {
    mockFetch(SAMPLE);
    const out = await fetchClarityUrlMetrics({ tenantId: "t" });
    expect(out).not.toBeNull();
    const a = out!.find((m) => m.url === "https://x.com/a")!;
    expect(a.sessions).toBe(120);
    expect(a.rageClicks).toBe(7);
    const b = out!.find((m) => m.url === "https://x.com/b")!;
    expect(b.deadClicks).toBe(3);
  });

  it("fail-softs to null on non-2xx and on missing token", async () => {
    mockFetch(SAMPLE, false);
    expect(await fetchClarityUrlMetrics({ tenantId: "t" })).toBeNull();
    _token = null;
    expect(await fetchClarityUrlMetrics({ tenantId: "t" })).toBeNull();
  });
});
