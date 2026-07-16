/**
 * MAX_SEO_AEO Phase 4 (2026-06-16) — GSC card readiness render tests on
 * /settings/connectors.
 *
 * Pins that the GSC card surfaces the pre-composed `gscReadiness` prop:
 *   • READY → resolved property headline + coverage detail + "Ready" badge +
 *     data-gsc-readiness="ready".
 *   • CONNECTED_NO_DATA → "Connected · no data yet, pull to backfill" line +
 *     data-gsc-readiness="connected_no_data".
 *   • NEEDS_RECONNECT → prominent "Reconnect needed" badge +
 *     data-gsc-readiness="needs_reconnect".
 *   • NOT_CONNECTED → "Not ready" badge + data-gsc-readiness="not_connected".
 *   • Card carries data-connector-card="google-gsc".
 *
 * Static render via renderToStaticMarkup; server actions + next/navigation
 * mocked so the output is deterministic.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import type { ConnectorInfo } from "@/lib/connector-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/connectors",
}));

vi.mock("@/app/(shell)/settings/connectors/actions", () => ({
  getGoogleAuthUrl: vi.fn(),
  getGoogleGscConnectorStatus: vi.fn(),
  getGoogleGa4ConnectorStatus: vi.fn(),
  getWixConnectorStatus: vi.fn(),
  getYelpConnectorStatus: vi.fn(),
  disconnectGoogle: vi.fn(),
  disconnectGoogleGa4: vi.fn(),
  disconnectYelp: vi.fn(),
  saveWixConnection: vi.fn(),
  disconnectWix: vi.fn(),
  saveSemrushConnection: vi.fn(),
  disconnectSemrush: vi.fn(),
  saveProfoundConnection: vi.fn(),
  disconnectProfound: vi.fn(),
  saveClarityConnection: vi.fn(),
  disconnectClarity: vi.fn(),
  saveYelpApiKey: vi.fn(),
  syncGoogleReviews: vi.fn(),
  syncYelpReviews: vi.fn(),
  loadGoogleLocations: vi.fn(),
  selectGoogleLocation: vi.fn(),
  listGa4Properties: vi.fn(),
  selectGa4Property: vi.fn(),
  syncGscNow: vi.fn(),
  syncGa4Now: vi.fn(),
  syncSemrushNow: vi.fn(),
  syncProfoundNow: vi.fn(),
  syncClarityNow: vi.fn(),
}));

import { ConnectorsClient } from "@/app/(shell)/settings/connectors/connectors-client";

function disconnectedInfo(): ConnectorInfo {
  return {
    status: "disconnected",
    connected_at: null,
    expires_at: null,
    last_synced_at: null,
  };
}

type Readiness = NonNullable<
  Parameters<typeof ConnectorsClient>[0]["gscReadiness"]
>;

function renderClient(args: {
  google: ConnectorInfo;
  gscReadiness?: Readiness;
}): string {
  const tree = (
    <ConnectorsClient
      google={args.google}
      googleSelectedLocation={null}
      ga4={disconnectedInfo()}
      wix={disconnectedInfo()}
      profound={disconnectedInfo()}
      clarity={disconnectedInfo()}
      gscStaleCopy={null}
      gscReadiness={args.gscReadiness}
      ga4StaleCopy={null}
    />
  ) as ReactElement;
  return renderToStaticMarkup(tree);
}

function connectedInfo(): ConnectorInfo {
  return {
    status: "connected",
    connected_at: "2026-01-12T10:00:00.000Z",
    expires_at: Date.now() + 3600 * 1000,
    last_synced_at: "2026-06-14T10:00:00.000Z",
  };
}

describe("GSC card — readiness surfacing", () => {
  it("READY → resolved property + coverage detail + Ready badge + verdict attr", () => {
    const html = renderClient({
      google: connectedInfo(),
      gscReadiness: {
        verdict: "ready",
        headline: "Using property sc-domain:iranopedia.com",
        detail: "Search data Jan 12 – Jun 14 · 12,431 rows · refreshed 2 days ago",
        tone: "ready",
        property: "sc-domain:iranopedia.com",
      },
    });
    expect(html).toContain('data-connector-card="google-gsc"');
    expect(html).toContain('data-gsc-readiness="ready"');
    expect(html).toContain("Using property sc-domain:iranopedia.com");
    expect(html).toContain("Search data Jan 12 – Jun 14 · 12,431 rows · refreshed 2 days ago");
    expect(html).toContain(">Ready<");
  });

  it("CONNECTED_NO_DATA → 'Connected · no data yet, pull to backfill' + verdict attr", () => {
    const html = renderClient({
      google: connectedInfo(),
      gscReadiness: {
        verdict: "connected_no_data",
        headline: "Connected, but no Search Console data yet",
        detail: "Click “Pull my Search Console data” to backfill your search history.",
        tone: "attention",
        property: null,
      },
    });
    expect(html).toContain('data-gsc-readiness="connected_no_data"');
    // FP10a (2026-07-02) — the connected card collapses to one summary line;
    // the badge shortens to "No data yet" there (the fuller "Connected, but
    // no Search Console data yet" headline still renders once, expanded).
    expect(html).toContain("No data yet");
    expect(html).toContain("Connected, but no Search Console data yet");
  });

  it("NEEDS_RECONNECT → prominent 'Reconnect needed' badge + verdict attr", () => {
    const html = renderClient({
      google: connectedInfo(),
      gscReadiness: {
        verdict: "needs_reconnect",
        headline: "Reconnect Google to resume",
        detail: "Google access stopped working — reconnect to keep your search data fresh.",
        tone: "attention",
        property: "sc-domain:iranopedia.com",
      },
    });
    expect(html).toContain('data-gsc-readiness="needs_reconnect"');
    expect(html).toContain("Reconnect needed");
    expect(html).toContain("Reconnect Google to resume");
  });

  it("NOT_CONNECTED → 'Not ready' badge + verdict attr", () => {
    const html = renderClient({
      google: disconnectedInfo(),
      gscReadiness: {
        verdict: "not_connected",
        headline: "Not connected",
        detail:
          "Connect Google Search Console so Beacon can see what people search to find you.",
        tone: "idle",
        property: null,
      },
    });
    // FP10a (2026-07-02) — the disconnected card no longer stacks a second
    // "Not ready" badge under "Not connected"; that was the same fact said
    // twice. "Not connected" is the single, plain state line now.
    expect(html).toContain('data-gsc-readiness="not_connected"');
    expect(html).toContain("Not connected");
  });

  it("no readiness prop → card still renders with default not_connected attr (back-compat)", () => {
    const html = renderClient({ google: disconnectedInfo() });
    expect(html).toContain('data-connector-card="google-gsc"');
    expect(html).toContain('data-gsc-readiness="not_connected"');
  });
});
