import { describe, expect, it } from "vitest";
import { actionLabel } from "./page-primary";

describe("actionLabel", () => {
  it("maps known atomic actions to imperative copy", () => {
    expect(actionLabel("title")).toBe("Rewrite the title");
    expect(actionLabel("intro_answer_block")).toBe("Add a direct answer block");
    expect(actionLabel("schema")).toBe("Add structured data (JSON-LD)");
    expect(actionLabel("keep_current")).toBe("Healthy, monitor");
  });

  it("falls back gracefully on unknown/empty", () => {
    expect(actionLabel(null)).toBe("Review the page");
    expect(actionLabel("nonsense")).toBe("Review the page");
  });
});
