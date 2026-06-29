import { describe, it, expect } from "vitest";
import { scheduleAutoMeasure } from "./auto-measure-on-use";

// scheduleAutoMeasure schedules via next/after, which is only valid inside a request
// scope. Outside one (here), it must NO-OP without throwing — the render path can never
// be broken by the passive trigger. (The real measurement is covered by the
// auto-measure-pass / measure-lifecycle suites.)
describe("scheduleAutoMeasure — fail-soft render contract", () => {
  it("no-ops on empty tenantId", () => {
    expect(() => scheduleAutoMeasure("")).not.toThrow();
  });
  it("never throws when called outside a request scope", () => {
    expect(() => scheduleAutoMeasure("tenant-iranopedia")).not.toThrow();
  });
  it("throttles a rapid second call without throwing", () => {
    expect(() => {
      scheduleAutoMeasure("tenant-throttle-test");
      scheduleAutoMeasure("tenant-throttle-test");
    }).not.toThrow();
  });
});
