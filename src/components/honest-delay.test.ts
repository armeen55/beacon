import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  HONEST_DELAY_RETRY_COOLDOWN_MS,
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
