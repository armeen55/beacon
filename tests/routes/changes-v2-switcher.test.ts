/**
 * Results timeline render contract (IA consolidation 2026-06-23).
 *
 * The /changes index merged INTO Results (/proof): the v2 proof timeline is now
 * rendered by <ResultsTimeline/> (embedded in the Results page). This pins that
 * the extracted component renders the v2 client (header suppressed). The
 * /changes index redirect itself is covered by changes-smoke.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/proof",
}));

vi.mock("@/lib/seed-data.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/seed-data.server")>();
  return { ...actual, hasActiveExperiment: async () => true };
});

vi.mock("@/app/(shell)/changes/changes-v2-client", () => {
  const React = require("react") as typeof import("react");
  return {
    ChangesV2Client: function ChangesV2ClientStub(props: {
      showHeader?: boolean;
    }) {
      return React.createElement(
        "div",
        {
          "data-changes-stub": "v2",
          "data-changes-stub-header": String(props.showHeader ?? true),
        },
        "changes-v2-stub",
      );
    },
  };
});

async function render(): Promise<string> {
  const { ResultsTimeline } = await import(
    "@/app/(shell)/changes/results-timeline"
  );
  const tree = await ResultsTimeline();
  return renderToStaticMarkup(tree as ReactElement);
}

describe("Results timeline render contract", () => {
  it("ResultsTimeline renders the v2 timeline with its header suppressed", async () => {
    const html = await render();
    expect(html).toContain('data-changes-stub="v2"');
    // Embedded in Results: the timeline's own PageHeader is suppressed
    // (Results shows the page header).
    expect(html).toContain('data-changes-stub-header="false"');
    // The deleted legacy table must never render.
    expect(html).not.toContain('data-changes-stub="legacy"');
  }, 15_000);
});
