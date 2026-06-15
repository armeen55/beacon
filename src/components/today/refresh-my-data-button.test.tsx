/**
 * 2026-06-15 — "Refresh my data" result list render contract.
 *
 * Pins the pure presentational `RefreshResultList` via renderToStaticMarkup
 * (no client state to drive):
 *   1. Shows a ✓ for successes and a ✗ for failures, alongside each label +
 *      detail line.
 *   2. White-label invariant: never renders the vendor name "Profound" — the
 *      AEO source is labeled "AI answers".
 *
 * (The button shell itself is a client island with hooks; only the pure list
 * is exercised here, matching the strip's markup-only test posture.)
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RefreshResultList } from "./refresh-my-data-button";

describe("RefreshResultList", () => {
  it("renders ✓/✗ + label + detail for each source", () => {
    const html = renderToStaticMarkup(
      <RefreshResultList
        results={[
          {
            provider: "google_gsc",
            label: "Search (Google)",
            ok: true,
            detail: "Synced 100 rows · 5 days.",
          },
          {
            provider: "google_ga4",
            label: "Visitors (Google Analytics)",
            ok: false,
            detail: "Couldn't refresh just now — please try again in a moment.",
          },
        ]}
      />,
    );
    expect(html).toContain("✓");
    expect(html).toContain("✗");
    expect(html).toContain("Search (Google)");
    expect(html).toContain("Visitors (Google Analytics)");
    expect(html).toContain("Synced 100 rows · 5 days.");
    expect(html).toContain("try again");
  });

  it("never renders the vendor name 'Profound' (white-label) — uses 'AI answers'", () => {
    const html = renderToStaticMarkup(
      <RefreshResultList
        results={[
          {
            provider: "profound",
            label: "AI answers",
            ok: true,
            detail: "Synced 7 rows.",
          },
        ]}
      />,
    );
    expect(html).toContain("AI answers");
    expect(html).not.toContain("Profound");
  });

  it("renders nothing for an empty result list", () => {
    const html = renderToStaticMarkup(<RefreshResultList results={[]} />);
    expect(html).toBe("");
  });
});
