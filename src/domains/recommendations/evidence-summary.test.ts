import { describe, expect, it } from "vitest";
import {
  summarizeEvidenceRef,
  summarizeEvidenceRefs,
} from "./evidence-summary";

describe("summarizeEvidenceRef — UUID hygiene (Step 1.1)", () => {
  const promptText = {
    "prompt-123": "best custom home builders in Atherton",
    "prompt-very-long":
      "what builders should I hire in the Bay Area for a complete whole-home renovation instead of rebuilding the house",
  };

  it("renders a prompt ref as a quoted snippet of the prompt text", () => {
    expect(
      summarizeEvidenceRef(
        { type: "prompt", promptId: "prompt-123" },
        promptText,
      ),
    ).toBe('prompt: "best custom home builders in Atherton"');
  });

  it("truncates long prompt text to 47 chars + ellipsis", () => {
    const result = summarizeEvidenceRef(
      { type: "prompt", promptId: "prompt-very-long" },
      promptText,
    );
    expect(result).toBeTruthy();
    expect(result!.length).toBeLessThanOrEqual('prompt: "'.length + 48 + 1);
    expect(result).toMatch(/^prompt: ".+…"$/);
  });

  it("returns null for unknown prompt UUIDs (never leaks the UUID)", () => {
    expect(
      summarizeEvidenceRef(
        { type: "prompt", promptId: "7ee3216b-327c-4de9-8d5d-2f4c95a6d773" },
        promptText,
      ),
    ).toBeNull();
  });

  it("renders element refs verbatim", () => {
    expect(
      summarizeEvidenceRef(
        { type: "element", elementKey: "title", url: "https://x.test/a" },
        promptText,
      ),
    ).toBe("element:title");
  });

  it("renders competitor refs verbatim", () => {
    expect(
      summarizeEvidenceRef(
        { type: "competitor", competitorName: "De Mattei Construction" },
        promptText,
      ),
    ).toBe("competitor:De Mattei Construction");
  });

  it("accepts a Map lookup as well as a Record", () => {
    const m = new Map<string, string>([["prompt-x", "hello world"]]);
    expect(
      summarizeEvidenceRef({ type: "prompt", promptId: "prompt-x" }, m),
    ).toBe('prompt: "hello world"');
  });
});

describe("summarizeEvidenceRefs — combines + drops nulls", () => {
  const promptText = { "p-1": "kitchen remodel cost atherton" };

  it("joins surviving refs with ' · '", () => {
    expect(
      summarizeEvidenceRefs(
        [
          { type: "prompt", promptId: "p-1" },
          { type: "competitor", competitorName: "De Mattei" },
        ],
        promptText,
      ),
    ).toBe('prompt: "kitchen remodel cost atherton" · competitor:De Mattei');
  });

  it("drops unknown prompt UUIDs without affecting other refs", () => {
    expect(
      summarizeEvidenceRefs(
        [
          { type: "prompt", promptId: "unknown-uuid" },
          { type: "competitor", competitorName: "Kasten" },
        ],
        promptText,
      ),
    ).toBe("competitor:Kasten");
  });

  it("returns empty string when all refs resolve to null", () => {
    expect(
      summarizeEvidenceRefs(
        [{ type: "prompt", promptId: "unknown-uuid" }],
        promptText,
      ),
    ).toBe("");
  });

  it("never produces a string containing 'prompt:' followed by a UUID-looking token", () => {
    const result = summarizeEvidenceRefs(
      [
        { type: "prompt", promptId: "7ee3216b-327c-4de9-8d5d-2f4c95a6d773" },
        { type: "competitor", competitorName: "Kasten" },
      ],
      {},
    );
    expect(result).not.toMatch(/prompt:[a-f0-9]{8}/i);
    expect(result).toBe("competitor:Kasten");
  });
});
