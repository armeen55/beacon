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

describe("#54 (2026-06-11) — dismiss reason capture", () => {
  it("records the operator's dismiss reason and preserves it on later updates", async () => {
    const mod = await import("@/domains/product/recommendation-response-store");
    mod.invalidateRecommendationResponsesSeed();
    await mod.recordResponse("rec-dismiss", "dismissed", { dismissReason: "not_relevant" });
    const r1 = await mod.getResponse("rec-dismiss");
    expect(r1?.status).toBe("dismissed");
    expect(r1?.dismissReason).toBe("not_relevant");

    // A later context-less update must NOT clobber the reason.
    await mod.recordResponse("rec-dismiss", "dismissed");
    const r2 = await mod.getResponse("rec-dismiss");
    expect(r2?.dismissReason).toBe("not_relevant");
  });

  it("non-dismiss responses carry a null reason", async () => {
    const mod = await import("@/domains/product/recommendation-response-store");
    mod.invalidateRecommendationResponsesSeed();
    await mod.recordResponse("rec-accept", "accepted");
    expect((await mod.getResponse("rec-accept"))?.dismissReason ?? null).toBeNull();
  });
});
