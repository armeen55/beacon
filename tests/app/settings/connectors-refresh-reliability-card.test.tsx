/**
 * refresh-reliability wave (2026-07-11) - connectors card surface tests.
 *
 * BUG 2: the bounded needs-attention escalation renders an honest, NON-accusatory
 *        dated banner ("I have not been able to pull your data since <date>.
 *        Reconnecting usually fixes this.") and NEVER the proven-dead "login
 *        expired" copy - while a genuinely proven-dead grant still wins.
 * BUG 3: the per-source refresh ledger line ("Last pulled ..., data through ...")
 *        renders per source, surfacing a Profound-style silent partial as "No new
 *        data came back that time."
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

import {
  ConnectorsClient,
  type RefreshLedgerFacts,
} from "@/app/(shell)/settings/connectors/connectors-client";

function disconnected(): ConnectorInfo {
  return { status: "disconnected", connected_at: null, expires_at: null, last_synced_at: null };
}

function connectedGa4(overrides: Partial<ConnectorInfo> = {}): ConnectorInfo {
  return {
    status: "connected",
    connected_at: "2026-05-18T10:00:00.000Z",
    expires_at: Date.now() + 3600 * 1000,
    last_synced_at: "2026-06-20T00:00:00.000Z",
    ga4_property_id: "1001",
    ga4_property_display_name: "Ritz Builders Production",
    ...overrides,
  };
}

function connectedGsc(overrides: Partial<ConnectorInfo> = {}): ConnectorInfo {
  return {
    status: "connected",
    connected_at: "2026-05-18T10:00:00.000Z",
    expires_at: Date.now() + 3600 * 1000,
    last_synced_at: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

function render(args: {
  google?: ConnectorInfo;
  ga4?: ConnectorInfo;
  refreshLedger?: RefreshLedgerFacts;
}): string {
  const tree = (
    <ConnectorsClient
      google={args.google ?? disconnected()}
      googleSelectedLocation={null}
      ga4={args.ga4 ?? disconnected()}
      wix={disconnected()}
      clarity={disconnected()}
      gscStaleCopy={null}
      ga4StaleCopy={null}
      refreshLedger={args.refreshLedger}
    />
  ) as ReactElement;
  return renderToStaticMarkup(tree);
}

describe("BUG 2 - needs-attention escalation banner", () => {
  it("GA4 with a needs_attention marker shows the honest dated banner, never 'login expired'", () => {
    const html = render({
      ga4: connectedGa4({
        needs_attention_at: "2026-07-11T00:00:00.000Z",
        needs_attention_since: "2026-06-30T00:00:00.000Z",
      }),
    });
    expect(html).toContain('data-recovery-fix="sync_failing"');
    expect(html).toContain('data-recovery-problem="sync_failing"');
    expect(html).toContain(
      "I have not been able to pull your data since June 30. Reconnecting usually fixes this.",
    );
    // Never claims revocation for an unproven-dead grant.
    expect(html).not.toContain("login expired");
  });

  it("a PROVEN-dead grant still wins (token_expired), even if the marker is also set", () => {
    const html = render({
      ga4: connectedGa4({
        auth_failed_at: "2026-07-05T00:00:00.000Z",
        needs_attention_at: "2026-07-11T00:00:00.000Z",
        needs_attention_since: "2026-06-30T00:00:00.000Z",
      }),
    });
    expect(html).toContain('data-recovery-fix="token_expired"');
    expect(html).toContain("Your Google Analytics login expired.");
    expect(html).not.toContain('data-recovery-fix="sync_failing"');
  });

  it("GSC also surfaces the escalation banner on its card", () => {
    const html = render({
      google: connectedGsc({
        needs_attention_at: "2026-07-11T00:00:00.000Z",
        needs_attention_since: "2026-06-30T00:00:00.000Z",
      }),
    });
    expect(html).toContain('data-recovery-fix="sync_failing"');
    expect(html).toContain("I have not been able to pull your data since June 30");
  });

  it("a healthy connector shows no escalation banner", () => {
    const html = render({ ga4: connectedGa4() });
    expect(html).not.toContain('data-recovery-fix="sync_failing"');
  });
});

describe("BUG 3 - per-source refresh ledger line", () => {
  it("renders 'last pulled / data through' and surfaces a silent partial as 'no new data'", () => {
    const html = render({
      ga4: connectedGa4(),
      refreshLedger: {
        ga4: {
          lastPulled: "2026-07-11T00:00:00.000Z",
          dataThrough: "2026-06-28",
          result: "partial",
          reason: "no new data",
        },
      },
    });
    expect(html).toContain('data-refresh-ledger="partial"');
    expect(html).toContain("data through Jun 28");
    expect(html).toContain("No new data came back that time.");
  });

  it("a healthy 'ok' ledger row shows the last-pulled facts without an alarm phrase", () => {
    const html = render({
      ga4: connectedGa4(),
      refreshLedger: {
        ga4: {
          lastPulled: "2026-07-11T00:00:00.000Z",
          dataThrough: "2026-07-08",
          result: "ok",
          reason: null,
        },
      },
    });
    expect(html).toContain('data-refresh-ledger="ok"');
    expect(html).toContain("data through Jul 8");
    expect(html).not.toContain("did not work");
    expect(html).not.toContain("No new data");
  });

  it("no ledger row for a source renders nothing (self-hides)", () => {
    const html = render({ ga4: connectedGa4(), refreshLedger: {} });
    expect(html).not.toContain("data-refresh-ledger");
  });
});
