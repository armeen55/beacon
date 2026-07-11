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
  commandAllowsCelebration,
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
    // P2-c (2026-07-10, visual audit) - standardized to "vs the week before" (was "over the
    // last 7 days"), matching the SAME phrase the page-smoke-alarm branch uses for this
    // identical last-7-vs-prior-7 delta.
    expect(c.headline).toContain("down 10% vs the week before");
  });

  // P2-c - both branches that name the whole-site week-over-week delta use the identical
  // phrase, so the operator never reads them as two different measurements of one number.
  it("uses the identical phrase for the whole-site delta whether or not a page is also blamed", () => {
    const withPage = buildTodayCommand(base({ smokeAlarm: smokeAlarmLosing(128), scoreboardDeltaPct: -12 }));
    const withoutPage = buildTodayCommand(base({ scoreboardDeltaPct: -12 }));
    expect(withPage.why.join(" ")).toContain("down 12% vs the week before");
    expect(withoutPage.headline).toContain("down 12% vs the week before");
  });

  it("ship_move fires only when a top opportunity exists and there is no defect or loss", () => {
    const c = buildTodayCommand(base({ topOpportunity: opportunity(), scoreboardDeltaPct: 4 }));
    expect(c.kind).toBe("ship_move");
    expect(c.headline).toBe("Do this next: Rewrite the title to match search intent.");
    expect(c.cta?.href).toBe(changeFocusHref("tenant-a::/flags::title"));
    // the demand number and the evidence + effort read as the evidence lines
    expect(c.why.join(" ")).toContain("about 40 more clicks a month");
    // P2-d (2026-07-10, visual audit) - the command card uses its own plain evidence words
    // (COMMAND_EVIDENCE_WORD), never the Changes list's EVIDENCE_LABEL chip text
    // ("Directional signal." / "Tracking only." read as lab jargon inside the ONE command).
    expect(c.why.join(" ")).toContain("Strong comparison behind it.");
    expect(c.why.join(" ")).toContain("5 minutes of work");
  });

  it("P2-d: the evidence bullet uses plain words for every tier, never the Changes list's EVIDENCE_LABEL jargon", () => {
    const directional = buildTodayCommand(base({ topOpportunity: opportunity({ evidenceStrength: "directional" }) }));
    const tracking = buildTodayCommand(base({ topOpportunity: opportunity({ evidenceStrength: "tracking" }) }));
    expect(directional.why.join(" ")).toContain("Early evidence, worth doing.");
    expect(tracking.why.join(" ")).toContain("Still building evidence for this one.");
    for (const c of [directional, tracking]) {
      expect(c.why.join(" ")).not.toContain("Directional signal");
      expect(c.why.join(" ")).not.toContain("Tracking only");
    }
  });

  // P2-b (2026-07-10, visual audit) - the observe command must NOT repeat the measuring count
  // or the next-read date; the proof strip right below it (Today slot 5) is the sole owner of
  // both. The command only points at what is measuring, in plain words.
  it("observe when nothing needs a decision points at what is measuring, without repeating its count or date", () => {
    const c = buildTodayCommand(base({ measuringCount: 3, firstReadOn: "2026-07-18" }));
    expect(c.kind).toBe("observe");
    expect(c.headline).toBe("Nothing needs a decision today. Keep measuring.");
    expect(c.why.join(" ")).toContain("Your active changes are still measuring below.");
    expect(c.why.join(" ")).not.toMatch(/\d/); // no repeated count or date, digit-free
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

// P1-5 (2026-07-10, visual audit) - the Today greeting must never celebrate a shipping streak
// ("you are on a roll") directly above a command that says something is broken or losing. The
// audit's exact live contradiction: "16 changes shipped in the last 14 days, you are on a roll."
// sat right above "Your biggest problem today: ... lost 163 clicks." commandAllowsCelebration is
// the one gate page.tsx's greeting reads before appending the celebratory clause.
describe("commandAllowsCelebration - the greeting never celebrates when the command is a problem", () => {
  it("forbids celebration for a defect or a loss - today's two problem kinds", () => {
    expect(commandAllowsCelebration("fix_defect")).toBe(false);
    expect(commandAllowsCelebration("respond_to_loss")).toBe(false);
  });

  it("allows celebration for a normal move or a quiet observe day", () => {
    expect(commandAllowsCelebration("ship_move")).toBe(true);
    expect(commandAllowsCelebration("observe")).toBe(true);
  });

  it("agrees with buildTodayCommand's real output for the audit's exact scenario (a losing page)", () => {
    const command = buildTodayCommand(base({ smokeAlarm: smokeAlarmLosing(163) }));
    expect(command.kind).toBe("respond_to_loss");
    expect(commandAllowsCelebration(command.kind)).toBe(false);
  });
});
