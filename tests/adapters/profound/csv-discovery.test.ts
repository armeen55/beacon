import { describe, it, expect } from "vitest";
import {
  classifyProfoundCsv,
  normalizeHeaderCell,
} from "@/adapters/profound/csv-discovery";

describe("classifyProfoundCsv", () => {
  it("classifies raw execution export", () => {
    const headers = [
      "run_id",
      "date",
      "platform",
      "prompt",
      "response",
      "citation_1",
    ].map(normalizeHeaderCell);
    expect(classifyProfoundCsv(headers)).toBe("raw_executions");
  });

  it("classifies citations export (not raw)", () => {
    const headers = [
      "run_id",
      "date",
      "url",
      "hostname",
      "prompt",
      "platform",
      "citationcategory",
    ].map(normalizeHeaderCell);
    expect(classifyProfoundCsv(headers)).toBe("citations");
  });

  it("classifies prompts export", () => {
    const headers = ["id", "topic", "prompt", "tags"].map(normalizeHeaderCell);
    expect(classifyProfoundCsv(headers)).toBe("prompts");
  });

  it("classifies benchmark export", () => {
    const headers = [
      "date",
      "asset",
      "platform",
      "visibility",
      "shareofvoice",
    ].map(normalizeHeaderCell);
    expect(classifyProfoundCsv(headers)).toBe("benchmark");
  });

  it("classifies changelog export", () => {
    const headers = [
      "timestamp",
      "date",
      "time",
      "signal type",
      "asset type",
      "url",
      "exact change made",
    ].map(normalizeHeaderCell);
    expect(classifyProfoundCsv(headers)).toBe("changelog");
  });
});
