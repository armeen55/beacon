import { describe, expect, it, vi } from "vitest";
import { bandOf, evaluateChange, evaluateWindows, type KernelInput } from "@/domains/measurement/proof-gsc/kernel";
import type { ShipmentVerification } from "@/domains/measurement";
import { buildResultsView, type ShipmentPresentation } from "@/app/(shell)/results/results-presentation";
import { buildResultsBrain } from "@/app/(shell)/results/results-brain";
import { RESULT_LINES } from "@/app/(shell)/results/results-lines";
import { splitLedgerLifecycle } from "@/domains/decision/changes/lifecycle-counts";
const { rowState } = RESULT_LINES;
import { buildResultsCsv } from "@/app/(shell)/results/results-csv";
import { buildHeadline } from "@/domains/measurement/proof-gsc/read-honesty";
/** RESULTS, WHOLE. What a customer READS on the surface, not how it is computed. Fixtures only, zero network. The promises: a read shared with a later change is never painted as this change's own win, the header totals are the visible rows added up rather than the wins alone, the next step fits the work that was done, "similar" is only said where a receipt backs it. */
const NOW = new Date("2026-06-01T00:00:00Z");
const SHIPPED = "2026-05-01";
const WINDOWS = evaluateWindows(SHIPPED, NOW, "2026-06-01");
const win = (day: 7 | 14 | 28, over: Partial<KernelInput["windows"][number]> = {}) => ({
  day, ran: true, adjustedClicksLift: 40, adjustedCtrLift: 0.02, adjustedPosLift: 0,
  adjustedImpressionsLift: 120, controlsUsed: 3, treatedPostImpressions: 5000, ...over,});
const input = (over: Partial<KernelInput> = {}): KernelInput => ({
  id: "c1", page: "https://site.com/nowruz", path: "/nowruz", actionType: "section_add",
  shippedAt: SHIPPED, implementedAt: SHIPPED, baselineImpressions: 9100, baselineClicks: 200,
  windows: [win(7), win(14), win(28)],
  componentKinds: ["title", "section_add"], diagnosisCause: "ctr_snippet", evidenceItemCount: 6, ...over,});
const VERIFICATION: ShipmentVerification = { status: "partially_verified", checkedAt: "2026-05-03T09:00:00Z",
  components: [{ kind: "title", state: "verified", note: null }] };
const shipment = (over: Partial<ShipmentPresentation> = {}): ShipmentPresentation => ({
  read: evaluateChange(input(), WINDOWS, []), implementedAt: `${SHIPPED}T12:00:00Z`, verification: VERIFICATION,
  baseline: { clicks: 200, impressions: 9100, windowDays: 28, capturedAt: `${SHIPPED}T12:00:00Z` },
  basisMove: { clicks: 61, impressions: 900 }, ...over,});
const first = (over: Partial<ShipmentPresentation> = {}) => {
  const rows = buildResultsView([shipment(over)], NOW).rows;
  return (["worked", "down", "flat", "reading"] as const).map((g) => rows[g][0]).find((r) => r != null)!;};
const measuring = evaluateChange(input({ windows: [] }), evaluateWindows(SHIPPED, new Date("2026-05-03T00:00:00Z"), "2026-05-03"), []);
const lost = { adjustedClicksLift: -30, adjustedImpressionsLift: -50 };
const declined = evaluateChange(input({ windows: [win(7, lost), win(14, lost), win(28, lost)] }), WINDOWS, []);
const sharedCredit = evaluateChange(input({ windows: [win(28)] }), WINDOWS, ["c2"]);
const cutOff = evaluateChange(input(), WINDOWS, ["c2"], "2026-05-10");
/** The signed number a row actually shows, read back out of the string the screen prints. */
const shown = (s: string | null): number => {
  const m = /^([+-])([\d,]+)/.exec(s ?? ""); return m ? Number(m[2]!.replace(/,/g, "")) * (m[1] === "-" ? -1 : 1) : 0; };

describe("one change gets one line", () => {
  it("puts a verified read ahead in its tab with its own number, its bar and its appearances", () => {
    const row = first(); expect([row.group, row.verdictWord, row.dot, row.bar! > 0, row.barOpacity]).toEqual(["worked", "Verified early signal", "emerald", true, 1]);
    expect([row.liftLabel, row.impressionsLabel, row.readLabel, row.pipCaption, row.work]).toEqual(["+40 clicks ahead", "+120 shown", "28 day read done", "Done May 29", "a new section"]);
    expect(row.pips).toEqual([{ day: 7, state: "read" }, { day: 14, state: "read" }, { day: 28, state: "read" }]);});
  it("calls a loss a loss, holds an early lean as still reading, and never grades them on different rules", () => {
    expect([first({ read: declined }).verdictWord, first({ read: declined }).liftLabel, first({ read: declined }).happened]).toEqual(["Verified early signal", "-30 clicks behind", "Ran 28 days. Estimated lift: 30 clicks behind pages that were not changed."]);
    const early = evaluateChange(input({ windows: [win(7)] }), evaluateWindows(SHIPPED, new Date("2026-05-09T00:00:00Z"), "2026-05-09"), []); // PIN: ONE MATURITY RULE. A 7 day lean is not a win and not a loss: until the window closes the row reads as Reading, which is what the header already claimed, and the running estimate stays on screen beside it.
    expect([first({ read: early }).group, first({ read: early }).verdictWord, first({ read: early }).happened]).toEqual(["reading", "Reading", "7 days in. Estimated lift: 40 clicks ahead of pages that were not changed."]);});
  it("claims no number on a read shared with a later change, and keeps the estimate visible as shared credit", () => {
    const row = buildResultsView([shipment({ read: sharedCredit })], NOW).rows.flat[0]!; expect([row.verdictWord, row.liftLabel, row.impressionsLabel, row.bar]).toEqual(["Shared with a later change", null, null, null]);
    expect(row.chip).toEqual({ text: "Shared with a later change", amber: true });
    expect(row.happened).toBe("1 other change landed on this page at the same time, so the credit is shared. Estimated lift: 40 clicks ahead of pages that were not changed, held as shared credit rather than a win.");
    expect(row.numbers).toEqual({ before: ["200", "9,100"], after: ["261", "10,000"] }); expect(row.nextStep).toBe("Two changes share these days. Make the next change on this page on its own, then measure it.");
    expect(first({ read: cutOff }).pips.map((p) => p.state)).toEqual(["read", "shared", "shared"]);  // AND A READ A LATER CHANGE CUT SHORT IS PAINTED AS SHARED FROM THE DAY IT WAS CUT, never as this change's own.
    expect(first({ read: cutOff }).caveats[0]).toBe("This page changed again on May 10. The days after that belong to both changes.");});
  it("says what has been read instead of a number while a change is still reading", () => {
    const rows = buildResultsView([shipment({ read: measuring })], new Date("2026-05-03T00:00:00Z")).rows; const row = rows.reading[0]!;
    expect([row.group, row.verdictWord, row.dot, row.liftLabel, row.impressionsLabel, row.bar]).toEqual(["reading", "Live verified", "sky", null, null, null]);
    expect([row.readLabel, row.pipCaption, row.happened, row.nextStep]).toEqual(["Nothing read yet", "Next May 8", "Nothing read yet. The first result lands May 8.", "Nothing to do until the next read lands May 8."]);});});
describe("opening a change says what happened, against what, and what to do next", () => {
  it("gives one sentence, the before and after, the dates and what it carries forward", () => {
    const row = first(); expect(row.happened).toBe("Ran 28 days. Estimated lift: 40 clicks ahead of pages that were not changed.");
    expect(row.numbers).toEqual({ before: ["200", "9,100"], after: ["261", "10,000"] });
    expect(row.timeline).toEqual([{ label: "Marked done May 1", done: true }, { label: "Live page checked May 3", done: true }, { label: "28 day read May 29", done: true }]);
    expect(row.taught).toBe("This page read as the line searchers saw not matching what they typed, it was answered with a content change, the page moved up after it. That carries into what gets recommended next on pages like this one. Backed by 6 checks.");
    expect([row.comparedAgainst, row.unadjustedNote]).toEqual([[], null]); // nothing to show is shown as nothing
  });
  it("a read nobody confirmed on the live page is context only: it never promises to shape what gets recommended", () => {
    const history = first({ implementedAt: null, verification: null });
    expect([history.group, history.verdictWord]).toEqual(["worked", "Historical read ahead"]);
    expect(history.nextStep).toBe("Context only: this read predates live verification, so nothing is recommended from it.");
    expect(first({ verification: null }).nextStep).toBe("Confirm the change on the live page first; nothing is recommended from an unverified read.");
    expect(history.taught).toContain("Context only: a read never confirmed on the live page does not shape what gets recommended.");
    expect(first().taught).toContain("That carries into what gets recommended next on pages like this one.");});
  it("names the pages it stood against, and only calls them similar once it can back that", () => {
    const row = first({ controlsReceipt: [{ path: "/a", reasons: ["same page type: city", "traffic within 5x", "4,000 impressions against 9,100 on the changed page"] }, { path: "/b", reasons: [] }] });
    expect(row.comparedAgainst).toEqual(["/a (same kind of page; similar traffic)", "/b"]); // said in words, and a reason with no plain wording is dropped rather than printed raw
    expect(row.happened).toBe("Ran 28 days. Estimated lift: 40 clicks ahead of similar pages that were not changed.");});
  it("shows the site's own before and after, labeled unadjusted, where no fair comparison exists", () => {
    const row = first({ read: evaluateChange(input({ windows: [win(28, { controlsUsed: 1, treatedDelta: 17 })] }), WINDOWS, []) });  // Too few pages to stand behind it is NOT too little data: the days ran, so the page's own move is shown.
    expect(row.happened).toBe("Ran 28 days. A fair comparison is not available: too few pages on this site can stand behind this one."); expect(row.unadjustedNote).toBe("Before 200 clicks / After 217 clicks, unadjusted: the site moved too.");
    expect([first().unadjustedNote, first({ read: measuring }).unadjustedNote]).toEqual([null, null]);});
  it("never invents a date or a number it was not given", () => {
    const bare = first({ implementedAt: null, baseline: null, verification: null, basisMove: null });
    expect([bare.timeline[0], bare.timeline[1], bare.chip, bare.numbers]).toEqual([{ label: "Marked done, date not kept", done: true }, { label: "Live page never checked; predates verification", done: false }, { text: "Historical read ahead", amber: false }, null]);
    const noTraffic = first({ baseline: { clicks: 0, impressions: 0, windowDays: 28, capturedAt: SHIPPED } }); expect([noTraffic.numbersNote, noTraffic.impressionsLabel]).toEqual(["No starting point could be read for this one.", null]);});});
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
    expect([dud.verdictWord, dud.liftLabel, dud.bar, dud.nextStep]).toEqual(["Not measurable", null, null, "Nothing to wait for on this one."]); expect(dud.happened).toMatch(/^Recorded, and not judged/);});});
describe("what the screen calls the work, and what it will not promise", () => {
  it("says what is missing when the change is recorded and no fair comparison exists", () => {
    const said = (m: string) => first({ read: measuring, measurement: m as never }).happened;
    expect(said("insufficient_comparison")).toBe("Recorded. A fair comparison is not available yet: too few similar pages on this site can stand behind this one.");
    expect([said("measurement_unavailable").slice(0, 55), said("verification_needed").slice(0, 30), said("measuring").slice(0, 17)])
      .toEqual(["Recorded. A fair comparison is not available yet: Searc", "Recorded from what was applied", "Nothing read yet."]);});
  it("prints no slug, no raw date stamp, no lab word, no first person and no dash", () => {
    const view = buildResultsView([shipment(), shipment({ read: declined }), shipment({ read: measuring }), shipment({ read: cutOff }),
      shipment({ read: sharedCredit }), shipment({ implementedAt: null, baseline: null, verification: null, basisMove: null }), ...(["withdrawn", "superseded", "dismissed", "gone"] as const).map((d) => shipment({ recommendation: { state: "retired", disposition: d } }))], NOW);
    const strings = (["worked", "down", "flat", "reading"] as const).flatMap((g) => view.rows[g]).flatMap((r) => [
      r.work, r.verdictWord, r.liftLabel ?? "", r.readLabel ?? "", r.pipCaption ?? "", r.chip?.text ?? "", r.retired?.text ?? "", r.retired?.note ?? "", r.happened,
      r.numbersNote ?? "", r.unadjustedNote ?? "", ...r.comparedAgainst, ...r.caveats, ...r.timeline.map((t) => t.label), r.taught, r.nextStep,
    ]);
    for (const [why, bad] of [["dash", /[–—]/], ["raw date stamp", /\d{4}-\d{2}-\d{2}/], ["slug", /[a-z]+_[a-z]+/], ["first person", /\b(I|me|my|we|our)\b/],
      ["lab word", /\b(experiment|controls?|baseline|treatment|serp|observational|directional|confounded|evidence|window)\b/i]] as const)
      for (const s of strings) expect(s, `${why} in: ${s}`).not.toMatch(bad); });
  it("every sentence the headline switch can print speaks subjectless: the whole branch space, not a sample", () => {
    const V = ["waiting", "insufficient_evidence", "directional_decline", "no_clear_movement", "directional_improvement", "stronger_improvement", "confounded"] as const; const M = ["clicks", "ctr", "position", "unclassified"] as const; // Third time this class shipped: a branch got rewritten and its sibling did not, and a fixture pin sampled around it. So walk the space.
    for (const verdict of V) for (const basisDay of [7, 14, 28, 56] as const) for (const overlapCount of [0, 1, 2]) for (const overlapClosedOn of [null, "2026-05-05"]) for (const metric of M) {
      const line = buildHeadline({ verdict, metric, lift: verdict === "directional_decline" ? -30 : 40, impressionsLift: 60, basisDay, overlapCount, overlapClosedOn, ga4ExtraSessions: 12, ga4Trustworthy: true });
      expect(line, line).not.toMatch(/\b(I|me|my|we|our)\b/); expect(line, line).not.toMatch(/[\u2013\u2014]/);}
    expect(buildResultsCsv([shipment().read, declined, measuring, sharedCredit, cutOff]), "first person in the export").not.toMatch(/\b(I|me|my|we|our)\b/);});});
describe("an AI change is judged on the thing it was raised to move", () => {
  const flatOnGoogle = evaluateChange(input({ windows: [win(7, { adjustedClicksLift: 0, adjustedCtrLift: 0, adjustedImpressionsLift: 0 }),
    win(14, { adjustedClicksLift: 0, adjustedCtrLift: 0, adjustedImpressionsLift: 0 }),
    win(28, { adjustedClicksLift: 0, adjustedCtrLift: 0, adjustedImpressionsLift: 0 })] }), WINDOWS, []);
  const ai = (direction: "improved" | "worsened" | "no_clear_movement" | "unclear", daysElapsed = 28) => // A FINISHED AI READ, because the same maturity rule holds on both sides: a lean taken three days in is still reading rather than a verdict, exactly as a 7 day Google lean is.
    ({ direction, line: "Credited on 6 of the 20 answers that reported their sources, up from 1 of 18 before.", metricLines: [], boundary: null, daysElapsed });
  it("keeps an unfinished AI read in the reading lane rather than calling it early", () => {
    expect(first({ judgedMetric: "ai_retrieval", ai: ai("unclear") }).group).toBe("reading");
    expect(first({ judgedMetric: "ai_retrieval", ai: ai("improved", 3) }).group).toBe("reading"); // AND A LEAN TAKEN THREE DAYS IN IS NOT A VERDICT EITHER, however strongly it leans.
  });
  it("files a retrieval objective that went backwards under went down", () => {
    expect(first({ judgedMetric: "ai_retrieval", ai: ai("worsened") }).group).toBe("down");});
  /** AND THE REST OF THE ROW GOES WITH IT: the group, the verdict word and the yardstick came off the declared objective while the number, the bar, the sentence and the step still came off Google. */
  const CONTRADICTS = /behind|slid|undo|put the previous|restor|revers|did not clearly move|moved down|lost ground|less often/i;
  const fields = (r: ReturnType<typeof first>) =>
    [r.verdictWord, r.liftLabel ?? "", r.readLabel ?? "", r.pipCaption ?? "", r.happened, r.taught, r.nextStep, ...r.timeline.map((t) => t.label), ...r.caveats];
  it("tells one citation win story on every line of the row while Google has not moved", () => {
    const row = first({ read: flatOnGoogle, judgedMetric: "ai_citation", ai: ai("improved") }); // A WON CITATION IS FILED AS A WIN even while Google has not moved, and the yardstick says which one decided it.
    expect([row.group, row.verdictWord, row.liftLabel, row.bar! > 0, row.impressionsLabel, row.yardstick]).toEqual(["worked", "Verified early signal", "Credited more often", true, null, "Judged on being credited in AI answers"]);
    expect(row.happened).toBe("Ran 28 days. Credited in AI answers more often than before.");
    expect(row.taught).toBe("This page read as the line searchers saw not matching what they typed, it was answered with a content change, it was credited in AI answers more often than before. That carries into what gets recommended next on pages like this one. Backed by 6 checks.");
    expect(row.nextStep).toBe("Do this again on the next page AI answers name without crediting.");
    expect([row.readLabel, row.pipCaption, row.timeline[2]]).toEqual(["28 day read done", "Read over 28 days", { label: "28 day read done", done: true }]); // The read this row is judged over is its own 28 days from the stamp, not the Google windows beside it.
    for (const s of fields(row)) expect(s, `contradicts the win: ${s}`).not.toMatch(CONTRADICTS); });
  it("keeps a Google decline on the row under its own heading, and never as the answer", () => {
    const row = first({ read: declined, judgedMetric: "ai_citation", ai: ai("improved") }); expect([row.group, row.verdictWord, row.liftLabel, row.bar! > 0, row.impressionsLabel]).toEqual(["worked", "Verified early signal", "Credited more often", true, null]);
    expect([row.happened, row.nextStep]).toEqual(["Ran 28 days. Credited in AI answers more often than before.", "Do this again on the next page AI answers name without crediting."]);
    for (const s of fields(row)) expect(s, `contradicts the win: ${s}`).not.toMatch(CONTRADICTS);
    expect(row.googleAside).toEqual({ heading: "Google search, for context", line: "Ran 28 days. Estimated lift: 30 clicks behind pages that were not changed." }); // NOT HIDDEN, JUST NOT THE ANSWER: the decline keeps its sentence and its before and after, under a heading that says whose number it is.
    expect(row.numbers).toEqual({ before: ["200", "9,100"], after: ["261", "10,000"] });});
  it("refuses to read as a win when Google moved and the declared objective did not", () => {
    const row = first({ judgedMetric: "ai_citation", ai: ai("no_clear_movement") }); expect([row.group, row.verdictWord, row.liftLabel, row.bar]).toEqual(["flat", "Inconclusive", "Credited with no clear movement yet", 0]);
    expect(row.happened).toBe("Ran 28 days. Credited in AI answers with no clear movement yet."); expect(row.taught).toContain("it was credited in AI answers with no clear movement yet");
    expect(row.nextStep).toBe("Being credited has not moved. Put the fact those answers credit elsewhere on this page, in your own words, then measure again.");
    expect(row.googleAside!.line).toBe("Ran 28 days. Estimated lift: 40 clicks ahead of pages that were not changed.");
    for (const s of fields(row)) expect(s, `reads as a win: ${s}`).not.toMatch(/\bworked\b|ahead|\bwin\b|more often/i); });
  it("speaks the same way on every objective: no slug, no first person, no dash, no lab word, and always a next step", () => { // FOUR OBJECTIVES, FOUR DIRECTIONS, THREE STRETCHES: hand-written copy on one objective is a sample, and the sample is how a branch gets rewritten while its sibling keeps saying the old thing. Walk the space instead.
    for (const m of ["ai_citation", "ai_citation_conversion", "ai_retrieval", "ai_mentions"] as const)
      for (const d of ["improved", "worsened", "no_clear_movement", "unclear"] as const) for (const days of [0, 3, 28]) {
        const row = first({ judgedMetric: m, ai: ai(d, days) });
        for (const s of [...fields(row), row.yardstick ?? "", row.googleAside?.heading ?? "", row.googleAside?.line ?? ""]) {
          expect(s, `${m} ${d} at ${days} days: ${s}`).not.toMatch(/[–—]|\b(I|me|my|we|our)\b|[a-z]+_[a-z]+/);
          expect(s, `${m} ${d} at ${days} days: ${s}`).not.toMatch(/\b(experiment|controls?|baseline|treatment|serp|observational|directional|confounded|evidence|window)\b/i);}
        expect(row.nextStep.length, `${m} ${d} at ${days} days`).toBeGreaterThan(0);}});
  it("leaves a click-judged row exactly as the rest of this file pins it, whatever the AI half says", () => {
    const declared = first({ judgedMetric: "clicks", ai: ai("worsened") }), plain = first();
    expect([declared.liftLabel, declared.bar, declared.impressionsLabel, declared.readLabel, declared.pipCaption, declared.happened, declared.taught, declared.nextStep])
      .toEqual([plain.liftLabel, plain.bar, plain.impressionsLabel, plain.readLabel, plain.pipCaption, plain.happened, plain.taught, plain.nextStep]);
    expect([declared.pips, declared.timeline, declared.googleAside, declared.group, declared.yardstick]).toEqual([plain.pips, plain.timeline, null, plain.group, null]); // grouped exactly as it always was, and nothing new is claimed on a row judged the old way
    expect([declared.liftLabel, declared.impressionsLabel, declared.happened, declared.nextStep]).toEqual(["+40 clicks ahead", "+120 shown",
      "Ran 28 days. Estimated lift: 40 clicks ahead of pages that were not changed.", "Add the same kind of section to a similar page."]);});});
describe("the surface never renders uncertainty as No change", () => {
  const render = async (over: Partial<ShipmentPresentation>) => {
    const [{ renderToStaticMarkup }, { createElement }, { ResultsRows }] = await Promise.all([
      import("react-dom/server"), import("react"), import("@/app/(shell)/results/results-rows-client")]);
    return renderToStaticMarkup(createElement(ResultsRows, { view: buildResultsView([shipment(over)], NOW) }));};
  const aiRow = (direction: "no_clear_movement" | "mixed" | "unclear", terminal = false) =>
    ({ judgedMetric: "ai_citation" as const, ai: { direction, terminal, daysElapsed: 28, metricLines: [], boundary: null,
      line: terminal ? "Not measurable: where the AI answers stood when this was marked done was not on file." : "No clear movement." } });
  it("names each silence as itself, and never as No change", async () => {
    for (const [row, said] of [[aiRow("no_clear_movement"), /No clear movement|no clear movement/],
      [aiRow("mixed"), /Assistants split|assistants split/], [aiRow("unclear", true), /Not measurable/]] as const) {
      const html = await render(row);
      expect(html).toContain("Unclear");   // the tab that holds all three
      expect(html).toMatch(said); expect(html).not.toContain("No change");
      expect(html).not.toContain("landed inside the normal range");}});
  it("never renders a past date as the next future result", () => { // A PROMISE ABOUT THE FUTURE MAY NEVER RENDER A PAST DATE (operator, 2026-08-21): on a day after the window close, the surface says the read is overdue because Google reports behind, never "lands May 8".
    const late = buildResultsView([shipment({ read: measuring })], new Date("2026-08-21T00:00:00Z"));
    const texts = [...late.rows.reading.map((r) => `${r.pipCaption} ${r.happened} ${r.nextStep}`)].join(" | "); expect(texts).not.toMatch(/lands May|Next May|until May/);
    expect(texts).toContain("overdue"); expect(texts).toContain("Google reports a few days behind");});
  it("says Inconclusive, in the one vocabulary, on a real control-based Google flat result", async () => {
    const level = { adjustedClicksLift: 0, adjustedCtrLift: 0, adjustedImpressionsLift: 0 }; const flat = evaluateChange(input({ windows: [win(7, level), win(14, level), win(28, level)] }), WINDOWS, []); // The one outcome that HAS been called: comparable pages moved the same way, so this page genuinely landed inside the normal range, and that sentence stays true where it is earned.
    expect(await render({ read: flat })).toContain("Inconclusive");});});
describe("the Brain: what Beacon believes is derived from verified facts, and history never trains it", () => {
  const legacy = (read = evaluateChange(input(), WINDOWS, []), id = "L") => shipment({ read: { ...read, id }, implementedAt: null, verification: null });
  const level = evaluateChange(input({ windows: [win(28, { adjustedClicksLift: 0, adjustedImpressionsLift: 0 })] }), WINDOWS, []);
  const many = (n: number, read: ReturnType<typeof evaluateChange>, tag: string, over: Partial<ShipmentPresentation> = {}) => Array.from({ length: n }, (_, i) => shipment({ read: { ...read, id: `${tag}${i}` }, ...over }));
  it("names every row in the one vocabulary, and a read nobody verified is history or waiting, never a win", () => {
    expect([rowState(shipment()), rowState(legacy()), rowState(legacy(declined)), rowState(legacy(level)), rowState(shipment({ verification: null })), rowState(shipment({ read: measuring })), rowState(shipment({ read: sharedCredit })), rowState(shipment({ read: declined }))])
      .toEqual(["verified_early", "historical_ahead", "historical_behind", "historical_unclear", "waiting_verification", "live_verified", "confounded", "verified_early"]); });
  it("today's real shape cannot say wins: twenty-five historical reads are context, fifty-nine newer changes are reading, and no verified sample exists", () => {
    const brain = buildResultsBrain([...many(6, evaluateChange(input(), WINDOWS, []), "a", { implementedAt: null, verification: null }), ...many(7, declined, "b", { implementedAt: null, verification: null }), ...many(12, level, "c", { implementedAt: null, verification: null }), ...many(59, measuring, "r")], NOW);
    expect([brain.belief.confidence, brain.belief.headline, brain.counts.historicalMature, brain.counts.historicalAhead, brain.counts.historicalBehind, brain.counts.historicalUnclear, brain.counts.reading, brain.counts.verifiedMature])
      .toEqual(["none", "Beacon cannot claim a live-verified pattern yet.", 25, 6, 7, 12, 59, 0]);
    expect(brain.belief.lines).toEqual(["25 historical reads give context: 6 finished ahead, 7 behind and 12 were unclear. None was confirmed on the live page, so none trains recommendations.", "59 newer changes are not finished: 59 changes confirmed on the live page and reading, 0 changes recorded and waiting for live verification."]);
    expect(/\bwins?\b/i.test(JSON.stringify(brain)), "the word win appears nowhere on a surface with nothing verified").toBe(false);
    const t = brain.thoughts.find((x) => x.family === "content")!; expect([t.verifiedSample, t.historical, t.confidence, t.strongest?.state], "history sizes a faint ring and never the node").toEqual([0, 25, "none", "historical_ahead"]); });
  it("one verified immature read is in flight, one verified finished read is an early signal, five consistent make a pattern, and a split record stays mixed", () => {
    const one = buildResultsBrain([shipment({ read: measuring })], NOW).thoughts[0]!; expect([one.confidence, one.inFlight, one.verifiedSample]).toEqual(["none", 1, 0]);
    const early = buildResultsBrain([shipment()], NOW); expect([early.belief.confidence, early.thoughts[0]!.confidence, early.thoughts[0]!.verifiedSample, early.thoughts[0]!.changeMind]).toEqual(["early", "early", 1, "3 more verified 28 day reads pointing the same way would make this a consistent record; the next live-confirmed change finishing its read moves it."]);
    const pattern = buildResultsBrain(many(5, evaluateChange(input(), WINDOWS, []), "p"), NOW); expect([pattern.belief.confidence, pattern.thoughts[0]!.confidence, pattern.thoughts[0]!.ahead, pattern.thoughts[0]!.medianEffect]).toEqual(["pattern", "pattern", 5, 40]);
    const heavyLoss = evaluateChange(input({ windows: [win(7, { adjustedClicksLift: -100 }), win(14, { adjustedClicksLift: -100 }), win(28, { adjustedClicksLift: -100, adjustedImpressionsLift: -50 })] }), WINDOWS, []);
    const mixed = buildResultsBrain([...many(3, evaluateChange(input(), WINDOWS, []), "m"), ...many(2, heavyLoss, "n")], NOW).thoughts[0]!; expect([mixed.confidence, mixed.ahead, mixed.behind, mixed.unit]).toEqual(["mixed", 3, 2, "clicks"]);
    // THE CONTRACT IS DESCRIPTIVE: four of four agree is a consistent record, four of six is split, and a record of five splits once two counterexamples land; no probability is printed anywhere.
    expect([buildResultsBrain(many(4, evaluateChange(input(), WINDOWS, []), "f"), NOW).thoughts[0]!.confidence, buildResultsBrain([...many(4, evaluateChange(input(), WINDOWS, []), "g"), ...many(2, heavyLoss, "h")], NOW).thoughts[0]!.confidence, buildResultsBrain([...many(5, evaluateChange(input(), WINDOWS, []), "i"), ...many(2, heavyLoss, "j")], NOW).thoughts[0]!.confidence, pattern.thoughts[0]!.agreement]).toEqual(["pattern", "mixed", "mixed", "5 of 5 directional verified reads point the same way. A small sample from one site: consistent, not proven."]);
    const rate = (lift: number, id: string) => shipment({ read: { ...evaluateChange(input({ actionType: "edit_title", windows: [win(7, { adjustedCtrLift: lift }), win(14, { adjustedCtrLift: lift }), win(28, { adjustedCtrLift: lift })] }), WINDOWS, []), id } });
    const titles = buildResultsBrain([rate(0.004, "t1")], NOW).thoughts[0]!; // A CLICK-RATE READ IS NEVER ROUNDED INTO ZERO CLICKS: the unit travels with the median.
    expect([titles.confidence, titles.unit, titles.ahead, titles.belief]).toEqual(["early", "ctr", 1, "Titles: 1 verified read so far, 1 ahead and 0 behind, +0.4 click rate ahead at the middle. A signal, not yet a record."]); });
  it("a confounded read and an AI-judged read never vote in the click effects, and both are named as limits", () => {
    const t = buildResultsBrain([shipment(), shipment({ read: { ...sharedCredit, id: "s" } }), shipment({ read: { ...evaluateChange(input(), WINDOWS, []), id: "ai" }, judgedMetric: "ai_citation", ai: { direction: "improved", line: "cited more", daysElapsed: 28 } })], NOW).thoughts[0]!;
    expect([t.verifiedSample, t.confounded, t.limits.some((l) => l.includes("shared"))]).toEqual([1, 1, true]); });
  it("selecting a thought exposes its strongest example and its counterexample, and edges exist only for real overlaps on one page", () => {
    const big = evaluateChange(input({ windows: [win(7, { adjustedClicksLift: 90 }), win(14, { adjustedClicksLift: 90 }), win(28, { adjustedClicksLift: 90 })] }), WINDOWS, []);
    const t = buildResultsBrain([shipment({ read: { ...big, id: "big" } }), shipment({ read: { ...declined, id: "small" } })], NOW).thoughts[0]!;
    expect([t.strongest?.id, t.counterexample?.id, t.strongest?.line.startsWith("Ran 28 days")]).toEqual(["big", "small", true]);
    const linked = buildResultsBrain([shipment({ read: { ...evaluateChange(input({ actionType: "edit_title" }), WINDOWS, ["s2"]), id: "s1" } }), shipment({ read: { ...evaluateChange(input(), WINDOWS, ["s1"]), id: "s2" } })], NOW);
    expect([linked.thoughts.map((x) => [x.key, x.edges]), buildResultsBrain([shipment()], NOW).thoughts[0]!.edges]).toEqual([[["title", ["content"]], ["content", ["title"]]], []]); });
  it("speaks the page's own rules everywhere the Brain prints, names pages as the rows do, and always has a next step with somewhere to go", () => {
    const brain = buildResultsBrain([shipment(), legacy(), shipment({ read: measuring, verification: { ...VERIFICATION, recheckAfter: "2026-06-03" } })], NOW);
    const strings = [brain.belief.headline, ...brain.belief.lines, brain.changed ?? "", ...brain.watching, brain.nextStep.text, ...brain.thoughts.flatMap((x) => [x.name, x.belief, x.changeMind, x.watching, ...x.limits, x.strongest?.label ?? "", x.strongest?.line ?? "", x.counterexample?.label ?? "", x.counterexample?.line ?? ""])];
    for (const s of strings) expect(s, s).not.toMatch(/[–—]|^\/|[a-z]+_[a-z]+|\b(I|me|my|we|our)\b|\b(experiment|controls?|baseline|treatment|serp|observational|directional|confounded|evidence|window)\b/i);
    expect([brain.nextStep.href, brain.nextStep.text.startsWith("Nothing to do until the next read"), brain.thoughts[0]!.strongest?.label]).toEqual(["/changes", true, "Nowruz"]); });
  it("a shipment the live page can never confirm is not measurable, a finished read nobody confirmed is never a win, and the next step counts finished changes rather than rechecks", () => {
    const blocked = { status: "blocked", checkedAt: "2026-05-03T09:00:00Z", components: [], recheckAfter: null } as unknown as ShipmentVerification;
    expect([rowState(shipment({ verification: blocked })), first({ verification: blocked }).verdictWord, first({ verification: blocked }).nextStep.startsWith("Nothing can be read on this one")]).toEqual(["not_measurable", "Not measurable", true]);
    const differs = shipment({ read: { ...measuring, id: "d" }, verification: { ...VERIFICATION, status: "differs", recheckAfter: "2026-05-05" } as unknown as ShipmentVerification });
    expect([buildResultsBrain([shipment(), differs], NOW, { ready: 3 }).nextStep, buildResultsBrain([differs], NOW).nextStep.href, buildResultsBrain([differs], NOW).watching.some((w) => w.includes("not yet show on the live page"))])
      .toEqual([{ text: "Make the 3 finished changes waiting on Changes; each one starts its read the day you mark it done.", href: "/changes" }, "#change-d", true]);
    const row = { id: "l", path: "/p", actionType: "section_add", shippedAt: "2026-05-01", implementedAt: "2026-05-01T12:00:00Z", verdict: "won", windows: [7, 14, 28].map((day) => ({ day, ran: true, controlsUsed: 3, adjustedLift: 40, adjustedCtrLift: 0.02, adjustedImpressionsLift: 120, treatedPostImpressions: 5000 })), baseline: { impressions: 9100, clicks: 200 } };
    expect([splitLedgerLifecycle([row], NOW).won.length, splitLedgerLifecycle([row], NOW).learned.length, splitLedgerLifecycle([{ ...row, verification: VERIFICATION }], NOW).won.length]).toEqual([0, 1, 1]); });
  /** A SHIPMENT IS THE OPERATOR'S OWN HISTORY AND STAYS VISIBLE; the advice behind it can be taken back afterwards, and seven of this account's rows pointed at a proposal carrying a terminal disposition while Results read exactly like a current one. A finished reading closing the queue's loop ("settled") is NOT a retirement and is not tested as one: it would deny a result this page claims. */
  it("a recommendation retired after the change was marked done is named on the row, teaches nothing it never confirmed, and is never news or a next step", () => {
    const rec = (state: "current" | "retired" | "unknown", disposition?: string): Partial<ShipmentPresentation> => ({ recommendation: { state, disposition } });
    const took = first({ ...rec("retired", "withdrawn"), verification: null }), stood = first(rec("current"));
    expect(took.retired).toEqual({ text: "Recommendation later retired", note: "The recommendation behind this was taken back after the change was marked done. The change stays in history and its read stays on this row. Nothing here teaches current work: the live page never confirmed it." });
    expect(first(rec("retired", "withdrawn")).retired!.note.endsWith("The live page confirmed it, so the read still counts."), "a retired row the live page did confirm keeps its read").toBe(true);
    expect([stood.retired, first(rec("unknown")).retired, first().retired], "a current one, an unknown one and a snapshot written before this all say nothing").toEqual([null, null, null]);
    expect([stood.verdictWord, stood.happened, stood.taught, stood.nextStep, took.verdictWord, took.happened, took.group], "no state word moves and no history is repainted").toEqual([first().verdictWord, first().happened, first().taught, first().nextStep, first({ verification: null }).verdictWord, first().happened, first().group]);
    // FOUR RETIRED READS NOBODY CONFIRMED LIVE ARE NOT A PATTERN, NOT NEWS, AND NOT SOMETHING TO GO AND PUBLISH. Such a row cannot reach won on Today or Changes either, for the reason pinned above: splitLedgerLifecycle files an unconfirmed row as learned whatever its verdict.
    const brain = buildResultsBrain([...many(4, evaluateChange(input(), WINDOWS, []), "rt", { ...rec("retired", "withdrawn"), verification: null }), shipment({ read: { ...measuring, id: "rd" }, ...rec("retired", "superseded"), verification: { ...VERIFICATION, status: "differs", recheckAfter: "2026-05-05" } as unknown as ShipmentVerification })], NOW);
    expect([brain.belief.confidence, brain.thoughts[0]!.verifiedSample, brain.changed, brain.nextStep.href, brain.watching.some((w) => w.includes("not yet show on the live page"))]).toEqual(["none", 0, null, "/changes", false]);
    expect(buildResultsBrain(many(4, evaluateChange(input(), WINDOWS, []), "cu", rec("current")), NOW).belief.confidence, "the same four, current, are still a record").toBe("pattern");});
  it("serves the saved surface without waiting on the persisted read, so the belief paints while a live read hangs", async () => {
    vi.doMock("next/server", () => ({ after: () => {} })); vi.doMock("@/lib/tenant-context", () => ({ currentTenantId: async () => "t" }));
    vi.doMock("@/app/(shell)/results/results-surface-store", () => ({ readResultsSurface: async () => ({ computedAt: NOW.toISOString(), shipments: [shipment()] }), isResultsSurfaceStale: () => false, writeResultsSurface: async () => {} }));
    vi.doMock("@/domains/measurement", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadProofLedgerPersisted: () => new Promise(() => {}) }));
    const { loadResultsLedgerSurface } = await import("@/app/(shell)/results/results-ledger-data");
    const out = await Promise.race([loadResultsLedgerSurface(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
    expect(out && "shipments" in out ? out.shipments.length : null, "saved truth, not a skeleton and not zero results").toBe(1); });
});
