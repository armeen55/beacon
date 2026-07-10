/**
 * single-flight (W2-B, 2026-07-10) - concurrent callers of the same key join ONE
 * run; the key clears when it settles so the next call can refresh again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runSingleFlight,
  isInFlight,
  inFlightCount,
  __resetSingleFlightForTests,
} from "./single-flight";

afterEach(() => {
  __resetSingleFlightForTests();
});

/** A deferred promise so a test can hold a run "in flight" deterministically. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runSingleFlight", () => {
  it("collapses concurrent callers of the same key to ONE run", async () => {
    const gate = deferred<void>();
    const fn = vi.fn(async () => {
      await gate.promise;
    });

    const a = runSingleFlight("k", fn);
    const b = runSingleFlight("k", fn);
    const c = runSingleFlight("k", fn);

    // Three concurrent readers, ONE underlying run.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isInFlight("k")).toBe(true);
    expect(a).toBe(b);
    expect(b).toBe(c);

    gate.resolve();
    await Promise.all([a, b, c]);
    // Key clears when the run settles.
    expect(isInFlight("k")).toBe(false);
    expect(inFlightCount()).toBe(0);
  });

  it("different keys run independently", async () => {
    const g1 = deferred<void>();
    const g2 = deferred<void>();
    const f1 = vi.fn(async () => {
      await g1.promise;
    });
    const f2 = vi.fn(async () => {
      await g2.promise;
    });

    const p1 = runSingleFlight("a", f1);
    const p2 = runSingleFlight("b", f2);
    expect(inFlightCount()).toBe(2);
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).toHaveBeenCalledTimes(1);

    g1.resolve();
    g2.resolve();
    await Promise.all([p1, p2]);
    expect(inFlightCount()).toBe(0);
  });

  it("a later call after the first settles starts a FRESH run (the next stale refresh)", async () => {
    const fn = vi.fn(async () => {});
    await runSingleFlight("k", fn);
    expect(isInFlight("k")).toBe(false);
    await runSingleFlight("k", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("clears the key even when the run rejects (no permanently-stuck flight)", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(runSingleFlight("k", fn)).rejects.toThrow("boom");
    expect(isInFlight("k")).toBe(false);
    // A subsequent call is not blocked by the failed one.
    const ok = vi.fn(async () => {});
    await runSingleFlight("k", ok);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
