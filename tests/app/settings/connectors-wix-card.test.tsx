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

function clientWith(wix: ConnectorInfo, wixUrlMapCount = 0): string {
  return render(
    <ConnectorsClient
      google={disconnectedInfo()}
      googleSelectedLocation={null}
      ga4={disconnectedInfo()}
      wix={wix}
      profound={{ status: "disconnected" as const, connected_at: null, expires_at: null, last_synced_at: null }}
      clarity={{ status: "disconnected" as const, connected_at: null, expires_at: null, last_synced_at: null }}
      gscStaleCopy={null}
      ga4StaleCopy={null}
      wixUrlMapCount={wixUrlMapCount}
    />,
  );
}

describe("Wix connector card", () => {
  it("disconnected: shows the key + site-id form and the no-auto-publish copy", () => {
    const html = clientWith(disconnectedInfo());
    expect(html).toContain('data-connector-card="wix"');
    // Assert on the actual form inputs, not prose: the capability copy
    // also mentions "a Wix API key" in plain English, so match the input ids.
    expect(html).toContain('id="wix-api-key"');
    expect(html).toContain('id="wix-site-id"');
    expect(html).toContain("Nothing changes on your live site without your approval");
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
    // Form hidden once connected — assert on the input ids (the capability
    // copy still mentions "a Wix API key" in prose on both states).
    expect(html).not.toContain('id="wix-api-key"');
    expect(html).not.toContain('id="wix-site-id"');
  });

  it("the publish-safety note always renders (no over-claimed publish surface)", () => {
    for (const info of [
      disconnectedInfo(),
      {
        status: "connected" as const,
        connected_at: "2026-06-11T20:00:00.000Z",
        expires_at: null,
        last_synced_at: null,
      },
    ]) {
      const html = clientWith(info);
      // #13/#180 — copy no longer promises an "Approve & Push" button that
      // has no customer-reachable surface; it keeps the honest safety facts.
      expect(html).toContain("Only used when you approve an edit for publishing");
      expect(html).toContain("disconnecting");
      expect(html).not.toContain("Approve &amp; Push");
    }
  });

  it("T0b: connected + zero mapped pages shows the exact recovery fix, deep-linked to /diagnostics/wix", () => {
    const html = clientWith(
      {
        status: "connected",
        connected_at: "2026-06-11T20:00:00.000Z",
        expires_at: null,
        last_synced_at: null,
      },
      0,
    );
    expect(html).toContain('data-recovery-fix="wix_url_map_empty"');
    expect(html).toContain("Fix this:");
    expect(html).toContain('href="/diagnostics/wix"');
    expect(html).toContain("Open Wix page mapping");
    expect(html).toContain("Discover collections");
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("T0b: connected + mapped pages hides the fix line", () => {
    const html = clientWith(
      {
        status: "connected",
        connected_at: "2026-06-11T20:00:00.000Z",
        expires_at: null,
        last_synced_at: null,
      },
      12,
    );
    expect(html).not.toContain('data-recovery-fix="wix_url_map_empty"');
  });
});
