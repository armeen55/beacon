import { describe, expect, it } from "vitest";
import {
  computeLeverRetirementDecisions, RetirementIndex, retirementLine,
  RETIRE_LOSS_THRESHOLD, RETEST_AFTER_DAYS, type SettledLeverRow,
} from "./lever-retirement";
import { actionFamilyOf } from "./experiment-eligibility";
import { pageFamilyOf } from "./daily-experiment-planner";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const NOW = new Date("2026-07-01T00:00:00Z");

const row = (path: string, actionType: string, verdict: SettledLeverRow["verdict"], settledAt: string): SettledLeverRow => ({
  path, actionType, verdict, settledAt,
});

function decisions(rows: SettledLeverRow[], now: Date = NOW) {
  return computeLeverRetirementDecisions(rows, now, pageFamilyOf, actionFamilyOf);
}

describe("computeLeverRetirementDecisions - retire threshold + zero-wins requirement", () => {
  it("does NOT retire with 2 losses (below threshold)", () => {
    const rows = [
      row("/cities/tehran", "edit_title", "lost", "2026-01-01T00:00:00Z"),
      row("/cities/shiraz", "edit_title", "lost", "2026-01-10T00:00:00Z"),
    ];
    const d = decisions(rows);
    expect(d).toHaveLength(1);
    expect(d[0].status).toBe("active");
    expect(d[0].lossCount).toBe(2);
  });

  it(`retires at exactly ${RETIRE_LOSS_THRESHOLD} settled losses with zero wins`, () => {
    const rows = [
      row("/cities/tehran", "edit_title", "lost", "2026-01-01T00:00:00Z"),
      row("/cities/shiraz", "edit_title", "lost", "2026-01-10T00:00:00Z"),
      row("/cities/isfahan", "edit_title", "lost", "2026-01-20T00:00:00Z"),
    ];
    // A "now" right after the 3rd loss - well inside the 90 day wait, so the fresh retirement
    // itself (not the later retest-due transition) is what this test pins.
    const d = decisions(rows, new Date("2026-01-21T00:00:00Z"));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ pageFamily: "cities", lever: "title", status: "retired", lossCount: 3, winCount: 0 });
    expect(d[0].retiredAtIso).toBe("2026-01-20T00:00:00.000Z"); // the 3rd (threshold-crossing) loss
  });

  it("does NOT retire when the cell has ANY win, even with 3+ losses", () => {
    const rows = [
      row("/cities/tehran", "edit_title", "lost", "2026-01-01T00:00:00Z"),
      row("/cities/shiraz", "edit_title", "lost", "2026-01-10T00:00:00Z"),
      row("/cities/isfahan", "edit_title", "lost", "2026-01-20T00:00:00Z"),
      row("/cities/yazd", "edit_title", "won", "2026-01-25T00:00:00Z"),
    ];
    const d = decisions(rows);
    expect(d[0].status).toBe("active");
    expect(d[0].winCount).toBe(1);
    expect(d[0].lossCount).toBe(3);
  });

  it("inconclusive rows count toward neither bucket and never trigger retirement alone", () => {
    const rows = [
      row("/cities/a", "edit_title", "inconclusive", "2026-01-01T00:00:00Z"),
      row("/cities/b", "edit_title", "inconclusive", "2026-01-10T00:00:00Z"),
      row("/cities/c", "edit_title", "inconclusive", "2026-01-20T00:00:00Z"),
    ];
    const d = decisions(rows);
    expect(d).toHaveLength(0); // no losses at all -> lossCount 0 -> filtered out entirely
  });

  it("keeps page families and lever families distinct cells (no cross-contamination)", () => {
    const rows = [
      row("/cities/a", "edit_title", "lost", "2026-01-01T00:00:00Z"),
      row("/cities/b", "edit_title", "lost", "2026-01-10T00:00:00Z"),
      row("/cities/c", "edit_meta_description", "lost", "2026-01-20T00:00:00Z"), // different lever, same family
      row("/iran-flags/a", "edit_title", "lost", "2026-01-01T00:00:00Z"), // same lever, different family
    ];
    const d = decisions(rows);
    // cities::title has 2 losses (not retired); cities::meta has 1; iran-flags::title has 1
    const citiesTitle = d.find((x) => x.pageFamily === "cities" && x.lever === "title");
    expect(citiesTitle?.status).toBe("active");
    expect(citiesTitle?.lossCount).toBe(2);
    expect(d.every((x) => x.status === "active")).toBe(true);
  });
});

describe("computeLeverRetirementDecisions - 90 day retest", () => {
  const threeLosses = [
    row("/cities/tehran", "edit_title", "lost", "2026-01-01T00:00:00Z"),
    row("/cities/shiraz", "edit_title", "lost", "2026-01-10T00:00:00Z"),
    row("/cities/isfahan", "edit_title", "lost", "2026-01-20T00:00:00Z"),
  ];

  it("stays 'retired' (not yet due) before 90 days pass", () => {
    const almostThere = new Date(Date.parse("2026-01-20T00:00:00Z") + (RETEST_AFTER_DAYS - 1) * 86_400_000);
    const d = decisions(threeLosses, almostThere);
    expect(d[0].status).toBe("retired");
  });

  it("becomes 'retest_due' exactly at the 90 day mark", () => {
    const exactlyThere = new Date(Date.parse("2026-01-20T00:00:00Z") + RETEST_AFTER_DAYS * 86_400_000);
    const d = decisions(threeLosses, exactlyThere);
    expect(d[0].status).toBe("retest_due");
    expect(d[0].retestAfterIso).toBe(exactlyThere.toISOString());
  });

  it("stays 'retest_due' well past the 90 day mark (no further decay)", () => {
    const wayLater = new Date(Date.parse("2026-01-20T00:00:00Z") + 400 * 86_400_000);
    const d = decisions(threeLosses, wayLater);
    expect(d[0].status).toBe("retest_due");
  });
});

describe("computeLeverRetirementDecisions - re-retire on retest loss / full unsuppress on retest win", () => {
  it("a retest LOSS re-retires the cell and RESETS the 90 day clock to the retest loss's own date", () => {
    const rows = [
      row("/cities/tehran", "edit_title", "lost", "2026-01-01T00:00:00Z"),
      row("/cities/shiraz", "edit_title", "lost", "2026-01-10T00:00:00Z"),
      row("/cities/isfahan", "edit_title", "lost", "2026-01-20T00:00:00Z"), // retires here
      row("/cities/yazd", "edit_title", "lost", "2026-04-25T00:00:00Z"), // the single retest, settles as a loss
    ];
    const d = decisions(rows, new Date("2026-05-01T00:00:00Z"));
    expect(d[0].status).toBe("retired"); // freshly re-retired, clock restarted
    expect(d[0].retiredAtIso).toBe(new Date("2026-04-25T00:00:00Z").toISOString());
    expect(d[0].lossCount).toBe(4);
    const newRetestAfter = new Date(Date.parse("2026-04-25T00:00:00Z") + RETEST_AFTER_DAYS * 86_400_000);
    expect(d[0].retestAfterIso).toBe(newRetestAfter.toISOString());
  });

  it("a retest WIN fully unsuppresses the cell permanently", () => {
    const rows = [
      row("/cities/tehran", "edit_title", "lost", "2026-01-01T00:00:00Z"),
      row("/cities/shiraz", "edit_title", "lost", "2026-01-10T00:00:00Z"),
      row("/cities/isfahan", "edit_title", "lost", "2026-01-20T00:00:00Z"), // retires here
      row("/cities/yazd", "edit_title", "won", "2026-04-25T00:00:00Z"), // the single retest, settles as a win
    ];
    const d = decisions(rows, new Date("2026-05-01T00:00:00Z"));
    expect(d[0].status).toBe("active");
    expect(d[0].winCount).toBe(1);
    expect(d[0].retiredAtIso).toBeNull();
  });
});

describe("RetirementIndex - single-candidate retest gating", () => {
  it("blocks every candidate in a fully 'retired' (not yet due) cell", () => {
    const stillWaiting = new Date("2026-01-21T00:00:00Z"); // 1 day after the 3rd loss, well inside 90 days
    const idx = new RetirementIndex(decisions([
      row("/cities/a", "edit_title", "lost", "2026-01-01T00:00:00Z"),
      row("/cities/b", "edit_title", "lost", "2026-01-10T00:00:00Z"),
      row("/cities/c", "edit_title", "lost", "2026-01-20T00:00:00Z"),
    ], stillWaiting));
    expect(idx.admit("cities", "title")).toMatchObject({ blocked: true, retest: false });
    expect(idx.admit("cities", "title")).toMatchObject({ blocked: true, retest: false });
  });

  it("admits EXACTLY ONE candidate through a 'retest_due' cell, blocks the rest", () => {
    const due = new Date(Date.parse("2026-01-20T00:00:00Z") + RETEST_AFTER_DAYS * 86_400_000);
    const idx = new RetirementIndex(decisions([
      row("/cities/a", "edit_title", "lost", "2026-01-01T00:00:00Z"),
      row("/cities/b", "edit_title", "lost", "2026-01-10T00:00:00Z"),
      row("/cities/c", "edit_title", "lost", "2026-01-20T00:00:00Z"),
    ], due));
    const first = idx.admit("cities", "title");
    expect(first).toMatchObject({ blocked: false, retest: true });
    const second = idx.admit("cities", "title");
    expect(second).toMatchObject({ blocked: true, retest: false });
    const third = idx.admit("cities", "title");
    expect(third).toMatchObject({ blocked: true, retest: false });
  });

  it("never blocks an active or absent cell", () => {
    const idx = new RetirementIndex([]);
    expect(idx.admit("cities", "title")).toMatchObject({ blocked: false, retest: false });
    expect(idx.admit("iran-flags", "meta")).toMatchObject({ blocked: false, retest: false });
  });
});

describe("retirementLine - plain first-person copy", () => {
  it("returns null for an active/absent cell", () => {
    expect(retirementLine(undefined)).toBeNull();
    const active = decisions([row("/cities/a", "edit_title", "lost", "2026-01-01T00:00:00Z")])[0];
    expect(retirementLine(active)).toBeNull();
  });

  it("says the plain lever + family + loss count when retired", () => {
    const stillWaiting = new Date("2026-01-21T00:00:00Z");
    const d = decisions([
      row("/cities/a", "edit_title", "lost", "2026-01-01T00:00:00Z"),
      row("/cities/b", "edit_title", "lost", "2026-01-10T00:00:00Z"),
      row("/cities/c", "edit_title", "lost", "2026-01-20T00:00:00Z"),
    ], stillWaiting)[0];
    const line = retirementLine(d);
    expect(line).toContain("I stopped");
    expect(line).toContain("title change");
    expect(line).toContain("cities pages");
    expect(line).toContain("lost 3 times");
    expect(line).toContain("I will retest it once in");
  });

  it("says it is ready to retest when the cell is retest_due", () => {
    const due = new Date(Date.parse("2026-01-20T00:00:00Z") + RETEST_AFTER_DAYS * 86_400_000);
    const d = decisions([
      row("/cities/a", "edit_title", "lost", "2026-01-01T00:00:00Z"),
      row("/cities/b", "edit_title", "lost", "2026-01-10T00:00:00Z"),
      row("/cities/c", "edit_title", "lost", "2026-01-20T00:00:00Z"),
    ], due)[0];
    const line = retirementLine(d);
    expect(line).toContain("I am ready to retest it once now.");
  });

  it("never contains a banned em or en dash", () => {
    const d = decisions([
      row("/cities/a", "edit_title", "lost", "2026-01-01T00:00:00Z"),
      row("/cities/b", "edit_title", "lost", "2026-01-10T00:00:00Z"),
      row("/cities/c", "edit_title", "lost", "2026-01-20T00:00:00Z"),
    ], NOW)[0];
    const line = retirementLine(d);
    expect(hasBannedDash(line)).toBe(false);
  });
});
