/**
 * 2026-06-09 — operator-only /diagnostics/callrail render contract (§9.B).
 * Pins: operator gate (404), connect form (api key + account id) when
 * disconnected, attribution-row display when connected, resilient empty
 * state.
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

let _rows: unknown[] = [];
vi.mock("@/lib/connectors/callrail/persist-url-calls", () => ({
  loadRecentCallAttribution: async () => _rows,
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-test",
}));
vi.mock("@/app/(shell)/diagnostics/callrail/actions", () => ({
  connectCallRailFromForm: async () => {},
  refreshCallRailFromForm: async () => {},
  disconnectCallRailFromForm: async () => {},
}));

import CallRailDiagnosticPage from "@/app/(shell)/diagnostics/callrail/page";

async function render(): Promise<string> {
  return renderToStaticMarkup(await CallRailDiagnosticPage());
}

beforeEach(() => {
  _operator = true;
  _status = "disconnected";
  _rows = [];
});

describe("/diagnostics/callrail — gate", () => {
  it("404s for non-operators", async () => {
    _operator = false;
    await expect(render()).rejects.toThrow(NotFoundError);
  });
  it("renders for operators", async () => {
    expect(await render()).toContain("CallRail");
  });
});

describe("/diagnostics/callrail — disconnected", () => {
  it("shows the connect form (api key + account id inputs)", async () => {
    const html = await render();
    expect(html).toContain('name="api_key"');
    expect(html).toContain('name="account_id"');
    expect(html).toContain("Not connected");
  });
});

describe("/diagnostics/callrail — connected", () => {
  it("shows refresh + disconnect, empty state with no rows", async () => {
    _status = "connected";
    const html = await render();
    expect(html).toContain("Connected");
    expect(html).toContain("Refresh calls");
    expect(html).toMatch(/no call attribution cached yet/i);
  });

  it("renders cached attribution rows (url + qualified/total)", async () => {
    _status = "connected";
    _rows = [
      {
        url: "https://ritzbuilders.com/adu",
        date: "2026-06-01",
        qualifiedCalls: 3,
        totalCalls: 5,
      },
      {
        url: "https://ritzbuilders.com/kitchen",
        date: "2026-06-02",
        qualifiedCalls: 1,
        totalCalls: 2,
      },
    ];
    const html = await render();
    expect(html).toContain("https://ritzbuilders.com/adu");
    expect(html).toContain("3/5 qualified");
    // total qualified across rows surfaced in the section heading
    expect(html).toContain("4 qualified across 2 URL/day rows");
  });
});
