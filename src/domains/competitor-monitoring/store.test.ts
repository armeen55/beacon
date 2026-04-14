/**
 * Tests for competitor monitoring store.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/persistence/dotdata-json", () => ({
  readDotDataJson: vi.fn(),
  writeDotDataJson: vi.fn(),
}));

import { getCompetitorMonitoringState, saveCompetitorMonitoringState } from "./store";
import { readDotDataJson, writeDotDataJson } from "@/lib/persistence/dotdata-json";
import type { CompetitorMonitoringState } from "./types";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCompetitorMonitoringState", () => {
  it("returns empty state when no file exists", () => {
    (readDotDataJson as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const state = getCompetitorMonitoringState();

    expect(state).toEqual({
      lastCrawlAt: null,
      snapshots: [],
      recentChanges: [],
    });
  });

  it("returns stored state when file exists", () => {
    const stored: CompetitorMonitoringState = {
      lastCrawlAt: "2024-03-15T10:00:00Z",
      snapshots: [
        {
          domain: "a.com",
          displayName: "A",
          crawledAt: "2024-03-15T10:00:00Z",
          pageCount: 5,
          entries: [],
          error: null,
        },
      ],
      recentChanges: [],
    };
    (readDotDataJson as ReturnType<typeof vi.fn>).mockReturnValue(stored);

    const state = getCompetitorMonitoringState();
    expect(state).toEqual(stored);
  });
});

describe("saveCompetitorMonitoringState", () => {
  it("writes state to store", () => {
    const state: CompetitorMonitoringState = {
      lastCrawlAt: "2024-03-15T10:00:00Z",
      snapshots: [],
      recentChanges: [],
    };

    saveCompetitorMonitoringState(state);

    expect(writeDotDataJson).toHaveBeenCalledWith("competitor-monitoring", state);
  });
});
