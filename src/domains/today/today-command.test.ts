/**
 * today-command (Wave 3B) - the ONE Today command model. Pins the deterministic priority
 * (defect > material loss > top move > observe), the exact operator copy for each kind, the
 * boundary edges (defect beats a larger loss; a loss at exactly 10 clicks lost fires but 9 does
 * not; a site drop at exactly the threshold fires; ship only with a top opportunity; observe when
 * empty), the one-CTA invariant, and that no produced copy carries an em or en dash.
 */
import { describe, it, expect } from "vitest";

import {
  buildTodayCommand,
  changeFocusHref,
  LOSS_DELTA_PCT,
  type TodayCommand,
  type TodayCommandInput,
} from "./today-command";
import { buildTodaySmokeAlarm } from "@/components/today/today-smoke-alarm";
import type { TodayOpportunity } from "@/domains/changes/today-view";

const BANNED_DASH = /[\u2012\u2013\u2014\u2015]/;

function base(overrides: Partial<TodayCommandInput> = {}): TodayCommandInput {
  return {
    pipelineAlarms: [],
    smokeAlarm: null,
    scoreboardDeltaPct: null,
    topOpportunity: null,
    firstReadOn: null,
    measuringCount: 0,
    ...overrides,
  };
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

/** The smoke alarm the way the page builds it: from real decay rows through the real gate
 *  (MIN_CLICKS_LOST = 10, MIN_PRIOR_CLICKS = 25), so the "10 vs 9" edge is exercised end to end. */
function smokeAlarmLosing(clicksLost: number, page = "/nowruz", fixReady = true) {
  const clicksPrior = 200;
  return buildTodaySmokeAlarm({
    decay: [{ page, clicksNow: clicksPrior - clicksLost, clicksPrior }],
    pagesWithFixReady: fixReady ? new Set([page]) : new Set<string>(),
  });
}

function allCopy(c: TodayCommand): string {
  return [c.headline, ...c.why, c.exactAction, c.cta?.label ?? ""].join(" ");
}

describe("buildTodayCommand priority", () => {
  it("fix_defect fires when the pipe has a red-tier violation", () => {
    const c = buildTodayCommand(base({ pipelineAlarms: ["Search Console wrote 0 rows last night."] }));
    expect(c.kind).toBe("fix_defect");
    expect(c.headline).toBe("Something is broken, so today's numbers are not trustworthy yet.");
    expect(c.why).toContain("Search Console wrote 0 rows last night.");
    expect(c.cta).not.toBeNull();
  });

  it("a defect beats a larger loss (numbers off a broken pipe are not trustworthy)", () => {
    const c = buildTodayCommand(
      base({
        pipelineAlarms: ["Search Console wrote 0 rows last night."],
        smokeAlarm: smokeAlarmLosing(500),
        scoreboardDeltaPct: -80,
        topOpportunity: opportunity(),
      }),
    );
    expect(c.kind).toBe("fix_defect");
  });

  it("respond_to_loss fires on a page smoke alarm, naming the page and the 4-week clicks", () => {
    const c = buildTodayCommand(base({ smokeAlarm: smokeAlarmLosing(128) }));
    expect(c.kind).toBe("respond_to_loss");
    expect(c.headline).toBe("Your biggest problem today: /nowruz lost 128 clicks in the last 4 weeks.");
    expect(c.cta?.label).toBe("See the fix");
  });

  it("respond_to_loss fires on a whole-site drop at exactly the threshold, no page needed", () => {
    const c = buildTodayCommand(base({ scoreboardDeltaPct: LOSS_DELTA_PCT }));
    expect(c.kind).toBe("respond_to_loss");
    expect(c.headline).toContain("down 10% over the last 7 days");
  });

  it("ship_move fires only when a top opportunity exists and there is no defect or loss", () => {
    const c = buildTodayCommand(base({ topOpportunity: opportunity(), scoreboardDeltaPct: 4 }));
    expect(c.kind).toBe("ship_move");
    expect(c.headline).toBe("Do this next: Rewrite the title to match search intent.");
    expect(c.cta?.href).toBe(changeFocusHref("tenant-a::/flags::title"));
    // the demand number and the evidence + effort read as the evidence lines
    expect(c.why.join(" ")).toContain("about 40 more clicks a month");
    expect(c.why.join(" ")).toContain("Strong comparison");
    expect(c.why.join(" ")).toContain("5 minutes of work");
  });

  it("observe when nothing needs a decision, naming the measuring count and the next-read date", () => {
    const c = buildTodayCommand(base({ measuringCount: 3, firstReadOn: "2026-07-18" }));
    expect(c.kind).toBe("observe");
    expect(c.headline).toBe("Nothing needs a decision today. Keep measuring.");
    expect(c.why.join(" ")).toContain("3 changes are measuring right now.");
    expect(c.why.join(" ")).toContain("The next results land around Jul 18.");
    expect(c.cta).toEqual({ label: "See what's measuring", href: "/results" });
  });

  it("observe on a fresh empty tenant points at Changes instead of Results", () => {
    const c = buildTodayCommand(base());
    expect(c.kind).toBe("observe");
    expect(c.cta).toEqual({ label: "Open Changes", href: "/changes" });
  });
});

describe("buildTodayCommand loss threshold edges", () => {
  it("a page that lost exactly 10 clicks fires respond_to_loss", () => {
    const alarm = smokeAlarmLosing(10);
    expect(alarm).not.toBeNull();
    expect(buildTodayCommand(base({ smokeAlarm: alarm })).kind).toBe("respond_to_loss");
  });

  it("a page that lost only 9 clicks does not fire a loss (no alarm, falls through)", () => {
    const alarm = smokeAlarmLosing(9);
    expect(alarm).toBeNull();
    // With no alarm and no opportunity, it lands on observe rather than respond_to_loss.
    expect(buildTodayCommand(base({ smokeAlarm: alarm })).kind).toBe("observe");
  });

  it("a whole-site drop of 9% does not fire a loss, but 10% does", () => {
    expect(buildTodayCommand(base({ scoreboardDeltaPct: -9 })).kind).toBe("observe");
    expect(buildTodayCommand(base({ scoreboardDeltaPct: -10 })).kind).toBe("respond_to_loss");
  });
});

describe("buildTodayCommand invariants", () => {
  const cases: TodayCommand[] = [
    buildTodayCommand(base({ pipelineAlarms: ["Search Console wrote 0 rows last night."] })),
    buildTodayCommand(base({ smokeAlarm: smokeAlarmLosing(128) })),
    buildTodayCommand(base({ topOpportunity: opportunity() })),
    buildTodayCommand(base({ measuringCount: 2, firstReadOn: "2026-07-18" })),
  ];

  it("every kind produces exactly one CTA", () => {
    for (const c of cases) {
      expect(c.cta, `kind ${c.kind} must have one CTA`).not.toBeNull();
      expect(typeof c.cta?.href).toBe("string");
      expect(typeof c.cta?.label).toBe("string");
    }
  });

  it("no produced copy carries an em or en dash", () => {
    for (const c of cases) {
      expect(BANNED_DASH.test(allCopy(c)), `dash in kind ${c.kind}`).toBe(false);
    }
  });

  it("every kind produces a headline and at least one evidence line", () => {
    for (const c of cases) {
      expect(c.headline.length).toBeGreaterThan(0);
      expect(c.why.length).toBeGreaterThanOrEqual(1);
      expect(c.exactAction.length).toBeGreaterThan(0);
    }
  });
});
