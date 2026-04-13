import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { TodayLocalAttentionStrip } from "@/components/today/today-local-attention";
import type { TodayLocalAttention } from "@/lib/local-presence";

describe("TodayLocalAttentionStrip", () => {
  it("renders headline, facts, CTA, and footnote", () => {
    const attention: TodayLocalAttention = {
      headline: "Local presence needs attention",
      facts: ["No review rows in Beacon yet.", "NAP fields incomplete — missing phone."],
      href: "/local",
      footnote:
        "Based on imported or synced data. May not reflect full platform data. No automatic syncing.",
    };
    const html = renderToStaticMarkup(
      <TodayLocalAttentionStrip attention={attention} /> as ReactElement,
    );
    expect(html).toContain("Local presence needs attention");
    expect(html).toContain("No review rows in Beacon yet.");
    expect(html).toContain("Review local presence");
    expect(html).toContain('href="/local"');
    expect(html).toContain("Based on imported or synced data.");
  });
});
