import { describe, expect, it } from "vitest";
import { evaluateChange, evaluateWindows, type KernelInput } from "@/domains/measurement/proof-gsc/kernel";
import type { ShipmentAiOutcome, ShipmentVerification } from "@/domains/measurement";
import { shipmentStory, type ShipmentPresentation } from "@/app/(shell)/results/results-presentation";

/**
 * RESULTS, WHOLE (V1 Truth Convergence Phase 8). These pin what a customer READS on a shipped
 * change, not how it is computed: did it land on the live page, where the page started, what has
 * been read so far, what happened in Google and in AI answers, and what I take away. Fixtures only,
 * zero network.
 *
 * The promise that matters most here: a measurement window shared with a later change is never
 * painted as this change's own win. The AI trend and its named breaks moved to Visibility with the
 * surface that draws them (tests/product/visibility-surface.test.ts).
 */

const NOW = new Date("2026-06-01T00:00:00Z");
const SHIPPED = "2026-05-01";
const WINDOWS = evaluateWindows(SHIPPED, NOW, "2026-06-01");

const win = (day: 7 | 14 | 28, over: Partial<KernelInput["windows"][number]> = {}) => ({
  day, ran: true, adjustedClicksLift: 40, adjustedCtrLift: 0.02, adjustedPosLift: 0,
  adjustedImpressionsLift: 120, controlsUsed: 3, treatedPostImpressions: 5000, ...over,
});
const input = (over: Partial<KernelInput> = {}): KernelInput => ({
  id: "c1", page: "https://site.com/nowruz", path: "/nowruz", actionType: "edit_title",
  shippedAt: SHIPPED, implementedAt: SHIPPED, baselineImpressions: 9100, baselineClicks: 412,
  windows: [win(7), win(14), win(28)],
  componentKinds: ["title", "section_add"], diagnosisCause: "ctr_snippet", evidenceItemCount: 6, ...over,
});
const VERIFICATION: ShipmentVerification = {
  status: "partially_verified", checkedAt: "2026-05-03T09:00:00Z",
  components: [{ kind: "title", state: "verified", note: null }, { kind: "section_add", state: "not_verified", note: null }, { kind: "schema", state: "unverifiable", note: null }],
};
const AI: ShipmentAiOutcome = {
  direction: "improved",
  before: { day: "2026-04-30", checked: 20, mentioning: 4, rate: 0.2, from: "on_file" },
  after: { from: SHIPPED, to: "2026-05-28", checked: 60, mentioning: 18, rate: 0.36, analyzed: 50 },
  coverage: { daysObserved: 21, daysElapsed: 28 },
  line: "I read 60 AI answers on 21 of the 28 days since you marked this done, you were named in 18 of the 50 I read closely, up from 4 of 20 before it. I keep reading every day.",
};
const shipment = (over: Partial<ShipmentPresentation> = {}): ShipmentPresentation => ({
  read: evaluateChange(input(), WINDOWS, []), implementedAt: `${SHIPPED}T12:00:00Z`, verification: VERIFICATION,
  baseline: { clicks: 412, impressions: 9100, windowDays: 28, capturedAt: `${SHIPPED}T12:00:00Z` }, ai: AI, ...over,
});

describe("one shipped change tells its whole story", () => {
  it("says component by component what it found on the live page, and never calls an unseeable one missing", () => {
    const story = shipmentStory(shipment());
    expect(story.verification.headline).toBe("I checked your live page: part of this is live and part of it is not.");
    expect(story.verification.components).toEqual([
      "The page title is exactly what we agreed.",
      "A new section is not there yet.",
      "I cannot see the structured data from outside the page, so I am not calling it either way.",
    ]);
    expect(story.verification.checkedOn).toBe("May 3");
  });
  it("says plainly when it has not looked yet, instead of implying a pass, and holds the starting point untouched", () => {
    const unchecked = shipmentStory(shipment({ verification: null }));
    expect(unchecked.verification.headline).toContain("I have not read your live page for this one yet");
    expect(unchecked.verification.components).toEqual([]);
    expect(shipmentStory(shipment()).baseline)
      .toBe("When you marked this done on May 1, this page had 412 clicks and 9,100 appearances in Google over the 28 days before it. I hold that starting point exactly as it was, and it never moves.");
  });
  it("walks the timeline from marked done through the live check to every checkpoint, and adds the 56 day follow up only when one ran", () => {
    const story = shipmentStory(shipment());
    expect(story.timeline.map((s) => s.label)).toEqual(["You marked it done", "I checked your live page", "7 day read", "14 day read", "28 day read"]);
    expect(story.timeline[0]).toMatchObject({ state: "done", when: "May 1" });
    expect(story.timeline[1]).toMatchObject({ state: "done", when: "May 3" });
    const followUp = shipment({ read: evaluateChange(input({ windows: [win(7), win(14), win(28), { ...win(28), day: 56 as 28 }] }), evaluateWindows(SHIPPED, new Date("2026-07-15T00:00:00Z"), "2026-07-15", true), []) });
    expect(shipmentStory(followUp).timeline.map((s) => s.label)).toContain("56 day read");
  });
  it("renders both outcomes: the Google read and the AI read, each with what it was read over", () => {
    const story = shipmentStory(shipment());
    expect(story.search.headline).toContain("similar pages");
    expect(story.search.headline.toLowerCase()).not.toContain("caused");
    expect(story.ai).not.toBeNull();
    expect(story.ai!.heading).toBe("AI assistants name you more often than they did before this went live.");
    expect(story.ai!.coverage).toBe("I read on 21 of the 28 days since then. A day I missed stays missed, and I never fill one in.");
    expect(story.ai!.line).toBe(AI.line);
  });
  it("never prints a zero where nothing was read: no AI day read says so in words", () => {
    const none = shipment({ ai: { ...AI, direction: "unclear", coverage: { daysObserved: 0, daysElapsed: 12 } } });
    expect(shipmentStory(none).ai!.coverage).toBe("I have not managed to read an AI answer on any of the 12 days since you marked this done.");
    expect(shipmentStory(shipment({ ai: null })).ai).toBeNull();
  });
  it("stops painting a window green once a later change on the page shares it, and names what it shares with", () => {
    const overlapped = shipment({ read: evaluateChange(input(), WINDOWS, ["c2"], "2026-05-10") });
    const story = shipmentStory(overlapped);
    expect(story.chips).toEqual([
      { day: 7, text: "7 days: read", state: "done" },
      { day: 14, text: "14 days: shared with a later change", state: "shared" },
      { day: 28, text: "28 days: shared with a later change", state: "shared" },
    ]);
    expect(story.overlap).toBe("I changed this page again on May 10. The windows that closed after that day belong to both changes, so I do not count them as this one's.");
    // A clean read paints no shared chip and needs no overlap sentence at all.
    expect(shipmentStory(shipment()).chips.every((c) => c.state !== "shared")).toBe(true);
    expect(shipmentStory(shipment()).overlap).toBeNull();
  });
  it("says what it learned in the operator's words, with no slug from the diagnosis or the action family", () => {
    const learned = shipmentStory(shipment()).learning;
    for (const s of ["I read this page as the line searchers saw not matching what they typed", "I answered it with a content change", "the page moved up after it", "6 pieces of evidence", "I carry that into what I recommend next"]) expect(learned, s).toContain(s);
    // NOTHING IS CARRIED FORWARD FROM A READ THAT HAS NOT LANDED: no direction, no lesson.
    const early = shipmentStory(shipment({ read: evaluateChange(input({ windows: [] }), evaluateWindows(SHIPPED, new Date("2026-05-03T00:00:00Z"), "2026-05-03"), []) }));
    expect(early.learning).toContain("it is too early to say which way this went");
    expect(early.learning).not.toContain("I carry that into");
    expect(early.learning).toContain("I carry nothing forward from this one until it settles.");
  });
  it("says the verdict and how sure I am in the operator's words, never in the kernel's", () => {
    const confounded = evaluateChange(input({ windows: [win(28)] }), WINDOWS, ["c2"]);
    expect(confounded.verdict).toBe("confounded"); // the kernel keeps its own vocabulary
    const overlapped = shipmentStory(shipment({ read: confounded }));
    expect(overlapped.badge).toBe("Shared with a later change"); // the loudest word on the card is not a lab word
    expect(overlapped.badge.toLowerCase()).not.toContain("confounded");
    expect(shipmentStory(shipment()).badge).toBe("A stronger improvement");
    expect(shipmentStory(shipment()).confidence).toMatch(/^I am /);
    expect(shipmentStory(shipment()).confidence.toLowerCase()).not.toContain("confidence");
  });
  it("renders a change marked done before I kept exact dates as done, and says the date is what is missing", () => {
    const legacy = shipmentStory(shipment({ implementedAt: null, baseline: null }));
    expect(legacy.timeline[0]).toEqual({ label: "You marked it done, before I kept exact dates", state: "done", when: null });
    expect(legacy.baseline).toBeNull(); // and "Where it started" stays absent rather than inventing a starting point
  });
});

// ── the sweep ───────────────────────────────────────────────────────────────

describe("no Results string reaches the operator carrying jargon", () => {
  it("prints no slug, no raw date stamp, no lab word and no dash", () => {
    const stories = [
      shipmentStory(shipment()),
      shipmentStory(shipment({ verification: null, baseline: null, ai: null })),
      shipmentStory(shipment({ read: evaluateChange(input(), WINDOWS, ["c2"], "2026-05-10") })),
      shipmentStory(shipment({ verification: { ...VERIFICATION, status: "blocked" }, ai: { ...AI, direction: "worsened" } })),
    ];
    const strings = stories.flatMap((s) => [
      s.work, s.badge, s.confidence, s.verification.headline, ...s.verification.components, s.baseline ?? "", s.overlap ?? "",
      ...s.timeline.map((t) => t.label), ...s.chips.map((c) => c.text),
      s.search.headline, ...s.search.caveats, s.learning,
      ...(s.ai ? [s.ai.heading, s.ai.coverage, s.ai.line] : []),
    ]);
    for (const s of strings) {
      expect(s, `dash in: ${s}`).not.toMatch(/[–—]/);
      expect(s, `raw date stamp in: ${s}`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(s, `slug in: ${s}`).not.toMatch(/[a-z]+_[a-z]+/);
      expect(s.toLowerCase(), `lab word in: ${s}`)
        .not.toMatch(/\b(experiment|control group|controls|baseline|treatment|serp|cohort|p value|statistically|confounder)\b/);
      expect(s.toLowerCase(), `provider jargon in: ${s}`).not.toMatch(/\b(openai|dataforseo|gpt|api|endpoint|token)\b/);
    }
  });
});
