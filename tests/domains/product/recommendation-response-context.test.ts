/**
 * Fix 2 (2026-04-21) — tests for auto-link context on RecommendationResponse.
 *
 * Covers:
 *   - recordResponse persists targetPageUrl + patternId when provided
 *   - context is preserved across status updates when omitted later
 *   - URL defaults to null when not provided
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getRecommendationResponses,
  recordResponse,
  getResponse,
} from "@/domains/product/recommendation-response-store";

describe("recordResponse — Fix 2 auto-link context", () => {
  beforeEach(async () => {
    (await getRecommendationResponses()).length = 0;
  });

  it("persists targetPageUrl and patternId when accepted", async () => {
    await recordResponse("rec-1", "accepted", {
      targetPageUrl: "https://site.example/locations/atherton",
      patternId: "pattern-neighborhoods",
    });
    const r = await getResponse("rec-1");
    expect(r?.targetPageUrl).toBe("https://site.example/locations/atherton");
    expect(r?.patternId).toBe("pattern-neighborhoods");
  });

  it("defaults context fields to null when no context is passed", async () => {
    await recordResponse("rec-2", "accepted");
    const r = await getResponse("rec-2");
    expect(r?.targetPageUrl).toBeNull();
    expect(r?.patternId).toBeNull();
  });

  it("preserves prior context when a later call omits context", async () => {
    await recordResponse("rec-3", "accepted", {
      targetPageUrl: "/a",
      patternId: "p-1",
    });
    await recordResponse("rec-3", "dismissed");
    const r = await getResponse("rec-3");
    expect(r?.status).toBe("dismissed");
    expect(r?.targetPageUrl).toBe("/a");
    expect(r?.patternId).toBe("p-1");
  });

  it("allows context update on upsert", async () => {
    await recordResponse("rec-4", "accepted", {
      targetPageUrl: "/old-url",
      patternId: null,
    });
    await recordResponse("rec-4", "accepted", {
      targetPageUrl: "/new-url",
      patternId: "p-updated",
    });
    const r = await getResponse("rec-4");
    expect(r?.targetPageUrl).toBe("/new-url");
    expect(r?.patternId).toBe("p-updated");
  });
});
