import { describe, expect, it } from "vitest";

import {
  withApprovedExperimentText,
  type PlannedExperimentRecord,
} from "./daily-plan-types";

function experiment(
  lever: PlannedExperimentRecord["lever"] = "title",
): PlannedExperimentRecord {
  return {
    lever,
    proposedText: "Original approved proposal",
  } as PlannedExperimentRecord;
}

describe("withApprovedExperimentText", () => {
  it("projects the trimmed operator edit for text levers", () => {
    const frozen = experiment("title");
    const approved = withApprovedExperimentText(frozen, "  Operator wording  ");

    expect(approved).not.toBe(frozen);
    expect(approved.proposedText).toBe("Operator wording");
    expect(frozen.proposedText).toBe("Original approved proposal");
  });

  it("keeps the frozen record for blank or unchanged text", () => {
    const frozen = experiment("h1");

    expect(withApprovedExperimentText(frozen, "   ")).toBe(frozen);
    expect(withApprovedExperimentText(frozen, frozen.proposedText)).toBe(frozen);
  });

  it("does not apply free-text overrides to structural internal links", () => {
    const frozen = experiment("internal_link");

    expect(withApprovedExperimentText(frozen, "different anchor text")).toBe(frozen);
  });
});
