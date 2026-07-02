import { describe, it, expect } from "vitest";
import { groupCreatePageCandidates, type CanonCandidate } from "./canonical-create-page";

const c = (o: Partial<CanonCandidate> & { demandKey: string; label: string }): CanonCandidate => ({
  distinctTokens: [], keyword: null, strongKeyword: true, volume: 0, verdict: "build", hasPassingBrief: false, ...o,
});

describe("groupCreatePageCandidates — conservative canonical clustering", () => {
  it("collapses the nowruz trio (same matched keyword) into ONE group", () => {
    const groups = groupCreatePageCandidates([
      c({ demandKey: "usa", label: "Nowruz Activities USA", distinctTokens: ["nowruz", "activitie"], keyword: "nowruz persian new year", volume: 14800, verdict: "build", hasPassingBrief: true }),
      c({ demandKey: "kids", label: "Nowruz Activities Kids", distinctTokens: ["nowruz", "activitie", "kid"], keyword: "nowruz persian new year", volume: 14800, verdict: "build" }),
      c({ demandKey: "nny", label: "Nowruz Persian New Year", distinctTokens: ["nowruz", "new", "year"], keyword: "nowruz persian new year", volume: 14800, verdict: "build" }),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].siblings.length).toBe(2);
    expect(groups[0].confidence).toBe("high");
    // canonical lacks a passing brief? no — usa has one; canonical should inherit/keep it
    expect(groups[0].inheritBriefFrom == null || groups[0].canonical.hasPassingBrief).toBe(true);
  });
  it("the nowruz canonical (no own brief) inherits the sibling's passing brief", () => {
    const groups = groupCreatePageCandidates([
      c({ demandKey: "nny", label: "Nowruz Persian New Year", distinctTokens: ["nowruz","new","year"], keyword: "nowruz persian new year", volume: 14800, verdict: "build", hasPassingBrief: false }),
      c({ demandKey: "usa", label: "Nowruz Activities USA", distinctTokens: ["nowruz","activitie"], keyword: "nowruz persian new year", volume: 14800, verdict: "wait", hasPassingBrief: true }),
    ]);
    expect(groups[0].canonical.demandKey).toBe("nny"); // build beats wait
    expect(groups[0].inheritBriefFrom).toBe("usa");    // inherit the sibling's brief
  });
  it("collapses WEAK-keyword siblings but at medium confidence + withholds brief inheritance", () => {
    // The real nowruz case: USA/Kids matched "nowruz persian new year" only weakly.
    const groups = groupCreatePageCandidates([
      c({ demandKey: "nny", label: "Nowruz Persian New Year", distinctTokens: ["nowruz", "new", "year"], keyword: "nowruz persian new year", strongKeyword: true, volume: 14800, verdict: "build", hasPassingBrief: false }),
      c({ demandKey: "usa", label: "Nowruz Activities USA", distinctTokens: ["nowruz", "activitie"], keyword: "nowruz persian new year", strongKeyword: false, volume: 14800, verdict: "build", hasPassingBrief: true }),
    ]);
    expect(groups.length).toBe(1); // still collapses (dedups the board)
    expect(groups[0].confidence).toBe("medium"); // one side weak → not high
    expect(groups[0].inheritBriefFrom).toBeNull(); // loose merge does NOT borrow copy
  });
  it("merges Persian Wedding + Iranian Wedding (identical {wedding} token set)", () => {
    const groups = groupCreatePageCandidates([
      c({ demandKey: "pw", label: "Persian Wedding", distinctTokens: ["wedding"], keyword: "persian wedding", volume: 1900, verdict: "build", hasPassingBrief: true }),
      c({ demandKey: "iw", label: "Iranian Wedding", distinctTokens: ["wedding"], keyword: "iranian wedding", volume: 1900, verdict: "wait", hasPassingBrief: true }),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].canonical.demandKey).toBe("pw"); // build beats wait
    expect(groups[0].confidence).toBe("medium");       // token-set merge, not keyword
  });
  it("keeps 'Iranian Culture Etiquette' SEPARATE from 'Culture Iran' (distinct intent, diff keyword/tokens)", () => {
    const groups = groupCreatePageCandidates([
      c({ demandKey: "ci", label: "Culture Iran", distinctTokens: ["culture"], keyword: "culture iran", volume: 2900 }),
      c({ demandKey: "et", label: "Iranian Culture Etiquette", distinctTokens: ["culture", "etiquette"], keyword: "iranian culture etiquette", volume: 700 }),
    ]);
    expect(groups.length).toBe(2);
  });
  it("keeps 'Persian Art' SEPARATE from 'Art Persian Literature' (literature ≠ art)", () => {
    const groups = groupCreatePageCandidates([
      c({ demandKey: "pa", label: "Persian Art", distinctTokens: ["art"], keyword: "persian art", volume: 3600 }),
      c({ demandKey: "apl", label: "Art Persian Literature", distinctTokens: ["art", "literature"], keyword: "art persian literature", volume: 10 }),
    ]);
    expect(groups.length).toBe(2);
  });
  it("does NOT merge two unrelated single-token topics", () => {
    const groups = groupCreatePageCandidates([
      c({ demandKey: "a", label: "Persian Gardens", distinctTokens: ["garden"], keyword: "persian gardens" }),
      c({ demandKey: "b", label: "Persian Mythology", distinctTokens: ["mythology"], keyword: "persian mythology" }),
    ]);
    expect(groups.length).toBe(2);
  });
  it("operator ground-truth: two candidates that both weak-match the SAME noisy keyword but share NOTHING with each other stay SEPARATE (never merge on the keyword alone)", () => {
    const groups = groupCreatePageCandidates([
      c({ demandKey: "travel", label: "Travel Iran Beautiful Natural Wonders", distinctTokens: ["travel", "beautiful", "natural", "wonder"], keyword: "most common name in iran", strongKeyword: false, volume: 70 }),
      c({ demandKey: "sports", label: "Most Popular Sports Iran", distinctTokens: ["sport"], keyword: "most common name in iran", strongKeyword: false, volume: 70 }),
    ]);
    expect(groups.length).toBe(2);
  });
  it("singletons return a group with no siblings", () => {
    const groups = groupCreatePageCandidates([c({ demandKey: "x", label: "Persian Astronomy", distinctTokens: ["astronomy"] })]);
    expect(groups.length).toBe(1);
    expect(groups[0].siblings).toEqual([]);
  });
});
