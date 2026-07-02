import { describe, it, expect } from "vitest";
import {
  computeCitationLosses,
  attributeCompetitorTakeover,
  extractHeadlineFact,
  CITATION_LOSS_WINDOW_DAYS,
  type CitationLossInputRow,
  type CitationLossFinding,
  type CoverageLossFinding,
} from "./citation-loss";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const NOW_ISO = "2026-07-02T12:00:00Z";
const OWNED = "iranopedia.com";

function row(overrides: Partial<CitationLossInputRow> & { prompt: string; date: string }): CitationLossInputRow {
  return {
    model: "ChatGPT",
    ownCited: false,
    citationHosts: [],
    responseExcerpt: null,
    ...overrides,
  };
}

describe("computeCitationLosses - window math", () => {
  it("classifies a genuine citation loss: cited in the prior window, polled but not cited in the recent window", () => {
    const rows: CitationLossInputRow[] = [
      // Prior window (8-14 days ago): cited.
      row({ prompt: "What is Chaharshanbe Suri", date: "2026-06-22", ownCited: true, citationHosts: ["iranopedia.com", "en.wikipedia.org"] }),
      // Recent window (0-7 days ago): still polled, no longer cited.
      row({
        prompt: "What is Chaharshanbe Suri",
        date: "2026-06-28",
        ownCited: false,
        model: "Perplexity",
        citationHosts: ["en.wikipedia.org", "surfiran.com"],
        responseExcerpt: "Chaharshanbe Suri is Iran's fire festival, held on the eve of the last Wednesday before Nowruz.",
      }),
    ];
    const findings = computeCitationLosses(rows, { nowIso: NOW_ISO, ownedDomainNorm: OWNED });
    expect(findings).toHaveLength(1);
    const f = findings[0] as CitationLossFinding;
    expect(f.kind).toBe("citation_loss");
    expect(f.prompt).toBe("What is Chaharshanbe Suri");
    expect(f.priorCitationCount).toBe(1);
    expect(f.recentAnsweringModels).toContain("Perplexity");
  });

  it("classifies a coverage loss: cited in the prior window, ZERO rows at all in the recent window", () => {
    const rows: CitationLossInputRow[] = [
      row({ prompt: "What goes on a haft-sin table", date: "2026-06-21", ownCited: true, citationHosts: ["iranopedia.com"] }),
      row({ prompt: "What goes on a haft-sin table", date: "2026-06-23", ownCited: true, citationHosts: ["iranopedia.com"] }),
      // No rows at all in the 7-day recent window.
    ];
    const findings = computeCitationLosses(rows, { nowIso: NOW_ISO, ownedDomainNorm: OWNED });
    expect(findings).toHaveLength(1);
    const f = findings[0] as CoverageLossFinding;
    expect(f.kind).toBe("coverage_loss");
    expect(f.priorRowCount).toBe(2);
    expect(f.lastSeenDate).toBe("2026-06-23");
  });

  it("never confuses a citation loss with a coverage loss (mutually exclusive kinds)", () => {
    const rows: CitationLossInputRow[] = [
      row({ prompt: "citation-loss-prompt", date: "2026-06-22", ownCited: true, citationHosts: ["iranopedia.com"] }),
      row({ prompt: "citation-loss-prompt", date: "2026-06-29", ownCited: false, citationHosts: ["rival.com"] }),
      row({ prompt: "coverage-loss-prompt", date: "2026-06-22", ownCited: true, citationHosts: ["iranopedia.com"] }),
    ];
    const findings = computeCitationLosses(rows, { nowIso: NOW_ISO, ownedDomainNorm: OWNED });
    const byPrompt = new Map(findings.map((f) => [f.prompt, f.kind]));
    expect(byPrompt.get("citation-loss-prompt")).toBe("citation_loss");
    expect(byPrompt.get("coverage-loss-prompt")).toBe("coverage_loss");
  });

  it("emits nothing when the tenant is still cited in the recent window (no loss)", () => {
    const rows: CitationLossInputRow[] = [
      row({ prompt: "still cited", date: "2026-06-22", ownCited: true, citationHosts: ["iranopedia.com"] }),
      row({ prompt: "still cited", date: "2026-06-29", ownCited: true, citationHosts: ["iranopedia.com"] }),
    ];
    expect(computeCitationLosses(rows, { nowIso: NOW_ISO, ownedDomainNorm: OWNED })).toEqual([]);
  });

  it("emits nothing for a prompt never cited in the prior window (no loss to report)", () => {
    const rows: CitationLossInputRow[] = [
      row({ prompt: "never cited", date: "2026-06-22", ownCited: false, citationHosts: ["rival.com"] }),
      row({ prompt: "never cited", date: "2026-06-29", ownCited: false, citationHosts: ["rival.com"] }),
    ];
    expect(computeCitationLosses(rows, { nowIso: NOW_ISO, ownedDomainNorm: OWNED })).toEqual([]);
  });

  it("ignores rows older than the prior window (outside both buckets)", () => {
    const rows: CitationLossInputRow[] = [
      // 40 days ago - outside the 2x7-day compare window entirely.
      row({ prompt: "ancient prompt", date: "2026-05-23", ownCited: true, citationHosts: ["iranopedia.com"] }),
    ];
    expect(computeCitationLosses(rows, { nowIso: NOW_ISO, ownedDomainNorm: OWNED })).toEqual([]);
  });

  it("respects a custom windowDays argument", () => {
    const rows: CitationLossInputRow[] = [
      // 5 days ago: prior window under a 3-day window setting (recent=0-3d, prior=3-6d).
      row({ prompt: "custom window", date: "2026-06-28", ownCited: true, citationHosts: ["iranopedia.com"] }),
      row({ prompt: "custom window", date: "2026-07-01", ownCited: false, citationHosts: ["rival.com"] }),
    ];
    const findings = computeCitationLosses(rows, { nowIso: NOW_ISO, ownedDomainNorm: OWNED, windowDays: 3 });
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("citation_loss");
  });

  it("uses CITATION_LOSS_WINDOW_DAYS as the documented default (7)", () => {
    expect(CITATION_LOSS_WINDOW_DAYS).toBe(7);
  });

  it("sorts citation losses before coverage losses (actionable signal leads)", () => {
    const rows: CitationLossInputRow[] = [
      row({ prompt: "b-coverage", date: "2026-06-21", ownCited: true, citationHosts: ["iranopedia.com"] }),
      row({ prompt: "a-citation", date: "2026-06-22", ownCited: true, citationHosts: ["iranopedia.com"] }),
      row({ prompt: "a-citation", date: "2026-06-29", ownCited: false, citationHosts: ["rival.com"] }),
    ];
    const findings = computeCitationLosses(rows, { nowIso: NOW_ISO, ownedDomainNorm: OWNED });
    expect(findings.map((f) => f.kind)).toEqual(["citation_loss", "coverage_loss"]);
  });
});

describe("attributeCompetitorTakeover", () => {
  it("picks the most-cited non-owned domain in the recent window", () => {
    const rows: CitationLossInputRow[] = [
      row({ prompt: "p", date: "2026-06-29", citationHosts: ["iranopedia.com", "rival.com", "www.rival.com"] }),
      row({ prompt: "p", date: "2026-06-30", citationHosts: ["rival.com", "other.com"] }),
    ];
    const result = attributeCompetitorTakeover(rows, "iranopedia.com");
    expect(result.domain).toBe("rival.com");
    expect(result.citingAnswerCount).toBe(3); // rival.com + www.rival.com (stripped) across both rows
  });

  it("strips www and never attributes the owned domain itself", () => {
    const rows: CitationLossInputRow[] = [row({ prompt: "p", date: "2026-06-29", citationHosts: ["www.iranopedia.com"] })];
    const result = attributeCompetitorTakeover(rows, "iranopedia.com");
    expect(result.domain).toBeNull();
    expect(result.citingAnswerCount).toBe(0);
  });

  it("returns null domain when the recent window cites nothing at all", () => {
    const result = attributeCompetitorTakeover([], "iranopedia.com");
    expect(result.domain).toBeNull();
    expect(result.citingAnswerCount).toBe(0);
  });

  it("is deterministic under ties (first-seen order wins)", () => {
    const rows: CitationLossInputRow[] = [
      row({ prompt: "p", date: "2026-06-29", citationHosts: ["first.com", "second.com"] }),
    ];
    const result = attributeCompetitorTakeover(rows, "iranopedia.com");
    expect(result.domain).toBe("first.com");
  });
});

describe("extractHeadlineFact", () => {
  it("prefers an excerpt from an answer that cites the identified competitor", () => {
    const rows: CitationLossInputRow[] = [
      row({ prompt: "p", date: "2026-06-29", citationHosts: ["other.com"], responseExcerpt: "Other fact here." }),
      row({ prompt: "p", date: "2026-06-30", citationHosts: ["rival.com"], responseExcerpt: "Rival fact here about the festival." }),
    ];
    const fact = extractHeadlineFact(rows, "rival.com");
    expect(fact?.fact).toContain("Rival fact here about the festival.");
  });

  it("falls back to any excerpt when no row cites the named competitor", () => {
    const rows: CitationLossInputRow[] = [
      row({ prompt: "p", date: "2026-06-29", citationHosts: ["other.com"], responseExcerpt: "Only fact available." }),
    ];
    const fact = extractHeadlineFact(rows, "rival.com");
    expect(fact?.fact).toContain("Only fact available.");
  });

  it("returns null when no recent row has a response excerpt (never fabricates)", () => {
    const rows: CitationLossInputRow[] = [row({ prompt: "p", date: "2026-06-29", citationHosts: ["rival.com"], responseExcerpt: null })];
    expect(extractHeadlineFact(rows, "rival.com")).toBeNull();
  });

  it("caps a run-on excerpt to a headline length without ever throwing", () => {
    const longExcerpt = "This is a very long answer with no punctuation for a long stretch of words that keeps going ".repeat(5);
    const rows: CitationLossInputRow[] = [row({ prompt: "p", date: "2026-06-29", citationHosts: [], responseExcerpt: longExcerpt })];
    const fact = extractHeadlineFact(rows, null);
    expect(fact).not.toBeNull();
    expect(fact!.fact.length).toBeLessThan(longExcerpt.length);
  });

  it("never returns a banned em/en dash in the extracted fact", () => {
    const rows: CitationLossInputRow[] = [
      row({ prompt: "p", date: "2026-06-29", citationHosts: [], responseExcerpt: "Chaharshanbe Suri, celebrated on the eve of Nowruz, is Iran's fire festival." }),
    ];
    const fact = extractHeadlineFact(rows, null);
    expect(hasBannedDash(fact?.fact)).toBe(false);
  });
});
