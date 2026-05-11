/**
 * /changes/[id] proof-brief — outcome-event humanizer truth table.
 *
 * Pins that every raw event-type enum maps to a customer-safe label
 * + plain-English summary + tone, and that NO raw enum name appears
 * in any rendered string.
 */
import { describe, expect, it } from "vitest";

import {
  humanizeOutcomeEvent,
  platformLabel,
  PLATFORM_LABEL,
} from "@/domains/changes/proof-timeline/event-humanizer";
import type { OutcomeEvent } from "@/domains/attribution/events";

function makeEvent(over: Partial<OutcomeEvent> = {}): OutcomeEvent {
  return {
    id: "evt-1",
    type: "first_appearance",
    topic: "modern home builder",
    platform: "chatgpt",
    trigger_date: "2026-05-04T00:00:00Z",
    anchor_result_id: "res-1",
    result_ids: ["res-1"],
    description: "raw description (should NOT appear in customer copy)",
    context: {
      mentions_before: 0,
      mentions_after: 3,
      cited: true,
      gap_days: 0,
    },
    ...over,
  } as OutcomeEvent;
}

describe("humanizeOutcomeEvent", () => {
  it("maps first_appearance → First time cited (success tone)", () => {
    const h = humanizeOutcomeEvent(makeEvent({ type: "first_appearance" }));
    expect(h.kind).toBe("first_cited");
    expect(h.label).toBe("First time cited");
    expect(h.tone).toBe("success");
    expect(h.platformLabel).toBe("ChatGPT");
    expect(h.summary.toLowerCase()).toContain("for the first time");
  });

  it("maps visibility_regained → Back in the rankings (success tone)", () => {
    const h = humanizeOutcomeEvent(
      makeEvent({ type: "visibility_regained", platform: "perplexity" }),
    );
    expect(h.kind).toBe("back_in_rankings");
    expect(h.label).toBe("Back in the rankings");
    expect(h.tone).toBe("success");
    expect(h.platformLabel).toBe("Perplexity");
  });

  it("maps mention_surge → Mentions jumped (success tone)", () => {
    const h = humanizeOutcomeEvent(
      makeEvent({
        type: "mention_surge",
        context: {
          mentions_before: 1,
          mentions_after: 5,
          cited: true,
          gap_days: 0,
        },
      }),
    );
    expect(h.kind).toBe("mentions_jumped");
    expect(h.label).toBe("Mentions jumped");
    expect(h.tone).toBe("success");
    expect(h.summary).toContain("1");
    expect(h.summary).toContain("5");
  });

  it("maps visibility_lost → Dropped from the rankings (danger tone)", () => {
    const h = humanizeOutcomeEvent(
      makeEvent({ type: "visibility_lost", platform: "google_aio" }),
    );
    expect(h.kind).toBe("dropped_from_rankings");
    expect(h.label).toBe("Dropped from the rankings");
    expect(h.tone).toBe("danger");
    expect(h.platformLabel).toBe("Google AI Overviews");
  });

  it("maps mention_decline → Mentions slowed down (danger tone)", () => {
    const h = humanizeOutcomeEvent(
      makeEvent({
        type: "mention_decline",
        context: {
          mentions_before: 4,
          mentions_after: 1,
          cited: true,
          gap_days: 0,
        },
      }),
    );
    expect(h.kind).toBe("mentions_slowed");
    expect(h.label).toBe("Mentions slowed down");
    expect(h.tone).toBe("danger");
  });

  it("never leaks raw event-type enums in label or summary", () => {
    const banned = [
      "first_appearance",
      "visibility_regained",
      "mention_surge",
      "visibility_lost",
      "mention_decline",
    ];
    for (const t of banned as ReadonlyArray<OutcomeEvent["type"]>) {
      const h = humanizeOutcomeEvent(makeEvent({ type: t }));
      const lower = (h.label + " " + h.summary).toLowerCase();
      for (const term of banned) {
        expect(lower, `${t} leaked '${term}'`).not.toContain(term);
      }
    }
  });

  it("slices the trigger_date down to a YYYY-MM-DD value", () => {
    const h = humanizeOutcomeEvent(
      makeEvent({ trigger_date: "2026-05-04T12:34:56Z" }),
    );
    expect(h.date).toBe("2026-05-04");
  });
});

describe("platformLabel", () => {
  it("returns customer-friendly names for tracked platforms", () => {
    expect(platformLabel("chatgpt")).toBe("ChatGPT");
    expect(platformLabel("perplexity")).toBe("Perplexity");
    expect(platformLabel("google_aio")).toBe("Google AI Overviews");
  });

  it("falls through to the raw key only for unknown platforms", () => {
    expect(platformLabel("unknown_engine")).toBe("unknown_engine");
  });

  it("never advertises an internal subsystem name in the label table", () => {
    const banned = ["z-score", "pattern brain", "evidence tier"];
    for (const value of Object.values(PLATFORM_LABEL)) {
      const lower = value.toLowerCase();
      for (const term of banned) {
        expect(lower, `${value} leaked '${term}'`).not.toContain(term);
      }
    }
  });
});
