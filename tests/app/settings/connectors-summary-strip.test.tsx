/**
 * FP10a (2026-07-02) — /settings/connectors summary strip render tests.
 *
 * The diagnosis this slice fixes: the same three facts (what's connected,
 * whether automatic on-use upkeep worked, that nothing auto-publishes without a
 * click) were stated five-plus times down the page, and connected sources
 * forced a read through four stacked paragraphs of onboarding copy for
 * connections made weeks ago.
 *
 * Pins:
 *   • the summary strip renders "N of M connected" via the Pill primitive,
 *     with the health color following connected count + autonomous state;
 *   • "Automatic upkeep: <state>" renders from pre-composed receipt evidence;
 *   • connected sources collapse into a <details> with a "Manage" affordance
 *     that reveals the disconnect/sync-now controls, not open by default;
 *   • the once-repeated "never changes your live site without approval"
 *     fact now appears exactly once, in the single intro sentence under the
 *     strip, not simultaneously in a nightly-job box + a "what you'll get"
 *     box + per-connector footers.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/connectors",
}));

import { ConnectorsClient } from "@/app/(shell)/settings/connectors/connectors-client";
import type { ConnectorInfo } from "@/lib/connector-store";

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

function render(over: {
  google?: ConnectorInfo;
  ga4?: ConnectorInfo;
  wix?: ConnectorInfo;
  profound?: ConnectorInfo;
  clarity?: ConnectorInfo;
  connectedCount?: number;
  totalCount?: number;
  autonomousState?: "ok" | "working" | "issues" | "none";
  autonomousHeadline?: string;
} = {}) {
  return renderToStaticMarkup(
    <ConnectorsClient
      google={over.google ?? off}
      googleSelectedLocation={null}
      ga4={over.ga4 ?? off}
      wix={over.wix ?? off}
      profound={over.profound ?? off}
      clarity={over.clarity ?? off}
      gscStaleCopy={null}
      ga4StaleCopy={null}
      connectedCount={over.connectedCount ?? 0}
      totalCount={over.totalCount ?? 5}
      autonomousState={over.autonomousState ?? "none"}
      autonomousHeadline={over.autonomousHeadline ?? "starts when you use Beacon."}
    />,
  );
}

describe("connectors summary strip", () => {
  it("renders 'N of M connected' via the Pill primitive with a neutral color when nothing is connected", () => {
    const html = render({ connectedCount: 0, totalCount: 5 });
    expect(html).toContain('data-connectors-summary-strip="true"');
    expect(html).toContain('data-slot="pill"');
    expect(html).toContain('data-intent="neutral"');
    expect(html).toContain("0 of 5 connected");
    expect(html).toContain("Automatic upkeep: starts when you use Beacon.");
  });

  it("renders a 'waiting' color when some but not all sources are connected", () => {
    const html = render({ connectedCount: 2, totalCount: 5, autonomousState: "ok" });
    expect(html).toContain('data-intent="waiting"');
    expect(html).toContain("2 of 5 connected");
  });

  it("renders a 'live' color when every source is connected and last sync was clean", () => {
    const html = render({ connectedCount: 5, totalCount: 5, autonomousState: "ok" });
    expect(html).toContain('data-intent="live"');
    expect(html).toContain("5 of 5 connected");
  });

  it("renders an 'attention' color when the last sync had issues, even if fully connected", () => {
    const html = render({
      connectedCount: 5,
      totalCount: 5,
      autonomousState: "issues",
      autonomousHeadline: "1 connected source needs attention.",
    });
    expect(html).toContain('data-intent="attention"');
    expect(html).toContain("Automatic upkeep: 1 connected source needs attention.");
  });

  it("uses a waiting color while the post-response cycle is working", () => {
    const html = render({ connectedCount: 5, totalCount: 5, autonomousState: "working" });
    expect(html).toContain('data-intent="waiting"');
  });

  it("states the never-auto-publish fact exactly once, not in a separate nightly-job box and a separate 'what you'll get' box", () => {
    const html = render();
    const matches = html.match(/never do on my own is change your live site/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("connected sources collapse to one line", () => {
  it("renders a connected GSC source as a collapsed <details> with a Manage affordance, not expanded controls by default", () => {
    const html = render({
      google: { ...on, status: "connected" },
      connectedCount: 1,
    });
    expect(html).toContain("<details");
    expect(html).toContain('data-connector-card="google-gsc"');
    // The one-line summary states what it feeds + last sync.
    expect(html).toContain("Feeds what people search to find you.");
    expect(html).toContain("Manage");
    // Manage/disconnect controls still exist in the markup (reachable on
    // expand), just not as a second always-visible paragraph block.
    expect(html).toContain("Disconnect Google");
  });

  it("renders a connected Wix source collapsed with its one-line summary", () => {
    const html = render({ wix: on, connectedCount: 1 });
    expect(html).toContain("<details");
    expect(html).toContain('data-connector-card="wix"');
    expect(html).toContain("Publishes approved edits to your live site.");
    expect(html).toContain("Disconnect");
  });

  it("unconnected sources keep a setup card trimmed to one short paragraph (no stacked four-paragraph explainer)", () => {
    const html = render();
    // Extract the Wix disconnected card block and count top-level <p> intro
    // paragraphs before the form fields start (the setup-instructions
    // paragraph + input labels are separate, expected structure).
    const wixCardStart = html.indexOf('data-connector-card="wix"');
    const wixCardSlice = html.slice(wixCardStart, wixCardStart + 700);
    // Exactly one plain-English "why connect this" paragraph, not four.
    expect(wixCardSlice).toContain(
      "Connect your Wix site so I can prepare publish-ready edits.",
    );
  });
});
