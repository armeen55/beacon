import { describe, expect, it } from "vitest";
import { isOwnedBrandMention } from "./entity-extract";

describe("isOwnedBrandMention", () => {
  it("accepts exact normalized aliases", () => {
    expect(isOwnedBrandMention("  IRANOPEDIA ", ["Iranopedia"])).toBe(true);
  });

  it("does not mark a containing or contained competitor name as owned", () => {
    expect(isOwnedBrandMention("Iranopedia News", ["Iranopedia"])).toBe(false);
    expect(isOwnedBrandMention("Iran", ["Iranopedia"])).toBe(false);
  });
});
