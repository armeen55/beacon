/**
 * 2026-06-09 — operator-only /diagnostics/semrush render contract.
 * Pins: operator gate (404), connect form when disconnected, snapshot
 * display when connected, resilient empty state.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
}));

let _operator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operator,
}));

let _status: "connected" | "disconnected" = "disconnected";
vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: async () => ({
    status: _status,
    connected_at: _status === "connected" ? "2026-06-09T00:00:00Z" : null,
    expires_at: null,
    last_synced_at: _status === "connected" ? "2026-06-09T12:00:00Z" : null,
  }),
}));

let _snapshot: unknown = null;
vi.mock("@/lib/connectors/semrush/persist-domain-metrics", () => ({
  loadSemrushDomainMetrics: async () => _snapshot,
}));

vi.mock("@/lib/business-config", () => ({
  getBusinessConfigForCurrentTenant: async () => ({ domain: "ritzbuilders.com" }),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-test",
}));
vi.mock("@/app/(shell)/diagnostics/semrush/actions", () => ({
  connectSemrushFromForm: async () => {},
  refreshSemrushFromForm: async () => {},
  disconnectSemrushFromForm: async () => {},
}));

import SemrushDiagnosticPage from "@/app/(shell)/diagnostics/semrush/page";

async function render(): Promise<string> {
  return renderToStaticMarkup(await SemrushDiagnosticPage());
}

beforeEach(() => {
  _operator = true;
  _status = "disconnected";
  _snapshot = null;
});

describe("/diagnostics/semrush — gate", () => {
  it("404s for non-operators", async () => {
    _operator = false;
    await expect(render()).rejects.toThrow(NotFoundError);
  });
  it("renders for operators", async () => {
    expect(await render()).toContain("Semrush");
  });
});

describe("/diagnostics/semrush — disconnected", () => {
  it("shows the connect form (api key input)", async () => {
    const html = await render();
    expect(html).toContain('name="api_key"');
    expect(html).toContain("Not connected");
  });
});

describe("/diagnostics/semrush — connected", () => {
  it("shows refresh + owned domain, no snapshot yet", async () => {
    _status = "connected";
    const html = await render();
    expect(html).toContain("Connected");
    expect(html).toContain("Refresh metrics");
    expect(html).toContain("ritzbuilders.com");
    expect(html).toMatch(/no semrush snapshot cached yet/i);
  });

  it("renders the cached snapshot (overview + competitors)", async () => {
    _status = "connected";
    _snapshot = {
      tenant_id: "tenant-test",
      domain: "ritzbuilders.com",
      database: "us",
      fetched_at: "2026-06-09T12:00:00Z",
      overview: {
        database: "us",
        domain: "ritzbuilders.com",
        rank: 152000,
        organicKeywords: 340,
        organicTraffic: 1200,
        organicCostUsd: 5400,
        adwordsKeywords: 12,
      },
      organic_competitors: [
        { domain: "supplehomes.com", competitionLevel: 0.83, commonKeywords: 120, organicKeywords: 5000, organicTraffic: 9000 },
      ],
    };
    const html = await render();
    expect(html).toContain("Organic competitors (1)");
    expect(html).toContain("supplehomes.com");
    expect(html).toContain("340"); // organic keywords
  });
});
