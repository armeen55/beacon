import { describe, expect, it } from "vitest";
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
