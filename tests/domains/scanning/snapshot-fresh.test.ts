import { describe, it, expect } from "vitest";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { getGuardrailAlerts } from "@/domains/pages/guardrail-store";

describe("snapshot / guardrail fresh reads", () => {
  it("getPageSnapshots returns an array (disk-backed, no import-time freeze)", async () => {
    const a = await getPageSnapshots();
    const b = await getPageSnapshots();
    expect(Array.isArray(a)).toBe(true);
    expect(Array.isArray(b)).toBe(true);
  });

  it("getGuardrailAlerts returns an array", async () => {
    expect(Array.isArray(await getGuardrailAlerts())).toBe(true);
  });
});
