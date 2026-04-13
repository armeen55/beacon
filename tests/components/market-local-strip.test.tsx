import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { MarketLocalStrip } from "@/components/local/market-local-strip";
import type { MarketLocalStripModel } from "@/lib/local-presence";

describe("MarketLocalStrip", () => {
  it("renders tier, NAP label, reviews, footnote, and link", () => {
    const model: MarketLocalStripModel = {
      healthTierLabel: "Strong",
      napState: "complete",
      napDisplay: "Complete",
      reviewLine: "12 stored reviews, 4.5 avg (1–5)",
      listingCompletenessPhrase: null,
      footnote:
        "Based on imported or synced data. May not reflect full platform data. No automatic syncing.",
    };
    const html = renderToStaticMarkup(
      <MarketLocalStrip model={model} /> as ReactElement,
    );
    expect(html).toContain("Listing health:");
    expect(html).toContain("Strong");
    expect(html).toContain("NAP:");
    expect(html).toContain("Complete");
    expect(html).toContain("Reviews:");
    expect(html).toContain("12 stored");
    expect(html).toContain("/local");
    expect(html).toContain("Based on imported or synced data.");
    expect(html).not.toContain("Listing completeness:");
  });

  it("renders inconsistent NAP with danger tone", () => {
    const model: MarketLocalStripModel = {
      healthTierLabel: "OK",
      napState: "inconsistent",
      napDisplay: "Inconsistent",
      reviewLine: "5 stored reviews, 4.0 avg (1–5)",
      listingCompletenessPhrase: "Listing completeness: partial",
      footnote:
        "Based on imported or synced data. May not reflect full platform data. No automatic syncing.",
    };
    const html = renderToStaticMarkup(
      <MarketLocalStrip model={model} /> as ReactElement,
    );
    expect(html).toContain("Inconsistent");
    expect(html).toContain("text-status-danger");
  });

  it("renders incomplete NAP with warning tone", () => {
    const model: MarketLocalStripModel = {
      healthTierLabel: "Weak",
      napState: "incomplete",
      napDisplay: "Incomplete",
      reviewLine: "No review rows in Beacon yet",
      listingCompletenessPhrase: "Listing completeness: limited",
      footnote:
        "Based on imported or synced data. May not reflect full platform data. No automatic syncing.",
    };
    const html = renderToStaticMarkup(
      <MarketLocalStrip model={model} /> as ReactElement,
    );
    expect(html).toContain("Incomplete");
    expect(html).toContain("text-status-warning");
    expect(html).toContain("Listing completeness: limited");
  });
});
