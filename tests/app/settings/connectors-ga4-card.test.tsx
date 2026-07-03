/**
 * 2026-05-18 — Slice 9.A1β — GA4 card render tests on
 * /settings/connectors.
 *
 * Pins the 4-state machine for the GA4 card:
 *   • NOT CONNECTED → "Connect Google Analytics" button visible;
 *     no property picker; no disconnect button.
 *   • CONNECTED + NO PROPERTY → "Connected. Select a property…"
 *     warning copy; "Choose property" button visible; "Disconnect"
 *     button visible.
 *   • CONNECTED + WITH PROPERTY → "Selected: <display name>" copy
 *     including the account display name; "Choose a different
 *     property" button visible; "Disconnect" button visible.
 *   • SOFT-DISCONNECTED → "Disconnected · cached data preserved"
 *     copy + the ga4StaleCopy tooltip text; "Connect Google
 *     Analytics" reconnect button visible.
 *
 * Plus customer-vocab safety: NO "drove" / "caused" / "$" / "revenue"
 * / "dollars" / "Mode A" / "Mode B" / "Mode C" anywhere on the card.
 *
 * Mocks server actions + next/navigation so the static render output
 * is deterministic.
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
  disconnectGoogle: vi.fn(),
  disconnectGoogleGa4: vi.fn(),
  disconnectYelp: vi.fn(),
  saveYelpApiKey: vi.fn(),
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

function renderClient(args: {
  ga4: ConnectorInfo;
  ga4StaleCopy?: string | null;
}): string {
  const tree = (
    <ConnectorsClient
      google={disconnectedInfo()}
      googleSelectedLocation={null}
      ga4={args.ga4}
      wix={{ status: "disconnected", connected_at: null, expires_at: null, last_synced_at: null }}
      yelp={disconnectedInfo()}
      profound={{ status: "disconnected" as const, connected_at: null, expires_at: null, last_synced_at: null }}
      clarity={{ status: "disconnected" as const, connected_at: null, expires_at: null, last_synced_at: null }}
      configYelpBusinessId=""
      gscStaleCopy={null}
      ga4StaleCopy={args.ga4StaleCopy ?? null}
    />
  ) as ReactElement;
  return renderToStaticMarkup(tree);
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("GA4 card — NOT CONNECTED state", () => {
  it("renders the Google Analytics header + Connect button", () => {
    const html = renderClient({
      ga4: {
        status: "disconnected",
        connected_at: null,
        expires_at: null,
        last_synced_at: null,
      },
    });
    expect(html).toContain('data-connector-card="google-ga4"');
    expect(html).toContain("Google Analytics");
    expect(html).toContain("Not connected");
    expect(html).toContain("Connect Google Analytics");
    expect(html).not.toContain("Choose property");
  });
});

describe("GA4 card — CONNECTED + NO PROPERTY state", () => {
  it("shows the 'Select a property to finish setup' warning + Choose property button", () => {
    const html = renderClient({
      ga4: {
        status: "connected",
        connected_at: "2026-05-18T10:00:00.000Z",
        expires_at: Date.now() + 3600 * 1000,
        last_synced_at: null,
        ga4_property_id: null,
        ga4_property_display_name: null,
        ga4_account_display_name: null,
      },
    });
    // FP10a (2026-07-02) — connected cards collapse to one summary line
    // with a "Manage" expand; the header no longer repeats "Connected to
    // Google Analytics" verbatim (the card + authorized date already say so).
    expect(html).toContain('data-connector-card="google-ga4"');
    expect(html).toContain("Authorized");
    // #197 — non-color "Action needed:" prefix + role=status (was color-only).
    expect(html).toContain("Action needed:");
    expect(html).toContain("select a property to finish setup");
    expect(html).toContain("Choose property");
    expect(html).toContain("Disconnect");
    expect(html).not.toContain("Connect Google Analytics</button>");
  });
});

describe("GA4 card — CONNECTED + WITH PROPERTY state", () => {
  it("shows the selected property name + account display name + 'Choose a different property'", () => {
    const html = renderClient({
      ga4: {
        status: "connected",
        connected_at: "2026-05-18T10:00:00.000Z",
        expires_at: Date.now() + 3600 * 1000,
        last_synced_at: null,
        ga4_property_id: "1001",
        ga4_property_display_name: "Ritz Builders — Production",
        ga4_account_display_name: "Ritz Builders LLC",
      },
    });
    expect(html).toContain('data-connector-card="google-ga4"');
    expect(html).toContain("Selected: Ritz Builders — Production");
    expect(html).toContain("Ritz Builders LLC");
    expect(html).toContain("Choose a different property");
    expect(html).toContain("Disconnect");
    // Warning copy should NOT show when a property is selected.
    expect(html).not.toContain("Select a property to finish setup");
  });
});

describe("GA4 card — SOFT-DISCONNECTED state", () => {
  it("shows the cached-data tooltip + Reconnect button", () => {
    const html = renderClient({
      ga4: {
        status: "disconnected",
        connected_at: "2026-04-18T10:00:00.000Z",
        expires_at: Date.now() - 14 * 24 * 60 * 60 * 1000,
        last_synced_at: null,
        ga4_property_id: null,
        ga4_property_display_name: null,
        ga4_account_display_name: null,
      },
      ga4StaleCopy:
        "Google Analytics data last refreshed 14 days ago. Reconnect to refresh.",
    });
    expect(html).toContain("Disconnected · cached data preserved");
    expect(html).toContain('data-ga4-stale-tooltip="true"');
    expect(html).toContain(
      "Google Analytics data last refreshed 14 days ago. Reconnect to refresh.",
    );
    // Reconnect button = the same "Connect Google Analytics" affordance.
    expect(html).toContain("Connect Google Analytics");
  });
});

describe("GA4 card — customer-vocab safety", () => {
  it("does NOT include 'drove' / 'caused' / 'revenue' / 'dollars' / 'Mode A' anywhere on the card", () => {
    const html = renderClient({
      ga4: {
        status: "connected",
        connected_at: "2026-05-18T10:00:00.000Z",
        expires_at: Date.now() + 3600 * 1000,
        last_synced_at: null,
        ga4_property_id: "1001",
        ga4_property_display_name: "Production",
        ga4_account_display_name: "Account A",
      },
    });
    const lower = html.toLowerCase();
    expect(lower.includes("drove")).toBe(false);
    expect(lower.includes("caused")).toBe(false);
    expect(lower.includes("revenue")).toBe(false);
    expect(lower.includes("dollars")).toBe(false);
    expect(html.includes("Mode A")).toBe(false);
    expect(html.includes("Mode B")).toBe(false);
    expect(html.includes("Mode C")).toBe(false);
  });
});
