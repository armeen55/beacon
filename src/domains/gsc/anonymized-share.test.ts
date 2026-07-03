import { describe, it, expect } from "vitest";

import {
  ANONYMIZED_NOTE_MIN_SHARE,
  anonymizedQueryShare,
  anonymizedShareNote,
} from "./anonymized-share";

const BANNED_DASH = /[‒–—―]/;

describe("anonymizedQueryShare", () => {
  it("is (total minus visible) over total", () => {
    expect(anonymizedQueryShare(1000, 600)).toBeCloseTo(0.4);
    expect(anonymizedQueryShare(1000, 1000)).toBe(0);
  });

  it("clamps to [0, 1] when canonicalization makes visible exceed total", () => {
    expect(anonymizedQueryShare(1000, 1200)).toBe(0);
    expect(anonymizedQueryShare(1000, 0)).toBe(1);
  });

  it("is null when either input is unknown (never a guess)", () => {
    expect(anonymizedQueryShare(0, 500)).toBeNull();
    expect(anonymizedQueryShare(null, 500)).toBeNull();
    expect(anonymizedQueryShare(1000, null)).toBeNull();
    expect(anonymizedQueryShare(1000, undefined)).toBeNull();
    expect(anonymizedQueryShare(1000, -5)).toBeNull();
    expect(anonymizedQueryShare(Number.NaN, 500)).toBeNull();
  });
});

describe("anonymizedShareNote", () => {
  it("stays silent under the threshold (a small hidden slice is normal)", () => {
    expect(anonymizedShareNote(null)).toBeNull();
    expect(anonymizedShareNote(0)).toBeNull();
    expect(anonymizedShareNote(ANONYMIZED_NOTE_MIN_SHARE - 0.01)).toBeNull();
  });

  it("speaks plainly at each magnitude", () => {
    expect(anonymizedShareNote(0.3)).toContain("About a third");
    expect(anonymizedShareNote(0.5)).toContain("About half");
    expect(anonymizedShareNote(0.7)).toContain("Most");
    expect(anonymizedShareNote(0.9)).toContain("Almost all");
  });

  it("says what is hidden and what the visible numbers cover", () => {
    const note = anonymizedShareNote(0.35)!;
    expect(note).toBe(
      "About a third of this page's Google traffic comes from searches Google keeps private. The numbers below cover what Google shows me.",
    );
  });

  it("never emits an em or en dash", () => {
    for (const share of [0.3, 0.5, 0.7, 0.95]) {
      expect(BANNED_DASH.test(anonymizedShareNote(share)!)).toBe(false);
    }
  });
});
