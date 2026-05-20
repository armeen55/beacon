/**
 * Slice 4.5.B.α₀ — emitter/cooldown-key unit tests.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { cooldownKey } from "@/domains/recommendation-intelligence/emitter/cooldown-key";

describe("cooldownKey", () => {
  it("is deterministic for the same inputs", () => {
    const out1 = cooldownKey({
      tenantId: "t",
      actionType: "edit_meta",
      targetUrl: "https://example.com/a",
    });
    const out2 = cooldownKey({
      tenantId: "t",
      actionType: "edit_meta",
      targetUrl: "https://example.com/a",
    });
    expect(out1).toBe(out2);
  });

  it("does NOT depend on topic_cluster_label (coarser than dedupe)", () => {
    // The cooldown key has no topic-cluster input; same (tenant +
    // action + URL) produces the same cooldown key regardless of
    // which topic-cluster a downstream consumer might want.
    expect(
      cooldownKey({
        tenantId: "t",
        actionType: "edit_meta",
        targetUrl: "u",
      }),
    ).toBe(
      cooldownKey({
        tenantId: "t",
        actionType: "edit_meta",
        targetUrl: "u",
      }),
    );
  });

  it("differs when any input field differs", () => {
    const base = {
      tenantId: "t",
      actionType: "edit_meta" as const,
      targetUrl: "u",
    };
    const baseKey = cooldownKey(base);
    expect(cooldownKey({ ...base, tenantId: "t2" })).not.toBe(baseKey);
    expect(cooldownKey({ ...base, actionType: "edit_title" })).not.toBe(baseKey);
    expect(cooldownKey({ ...base, targetUrl: "u2" })).not.toBe(baseKey);
  });

  it("maps null target URL to the literal 'no_url' marker", () => {
    const expected = createHash("sha1")
      .update("t::edit_meta::no_url")
      .digest("hex");
    expect(
      cooldownKey({
        tenantId: "t",
        actionType: "edit_meta",
        targetUrl: null,
      }),
    ).toBe(expected);
  });
});
