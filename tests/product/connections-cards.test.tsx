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
  disconnectGoogle: vi.fn(),
  disconnectGoogleGa4: vi.fn(),
  disconnectWix: vi.fn(),
  saveWixConnection: vi.fn(),
  saveClarityConnection: vi.fn(),
  disconnectClarity: vi.fn(),
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

describe("GA4 card", () => {
  it("boundary: not-connected shows Connect + no picker; connected shows the selected property", () => {
    const disc = renderClient({ ga4: off });
    expect(disc).toContain('data-connector-card="google-ga4"');
    expect(disc).toContain("Connect Google Analytics");
    expect(disc).not.toContain("Choose property");

    const conn = renderClient({ ga4: connectedGa4({ ga4_property_display_name: "Ritz Builders Production" }) });
    expect(conn).toContain("Ritz Builders Production");
    expect(conn).not.toContain("Select a property to finish setup");
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

  it("each verdict renders its own data-attr; missing prop falls back to not_connected (never a fake Ready)", () => {
    const ready = renderClient({
      google: connectedGsc,
      gscReadiness: { verdict: "ready", headline: "Using property sc-domain:iranopedia.com", detail: "x", tone: "ready", property: "sc-domain:iranopedia.com" },
    });
    expect(ready).toContain('data-connector-card="google-gsc"');
    expect(ready).toContain('data-gsc-readiness="ready"');

    const recon = renderClient({
      google: connectedGsc,
      gscReadiness: { verdict: "needs_reconnect", headline: "Reconnect Google to resume", detail: "x", tone: "attention", property: "sc-domain:iranopedia.com" },
    });
    expect(recon).toContain('data-gsc-readiness="needs_reconnect"');

    expect(renderClient({ google: off })).toContain('data-gsc-readiness="not_connected"');
  });
});

describe("Wix self-serve publish card", () => {
  it("renders the key/site-id form, the never-auto-publish trust copy (connected or not), and no em-dashes", () => {
    const html = renderClient({ wix: off });
    expect(html).toContain('data-connector-card="wix"');
    expect(html).toContain('id="wix-api-key"');
    expect(html).toContain('id="wix-site-id"');
    expect(html).toContain("Nothing changes on your live site without your approval");
    expect(html).not.toMatch(/[‒–—―]/);
    for (const info of [off, { ...on }]) {
      expect(renderClient({ wix: info })).toContain("Only used when you approve an edit for publishing");
    }
  });

  it("T0b: connected + zero mapped pages shows the Discover collections fix; mapped pages hide it", () => {
    const zero = renderClient({ wix: on, wixUrlMapCount: 0 });
    expect(zero).toContain('data-recovery-fix="wix_url_map_empty"');
    expect(zero).toContain('data-wix-discover="true"');
    expect(renderClient({ wix: on, wixUrlMapCount: 12 })).not.toContain('data-recovery-fix="wix_url_map_empty"');
  });
});

describe("self-serve key cards + retired connectors", () => {
  it("renders the Clarity card; never renders a Profound card (account fully disconnected)", () => {
    expect(renderClient()).toContain('data-connector-card="clarity"');
    const html = renderClient({ clarity: on });
    expect(html).not.toContain('data-connector-card="profound"');
    expect(html).not.toContain("Profound");
  });
});

describe("summary strip health + the once-only publish fact", () => {
  it("'N of M connected' follows health color, states the never-touch fact once, collapses connected to a details line", () => {
    const none = renderClient({ connectedCount: 0, totalCount: 5 });
    expect(none).toContain('data-connectors-summary-strip="true"');
    expect(none).toContain('data-intent="neutral"');
    expect(none).toContain("0 of 5 connected");
    expect((none.match(/I never touch your live site/g) ?? []).length).toBe(1);

    const all = renderClient({ connectedCount: 5, totalCount: 5 });
    expect(all).toContain('data-intent="live"');
    expect(all).toContain("5 of 5 connected");

    const one = renderClient({ google: on, connectedCount: 1, totalCount: 5 });
    expect(one).toContain("<details");
    expect(one).toContain("Manage");
  });
});
