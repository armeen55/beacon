import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/**
 * Market route pulls several client sections (hooks). Same pattern as Today /
 * Pages / Changes: stub the slots so `renderToStaticMarkup` in Vitest never runs
 * client hooks, including when import + citation data is present locally.
 */
vi.mock("@/app/(shell)/competitors/competitors-manage-client", () => {
  const React = require("react") as typeof import("react");
  return {
    CompetitorsManageClient: function CompetitorsManageClientSmokeStub() {
      return React.createElement("div", {
        className: "competitors-manage-smoke-stub",
      });
    },
  };
});

vi.mock("@/app/(shell)/competitors/co-mention-section", () => {
  const React = require("react") as typeof import("react");
  return {
    CoMentionSection: function CoMentionSectionSmokeStub() {
      return React.createElement("div", { className: "co-mention-smoke-stub" });
    },
  };
});

vi.mock("@/app/(shell)/competitors/source-trust-section", () => {
  const React = require("react") as typeof import("react");
  return {
    SourceTrustSection: function SourceTrustSectionSmokeStub() {
      return React.createElement("div", {
        className: "source-trust-smoke-stub",
      });
    },
  };
});

vi.mock("@/app/(shell)/competitors/local-pressure-section", () => {
  const React = require("react") as typeof import("react");
  return {
    LocalPressureSection: function LocalPressureSectionSmokeStub() {
      return React.createElement("div", {
        className: "local-pressure-smoke-stub",
      });
    },
  };
});

vi.mock("@/app/(shell)/competitors/battlecard-section", () => {
  const React = require("react") as typeof import("react");
  return {
    BattlecardSection: function BattlecardSectionSmokeStub() {
      return React.createElement("div", {
        className: "battlecard-smoke-stub",
      });
    },
  };
});

describe("Market route smoke", () => {
  it("CompetitorsPage RSC loads data and renders shell wrapper plus Market header copy", async () => {
    const { default: CompetitorsPage } = await import(
      "@/app/(shell)/competitors/page"
    );
    const tree = await CompetitorsPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    // Stable wrapper from `src/app/(shell)/competitors/page.tsx` (demo + full paths).
    expect(html).toContain("max-w-4xl");
    // PageHeader description — same on import-empty and full Market surfaces.
    expect(html).toContain(
      "Who beats you, where they beat you, and exactly what to do about it.",
    );
  });
});
