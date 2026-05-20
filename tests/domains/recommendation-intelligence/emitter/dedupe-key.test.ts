/**
 * Slice 4.5.B.α₀ — emitter/dedupe-key unit tests.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { dedupeKey } from "@/domains/recommendation-intelligence/emitter/dedupe-key";

describe("dedupeKey", () => {
  it("is deterministic for the same inputs", () => {
    const out1 = dedupeKey({
      tenantId: "tenant-a",
      actionType: "edit_meta",
      targetUrl: "https://example.com/a",
      topicClusterLabel: "Meta description",
    });
    const out2 = dedupeKey({
      tenantId: "tenant-a",
      actionType: "edit_meta",
      targetUrl: "https://example.com/a",
      topicClusterLabel: "Meta description",
    });
    expect(out1).toBe(out2);
  });

  it("differs when any input field differs", () => {
    const base = {
      tenantId: "tenant-a",
      actionType: "edit_meta" as const,
      targetUrl: "https://example.com/a",
      topicClusterLabel: "Meta description",
    };
    const baseKey = dedupeKey(base);
    expect(dedupeKey({ ...base, tenantId: "tenant-b" })).not.toBe(baseKey);
    expect(dedupeKey({ ...base, actionType: "edit_title" })).not.toBe(baseKey);
    expect(dedupeKey({ ...base, targetUrl: "https://example.com/b" })).not.toBe(baseKey);
    expect(dedupeKey({ ...base, topicClusterLabel: "Page title" })).not.toBe(baseKey);
  });

  it("maps null target URL to the literal 'no_url' marker", () => {
    const expected = createHash("sha1")
      .update("tenant-a::edit_meta::no_url::topic")
      .digest("hex");
    expect(
      dedupeKey({
        tenantId: "tenant-a",
        actionType: "edit_meta",
        targetUrl: null,
        topicClusterLabel: "topic",
      }),
    ).toBe(expected);
  });

  it("returns a 40-character hex SHA1 digest", () => {
    const out = dedupeKey({
      tenantId: "t",
      actionType: "edit_meta",
      targetUrl: "u",
      topicClusterLabel: "c",
    });
    expect(out).toMatch(/^[0-9a-f]{40}$/);
  });
});
