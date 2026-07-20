import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  HONEST_DELAY_ESCALATED_MESSAGE,
  HONEST_DELAY_MAX_VISIBLE_RETRIES,
  HONEST_DELAY_RETRY_COOLDOWN_MS,
  honestDelayHasEscalated,
  shouldScheduleHonestDelayRetry,
} from "./honest-delay";

describe("honest delay automatic retry", () => {
  it("schedules the first retry", () => {
    expect(shouldScheduleHonestDelayRetry({ lastRetryAtMs: null, nowMs: 1_000 })).toBe(true);
  });

  it("blocks another retry inside the cooldown", () => {
    expect(
      shouldScheduleHonestDelayRetry({
        lastRetryAtMs: 1_000,
        nowMs: 1_000 + HONEST_DELAY_RETRY_COOLDOWN_MS - 1,
      }),
    ).toBe(false);
  });

  it("allows a retry when the cooldown has elapsed", () => {
    expect(
      shouldScheduleHonestDelayRetry({
        lastRetryAtMs: 1_000,
        nowMs: 1_000 + HONEST_DELAY_RETRY_COOLDOWN_MS,
      }),
    ).toBe(true);
  });

  it("treats malformed stored timestamps as no prior retry", () => {
    expect(shouldScheduleHonestDelayRetry({ lastRetryAtMs: Number.NaN, nowMs: 1_000 })).toBe(true);
  });
});

describe("honest delay bounded escalation", () => {
  it("does not escalate before the visible-retry budget is spent", () => {
    expect(honestDelayHasEscalated(0)).toBe(false);
    expect(honestDelayHasEscalated(HONEST_DELAY_MAX_VISIBLE_RETRIES - 1)).toBe(false);
  });

  it("escalates at and past the budget so we stop implying success", () => {
    expect(honestDelayHasEscalated(HONEST_DELAY_MAX_VISIBLE_RETRIES)).toBe(true);
    expect(honestDelayHasEscalated(HONEST_DELAY_MAX_VISIBLE_RETRIES + 9)).toBe(true);
  });

  it("treats a malformed retry count as not-yet-escalated", () => {
    expect(honestDelayHasEscalated(Number.NaN)).toBe(false);
  });

  it("uses honest, calm escalation copy with no dashes and no false promise", () => {
    expect(HONEST_DELAY_ESCALATED_MESSAGE).toContain("could not load");
    expect(HONEST_DELAY_ESCALATED_MESSAGE).toContain("on my side");
    expect(HONEST_DELAY_ESCALATED_MESSAGE).toContain("your data is safe");
    // Never implies it is about to succeed the way the default message does.
    expect(HONEST_DELAY_ESCALATED_MESSAGE).not.toContain("retrying automatically");
    expect(HONEST_DELAY_ESCALATED_MESSAGE).not.toMatch(/[‒–—―]/);
  });
});

describe("customer recovery boundaries", () => {
  const todaySource = readFileSync(
    new URL("../app/(shell)/page.tsx", import.meta.url),
    "utf8",
  );
  const keywordSource = readFileSync(
    new URL("../app/(shell)/research/keywords/page.tsx", import.meta.url),
    "utf8",
  );

  it("Today load failures use automatic recovery", () => {
    expect(todaySource).toContain("Couldn’t load Today just now. Your data is safe, and Beacon is retrying automatically.");
    expect(todaySource).not.toContain("Your data is safe. Refresh in a moment");
  });

  it("keyword-library load failures use automatic recovery", () => {
    expect(keywordSource).toContain("I couldn’t load your keyword library just now. Beacon is retrying automatically.");
    expect(keywordSource).not.toContain("I could not load your keyword library just now. Refresh in a moment.");
  });
});
