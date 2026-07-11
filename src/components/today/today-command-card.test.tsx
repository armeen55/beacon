/**
 * today-command-card (Wave 3B) render pins - the ONE command block (slot 2). Pins the exact
 * rendered copy for each of the four kinds, the single-CTA invariant (exactly one accent CTA, the
 * only accent element above the fold), a11y basics (role + accessible label), and that two
 * tenants render their own copy. Rendered for real via renderToStaticMarkup (repo convention).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayCommandCard } from "./today-command-card";
import { buildTodayCommand, type TodayCommandInput } from "@/domains/today/today-command";
import { buildTodaySmokeAlarm } from "./today-smoke-alarm";
import type { TodayOpportunity } from "@/domains/changes/today-view";

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&rarr;|→/g, "->")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function base(overrides: Partial<TodayCommandInput> = {}): TodayCommandInput {
  return { pipelineAlarms: [], smokeAlarm: null, scoreboardDeltaPct: null, topOpportunity: null, firstReadOn: null, measuringCount: 0, ...overrides };
}

function opportunity(overrides: Partial<TodayOpportunity> = {}): TodayOpportunity {
  return {
    changeId: "tenant-a::/flags::title",
    pageLabel: "/flags",
    recommendation: "Rewrite the title to match search intent",
    opportunityType: "title",
    estimatedEffortMinutes: 5,
    upside: 40,
    evidenceStrength: "strong",
    ...overrides,
  };
}

const alarm128 = buildTodaySmokeAlarm({
  decay: [{ page: "/nowruz", clicksNow: 72, clicksPrior: 200 }],
  pagesWithFixReady: new Set(["/nowruz"]),
});

function ctaCount(markup: string): number {
  return (markup.match(/data-command-cta="true"/g) ?? []).length;
}

describe("TodayCommandCard - exactly one CTA per kind", () => {
  const kinds: TodayCommandInput[] = [
    base({ pipelineAlarms: ["Search Console wrote 0 rows last night."] }),
    base({ smokeAlarm: alarm128 }),
    base({ topOpportunity: opportunity() }),
    base({ measuringCount: 2, firstReadOn: "2026-07-18" }),
  ];
  it("renders exactly one accent CTA in every kind (the only accent element above the fold)", () => {
    for (const input of kinds) {
      const markup = renderToStaticMarkup(<TodayCommandCard command={buildTodayCommand(input)} />);
      expect(ctaCount(markup)).toBe(1);
    }
  });
});

describe("TodayCommandCard - rendered copy per kind", () => {
  it("fix_defect", () => {
    const markup = renderToStaticMarkup(
      <TodayCommandCard command={buildTodayCommand(base({ pipelineAlarms: ["Search Console wrote 0 rows last night."] }))} />,
    );
    const t = text(markup);
    expect(t).toContain("Something is broken, so today's numbers are not trustworthy yet.");
    expect(t).toContain("Search Console wrote 0 rows last night.");
    expect(t).toContain("Check your connections ->");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
  });

  it("respond_to_loss", () => {
    const markup = renderToStaticMarkup(<TodayCommandCard command={buildTodayCommand(base({ smokeAlarm: alarm128 }))} />);
    const t = text(markup);
    expect(t).toContain("Your biggest problem today: /nowruz lost 128 clicks in the last 4 weeks.");
    expect(t).toContain("See the fix ->");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
  });

  it("ship_move", () => {
    const markup = renderToStaticMarkup(<TodayCommandCard command={buildTodayCommand(base({ topOpportunity: opportunity() }))} />);
    const t = text(markup);
    expect(t).toContain("Do this next: Rewrite the title to match search intent.");
    expect(t).toContain("about 40 more clicks a month");
    expect(t).toContain("See the change ->");
    expect(markup).toContain(`href="/changes?focus=${encodeURIComponent("tenant-a::/flags::title")}"`);
    expect(markup).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
  });

  it("observe", () => {
    const markup = renderToStaticMarkup(
      <TodayCommandCard command={buildTodayCommand(base({ measuringCount: 3, firstReadOn: "2026-07-18" }))} />,
    );
    const t = text(markup);
    expect(t).toContain("Nothing needs a decision today. Keep measuring.");
    expect(t).toContain("3 changes are measuring right now.");
    expect(t).toContain("The next results land around Jul 18.");
    expect(t).toContain("See what's measuring ->");
    expect(markup).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
  });
});

describe("TodayCommandCard - a11y basics", () => {
  it("alert kinds carry role=alert and an accessible label", () => {
    const markup = renderToStaticMarkup(<TodayCommandCard command={buildTodayCommand(base({ smokeAlarm: alarm128 }))} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toMatch(/aria-label="[^"]+"/);
  });
  it("a calm observe card is not an alert but is still labelled", () => {
    const markup = renderToStaticMarkup(<TodayCommandCard command={buildTodayCommand(base({ measuringCount: 1, firstReadOn: "2026-07-18" }))} />);
    expect(markup).not.toContain('role="alert"');
    expect(markup).toMatch(/aria-label="[^"]+"/);
    expect(markup).toContain('data-command-kind="observe"');
  });
});

describe("TodayCommandCard - two tenants render their own command", () => {
  it("each tenant's ship_move names its own page and deep-links to its own change", () => {
    const a = renderToStaticMarkup(
      <TodayCommandCard command={buildTodayCommand(base({ topOpportunity: opportunity({ changeId: "tenant-a::/flags::title", pageLabel: "/flags", recommendation: "Rewrite the title on flags" }) }))} />,
    );
    const b = renderToStaticMarkup(
      <TodayCommandCard command={buildTodayCommand(base({ topOpportunity: opportunity({ changeId: "tenant-b::/rugs::title", pageLabel: "/rugs", recommendation: "Add an answer block to rugs" }) }))} />,
    );
    expect(text(a)).toContain("Do this next: Rewrite the title on flags.");
    expect(a).toContain(`href="/changes?focus=${encodeURIComponent("tenant-a::/flags::title")}"`);
    expect(text(b)).toContain("Do this next: Add an answer block to rugs.");
    expect(b).toContain(`href="/changes?focus=${encodeURIComponent("tenant-b::/rugs::title")}"`);
    expect(a).not.toContain("tenant-b");
    expect(b).not.toContain("tenant-a");
  });
});
