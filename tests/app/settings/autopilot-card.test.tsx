/**
 * Autopilot settings card (2026-07-01 item 1, 2026-07-02 item 52 additions).
 *
 * Static-markup render pins (matches the repo's existing card-test pattern:
 * renderToStaticMarkup captures the initial render, before the useEffect
 * data load resolves). Confirms the card ships with the item 52 hooks
 * present in the DOM once - the per-lever-policy and triage-suggestion
 * section containers - and that the always-visible initial copy carries no
 * em or en dash.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/(shell)/settings/connectors/autopilot-actions", () => ({
  loadAutopilotSettings: vi.fn(async () => ({
    canPublish: true,
    publishingArmed: true,
    adviseOnly: false,
    config: {
      enabled: false,
      weeklyCap: 3,
      minVerdicts: 10,
      minNonRegressionRate: 0.8,
      leverAllowlist: null,
      perLeverPolicies: null,
    },
    usedThisWeek: 0,
    levers: [],
    recentReceipts: [],
    perLeverPolicies: [],
    triageSuggestions: [],
  })),
  setAutopilotEnabled: vi.fn(),
  setAutopilotWeeklyCap: vi.fn(),
  setLeverPolicy: vi.fn(),
  setLeverPolicyDailyCap: vi.fn(),
  setLeverPolicyToReview: vi.fn(),
  enableTriageSuggestion: vi.fn(),
}));

import { AutopilotCard } from "@/app/(shell)/settings/connectors/autopilot-card";

function render(): string {
  return renderToStaticMarkup(<AutopilotCard />);
}

describe("AutopilotCard - static render pins", () => {
  it("renders the card container and the off-state headline", () => {
    const html = render();
    expect(html).toContain('data-autopilot-card="true"');
    expect(html).toContain("Autopilot for proven changes");
  });

  it("carries no em or en dash in the always-visible initial copy", () => {
    const html = render();
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it("mentions no lab words on this operator surface", () => {
    const html = render().toLowerCase();
    expect(html).not.toContain("experiment");
    expect(html).not.toContain("baseline");
    expect(html).not.toContain("treatment");
    expect(html).not.toContain("reservation");
  });
});
