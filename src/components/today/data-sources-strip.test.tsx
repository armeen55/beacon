/**
 * "Your data sources" quick-connect strip (2026-06-15; UX4 four-state split 2026-07-02).
 *
 * Pins the strip's render contract via the pure presentational view
 * (`DataSourcesStripView`), so we exercise fixed connected / not-connected /
 * all-connected states without a Supabase round-trip:
 *
 *   1. Not-connected sources render a labeled "Connect" link pointing at the
 *      real connect entry point (the connectors page / its card anchor).
 *   2. Connected (fully healthy) sources render a "Connected" state (✓) —
 *      never a Connect link — and show last-synced copy when available.
 *   3. needs_attention sources (connected in the token store but NOT actually
 *      delivering data — e.g. GA4 with no property picked, or never synced)
 *      render an honest ⚠ treatment with the plain-English reason — NEVER the
 *      success-green ✓ — and deep-link to the connectors page to fix it.
 *   4. ALL six fully connected → the heavy strip collapses to a tiny
 *      confirmation naming the four distinct counts (Connected / Healthy /
 *      Fresh / Has data, UX4 item 3) instead of a single "all connected"
 *      claim, so it can never contradict an alert shown above it. A single
 *      needs_attention source keeps the full strip visible.
 *   5. Connect affordances are accessible (each carries an aria-label naming
 *      the source) and tap-target sized (min-h-[44px]).
 *
 * Markup-only assertions (renderToStaticMarkup) — no behavior to drive. The
 * strip no longer mounts a refresh button (UX4 item 6 moved that control to
 * the page header), so no router stub is needed here.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DataSourcesStripView } from "./data-sources-strip";
import type { ConnectorHealth, ConnectorProvider } from "@/lib/connector-store";

type StatusInput = {
  provider: ConnectorProvider;
  label: string;
  /** `connected: true` is sugar for a fully-healthy source (health "connected"). */
  connected?: boolean;
  health?: ConnectorHealth;
  healthReason?: string | null;
  lastSynced?: string | null;
};

const ALL_SIX: StatusInput[] = [
  { provider: "google_gsc", label: "Google Search Console" },
  { provider: "google_ga4", label: "Google Analytics 4" },
  { provider: "semrush", label: "SEMrush" },
  { provider: "clarity", label: "Microsoft Clarity" },
  { provider: "profound", label: "Profound" },
  { provider: "wix", label: "Wix" },
];

function resolveHealth(patch: Partial<StatusInput> | undefined): ConnectorHealth {
  if (patch?.health != null) return patch.health;
  if (patch?.connected === true) return "connected";
  return "not_connected";
}

function statuses(over: Partial<Record<ConnectorProvider, Partial<StatusInput>>> = {}) {
  return ALL_SIX.map((s) => {
    const patch = over[s.provider];
    const health = resolveHealth(patch);
    return {
      source: { provider: s.provider, label: s.label, cardAnchor: null },
      health,
      healthReason: patch?.healthReason ?? null,
      lastSynced: patch?.lastSynced ?? null,
      // A fully-healthy fixture source is treated as synced just now (fresh); every
      // other state has no sync timestamp, matching readStatuses' real behavior.
      lastSyncedAtIso: health === "connected" ? new Date().toISOString() : null,
      // Wave 3A: the real data-through clock is not threaded at this layer yet, so the
      // freshness line falls back to the sync stamp above (null-honest here too).
      dataThroughIso: null,
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
    expect(html).not.toMatch(/automatically|on a schedule|nightly|tonight|last night|overnight/i);
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

describe("DataSourcesStripView — needs_attention state", () => {
  it("renders an amber-dot treatment (not the success state) with the reason for a connected-but-not-delivering source", () => {
    const html = render({
      google_ga4: {
        health: "needs_attention",
        healthReason:
          "Connected — pick your Analytics property to start pulling data.",
      },
    });
    // The honest reason is the visible text.
    expect(html).toContain(
      "Connected — pick your Analytics property to start pulling data.",
    );
    // Warning glyph present; the success glyph must NOT be used for this source.
    // Item 51 redesign: the warning is a colored status DOT (amber), not a unicode glyph.
    expect(html).toContain("bg-status-warning");
    // Accessible name says "needs attention" + the reason — never "connected".
    expect(html).toContain('aria-label="Google Analytics 4: needs attention.');
    expect(html).not.toContain('aria-label="Google Analytics 4: connected"');
    // It deep-links to the connectors page to fix it (not a passive label).
    expect(html).toContain('href="/settings/connectors"');
    // It is NOT presented as a plain "Connect →" not-connected source either.
    expect(html).not.toContain('aria-label="Connect Google Analytics 4"');
  });

  it("renders the never-synced reason for a connected source with no first reading", () => {
    const html = render({
      semrush: {
        health: "needs_attention",
        healthReason: "Connected — click Refresh my data to pull your first reading.",
      },
    });
    expect(html).toContain(
      "Connected — click Refresh my data to pull your first reading.",
    );
    expect(html).toContain('aria-label="SEMrush: needs attention.');
    expect(html).toContain("min-h-[44px]");
  });

  it("does NOT use the success-green ✓ markup for a needs_attention source", () => {
    const onlyAttention = render({
      google_ga4: {
        health: "needs_attention",
        healthReason:
          "Connected — pick your Analytics property to start pulling data.",
      },
    });
    // The success-state border class only appears on a fully-healthy ✓ chip,
    // which this fixture has none of.
    expect(onlyAttention).not.toContain("border-status-success/40");
    // Honest copy invariant still holds — no phantom-automation claims.
    expect(onlyAttention).not.toMatch(/automatically|on a schedule|nightly|tonight|last night|overnight/i);
  });

  it("keeps the full strip visible (no all-connected collapse) when one source needs attention", () => {
    const html = render({
      google_gsc: { connected: true },
      google_ga4: {
        health: "needs_attention",
        healthReason:
          "Connected — pick your Analytics property to start pulling data.",
      },
      semrush: { connected: true },
      clarity: { connected: true },
      profound: { connected: true },
      wix: { connected: true },
    });
    // The collapse confirmation must NOT appear while a source needs attention.
    expect(html).not.toContain("6 connected, 6 healthy");
    expect(html).toContain(
      "Connected — pick your Analytics property to start pulling data.",
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
    // Wave 3A: freshness-first health line - the required sources (GSC, Profound, Clarity) are
    // all within SLA, so it reports currency + the oldest data-through, never a bare count.
    expect(html).toContain("Your key sources are current");
    // No Connect affordances at all in the all-connected confirmation.
    expect(html).not.toContain("Connect →");
    expect(html).not.toContain('aria-label="Connect');
    // Still offers a way into the connectors page to manage them.
    expect(html).toContain('href="/settings/connectors"');
  });

  it("never claims a blanket \"all connected\" state (UX4 item 3 removed that phrase)", () => {
    const html = render({
      google_gsc: { connected: true },
      google_ga4: { connected: true },
      semrush: { connected: true },
      clarity: { connected: true },
      profound: { connected: true },
      wix: { connected: true },
    });
    expect(html).not.toContain("All data sources connected");
  });
});

describe("DataSourcesStripView - freshness-first health line (Wave 3A)", () => {
  it("names the gap when a REQUIRED source is not current (never a bare connected count)", () => {
    const html = render({
      google_gsc: { connected: true },
      // Clarity is a REQUIRED source; degraded (no data flowing) it makes the line report a gap.
      clarity: {
        health: "needs_attention",
        healthReason: "Connected. Click Refresh my data to pull your first reading.",
      },
      semrush: { connected: true },
      profound: { connected: true },
      wix: { connected: true },
    });
    // The health line reports the attention gap, never "6 connected, 6 healthy".
    expect(html).toContain("key source");
    expect(html).toContain("need");
    expect(html).not.toContain("6 connected, 6 healthy");
  });

  it("a degraded GA4 (a removed source) never blocks the required-source freshness verdict", () => {
    const html = render({
      google_gsc: { connected: true },
      google_ga4: {
        health: "needs_attention",
        healthReason: "Connected. Pick your Analytics property to start pulling data.",
      },
      semrush: { connected: true },
      clarity: { connected: true },
      profound: { connected: true },
      wix: { connected: true },
    });
    // GSC + Profound + Clarity are all current; GA4 is removed (excluded), so the line reads current.
    expect(html).toContain("Your key sources are current");
  });

  it("reports the gap when required sources have never connected", () => {
    const html = render({
      google_gsc: { connected: true },
      google_ga4: { connected: true },
    });
    // Profound + Clarity (required) have no data; the line names the gap, not a connected count.
    expect(html).toContain("key sources need attention");
    expect(html).not.toContain("2 connected, 2 healthy");
  });
});
