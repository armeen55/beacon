/**
 * "Your data sources" quick-connect strip (2026-06-15).
 *
 * Pins the strip's render contract via the pure presentational view
 * (`DataSourcesStripView`), so we exercise fixed connected / not-connected /
 * all-connected states without a Supabase round-trip:
 *
 *   1. Not-connected sources render a labeled "Connect" link pointing at the
 *      real connect entry point (the connectors page / its card anchor).
 *   2. Connected sources render a "Connected" state (✓) — never a Connect
 *      link — and show last-synced copy when available.
 *   3. ALL six connected → the heavy strip collapses to a tiny
 *      "All data sources connected" confirmation (no per-source list).
 *   4. Connect affordances are accessible (each carries an aria-label naming
 *      the source) and tap-target sized (min-h-[44px]).
 *
 * Markup-only assertions (renderToStaticMarkup) — no behavior to drive.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The strip now mounts the <RefreshMyDataButton /> client island, which calls
// useRouter(). Stub next/navigation so renderToStaticMarkup can render the
// button shell without a real Next router context.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { DataSourcesStripView } from "./data-sources-strip";
import type { ConnectorProvider } from "@/lib/connector-store";

type StatusInput = {
  provider: ConnectorProvider;
  label: string;
  connected: boolean;
  lastSynced?: string | null;
};

const ALL_SIX: StatusInput[] = [
  { provider: "google_gsc", label: "Google Search Console", connected: false },
  { provider: "google_ga4", label: "Google Analytics 4", connected: false },
  { provider: "semrush", label: "SEMrush", connected: false },
  { provider: "clarity", label: "Microsoft Clarity", connected: false },
  { provider: "profound", label: "Profound", connected: false },
  { provider: "wix", label: "Wix", connected: false },
];

function statuses(over: Partial<Record<ConnectorProvider, Partial<StatusInput>>> = {}) {
  return ALL_SIX.map((s) => {
    const patch = over[s.provider];
    return {
      source: { provider: s.provider, label: s.label, cardAnchor: null },
      connected: patch?.connected ?? s.connected,
      lastSynced: patch?.lastSynced ?? null,
    };
  });
}

function render(over?: Parameters<typeof statuses>[0]) {
  return renderToStaticMarkup(<DataSourcesStripView statuses={statuses(over)} />);
}

describe("DataSourcesStripView — not-connected state", () => {
  it("renders a labeled Connect link for every not-connected source", () => {
    const html = render();
    // All six names present.
    expect(html).toContain("Google Search Console");
    expect(html).toContain("Google Analytics 4");
    expect(html).toContain("SEMrush");
    expect(html).toContain("Microsoft Clarity");
    expect(html).toContain("Profound");
    expect(html).toContain("Wix");
    // Each not-connected source exposes a labeled connect affordance.
    expect(html).toContain('aria-label="Connect Google Search Console"');
    expect(html).toContain('aria-label="Connect Wix"');
    // Connect targets the real connect entry point (the connectors page).
    expect(html).toContain('href="/settings/connectors"');
    // Honest copy — Connect arrow, no phantom-automation claims.
    expect(html).toContain("Connect →");
    expect(html).not.toMatch(/automatically|on a schedule|nightly/i);
  });

  it("gives connect affordances a >=44px tap target", () => {
    const html = render();
    expect(html).toContain("min-h-[44px]");
  });
});

describe("DataSourcesStripView — connected state", () => {
  it("shows a Connected state (no Connect link) for connected sources", () => {
    const html = render({ google_gsc: { connected: true } });
    expect(html).toContain('aria-label="Google Search Console: connected"');
    // The GSC source must NOT also render a Connect affordance.
    expect(html).not.toContain('aria-label="Connect Google Search Console"');
    // Other sources are still connectable.
    expect(html).toContain('aria-label="Connect SEMrush"');
  });

  it("surfaces last-synced copy when available", () => {
    const html = render({
      google_ga4: { connected: true, lastSynced: "synced 2 days ago" },
    });
    expect(html).toContain("synced 2 days ago");
    expect(html).toContain(
      'aria-label="Google Analytics 4: connected, synced 2 days ago"',
    );
  });
});

describe("DataSourcesStripView — all-connected state", () => {
  it("collapses to a tiny confirmation (no per-source Connect list) when all six connect", () => {
    const html = render({
      google_gsc: { connected: true },
      google_ga4: { connected: true },
      semrush: { connected: true },
      clarity: { connected: true },
      profound: { connected: true },
      wix: { connected: true },
    });
    expect(html).toContain("All data sources connected");
    // No Connect affordances at all in the all-connected confirmation.
    expect(html).not.toContain("Connect →");
    expect(html).not.toContain('aria-label="Connect');
    // Still offers a way into the connectors page to manage them.
    expect(html).toContain('href="/settings/connectors"');
  });
});
