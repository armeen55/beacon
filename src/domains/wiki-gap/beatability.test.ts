import { describe, it, expect } from "vitest";
import { scoreBeatability, THIN_WORDS_THRESHOLD, STALE_YEARS_THRESHOLD } from "./beatability";

const NOW = new Date("2026-07-02T00:00:00Z");

describe("scoreBeatability - existence", () => {
  it("a nonexistent article scores high (nothing to be thin relative to)", () => {
    const r = scoreBeatability({ words: null, lastRevisionAt: null, sections: null, exists: false, demand: null, now: NOW });
    expect(r.band).toBe("high");
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.thin).toBe(true);
  });
});

describe("scoreBeatability - thinness", () => {
  it("a very short article (well under threshold) scores thin=true, high band", () => {
    const r = scoreBeatability({
      words: 180,
      lastRevisionAt: new Date(NOW.getTime() - 3 * 365.25 * 24 * 60 * 60 * 1000).toISOString(),
      sections: 2,
      exists: true,
      demand: null,
      now: NOW,
    });
    expect(r.thin).toBe(true);
    expect(r.band).toBe("high");
  });

  it("a long, fresh article is not thin and not stale, low band", () => {
    const r = scoreBeatability({
      words: 4000,
      lastRevisionAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
      sections: 12,
      exists: true,
      demand: null,
      now: NOW,
    });
    expect(r.thin).toBe(false);
    expect(r.stale).toBe(false);
    expect(r.band).toBe("low");
  });

  it("thin flag flips exactly at the documented threshold", () => {
    const justUnder = scoreBeatability({ words: THIN_WORDS_THRESHOLD - 1, lastRevisionAt: null, sections: null, exists: true, demand: null, now: NOW });
    const atThreshold = scoreBeatability({ words: THIN_WORDS_THRESHOLD, lastRevisionAt: null, sections: null, exists: true, demand: null, now: NOW });
    expect(justUnder.thin).toBe(true);
    expect(atThreshold.thin).toBe(false);
  });

  it("unknown word count never assumes thin", () => {
    const r = scoreBeatability({ words: null, lastRevisionAt: null, sections: null, exists: true, demand: null, now: NOW });
    expect(r.thin).toBe(false);
  });
});

describe("scoreBeatability - staleness", () => {
  it("stale flag flips exactly at the documented threshold (years)", () => {
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const justUnder = scoreBeatability({
      words: 4000,
      lastRevisionAt: new Date(NOW.getTime() - (STALE_YEARS_THRESHOLD - 0.1) * msPerYear).toISOString(),
      sections: 10,
      exists: true,
      demand: null,
      now: NOW,
    });
    const over = scoreBeatability({
      words: 4000,
      lastRevisionAt: new Date(NOW.getTime() - (STALE_YEARS_THRESHOLD + 0.5) * msPerYear).toISOString(),
      sections: 10,
      exists: true,
      demand: null,
      now: NOW,
    });
    expect(justUnder.stale).toBe(false);
    expect(over.stale).toBe(true);
  });

  it("unknown revision date never assumes stale", () => {
    const r = scoreBeatability({ words: 4000, lastRevisionAt: null, sections: 10, exists: true, demand: null, now: NOW });
    expect(r.stale).toBe(false);
    expect(r.yearsSinceRevision).toBeNull();
  });

  it("a future/garbage revision timestamp is treated as unknown, not negative years", () => {
    const r = scoreBeatability({
      words: 4000,
      lastRevisionAt: new Date(NOW.getTime() + 1000).toISOString(), // future
      sections: 10,
      exists: true,
      demand: null,
      now: NOW,
    });
    expect(r.yearsSinceRevision).toBeNull();
    expect(r.stale).toBe(false);
  });
});

describe("scoreBeatability - generic", () => {
  it("flags generic when a long article has very few sections for its length", () => {
    const r = scoreBeatability({ words: 3000, lastRevisionAt: null, sections: 1, exists: true, demand: null, now: NOW });
    expect(r.generic).toBe(true);
  });

  it("does not flag generic when sections are unknown", () => {
    const r = scoreBeatability({ words: 3000, lastRevisionAt: null, sections: null, exists: true, demand: null, now: NOW });
    expect(r.generic).toBe(false);
  });

  it("does not flag generic for a thin article (thin already covers it)", () => {
    const r = scoreBeatability({ words: 100, lastRevisionAt: null, sections: 1, exists: true, demand: null, now: NOW });
    expect(r.generic).toBe(false);
  });
});

describe("scoreBeatability - demand as a tiebreaker, not a gate", () => {
  it("higher demand raises the score between two otherwise-identical thin+stale articles", () => {
    const base = {
      words: 200,
      lastRevisionAt: new Date(NOW.getTime() - 4 * 365.25 * 24 * 60 * 60 * 1000).toISOString(),
      sections: 2,
      exists: true,
      now: NOW,
    };
    const noDemand = scoreBeatability({ ...base, demand: null });
    const someDemand = scoreBeatability({ ...base, demand: 50 });
    const highDemand = scoreBeatability({ ...base, demand: 5000 });
    expect(someDemand.score).toBeGreaterThanOrEqual(noDemand.score);
    expect(highDemand.score).toBeGreaterThanOrEqual(someDemand.score);
  });

  it("a thin+stale article still scores meaningfully with zero known demand (never gated on demand)", () => {
    const r = scoreBeatability({
      words: 150,
      lastRevisionAt: new Date(NOW.getTime() - 5 * 365.25 * 24 * 60 * 60 * 1000).toISOString(),
      sections: 1,
      exists: true,
      demand: null,
      now: NOW,
    });
    expect(r.band).not.toBe("low");
  });
});

describe("scoreBeatability - score bounds + band monotonicity", () => {
  it("score is always within 0-100", () => {
    const cases = [
      { words: 0, lastRevisionAt: null, sections: null, exists: true, demand: 1_000_000 },
      { words: 100000, lastRevisionAt: NOW.toISOString(), sections: 500, exists: true, demand: 0 },
      { words: null, lastRevisionAt: null, sections: null, exists: false, demand: null },
    ];
    for (const c of cases) {
      const r = scoreBeatability({ ...c, now: NOW });
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("band thresholds are consistent with the numeric score", () => {
    const samples = [
      { words: 50, lastRevisionAt: null, sections: null, exists: true, demand: null },
      { words: 400, lastRevisionAt: new Date(NOW.getTime() - 3 * 365.25 * 24 * 60 * 60 * 1000).toISOString(), sections: 3, exists: true, demand: 200 },
      { words: 5000, lastRevisionAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(), sections: 20, exists: true, demand: null },
    ];
    for (const s of samples) {
      const r = scoreBeatability({ ...s, now: NOW });
      if (r.score >= 60) expect(r.band).toBe("high");
      else if (r.score >= 30) expect(r.band).toBe("medium");
      else expect(r.band).toBe("low");
    }
  });
});

describe("scoreBeatability - evidence sentence content + voice", () => {
  it("includes the real word count and revision year when both are known", () => {
    const r = scoreBeatability({
      words: 180,
      lastRevisionAt: "2019-03-15T00:00:00Z",
      sections: 2,
      exists: true,
      demand: null,
      now: NOW,
    });
    expect(r.evidenceSentence).toContain("180");
    expect(r.evidenceSentence).toContain("2019");
    expect(r.evidenceSentence).toContain("AI cites it anyway because nothing better exists");
    expect(r.evidenceSentence).toContain("You can be the better source");
  });

  it("the nonexistent-article sentence is honest about there being no dedicated article", () => {
    const r = scoreBeatability({ words: null, lastRevisionAt: null, sections: null, exists: false, demand: null, now: NOW });
    expect(r.evidenceSentence.toLowerCase()).toContain("no");
    expect(r.evidenceSentence.toLowerCase()).toContain("wikipedia");
  });

  it("first person voice - uses I, never third person about Beacon", () => {
    const r = scoreBeatability({ words: null, lastRevisionAt: null, sections: null, exists: false, demand: null, now: NOW });
    expect(r.evidenceSentence).toContain("I ");
  });
});

describe("scoreBeatability - dash guard (HARD RULE: no em or en dashes anywhere)", () => {
  const NO_DASH = /[–—]/;

  it("never emits an em or en dash across a wide matrix of inputs", () => {
    const wordsCases = [null, 0, 50, 180, 499, 500, 1000, 5000];
    const yearsCases = [null, 0.1, 1, 2, 2.1, 5, 10];
    const sectionsCases = [null, 0, 1, 2, 5, 20];
    const demandCases = [null, 0, 10, 500, 5000];
    for (const words of wordsCases) {
      for (const years of yearsCases) {
        for (const sections of sectionsCases) {
          for (const demand of demandCases) {
            const lastRevisionAt =
              years == null ? null : new Date(NOW.getTime() - years * 365.25 * 24 * 60 * 60 * 1000).toISOString();
            const r = scoreBeatability({ words, lastRevisionAt, sections, exists: true, demand, now: NOW });
            expect(r.evidenceSentence).not.toMatch(NO_DASH);
          }
        }
      }
    }
    const nonexistent = scoreBeatability({ words: null, lastRevisionAt: null, sections: null, exists: false, demand: null, now: NOW });
    expect(nonexistent.evidenceSentence).not.toMatch(NO_DASH);
  });
});
