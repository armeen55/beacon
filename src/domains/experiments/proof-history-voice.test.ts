import { describe, expect, it } from "vitest";
import { aggregateSettled, proofHistoryLine } from "./proof-history-voice";
import { actionFamilyOf } from "./experiment-eligibility";
import { pageFamilyOf } from "./daily-experiment-planner";

const row = (path: string, actionType: string, verdict: string) => ({ path, actionType, verdict });

function settle(rows: ReturnType<typeof row>[]) {
  return aggregateSettled(rows, pageFamilyOf, actionFamilyOf);
}

describe("proof-history-voice (item 27)", () => {
  it("stays silent with no settled history", () => {
    const s = settle([row("/iran-flags/a", "edit_title", "measuring")]);
    expect(proofHistoryLine(s, pageFamilyOf("/iran-flags/b"), "title")).toBeNull();
  });

  it("tallies same-lever history on the page family", () => {
    const s = settle([
      row("/iran-flags/a", "edit_meta_description", "won"),
      row("/iran-flags/b", "edit_meta_description", "inconclusive"),
    ]);
    const line = proofHistoryLine(s, pageFamilyOf("/iran-flags/c"), "meta");
    expect(line).toContain("We already tried this kind of change");
    expect(line).toContain("won 1");
    expect(line).toContain("no clear lift 1");
  });

  it("explains the lever REDIRECTION when a sibling lever settled flat", () => {
    const s = settle([row("/iran-flags/a", "edit_title", "inconclusive")]);
    const line = proofHistoryLine(s, pageFamilyOf("/iran-flags/b"), "meta");
    expect(line).toContain("We tried a title change on similar pages");
    expect(line).toContain("That is why today's change is a description change, not a title change.");
  });

  it("says so when the sibling lever HURT", () => {
    const s = settle([row("/iran-flags/a", "edit_title", "lost")]);
    const line = proofHistoryLine(s, pageFamilyOf("/iran-flags/b"), "meta");
    expect(line).toContain("it hurt");
  });

  it("does NOT redirect off a sibling lever that has a win", () => {
    const s = settle([
      row("/iran-flags/a", "edit_title", "won"),
      row("/iran-flags/b", "edit_title", "inconclusive"),
    ]);
    expect(proofHistoryLine(s, pageFamilyOf("/iran-flags/c"), "meta")).toBeNull();
  });

  it("never crosses page families", () => {
    const s = settle([row("/cities/tehran", "edit_title", "inconclusive")]);
    expect(proofHistoryLine(s, pageFamilyOf("/iran-flags/b"), "meta")).toBeNull();
  });
});
