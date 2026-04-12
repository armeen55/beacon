import { describe, it, expect } from "vitest";
import {
  mapExitKindToPhase,
  terminalPhaseFromPayload,
} from "@/domains/scanning/scan-state";
import type { LastScanResultPayload } from "@/domains/scanning/last-scan-result";

function payload(exit: LastScanResultPayload["exit"]): LastScanResultPayload {
  return {
    schemaVersion: 1,
    finishedAt: "2026-01-01T00:00:00.000Z",
    exit,
    observationRunId: "obs-1",
    pagesScanned: 1,
    pagesChanged: 0,
    pagesWithErrors: 0,
    guardrailAlertCount: 0,
  };
}

describe("scan-state", () => {
  it("mapExitKindToPhase maps CLI exits to persisted phases", () => {
    expect(mapExitKindToPhase("success")).toBe("success");
    expect(mapExitKindToPhase("partial")).toBe("partial");
    expect(mapExitKindToPhase("failed")).toBe("failed");
    expect(mapExitKindToPhase("aborted")).toBe("failed");
  });

  it("terminalPhaseFromPayload treats aborted as failed", () => {
    expect(terminalPhaseFromPayload(payload("aborted"))).toBe("failed");
    expect(terminalPhaseFromPayload(payload("success"))).toBe("success");
  });
});
