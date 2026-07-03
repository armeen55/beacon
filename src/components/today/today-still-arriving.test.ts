import { describe, expect, it } from "vitest";
import { readStillArriving, stillArrivingPhrase, checkpointLabel } from "./today-still-arriving";

describe("readStillArriving", () => {
  it("marks a mature result as final (no label)", () => {
    const r = readStillArriving("mature_result");
    expect(r.final).toBe(true);
    expect(r.label).toBe("");
  });

  it("marks an early checkpoint as still measuring", () => {
    const r = readStillArriving("early_checkpoint", "2026-07-18");
    expect(r.final).toBe(false);
    expect(r.label).toBe("still measuring");
    expect(r.nextCheckpoint).toBe("2026-07-18");
  });

  it("marks a blocked-data window as still arriving (the literal waiting-on-Google case)", () => {
    const r = readStillArriving("blocked_data");
    expect(r.final).toBe(false);
    expect(r.label).toBe("still arriving");
  });

  it("marks collecting/interim/scheduled as not final", () => {
    for (const m of ["collecting", "interim_checkpoint", "scheduled", "attribution_limited"] as const) {
      expect(readStillArriving(m).final).toBe(false);
    }
  });
});

describe("stillArrivingPhrase", () => {
  it("returns an empty phrase for a final number", () => {
    expect(stillArrivingPhrase(readStillArriving("mature_result"))).toBe("");
  });

  it("adds a final-read date when a checkpoint is known", () => {
    expect(stillArrivingPhrase(readStillArriving("early_checkpoint", "2026-07-18"))).toBe("still measuring, final read around Jul 18");
  });

  it("falls back to the bare label with no checkpoint", () => {
    expect(stillArrivingPhrase(readStillArriving("blocked_data"))).toBe("still arriving");
  });

  it("never emits an em or en dash", () => {
    expect(stillArrivingPhrase(readStillArriving("early_checkpoint", "2026-07-18"))).not.toMatch(/[‒–—―]/);
  });
});

describe("checkpointLabel", () => {
  it("formats a YYYY-MM-DD date", () => {
    expect(checkpointLabel("2026-07-18")).toBe("Jul 18");
  });
  it("returns null for an unparseable date", () => {
    expect(checkpointLabel(null)).toBeNull();
    expect(checkpointLabel("nope")).toBeNull();
  });
});
