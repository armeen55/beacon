/**
 * TodayCommandCard - the ONE command block (Wave 3B), trimmed suite (Core 100K
 * Phase 6). Absorbs the smoke-alarm builder boundary cases (today-smoke-alarm).
 * Rendered for real via renderToStaticMarkup.
 *
 * Pins: exactly one accent CTA per kind (rendered as an accent button, never an
 * underlined link), the rendered copy per command kind, a11y roles, tenant
 * isolation, and the smoke alarm's small-sample floor + dated window honesty.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayCommandCard } from "@/components/today/today-command-card";
import { buildTodayCommand, type TodayCommandInput } from "@/domains/today/today-command";
import { buildTodaySmokeAlarm } from "@/components/today/today-smoke-alarm";
import type { TodayOpportunity } from "@/domains/today/today-command";

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

const KINDS: TodayCommandInput[] = [
  base({ pipelineAlarms: ["Search Console wrote 0 rows last night."] }),
  base({ smokeAlarm: alarm128 }),
  base({ topOpportunity: opportunity() }),
  base({ measuringCount: 2, firstReadOn: "2026-07-18" }),
];

describe("TodayCommandCard - exactly one accent CTA, rendered as a button", () => {
  it("every kind renders ONE accent CTA styled as a filled button, never an underlined link", () => {
    for (const input of KINDS) {
      const markup = renderToStaticMarkup(<TodayCommandCard command={buildTodayCommand(input)} />);
      expect((markup.match(/data-command-cta="true"/g) ?? []).length).toBe(1);
      const ctaTag = markup.match(/<a[^>]*data-command-cta="true"[^>]*>/)![0];
      expect(ctaTag).toContain("bg-accent-primary");
      expect(ctaTag).not.toContain("underline");
    }
  });
});

describe("TodayCommandCard - rendered copy per kind", () => {
  it("fix_defect leads with the broken-numbers warning as an alert", () => {
    const markup = renderToStaticMarkup(
      <TodayCommandCard command={buildTodayCommand(base({ pipelineAlarms: ["Search Console wrote 0 rows last night."] }))} />,
    );
    const t = text(markup);
    expect(t).toContain("Something is broken, so today's numbers are not trustworthy yet.");
    expect(t).toContain("Check your connections ->");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toMatch(/[‒–—―]/);
  });

  it("background recovery is calm and never tells the operator to fix it", () => {
    const markup = renderToStaticMarkup(
      <TodayCommandCard command={buildTodayCommand(base({
        pipelineAlarms: ["The weekly new-page batch did not finish."],
        dataTrustBroken: false,
      }))} />,
    );
    const t = text(markup);
    expect(t).toContain("Working in background");
    expect(t).toContain("Google numbers are still trustworthy");
    expect(t).not.toContain("Fix this first");
    expect(markup).not.toContain('role="alert"');
  });

  it("respond_to_loss names the page and the exact click loss", () => {
    const markup = renderToStaticMarkup(<TodayCommandCard command={buildTodayCommand(base({ smokeAlarm: alarm128 }))} />);
    const t = text(markup);
    expect(t).toContain("Your biggest problem today: /nowruz lost 128 clicks vs the previous 4 weeks.");
    expect(t).toContain("See the fix ->");
    expect(markup).toContain('role="alert"');
  });

  it("ship_move names the move, the upside, and deep-links the change", () => {
    const markup = renderToStaticMarkup(<TodayCommandCard command={buildTodayCommand(base({ topOpportunity: opportunity() }))} />);
    const t = text(markup);
    expect(t).toContain("Do this next: Rewrite the title to match search intent.");
    expect(t).toContain("about 40 more clicks a month");
    expect(markup).toContain(`href="/changes?focus=${encodeURIComponent("tenant-a::/flags::title")}"`);
  });

  it("observe owns the calm reassurance, is not an alert, and points at the proof strip", () => {
    const markup = renderToStaticMarkup(
      <TodayCommandCard command={buildTodayCommand(base({ measuringCount: 3, firstReadOn: "2026-07-18" }))} />,
    );
    const t = text(markup);
    expect(t).toContain("Nothing needs a decision today. Keep measuring.");
    expect(t).toContain("Your active changes are still measuring below.");
    expect(markup).not.toContain('role="alert"');
    expect(markup).toMatch(/aria-label="[^"]+"/);
    expect(markup).toContain('data-command-kind="observe"');
  });
});

describe("buildTodaySmokeAlarm - boundary honesty", () => {
  it("returns null under the loss floor and for drops off a tiny prior base", () => {
    expect(
      buildTodaySmokeAlarm({
        decay: [{ page: "/a", clicksNow: 98, clicksPrior: 100 }],
        pagesWithFixReady: new Set(),
      }),
    ).toBeNull();
    expect(
      buildTodaySmokeAlarm({
        decay: [{ page: "/tiny", clicksNow: 1, clicksPrior: 15 }],
        pagesWithFixReady: new Set(),
      }),
    ).toBeNull();
  });

  it("names the worst-bleeding page, the exact loss, and the dated window; never the undated phrasing", () => {
    const r = buildTodaySmokeAlarm({
      decay: [
        { page: "/nowruz", clicksNow: 42, clicksPrior: 60 },
        { page: "/other", clicksNow: 90, clicksPrior: 100 },
      ],
      pagesWithFixReady: new Set(),
      windowEnd: "2026-07-09",
    });
    expect(r!.page).toBe("/nowruz");
    expect(r!.clicksLost).toBe(18);
    expect(r!.windowLabel).toBe("the previous 4 weeks (data through Jul 9)");
    expect(r!.sentence).not.toContain("in the last 4 weeks");
    expect(r!.sentence).not.toMatch(/[‒–—―]/);
  });

  it("says 'I have a fix ready' only when a fix is queued for the bleeding page", () => {
    const r = buildTodaySmokeAlarm({
      decay: [{ page: "/nowruz", clicksNow: 42, clicksPrior: 60 }],
      pagesWithFixReady: new Set(["/nowruz"]),
    });
    expect(r!.sentence).toContain("I have a fix ready.");
    expect(r!.actionLabel).toBe("See the fix");
  });
});
