import { describe, it, expect } from "vitest";
import { promptToTopic, shortActionLabel, clusterKeyOf } from "./ai-questions-data";

describe("AI question label helpers", () => {
  it("promptToTopic strips question words + humanizes", () => {
    expect(promptToTopic("What are Persian wedding customs?")).toBe("Persian Wedding Customs");
    expect(promptToTopic("How do I learn Persian")).toContain("Learn Persian");
  });
  it("shortActionLabel is short, not the raw question", () => {
    expect(shortActionLabel("create_hub", "What are Persian wedding customs?")).toMatch(/^.+: Persian Wedding Customs$/);
  });
  it("clusterKeyOf groups near-duplicates by lead topic token", () => {
    const a = clusterKeyOf("Persian wedding family customs");
    const b = clusterKeyOf("What is a Persian wedding proposal?");
    expect(a).toBe(b); // both → "wedding"
    expect(clusterKeyOf("Nowruz activities for kids")).toBe("nowruz");
  });
});
