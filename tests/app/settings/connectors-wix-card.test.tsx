/**
 * North-star onboarding (2026-06-11) — Wix connector card render tests.
 *
 * The self-serve publish connection: a Wix customer pastes their own
 * API key + site id (per-tenant connector-store row — the same row the
 * push service reads). Pins: disconnected card shows the key+site form
 * with safety copy; connected card shows status + Disconnect and hides
 * the form; the Approve & Push safety note always renders.
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
  getYelpConnectorStatus: vi.fn(),
  getWixConnectorStatus: vi.fn(),
  disconnectGoogle: vi.fn(),
  disconnectGoogleGa4: vi.fn(),
  disconnectYelp: vi.fn(),
  disconnectWix: vi.fn(),
  saveYelpApiKey: vi.fn(),
  saveWixConnection: vi.fn(),
  syncGoogleReviews: vi.fn(),
  syncYelpReviews: vi.fn(),
  loadGoogleLocations: vi.fn(),
  selectGoogleLocation: vi.fn(),
  listGa4Properties: vi.fn(),
  selectGa4Property: vi.fn(),
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

function render(el: ReactElement): string {
  return renderToStaticMarkup(el);
}

function clientWith(wix: ConnectorInfo): string {
  return render(
    <ConnectorsClient
      google={disconnectedInfo()}
      googleSelectedLocation={null}
      ga4={disconnectedInfo()}
      yelp={disconnectedInfo()}
      wix={wix}
      configYelpBusinessId=""
      gscStaleCopy={null}
      ga4StaleCopy={null}
    />,
  );
}

describe("Wix connector card", () => {
  it("disconnected: shows the key + site-id form and the no-auto-publish copy", () => {
    const html = clientWith(disconnectedInfo());
    expect(html).toContain('data-connector-card="wix"');
    expect(html).toContain("Wix API key");
    expect(html).toContain("Wix Site ID");
    expect(html).toContain("Nothing publishes without your approval");
    expect(html).toContain("Connect Wix");
  });

  it("connected: shows status + Disconnect, hides the form", () => {
    const html = clientWith({
      status: "connected",
      connected_at: "2026-06-11T20:00:00.000Z",
      expires_at: null,
      last_synced_at: null,
    });
    expect(html).toContain('data-connector-card="wix"');
    expect(html).toContain("Disconnect");
    expect(html).not.toContain("Wix API key"); // form hidden once connected
  });

  it("the Approve & Push safety note always renders", () => {
    for (const info of [
      disconnectedInfo(),
      {
        status: "connected" as const,
        connected_at: "2026-06-11T20:00:00.000Z",
        expires_at: null,
        last_synced_at: null,
      },
    ]) {
      expect(clientWith(info)).toContain("Approve &amp; Push");
    }
  });
});
