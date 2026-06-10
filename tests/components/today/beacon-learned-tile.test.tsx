/**
 * Phase A.2 (Section 3.6) — "Beacon learned" tile render contract.
 * Pins the 3 states + customer-safe copy (no forbidden vocabulary).
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BeaconLearnedTile,
  type BeaconLearnedState,
} from "@/components/today/beacon-learned-tile";

function render(state: BeaconLearnedState): string {
  return renderToStaticMarkup(<BeaconLearnedTile state={state} />);
}

describe("BeaconLearnedTile — states", () => {
  it("hidden → renders nothing", () => {
    expect(render({ kind: "hidden" })).toBe("");
  });

  it("per_tenant → shows the Beacon-owned citation-timing insight", () => {
    const html = render({ kind: "per_tenant", medianDays: 7, sampleSize: 22 });
    expect(html).toContain("Beacon learned from your site");
    expect(html).toContain("7 days");
    expect(html).toContain("22");
    expect(html).toContain("not a borrowed benchmark");
    expect(html).toContain('data-today-beacon-learned="true"');
  });

  it("network → shows the pre-scrubbed pattern description + sample", () => {
    const html = render({
      kind: "network",
      description: "Adding a cost section typically earns citations faster.",
      sampleSize: 12,
    });
    expect(html).toContain("Adding a cost section");
    expect(html).toContain("12");
  });
});

describe("BeaconLearnedTile — customer-safe copy", () => {
  const FORBIDDEN = [
    "Mode A",
    "Mode B",
    "Mode C",
    "drove",
    "caused",
    "generated",
    "revenue",
    "dollars",
    "process-global",
    "helpingRate",
    "matchKey",
    "sampleSize",
    "tenant",
  ];

  it("no forbidden vocabulary in any rendered state", () => {
    const htmls = [
      render({ kind: "per_tenant", medianDays: 7, sampleSize: 22 }),
      render({
        kind: "network",
        description: "Adding a cost section helps.",
        sampleSize: 12,
      }),
    ];
    for (const html of htmls) {
      for (const term of FORBIDDEN) {
        expect(html.toLowerCase()).not.toContain(term.toLowerCase());
      }
    }
  });
});
