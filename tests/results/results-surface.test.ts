import { describe, expect, it } from "vitest";
import { evaluateChange, evaluateWindows, type KernelInput } from "@/domains/measurement/proof-gsc/kernel";
import type { ShipmentVerification } from "@/domains/measurement";
import { buildResultsView, type ShipmentPresentation } from "@/app/(shell)/results/results-presentation";

/** RESULTS, WHOLE. These pin what a customer READS on the surface, not how it is computed: the three header
 *  numbers, which answer a change belongs to, the one line it gets, and what opening it says. Fixtures only,
 *  zero network. The promise that matters most: a read shared with a later change is never painted as this
 *  change's own win, and a number nobody has read is blank rather than zero. */

const NOW = new Date("2026-06-01T00:00:00Z");
const SHIPPED = "2026-05-01";
const WINDOWS = evaluateWindows(SHIPPED, NOW, "2026-06-01");

const win = (day: 7 | 14 | 28, over: Partial<KernelInput["windows"][number]> = {}) => ({
  day, ran: true, adjustedClicksLift: 40, adjustedCtrLift: 0.02, adjustedPosLift: 0,
  adjustedImpressionsLift: 120, controlsUsed: 3, treatedPostImpressions: 5000, ...over,
});
const input = (over: Partial<KernelInput> = {}): KernelInput => ({
  id: "c1", page: "https://site.com/nowruz", path: "/nowruz", actionType: "section_add",
  shippedAt: SHIPPED, implementedAt: SHIPPED, baselineImpressions: 9100, baselineClicks: 200,
  windows: [win(7), win(14), win(28)],
  componentKinds: ["title", "section_add"], diagnosisCause: "ctr_snippet", evidenceItemCount: 6, ...over,
});
const VERIFICATION: ShipmentVerification = {
  status: "partially_verified", checkedAt: "2026-05-03T09:00:00Z",
  components: [{ kind: "title", state: "verified", note: null }],
};
const shipment = (over: Partial<ShipmentPresentation> = {}): ShipmentPresentation => ({
  read: evaluateChange(input(), WINDOWS, []), implementedAt: `${SHIPPED}T12:00:00Z`, verification: VERIFICATION,
  baseline: { clicks: 200, impressions: 9100, windowDays: 28, capturedAt: `${SHIPPED}T12:00:00Z` },
  basisMove: { clicks: 61, impressions: 900 }, ...over,
});
const only = (over: Partial<ShipmentPresentation> = {}) => buildResultsView([shipment(over)]).rows;
const first = (over: Partial<ShipmentPresentation> = {}) => {
  const rows = only(over);
  return (["worked", "down", "flat", "reading"] as const).map((g) => rows[g][0]).find((r) => r != null)!;
};
const measuring = evaluateChange(input({ windows: [] }), evaluateWindows(SHIPPED, new Date("2026-05-03T00:00:00Z"), "2026-05-03"), []);
const declined = evaluateChange(input({ windows: [win(7, { adjustedClicksLift: -30 }), win(14, { adjustedClicksLift: -30 }), win(28, { adjustedClicksLift: -30 })] }), WINDOWS, []);

describe("the three numbers at the top", () => {
  it("counts only the changes that finished their 28 day read, and adds up what those won", () => {
    const view = buildResultsView([shipment(), shipment({ read: declined }), shipment({ read: measuring })]);
    // BANKED FRAMING: the denominator is every finished read, and the ones that did not win are named as what they taught.
    expect(view.header.worked).toEqual({ value: "1 win", sub: "out of 2 finished; the rest taught what does not move this site", isCount: true });
    expect(view.header.appearances).toEqual({ value: "+120", positive: true });
    expect(view.header.reading.value).toBe("1");
    expect(view.header.reading.sub).toMatch(/^next result lands /);
    expect(view.counts).toEqual({ worked: 1, down: 1, flat: 0, reading: 1 });
    expect(view.defaultGroup).toBe("worked");
  });
  it("never says nothing worked out of nothing: with no read finished it says when the first one lands", () => {
    const view = buildResultsView([shipment({ read: measuring })]);
    expect([view.header.worked.value, view.header.worked.isCount, view.header.appearances.value])
      .toEqual(["First result lands May 8", false, "Not enough read yet"]);
    expect(view.defaultGroup).toBe("reading");
  });
});

describe("one change gets one line", () => {
  it("puts a win in Worked with its own number, its bar and its appearances", () => {
    const row = first();
    expect([row.group, row.verdictWord, row.dot]).toEqual(["worked", "Worked", "emerald"]);
    expect([row.liftLabel, row.impressionsLabel, row.readLabel, row.pipCaption, row.work])
      .toEqual(["+40 clicks ahead", "+120", "28 day read done", "Done May 29", "a new section"]);
    expect(row.pips).toEqual([{ day: 7, state: "read" }, { day: 14, state: "read" }, { day: 28, state: "read" }]);
    expect([row.bar! > 0, row.barOpacity]).toEqual([true, 1]);
  });
  it("calls a loss a loss and an early win a work in progress, and never grades them on different rules", () => {
    expect(first({ read: declined }).verdictWord).toBe("Went down");
    expect([first({ read: declined }).liftLabel, first({ read: declined }).happened]).toEqual(["-30 clicks behind", "Ran 28 days and finished 30 clicks behind similar pages that were not changed."]);
    const early = evaluateChange(input({ windows: [win(7)] }), evaluateWindows(SHIPPED, new Date("2026-05-09T00:00:00Z"), "2026-05-09"), []);
    expect(first({ read: early }).verdictWord).toBe("Working so far");
    expect(first({ read: early }).happened).toBe("7 days in and sitting 40 clicks ahead of similar pages that were not changed.");
  });
  it("claims no number on a read shared with a later change, and says so in amber", () => {
    const row = buildResultsView([shipment({ read: evaluateChange(input({ windows: [win(28)] }), WINDOWS, ["c2"]) })]).rows.flat[0]!;
    expect(row.verdictWord).toBe("Shared with a later change");
    expect([row.liftLabel, row.impressionsLabel, row.bar]).toEqual([null, null, null]);
    expect(row.chip).toEqual({ text: "Shared with a later change", amber: true });
    expect(row.happened).toContain("landed on this page at the same time");
  });
  it("paints a read that a later change shares as shared, never as this change's own", () => {
    const row = first({ read: evaluateChange(input(), WINDOWS, ["c2"], "2026-05-10") });
    expect(row.pips.map((p) => p.state)).toEqual(["read", "shared", "shared"]);
    expect(row.caveats[0]).toBe("This page changed again on May 10. The days after that belong to both changes.");
  });
  it("says what has been read instead of a number while a change is still reading", () => {
    const row = first({ read: measuring });
    expect([row.group, row.verdictWord, row.dot]).toEqual(["reading", "Reading", "sky"]);
    expect([row.liftLabel, row.impressionsLabel, row.bar]).toEqual([null, null, null]);
    expect(row.readLabel).toBe("Nothing read yet");
    expect(row.pipCaption).toBe("Next May 8");
    expect(row.happened).toBe("Nothing read yet. The first result lands May 8.");
    expect(row.nextStep).toBe("Nothing to do until May 8.");
  });
});

describe("opening a change says what happened, on what, and what to do next", () => {
  it("gives one sentence, the before and after, the dates, and one next step", () => {
    const row = first();
    expect(row.happened).toBe("Ran 28 days and finished 40 clicks ahead of similar pages that were not changed.");
    expect(row.numbers).toEqual({ before: ["200", "9,100"], after: ["261", "10,000"] });
    expect(row.timeline).toEqual([
      { label: "Marked done May 1", done: true },
      { label: "Live page checked May 3", done: true },
      { label: "28 day read May 29", done: true },
    ]);
    expect(row.taught).toBe("This page read as the line searchers saw not matching what they typed, it was answered with a content change, the page moved up after it. That carries into what gets recommended next on pages like this one. Backed by 6 checks.");
    expect(row.nextStep).toBe("Do this again on a similar page.");
    expect(first({ read: declined }).nextStep).toBe("Put the old wording back, then measure again.");
  });
  it("never invents a date or a number it was not given", () => {
    const bare = first({ implementedAt: null, baseline: null, verification: null, basisMove: null });
    expect(bare.timeline[0]).toEqual({ label: "Marked done, date not kept", done: true });
    expect(bare.timeline[1]).toEqual({ label: "Live page not read yet", done: false });
    expect(bare.chip).toEqual({ text: "Live page not read yet", amber: false });
    expect(bare.numbers).toBeNull();
    const noTraffic = first({ baseline: { clicks: 0, impressions: 0, windowDays: 28, capturedAt: SHIPPED } });
    expect([noTraffic.numbersNote, noTraffic.impressionsLabel]).toEqual(["No Google traffic on file.", null]);
  });
});

describe("no Results string reaches the operator carrying jargon", () => {
  it("prints no slug, no raw date stamp, no lab word, no first person and no dash", () => {
    const view = buildResultsView([
      shipment(), shipment({ read: declined }), shipment({ read: measuring }),
      shipment({ read: evaluateChange(input(), WINDOWS, ["c2"], "2026-05-10") }),
      shipment({ implementedAt: null, baseline: null, verification: null, basisMove: null }),
    ]);
    const strings = (["worked", "down", "flat", "reading"] as const).flatMap((g) => view.rows[g]).flatMap((r) => [
      r.work, r.verdictWord, r.liftLabel ?? "", r.readLabel ?? "", r.pipCaption ?? "", r.chip?.text ?? "",
      r.happened, r.numbersNote ?? "", ...r.caveats, ...r.timeline.map((t) => t.label), r.taught, r.nextStep,
    ]).concat([view.header.worked.value, view.header.worked.sub, view.header.appearances.value, view.header.reading.sub]);
    for (const s of strings) {
      expect(s, `dash in: ${s}`).not.toMatch(/[–—]/);
      expect(s, `raw date stamp in: ${s}`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(s, `slug in: ${s}`).not.toMatch(/[a-z]+_[a-z]+/);
      expect(s, `first person in: ${s}`).not.toMatch(/\b(I|me|my|we|our)\b/);
      expect(s.toLowerCase(), `lab word in: ${s}`)
        .not.toMatch(/\b(experiment|control|controls|baseline|treatment|serp|observational|directional|confounded|evidence|window)\b/);
    }
  });
});

/** THE SAME TWO VOCABULARIES REACH THE SCREEN. A row's action word is a KIND ("title") or the FAMILY the bundle
 *  producer stamps ("title-family"). Only the kinds were mapped, so every bundle this account shipped read as the
 *  shrug "this change" while a real label existed. And a change nothing can grade, or compare, says which. */
describe("what the screen calls the work, and what it will not promise", () => {
  it("names a family spelling in the operator's words, never as a shrug and never as its slug", () => {
    for (const [action, work] of [["title-family", "the title and headline"], ["section-family", "the content on the page"],
      ["links-family", "the internal links"], ["technical-family", "the technical setup"], ["title", "the page title"]] as const) {
      expect(first({ read: evaluateChange(input({ actionType: action }), WINDOWS, []) }).work).toBe(work);
    }
    const ungradable = first({ read: evaluateChange(input({ actionType: "other" }), WINDOWS, []) }); // nothing can grade it, so nothing is claimed
    expect([ungradable.verdictWord, ungradable.liftLabel, ungradable.bar, ungradable.nextStep]).toEqual(["Not judged", null, null, "Nothing to wait for on this one."]);
    expect(ungradable.happened).toMatch(/^Recorded, and not judged/);
  });
  it("says what is missing when the change is recorded and no fair comparison exists", () => {
    const said = (m: string) => first({ read: measuring, measurement: m as never }).happened;
    expect(said("insufficient_comparison")).toBe("Recorded. A fair comparison is not available yet: too few similar pages on this site can stand behind this one.");
    // A shipment that CAN be compared keeps the promise it can keep.
    expect([said("measurement_unavailable").slice(0, 55), said("verification_needed").slice(0, 30), said("measuring").slice(0, 17)])
      .toEqual(["Recorded. A fair comparison is not available yet: Searc", "Recorded from what was applied", "Nothing read yet."]);
  });
});
