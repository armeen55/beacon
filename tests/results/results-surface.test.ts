import { describe, expect, it } from "vitest";
import { bandOf, evaluateChange, evaluateWindows, type KernelInput } from "@/domains/measurement/proof-gsc/kernel";
import type { ShipmentVerification } from "@/domains/measurement";
import { buildResultsView, type ShipmentPresentation } from "@/app/(shell)/results/results-presentation";
import { buildResultsCsv } from "@/app/(shell)/results/results-csv";
import { buildHeadline } from "@/domains/measurement/proof-gsc/read-honesty";
/** RESULTS, WHOLE. What a customer READS on the surface, not how it is computed. Fixtures only, zero network. The promises: a read shared with a later change is never painted as this change's own win, the header totals are the visible rows added up rather than the wins alone, the next step fits the work that was done, "similar" is only said where a receipt backs it. */
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
const VERIFICATION: ShipmentVerification = { status: "partially_verified", checkedAt: "2026-05-03T09:00:00Z",
  components: [{ kind: "title", state: "verified", note: null }] };
const shipment = (over: Partial<ShipmentPresentation> = {}): ShipmentPresentation => ({
  read: evaluateChange(input(), WINDOWS, []), implementedAt: `${SHIPPED}T12:00:00Z`, verification: VERIFICATION,
  baseline: { clicks: 200, impressions: 9100, windowDays: 28, capturedAt: `${SHIPPED}T12:00:00Z` },
  basisMove: { clicks: 61, impressions: 900 }, ...over,
});
const first = (over: Partial<ShipmentPresentation> = {}) => {
  const rows = buildResultsView([shipment(over)]).rows;
  return (["worked", "down", "flat", "reading"] as const).map((g) => rows[g][0]).find((r) => r != null)!;
};
const measuring = evaluateChange(input({ windows: [] }), evaluateWindows(SHIPPED, new Date("2026-05-03T00:00:00Z"), "2026-05-03"), []);
const lost = { adjustedClicksLift: -30, adjustedImpressionsLift: -50 };
const declined = evaluateChange(input({ windows: [win(7, lost), win(14, lost), win(28, lost)] }), WINDOWS, []);
const sharedCredit = evaluateChange(input({ windows: [win(28)] }), WINDOWS, ["c2"]);
const cutOff = evaluateChange(input(), WINDOWS, ["c2"], "2026-05-10");
/** The signed number a row actually shows, read back out of the string the screen prints. */
const shown = (s: string | null): number => {
  const m = /^([+-])([\d,]+)/.exec(s ?? ""); return m ? Number(m[2]!.replace(/,/g, "")) * (m[1] === "-" ? -1 : 1) : 0; };

describe("the numbers at the top", () => {
  it("counts only the changes that finished their 28 day read, and adds up the rows on the screen", () => {
    const view = buildResultsView([shipment(), shipment({ read: declined }), shipment({ read: measuring }), shipment({ read: sharedCredit })]);
    // BANKED FRAMING: the denominator is every finished read, and the ones that did not win are named as what they taught.
    expect(view.header.worked).toEqual({ value: "1 win", sub: "out of 3 finished; the rest taught what does not move this site", isCount: true });
    expect(view.header.clicks).toEqual({ value: "+10", positive: true, note: "+40 from wins, -30 from the rest" });  // NET, NEVER THE WINS ALONE. The gross from the wins drops to the smaller second line beside what the rest gave back.
    expect(view.header.appearances).toEqual({ value: "+70", positive: true, note: "+120 from wins, -50 from the rest" });
    expect(view.header.window).toBe("Across the 3 changes that finished their 28 day read.");
    const mature = (["worked", "down", "flat"] as const).flatMap((g) => view.rows[g]);  // AND THEY RECONCILE: the totals are exactly the mature rows a customer can see, added up.
    expect([mature.reduce((t, r) => t + shown(r.liftLabel), 0), mature.reduce((t, r) => t + shown(r.impressionsLabel), 0)]).toEqual([10, 70]);
    expect([view.header.reading.value, view.counts, view.defaultGroup]).toEqual(["1", { worked: 1, down: 1, flat: 1, reading: 1 }, "worked"]);
  });
  // ONE MATURITY RULE, BOTH SIDES: a shared-credit read sat in flight in the ledger bands and finished on Results, so Today said "out of 12 finished" over a header saying 14.
  it("settles a shared-credit read the same way in the ledger bands and on Results", () => {
    const early = evaluateChange(input({ windows: [win(7)] }), evaluateWindows(SHIPPED, new Date("2026-05-09T00:00:00Z"), "2026-05-09"), ["c2"]);
    const view = buildResultsView([shipment({ read: sharedCredit }), shipment({ read: early })]);
    expect([bandOf(sharedCredit), view.counts.flat, bandOf(early), view.counts.reading]).toEqual(["learned", 1, "measuring", 1]); });
  it("never says nothing worked out of nothing: with no read finished it says when the first one lands", () => {
    const view = buildResultsView([shipment({ read: measuring })]);
    expect([view.header.worked.value, view.header.worked.isCount, view.header.appearances.value, view.header.window]).toEqual(["First result lands May 8", false, "Not enough read yet", "Nothing has finished its 28 day read yet."]);
    expect(view.defaultGroup).toBe("reading");
  });
});
describe("one change gets one line", () => {
  it("puts a win in Worked with its own number, its bar and its appearances", () => {
    const row = first();
    expect([row.group, row.verdictWord, row.dot, row.bar! > 0, row.barOpacity]).toEqual(["worked", "Worked", "emerald", true, 1]);
    expect([row.liftLabel, row.impressionsLabel, row.readLabel, row.pipCaption, row.work]).toEqual(["+40 clicks ahead", "+120", "28 day read done", "Done May 29", "a new section"]);
    expect(row.pips).toEqual([{ day: 7, state: "read" }, { day: 14, state: "read" }, { day: 28, state: "read" }]);
  });
  it("calls a loss a loss, holds an early lean as still reading, and never grades them on different rules", () => {
    expect([first({ read: declined }).verdictWord, first({ read: declined }).liftLabel, first({ read: declined }).happened]).toEqual(["Went down", "-30 clicks behind", "Ran 28 days. Estimated lift: 30 clicks behind pages that were not changed."]);
    // PIN: ONE MATURITY RULE. A 7 day lean is not a win and not a loss: until the window closes the row reads as Reading, which is what the header already claimed, and the running estimate stays on screen beside it.
    const early = evaluateChange(input({ windows: [win(7)] }), evaluateWindows(SHIPPED, new Date("2026-05-09T00:00:00Z"), "2026-05-09"), []);
    expect([first({ read: early }).group, first({ read: early }).verdictWord, first({ read: early }).happened]).toEqual(["reading", "Reading", "7 days in. Estimated lift: 40 clicks ahead of pages that were not changed."]);
  });
  it("claims no number on a read shared with a later change, and keeps the estimate visible as shared credit", () => {
    const row = buildResultsView([shipment({ read: sharedCredit })]).rows.flat[0]!;
    expect([row.verdictWord, row.liftLabel, row.impressionsLabel, row.bar]).toEqual(["Shared with a later change", null, null, null]);
    expect(row.chip).toEqual({ text: "Shared with a later change", amber: true });
    expect(row.happened).toBe("1 other change landed on this page at the same time, so the credit is shared. Estimated lift: 40 clicks ahead of pages that were not changed, held as shared credit rather than a win.");
    expect(row.numbers).toEqual({ before: ["200", "9,100"], after: ["261", "10,000"] });
    expect(row.nextStep).toBe("Two changes share these days. Make the next change on this page on its own, then measure it.");
    expect(first({ read: cutOff }).pips.map((p) => p.state)).toEqual(["read", "shared", "shared"]);  // AND A READ A LATER CHANGE CUT SHORT IS PAINTED AS SHARED FROM THE DAY IT WAS CUT, never as this change's own.
    expect(first({ read: cutOff }).caveats[0]).toBe("This page changed again on May 10. The days after that belong to both changes.");
  });
  it("says what has been read instead of a number while a change is still reading", () => {
    const row = first({ read: measuring });
    expect([row.group, row.verdictWord, row.dot, row.liftLabel, row.impressionsLabel, row.bar]).toEqual(["reading", "Reading", "sky", null, null, null]);
    expect([row.readLabel, row.pipCaption, row.happened, row.nextStep]).toEqual(["Nothing read yet", "Next May 8", "Nothing read yet. The first result lands May 8.", "Nothing to do until May 8."]);
  });
});
describe("opening a change says what happened, against what, and what to do next", () => {
  it("gives one sentence, the before and after, the dates and what it carries forward", () => {
    const row = first();
    expect(row.happened).toBe("Ran 28 days. Estimated lift: 40 clicks ahead of pages that were not changed.");
    expect(row.numbers).toEqual({ before: ["200", "9,100"], after: ["261", "10,000"] });
    expect(row.timeline).toEqual([{ label: "Marked done May 1", done: true }, { label: "Live page checked May 3", done: true }, { label: "28 day read May 29", done: true }]);
    expect(row.taught).toBe("This page read as the line searchers saw not matching what they typed, it was answered with a content change, the page moved up after it. That carries into what gets recommended next on pages like this one. Backed by 6 checks.");
    expect([row.comparedAgainst, row.unadjustedNote]).toEqual([[], null]); // nothing to show is shown as nothing
  });
  it("names the pages it stood against, and only calls them similar once it can back that", () => {
    const row = first({ controlsReceipt: [{ path: "/a", reasons: ["same page type: city", "traffic within 5x", "4,000 impressions against 9,100 on the changed page"] }, { path: "/b", reasons: [] }] });
    expect(row.comparedAgainst).toEqual(["/a (same kind of page; similar traffic)", "/b"]); // said in words, and a reason with no plain wording is dropped rather than printed raw
    expect(row.happened).toBe("Ran 28 days. Estimated lift: 40 clicks ahead of similar pages that were not changed.");
  });
  it("shows the site's own before and after, labeled unadjusted, where no fair comparison exists", () => {
    const row = first({ read: evaluateChange(input({ windows: [win(28, { controlsUsed: 1, treatedDelta: 17 })] }), WINDOWS, []) });  // Too few pages to stand behind it is NOT too little data: the days ran, so the page's own move is shown.
    expect(row.happened).toBe("Ran 28 days. A fair comparison is not available: too few pages on this site can stand behind this one.");
    expect(row.unadjustedNote).toBe("Before 200 clicks / After 217 clicks, unadjusted: the site moved too.");
    expect([first().unadjustedNote, first({ read: measuring }).unadjustedNote]).toEqual([null, null]);
  });
  it("never invents a date or a number it was not given", () => {
    const bare = first({ implementedAt: null, baseline: null, verification: null, basisMove: null });
    expect([bare.timeline[0], bare.timeline[1], bare.chip, bare.numbers]).toEqual([{ label: "Marked done, date not kept", done: true }, { label: "Live page not read yet", done: false }, { text: "Live page not read yet", amber: false }, null]);
    const noTraffic = first({ baseline: { clicks: 0, impressions: 0, windowDays: 28, capturedAt: SHIPPED } });
    expect([noTraffic.numbersNote, noTraffic.impressionsLabel]).toEqual(["No Google traffic on file.", null]);
  });
});
/** THREE SENTENCES TOLD EVERY OPERATOR TO PUT THE OLD WORDING BACK, including the ones whose change was a redirect or an internal link, where there was no wording to restore. One step per family of work, in win/loss/flat order. */
describe("the next step belongs to the kind of work that was done", () => {
  const dir = (v: number) => ({ adjustedClicksLift: 40 * v, adjustedCtrLift: 0.02 * v, adjustedPosLift: v });
  const step = (actionType: string, v: number) =>
    first({ read: evaluateChange(input({ actionType, componentKinds: [actionType], windows: [win(28, dir(v))] }), WINDOWS, []) }).nextStep;
  it.each([
    ["title", ["Do this again on a similar page.", "Put the previous title back, then measure again.", "The words were not the lever here. Try a content change on this page."]],
    ["section_add", ["Add the same kind of section to a similar page.", "Review what the new section replaced; restoring the old order is the honest test.", "The added copy did not move readers. A title sharpening is the cheaper next test."]],
    ["internal_link_add", ["Link the next weakest page the same way.", "This page slid down the results after the new links. Drop the weakest one, then read the position again.", "The position held where it was. Link to this page from a stronger page next."]],
    ["redirect", ["Apply the same technical fix to a similar page.", "Reverse the redirect only if the page lost real traffic; otherwise leave it and measure the next read.", "The technical fix moved nothing on its own. Leave it in place and try a content change here."]],
    ["consolidation", ["Merge the next pair of pages competing for the same search.", "The merged page lost ground. Split the two pages apart again, then measure.", "Merging moved nothing. Sharpen the title on the page that survived."]],
    ["new_page", ["Write the next page on the same kind of question.", "The new page is losing ground. Link to it from the pages that already rank before touching it again.", "The new page has not been found yet. Link to it from the pages that already rank."]],
    ["faq", ["Do this again on a similar page.", "Undo what was applied here, then measure again.", "Nothing moved here. Try a different kind of change on this page."]],
  ] as const)("%s gets the three steps its own family earned", (a, said) => expect([1, -1, 0].map((v) => step(a, v))).toEqual(said));
  it("never asks for wording back where no wording was changed, and waits where it cannot judge", () => {
    for (const a of ["internal_link_add", "redirect", "canonical", "anchor_text"]) for (const v of [1, 0, -1]) expect(step(a, v), `${a} at ${v}`).not.toMatch(/wording|title/i);
    const dud = first({ read: evaluateChange(input({ actionType: "other" }), WINDOWS, []) }); // nothing can grade it, so nothing is claimed
    expect([dud.verdictWord, dud.liftLabel, dud.bar, dud.nextStep]).toEqual(["Not judged", null, null, "Nothing to wait for on this one."]);
    expect(dud.happened).toMatch(/^Recorded, and not judged/);
  });
});
/** THE SAME TWO VOCABULARIES REACH THE SCREEN. A row's action word is a KIND ("title") or the FAMILY the bundle producer stamps ("title-family"). Only the kinds were mapped, so every bundle this account shipped read as the shrug "this change" while a real label existed. And a change nothing can compare says which. */
describe("what the screen calls the work, and what it will not promise", () => {
  it("names a family spelling in the operator's words, never as a shrug and never as its slug", () => {
    for (const [action, work] of [["title-family", "the title and headline"], ["section-family", "the content on the page"],
      ["links-family", "the internal links"], ["technical-family", "the technical setup"], ["title", "the page title"]] as const)
      expect(first({ read: evaluateChange(input({ actionType: action }), WINDOWS, []) }).work).toBe(work);
  });
  it("says what is missing when the change is recorded and no fair comparison exists", () => {
    const said = (m: string) => first({ read: measuring, measurement: m as never }).happened;
    expect(said("insufficient_comparison")).toBe("Recorded. A fair comparison is not available yet: too few similar pages on this site can stand behind this one.");
    expect([said("measurement_unavailable").slice(0, 55), said("verification_needed").slice(0, 30), said("measuring").slice(0, 17)])
      .toEqual(["Recorded. A fair comparison is not available yet: Searc", "Recorded from what was applied", "Nothing read yet."]);
  });
  it("prints no slug, no raw date stamp, no lab word, no first person and no dash", () => {
    const view = buildResultsView([shipment(), shipment({ read: declined }), shipment({ read: measuring }), shipment({ read: cutOff }),
      shipment({ read: sharedCredit }), shipment({ implementedAt: null, baseline: null, verification: null, basisMove: null })]);
    const strings = (["worked", "down", "flat", "reading"] as const).flatMap((g) => view.rows[g]).flatMap((r) => [
      r.work, r.verdictWord, r.liftLabel ?? "", r.readLabel ?? "", r.pipCaption ?? "", r.chip?.text ?? "", r.happened,
      r.numbersNote ?? "", r.unadjustedNote ?? "", ...r.comparedAgainst, ...r.caveats, ...r.timeline.map((t) => t.label), r.taught, r.nextStep,
    ]).concat([view.header.worked.value, view.header.worked.sub, view.header.clicks.value, view.header.clicks.note ?? "",
      view.header.appearances.value, view.header.appearances.note ?? "", view.header.reading.sub, view.header.window]);
    for (const [why, bad] of [["dash", /[–—]/], ["raw date stamp", /\d{4}-\d{2}-\d{2}/], ["slug", /[a-z]+_[a-z]+/], ["first person", /\b(I|me|my|we|our)\b/],
      ["lab word", /\b(experiment|controls?|baseline|treatment|serp|observational|directional|confounded|evidence|window)\b/i]] as const)
      for (const s of strings) expect(s, `${why} in: ${s}`).not.toMatch(bad);
  });
  it("every sentence the headline switch can print speaks subjectless: the whole branch space, not a sample", () => {
    // Third time this class shipped: a branch got rewritten and its sibling did not, and a fixture pin sampled around it. So walk the space.
    const V = ["waiting", "insufficient_evidence", "directional_decline", "no_clear_movement", "directional_improvement", "stronger_improvement", "confounded"] as const;
    const M = ["clicks", "ctr", "position", "unclassified"] as const;
    for (const verdict of V) for (const basisDay of [7, 14, 28, 56] as const) for (const overlapCount of [0, 1, 2]) for (const overlapClosedOn of [null, "2026-05-05"]) for (const metric of M) {
      const line = buildHeadline({ verdict, metric, lift: verdict === "directional_decline" ? -30 : 40, impressionsLift: 60, basisDay, overlapCount, overlapClosedOn, ga4ExtraSessions: 12, ga4Trustworthy: true });
      expect(line, line).not.toMatch(/\b(I|me|my|we|our)\b/); expect(line, line).not.toMatch(/[\u2013\u2014]/);
    }
    expect(buildResultsCsv([shipment().read, declined, measuring, sharedCredit, cutOff]), "first person in the export").not.toMatch(/\b(I|me|my|we|our)\b/);
  });

});

/** THE CHANGE IS FILED UNDER THE YARDSTICK IT DECLARED (reviewer, 2026-08-19): grouped by the Google verdict,
 *  a change raised to earn a CITATION could earn exactly that and sit under "No change", while one that moved
 *  no citation sat under "Worked" for traffic it never aimed at. */
describe("an AI change is judged on the thing it was raised to move", () => {
  const flatOnGoogle = evaluateChange(input({ windows: [win(7, { adjustedClicksLift: 0, adjustedCtrLift: 0, adjustedImpressionsLift: 0 }),
    win(14, { adjustedClicksLift: 0, adjustedCtrLift: 0, adjustedImpressionsLift: 0 }),
    win(28, { adjustedClicksLift: 0, adjustedCtrLift: 0, adjustedImpressionsLift: 0 })] }), WINDOWS, []);
  // A FINISHED AI READ, because the same maturity rule holds on both sides: a lean taken three days in is
  // still reading rather than a verdict, exactly as a 7 day Google lean is.
  const ai = (direction: "improved" | "worsened" | "no_clear_movement" | "unclear", daysElapsed = 28) =>
    ({ direction, line: "Credited on 6 of the 20 answers that reported their sources, up from 1 of 18 before.", metricLines: [], boundary: null, daysElapsed });

  it("files a won citation as a win even while Google has not moved", () => {
    const row = first({ read: flatOnGoogle, judgedMetric: "ai_citation", ai: ai("improved") });
    expect([row.group, row.verdictWord]).toEqual(["worked", "Worked"]);
    expect(row.yardstick).toBe("Judged on being credited in AI answers");
  });
  it("refuses to call a change a win for traffic it was never aimed at", () => {
    // Google says this one improved. Its own objective did not move, so it is not filed as a win.
    const row = first({ judgedMetric: "ai_citation", ai: ai("no_clear_movement") });
    expect(row.group).toBe("flat");
    expect(row.verdictWord).toBe("No clear movement"); // never "No change": nothing was called either way
  });
  it("keeps an unfinished AI read in the reading lane rather than calling it early", () => {
    expect(first({ judgedMetric: "ai_retrieval", ai: ai("unclear") }).group).toBe("reading");
    // AND A LEAN TAKEN THREE DAYS IN IS NOT A VERDICT EITHER, however strongly it leans.
    expect(first({ judgedMetric: "ai_retrieval", ai: ai("improved", 3) }).group).toBe("reading");
  });
  it("files a retrieval objective that went backwards under went down", () => {
    expect(first({ judgedMetric: "ai_retrieval", ai: ai("worsened") }).group).toBe("down");
  });
  it("groups a click-judged change exactly as it always did, whatever the AI half says", () => {
    const declared = first({ judgedMetric: "clicks", ai: ai("worsened") });
    expect(declared.group).toBe(first().group);
    expect(declared.yardstick).toBeNull(); // nothing new is claimed on a row judged the old way
  });

  /** AND THE REST OF THE ROW GOES WITH IT: the group, the verdict word and the yardstick came off the declared
 *  objective while the number, the bar, the sentence and the step still came off Google. */
  const CONTRADICTS = /behind|slid|undo|put the previous|restor|revers|did not clearly move|moved down|lost ground|less often/i;
  const fields = (r: ReturnType<typeof first>) =>
    [r.verdictWord, r.liftLabel ?? "", r.readLabel ?? "", r.pipCaption ?? "", r.happened, r.taught, r.nextStep, ...r.timeline.map((t) => t.label), ...r.caveats];

  it("tells one citation win story on every line of the row while Google has not moved", () => {
    const row = first({ read: flatOnGoogle, judgedMetric: "ai_citation", ai: ai("improved") });
    expect([row.group, row.verdictWord, row.liftLabel, row.bar! > 0, row.impressionsLabel]).toEqual(["worked", "Worked", "Credited more often", true, null]);
    expect(row.happened).toBe("Ran 28 days. Credited in AI answers more often than before.");
    expect(row.taught).toBe("This page read as the line searchers saw not matching what they typed, it was answered with a content change, it was credited in AI answers more often than before. That carries into what gets recommended next on pages like this one. Backed by 6 checks.");
    expect(row.nextStep).toBe("Do this again on the next page AI answers name without crediting.");
    // The read this row is judged over is its own 28 days from the stamp, not the Google windows beside it.
    expect([row.readLabel, row.pipCaption, row.timeline[2]]).toEqual(["28 day read done", "Read over 28 days", { label: "28 day read done", done: true }]);
    for (const s of fields(row)) expect(s, `contradicts the win: ${s}`).not.toMatch(CONTRADICTS);
  });
  it("keeps a Google decline on the row under its own heading, and never as the answer", () => {
    const row = first({ read: declined, judgedMetric: "ai_citation", ai: ai("improved") });
    expect([row.group, row.verdictWord, row.liftLabel, row.bar! > 0, row.impressionsLabel]).toEqual(["worked", "Worked", "Credited more often", true, null]);
    expect([row.happened, row.nextStep]).toEqual(["Ran 28 days. Credited in AI answers more often than before.",
      "Do this again on the next page AI answers name without crediting."]);
    for (const s of fields(row)) expect(s, `contradicts the win: ${s}`).not.toMatch(CONTRADICTS);
    // NOT HIDDEN, JUST NOT THE ANSWER: the decline keeps its sentence and its before and after, under a heading that says whose number it is.
    expect(row.googleAside).toEqual({ heading: "Google search, for context", line: "Ran 28 days. Estimated lift: 30 clicks behind pages that were not changed." });
    expect(row.numbers).toEqual({ before: ["200", "9,100"], after: ["261", "10,000"] });
  });
  it("refuses to read as a win when Google moved and the declared objective did not", () => {
    const row = first({ judgedMetric: "ai_citation", ai: ai("no_clear_movement") });
    expect([row.group, row.verdictWord, row.liftLabel, row.bar]).toEqual(["flat", "No clear movement", "Credited with no clear movement yet", 0]);
    expect(row.happened).toBe("Ran 28 days. Credited in AI answers with no clear movement yet.");
    expect(row.taught).toContain("it was credited in AI answers with no clear movement yet");
    expect(row.nextStep).toBe("Being credited has not moved. Put the fact those answers credit elsewhere on this page, in your own words, then measure again.");
    expect(row.googleAside!.line).toBe("Ran 28 days. Estimated lift: 40 clicks ahead of pages that were not changed.");
    for (const s of fields(row)) expect(s, `reads as a win: ${s}`).not.toMatch(/\bworked\b|ahead|\bwin\b|more often/i);
  });
  // FOUR OBJECTIVES, FOUR DIRECTIONS, THREE STRETCHES: hand-written copy on one objective is a sample, and the sample is how a branch
  // gets rewritten while its sibling keeps saying the old thing. Walk the space instead.
  it("speaks the same way on every objective: no slug, no first person, no dash, no lab word, and always a next step", () => {
    for (const m of ["ai_citation", "ai_citation_conversion", "ai_retrieval", "ai_mentions"] as const)
      for (const d of ["improved", "worsened", "no_clear_movement", "unclear"] as const) for (const days of [0, 3, 28]) {
        const row = first({ judgedMetric: m, ai: ai(d, days) });
        for (const s of [...fields(row), row.yardstick ?? "", row.googleAside?.heading ?? "", row.googleAside?.line ?? ""]) {
          expect(s, `${m} ${d} at ${days} days: ${s}`).not.toMatch(/[–—]|\b(I|me|my|we|our)\b|[a-z]+_[a-z]+/);
          expect(s, `${m} ${d} at ${days} days: ${s}`).not.toMatch(/\b(experiment|controls?|baseline|treatment|serp|observational|directional|confounded|evidence|window)\b/i);
        }
        expect(row.nextStep.length, `${m} ${d} at ${days} days`).toBeGreaterThan(0);
      }
  });
  it("leaves a click-judged row exactly as the rest of this file pins it, whatever the AI half says", () => {
    const declared = first({ judgedMetric: "clicks", ai: ai("worsened") }), plain = first();
    expect([declared.liftLabel, declared.bar, declared.impressionsLabel, declared.readLabel, declared.pipCaption, declared.happened, declared.taught, declared.nextStep])
      .toEqual([plain.liftLabel, plain.bar, plain.impressionsLabel, plain.readLabel, plain.pipCaption, plain.happened, plain.taught, plain.nextStep]);
    expect([declared.pips, declared.timeline, declared.googleAside]).toEqual([plain.pips, plain.timeline, null]);
    expect([declared.liftLabel, declared.impressionsLabel, declared.happened, declared.nextStep]).toEqual(["+40 clicks ahead", "+120",
      "Ran 28 days. Estimated lift: 40 clicks ahead of pages that were not changed.", "Add the same kind of section to a similar page."]);
  });
});

/** THE HEADER IS THE VISIBLE ROWS ADDED UP. An AI-judged row prints no click and no appearances figure, so
 *  adding its Google numbers into the totals made a header nobody could reconcile against the list under it. */
describe("the totals reconcile with what the rows actually show", () => {
  it("leaves an AI-judged row out of the Google money totals, and keeps a click row in", () => {
    const clickOnly = buildResultsView([shipment()]);
    const withAi = buildResultsView([shipment(), shipment({ judgedMetric: "ai_citation",
      ai: { direction: "improved", line: "Credited on 6 of 20 answers.", metricLines: [], boundary: null, daysElapsed: 28 } })]);
    // The AI row is counted in the tabs, and adds nothing to a clicks figure it never printed.
    expect(withAi.counts.worked).toBe(clickOnly.counts.worked + 1);
    expect(withAi.header.clicks).toEqual(clickOnly.header.clicks);
    expect(withAi.header.appearances).toEqual(clickOnly.header.appearances);
  });
});

/** THE COLLAPSED ROW AND THE TAB ARE HONEST BEFORE ANYTHING IS OPENED (Codex, 2026-08-21): three different
 *  silences funnelled into "No change" translate uncertainty back into the false claim the whole measurement
 *  repair exists to stop. RENDERED, never read off the view object: what a customer sees is what is pinned. */
describe("the surface never renders uncertainty as No change", () => {
  const render = async (over: Partial<ShipmentPresentation>) => {
    const [{ renderToStaticMarkup }, { createElement }, { ResultsRows }] = await Promise.all([
      import("react-dom/server"), import("react"), import("@/app/(shell)/results/results-rows-client")]);
    return renderToStaticMarkup(createElement(ResultsRows, { view: buildResultsView([shipment(over)]) }));
  };
  const aiRow = (direction: "no_clear_movement" | "mixed" | "unclear", terminal = false) =>
    ({ judgedMetric: "ai_citation" as const, ai: { direction, terminal, daysElapsed: 28, metricLines: [], boundary: null,
      line: terminal ? "Not measurable: where the AI answers stood when this was marked done was not on file." : "No clear movement." } });

  it("names each silence as itself, and never as No change", async () => {
    for (const [row, said] of [[aiRow("no_clear_movement"), /No clear movement|no clear movement/],
      [aiRow("mixed"), /Assistants split|assistants split/], [aiRow("unclear", true), /Not measurable/]] as const) {
      const html = await render(row);
      expect(html).toContain("No clear result");   // the tab that holds all three
      expect(html).toMatch(said);
      expect(html).not.toContain("No change");
      expect(html).not.toContain("landed inside the normal range");
    }
  });
  it("still says No change on a real control-based Google flat result", async () => {
    // The one outcome that HAS been called: comparable pages moved the same way, so this page genuinely
    // landed inside the normal range, and that sentence stays true where it is earned.
    const level = { adjustedClicksLift: 0, adjustedCtrLift: 0, adjustedImpressionsLift: 0 };
    const flat = evaluateChange(input({ windows: [win(7, level), win(14, level), win(28, level)] }), WINDOWS, []);
    expect(await render({ read: flat })).toContain("No change");
  });
});
