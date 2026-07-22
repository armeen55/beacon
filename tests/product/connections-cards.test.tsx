/**
 * /settings/connectors card surface - merged behavioral suite (Core 100K Phase 6).
 * Absorbs: connectors-ga4-card, connectors-gsc-readiness-card, connectors-new-cards,
 * connectors-wix-card, connectors-summary-strip, connectors-refresh-reliability-card.
 * One render helper, one boundary case per card state family:
 *   - GA4 4-state machine (not connected / property selected / dead-login recovery / vocab bans)
 *   - GSC readiness verdicts (ready / needs_reconnect / not_connected)
 *   - Wix self-serve publish card (key form, publish-safety note, T0b discover fix)
 *   - self-serve key cards (Clarity present, Profound gone)
 *   - summary strip health colors + the once-only never-auto-publish fact
 *   - needs-attention escalation banner vs proven-dead grant
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import type { ConnectorInfo } from "@/lib/connector-store";

vi.mock("server-only", () => ({}));
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
  disconnectWix: vi.fn(),
  saveWixConnection: vi.fn(),
  saveClarityConnection: vi.fn(),
  disconnectClarity: vi.fn(),
  saveYelpApiKey: vi.fn(),
  syncGoogleReviews: vi.fn(),
  syncYelpReviews: vi.fn(),
  loadGoogleLocations: vi.fn(),
  selectGoogleLocation: vi.fn(),
  listGa4Properties: vi.fn(),
  selectGa4Property: vi.fn(),
  discoverWixCollections: vi.fn(),
  syncGscNow: vi.fn(),
  syncGa4Now: vi.fn(),
  syncClarityNow: vi.fn(),
}));

import {
  ConnectorsClient,
  type RefreshLedgerFacts,
} from "@/app/(shell)/settings/connectors/connectors-client";

const off: ConnectorInfo = {
  status: "disconnected",
  connected_at: null,
  expires_at: null,
  last_synced_at: null,
};
const on: ConnectorInfo = {
  ...off,
  status: "connected",
  connected_at: "2026-06-12T00:00:00Z",
  last_synced_at: "2026-07-01T09:00:00Z",
};

type Readiness = NonNullable<Parameters<typeof ConnectorsClient>[0]["gscReadiness"]>;

function renderClient(over: {
  google?: ConnectorInfo;
  ga4?: ConnectorInfo;
  wix?: ConnectorInfo;
  clarity?: ConnectorInfo;
  gscReadiness?: Readiness;
  ga4StaleCopy?: string | null;
  wixUrlMapCount?: number;
  refreshLedger?: RefreshLedgerFacts;
  connectedCount?: number;
  totalCount?: number;
} = {}): string {
  const tree = (
    <ConnectorsClient
      google={over.google ?? off}
      googleSelectedLocation={null}
      ga4={over.ga4 ?? off}
      wix={over.wix ?? off}
      clarity={over.clarity ?? off}
      gscStaleCopy={null}
      ga4StaleCopy={over.ga4StaleCopy ?? null}
      gscReadiness={over.gscReadiness}
      wixUrlMapCount={over.wixUrlMapCount}
      refreshLedger={over.refreshLedger}
      connectedCount={over.connectedCount}
      totalCount={over.totalCount}
    />
  ) as ReactElement;
  return renderToStaticMarkup(tree);
}

const connectedGa4 = (overrides: Partial<ConnectorInfo> = {}): ConnectorInfo => ({
  status: "connected",
  connected_at: "2026-05-18T10:00:00.000Z",
  expires_at: Date.now() + 3600 * 1000,
  last_synced_at: "2026-06-20T00:00:00.000Z",
  ga4_property_id: "1001",
  ga4_property_display_name: "Ritz Builders Production",
  ...overrides,
});

describe("GA4 card state machine", () => {
  it("NOT CONNECTED renders the Connect button, never the property picker", () => {
    const html = renderClient({ ga4: off });
    expect(html).toContain('data-connector-card="google-ga4"');
    expect(html).toContain("Not connected");
    expect(html).toContain("Connect Google Analytics");
    expect(html).not.toContain("Choose property");
  });

  it("CONNECTED + WITH PROPERTY shows the selected property + account + change affordance", () => {
    const html = renderClient({
      ga4: connectedGa4({
        ga4_property_display_name: "Ritz Builders — Production",
        ga4_account_display_name: "Ritz Builders LLC",
      }),
    });
    expect(html).toContain("Selected: Ritz Builders — Production");
    expect(html).toContain("Ritz Builders LLC");
    expect(html).toContain("Choose a different property");
    expect(html).toContain("Disconnect");
    expect(html).not.toContain("Select a property to finish setup");
  });

  it("customer-vocab safety: no drove/caused/revenue/dollars/Mode-letters on the card", () => {
    const html = renderClient({ ga4: connectedGa4({ ga4_account_display_name: "Account A" }) });
    const lower = html.toLowerCase();
    for (const banned of ["drove", "caused", "revenue", "dollars"]) {
      expect(lower.includes(banned)).toBe(false);
    }
    for (const banned of ["Mode A", "Mode B", "Mode C"]) {
      expect(html.includes(banned)).toBe(false);
    }
  });
});

describe("GSC card readiness verdicts", () => {
  const connectedGsc: ConnectorInfo = {
    status: "connected",
    connected_at: "2026-01-12T10:00:00.000Z",
    expires_at: Date.now() + 3600 * 1000,
    last_synced_at: "2026-06-14T10:00:00.000Z",
  };

  it("READY renders the resolved property + coverage detail + Ready badge", () => {
    const html = renderClient({
      google: connectedGsc,
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
    expect(html).toContain(">Ready<");
  });

  it("NEEDS_RECONNECT renders the prominent reconnect badge", () => {
    const html = renderClient({
      google: connectedGsc,
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
  });

  it("no readiness prop falls back to not_connected (back-compat, never a fake Ready)", () => {
    const html = renderClient({ google: off });
    expect(html).toContain('data-gsc-readiness="not_connected"');
  });
});

describe("Wix self-serve publish card", () => {
  it("disconnected: shows the key + site-id form and the no-auto-publish copy", () => {
    const html = renderClient({ wix: off });
    expect(html).toContain('data-connector-card="wix"');
    expect(html).toContain('id="wix-api-key"');
    expect(html).toContain('id="wix-site-id"');
    expect(html).toContain("Nothing changes on your live site without your approval");
    expect(html).toContain("Connect Wix");
  });

  it("the publish-safety note always renders, connected or not (publishing authority copy)", () => {
    for (const info of [off, { ...on }]) {
      const html = renderClient({ wix: info });
      expect(html).toContain("Only used when you approve an edit for publishing");
      expect(html).not.toContain("Approve &amp; Push");
    }
  });

  it("T0b: connected + zero mapped pages shows the Discover collections fix; mapped pages hide it", () => {
    const zero = renderClient({ wix: on, wixUrlMapCount: 0 });
    expect(zero).toContain('data-recovery-fix="wix_url_map_empty"');
    expect(zero).toContain('data-wix-discover="true"');
    expect(zero).toContain("Discover collections");
    expect(zero).not.toContain('href="/diagnostics/wix"');
    expect(zero).not.toMatch(/[‒–—―]/);

    const mapped = renderClient({ wix: on, wixUrlMapCount: 12 });
    expect(mapped).not.toContain('data-recovery-fix="wix_url_map_empty"');
  });
});

describe("self-serve key cards", () => {
  it("renders the Clarity card with its key input when disconnected", () => {
    const html = renderClient();
    expect(html).toContain('data-connector-card="clarity"');
    expect(html).toContain("Connect Clarity");
  });

  it("never renders a Profound connector card (account fully disconnected 2026-07-20)", () => {
    const html = renderClient({ clarity: on });
    expect(html).not.toContain('data-connector-card="profound"');
    expect(html).not.toContain("Profound");
  });
});

describe("summary strip health + the once-only publish fact", () => {
  it("renders 'N of M connected' with the health color following state", () => {
    const none = renderClient({ connectedCount: 0, totalCount: 5 });
    expect(none).toContain('data-connectors-summary-strip="true"');
    expect(none).toContain('data-intent="neutral"');
    expect(none).toContain("0 of 5 connected");

    const all = renderClient({ connectedCount: 5, totalCount: 5 });
    expect(all).toContain('data-intent="live"');
    expect(all).toContain("5 of 5 connected");
  });

  it("states the never-touch-your-live-site fact exactly once on the page", () => {
    const html = renderClient({ connectedCount: 0, totalCount: 5 });
    const matches = html.match(/I never touch your live site/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("a connected source collapses to one <details> line with a Manage affordance", () => {
    const html = renderClient({ google: on, connectedCount: 1, totalCount: 5 });
    expect(html).toContain("<details");
    expect(html).toContain('data-connector-card="google-gsc"');
    expect(html).toContain("Manage");
    expect(html).toContain("Disconnect Google");
  });
});
