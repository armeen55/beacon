import { describe, expect, it } from "vitest";

import { stripAdditionLabel } from "./load-linkgraph-triggers";

describe("stripAdditionLabel", () => {
  it("extracts the quoted inner label from an addition prose wrapper", () => {
    expect(stripAdditionLabel('a section covering "visa fees"')).toBe("visa fees");
    expect(stripAdditionLabel("a section covering “processing time”")).toBe("processing time");
  });

  it("strips a leading a/an + section covering/on/about prefix when unquoted", () => {
    expect(stripAdditionLabel("a section covering required documents")).toBe("required documents");
    expect(stripAdditionLabel("an section on eligibility rules")).toBe("eligibility rules");
  });

  it("leaves an already-bare label intact", () => {
    expect(stripAdditionLabel("required documents")).toBe("required documents");
    expect(stripAdditionLabel("an FAQ section")).toBe("FAQ section");
  });

  it("trims and tolerates empty input", () => {
    expect(stripAdditionLabel("   visa fees  ")).toBe("visa fees");
    expect(stripAdditionLabel("")).toBe("");
  });
});
