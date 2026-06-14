/**
 * 2026-06-09 — operator-only /diagnostics/connectors render contract (§5).
 * Pins: operator gate (404), one row per cache-backed connector with
 * status + last-refreshed, the refresh-all button, disabled when none
 * connected.
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

// provider → connector info. Default: all disconnected.
let _info: Record<string, { status: string; last_synced_at: string | null }> = {};
vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: async (provider: string) =>
    _info[provider] ?? { status: "disconnected", last_synced_at: null },
}));

vi.mock("@/app/(shell)/diagnostics/connectors/actions", () => ({
  refreshAllDataSourcesFromForm: async () => {},
  runPerplexityReadingFromForm: async () => {},
  runOpenAiReadingFromForm: async () => {},
}));

import ConnectorsDiagnosticPage from "@/app/(shell)/diagnostics/connectors/page";

async function render(): Promise<string> {
  return renderToStaticMarkup(await ConnectorsDiagnosticPage());
}

beforeEach(() => {
  _operator = true;
  _info = {};
});

describe("/diagnostics/connectors — gate", () => {
  it("404s for non-operators", async () => {
    _operator = false;
    await expect(render()).rejects.toThrow(NotFoundError);
  });
  it("renders for operators", async () => {
    expect(await render()).toContain("Data sources");
  });
});

describe("/diagnostics/connectors — rows", () => {
  it("lists all six cache-backed connectors + the on-demand AI reading", async () => {
    const html = await render();
    expect(html).toContain("Google Search Console");
    expect(html).toContain("Google Analytics 4");
    expect(html).toContain("Microsoft Clarity");
    expect(html).toContain("Profound");
    expect(html).toContain("CallRail");
    expect(html).toContain("Semrush");
    expect(html).toContain("Refresh all connected sources");
    // 2026-06-15 — on-demand AEO poll (crons off)
    expect(html).toContain("Run today&#x27;s AI reading");
    expect(html).toContain("Run Perplexity reading");
    expect(html).toContain("Run ChatGPT reading");
  });

  it("disables refresh + shows empty note when none connected", async () => {
    const html = await render();
    expect(html).toContain("disabled");
    expect(html).toMatch(/no data sources connected yet/i);
  });

  it("shows connected status + last-refreshed when a source is connected", async () => {
    _info = {
      google_ga4: { status: "connected", last_synced_at: "2026-06-09T12:00:00Z" },
    };
    const html = await render();
    expect(html).toContain("Connected");
    expect(html).toContain("last refreshed 2026-06-09T12:00:00Z");
    // refresh button enabled (no disabled attr on the button) when ≥1 connected
    expect(html).not.toMatch(/no data sources connected yet/i);
  });
});
