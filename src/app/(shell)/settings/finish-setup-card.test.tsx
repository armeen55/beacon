/**
 * T0b render pins - the "Finish setting up" checklist card on /settings.
 * Self-hides when every item is done; renders one row per unfinished item
 * with the exact plainProblem + exactFix + deep link from the shared
 * recovery map (recovery-actions.ts), never a raw code or a second story.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { FinishSetupItem } from "@/domains/ops/finish-setup";

let items: FinishSetupItem[] = [];

vi.mock("@/domains/ops/finish-setup", () => ({
  loadFinishSetupChecklist: async () => items,
}));

import { FinishSetupCard } from "./finish-setup-card";

beforeEach(() => {
  items = [];
});

describe("FinishSetupCard", () => {
  it("renders nothing when every setup item is done", async () => {
    items = [];
    const html = renderToStaticMarkup(await FinishSetupCard());
    expect(html).toBe("");
  });

  it("renders one row per unfinished item, with its exact fix + deep link", async () => {
    items = [
      {
        kind: "revenue_model",
        plainProblem: "I do not know your unit economics yet, so I cannot turn traffic into a dollar estimate.",
        exactFix: "Open Business info and set your revenue model (per visit or per lead) so I can estimate dollars from real traffic.",
        href: "/settings/config",
      },
      {
        kind: "wix_page_mapping",
        plainProblem: "Wix is connected, but I have no page map, so I cannot publish approved changes to your site.",
        exactFix: "Open Wix page mapping, click Discover collections, then Save mapping for each page type.",
        href: "/diagnostics/wix",
        selfServe: { kind: "wix_map_collections" },
      },
    ];
    const html = renderToStaticMarkup(await FinishSetupCard());
    expect(html).toContain("Finish setting up");
    expect(html).toContain("2 things left");
    expect(html).toContain("I do not know your unit economics yet");
    expect(html).toContain('href="/settings/config"');
    expect(html).toContain("Wix is connected, but I have no page map");
    expect(html).toContain('href="/diagnostics/wix"');
    expect(html).toContain('data-finish-setup-item="revenue_model"');
    expect(html).toContain('data-finish-setup-item="wix_page_mapping"');
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("singular wording for exactly one item left", async () => {
    items = [
      {
        kind: "indexnow_key",
        plainProblem: "I am not telling Bing and other search engines the moment a page changes.",
        exactFix: "Open the connectors diagnostics page and generate an IndexNow key.",
        href: "/diagnostics/connectors",
      },
    ];
    const html = renderToStaticMarkup(await FinishSetupCard());
    expect(html).toContain("1 thing left");
  });

  it("a loader failure self-hides rather than crashing the settings page", async () => {
    vi.mocked(await import("@/domains/ops/finish-setup")).loadFinishSetupChecklist = vi
      .fn()
      .mockRejectedValue(new Error("boom"));
    const html = renderToStaticMarkup(await FinishSetupCard());
    expect(html).toBe("");
  });
});
