import { describe, expect, it } from "vitest";
import { loadWithDeadline, valueWithDeadline, DEFAULT_DEADLINE_MS } from "./load-with-deadline";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("loadWithDeadline", () => {
  it("returns the data when the loader beats the deadline", async () => {
    const result = await loadWithDeadline(Promise.resolve(42), 50);
    expect(result).toEqual({ timedOut: false, data: 42 });
  });

  it("returns timedOut when the loader is slower than the deadline", async () => {
    const slow = sleep(80).then(() => "late");
    const result = await loadWithDeadline(slow, 10);
    expect(result.timedOut).toBe(true);
    expect(result.data).toBeNull();
  });

  it("propagates a fast rejection (fail-soft stays at the call site)", async () => {
    await expect(loadWithDeadline(Promise.reject(new Error("boom")), 50)).rejects.toThrow("boom");
  });

  it("a rejection AFTER the deadline never becomes an unhandled crash", async () => {
    let rejectLate: (e: Error) => void = () => {};
    const slow = new Promise<string>((_, reject) => {
      rejectLate = reject;
    });
    const result = await loadWithDeadline(slow, 10);
    expect(result.timedOut).toBe(true);
    rejectLate(new Error("late failure"));
    // Give the microtask queue a beat; the helper's internal catch absorbs it.
    await sleep(5);
  });

  it("default deadline is 5 seconds", () => {
    expect(DEFAULT_DEADLINE_MS).toBe(5000);
  });
});

describe("valueWithDeadline", () => {
  it("returns the value when on time", async () => {
    expect(await valueWithDeadline(Promise.resolve("fresh"), "fallback", 50)).toBe("fresh");
  });

  it("returns the fallback past the deadline", async () => {
    const slow = sleep(80).then(() => "late");
    expect(await valueWithDeadline(slow, "fallback", 10)).toBe("fallback");
  });
});
