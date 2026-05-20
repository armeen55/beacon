/**
 * Architecture invariant — Slice 4.5.D.α₀a.2 — promotion dedupe
 * + cooldown key formula pin.
 *
 * Locally recomputes both sha1 formulas against the module-exported
 * `buildPromotionDedupeKey` + `buildPromotionCooldownKey` outputs.
 * Any formula drift produces a hard test failure.
 *
 *   dedupe   = sha1(tenant_id::action_type
 *                   ::target_url_or_no_url
 *                   ::target_element_key_or_no_key
 *                   ::topic_cluster_label_or_no_topic)
 *
 *   cooldown = sha1(tenant_id::action_type
 *                   ::target_url_or_no_url)
 *
 * Null sentinels: "no_url" / "no_key" / "no_topic".
 */

import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";

import {
  buildPromotionDedupeKey,
  buildPromotionCooldownKey,
} from "@/domains/recommendation-intelligence/dedupe-cooldown";

function lockedDedupe(
  tenantId: string,
  actionType: string,
  targetUrl: string | null,
  targetElementKey: string | null,
  topicClusterLabel: string | null,
): string {
  const canonical = [
    tenantId,
    actionType,
    targetUrl ?? "no_url",
    targetElementKey ?? "no_key",
    topicClusterLabel ?? "no_topic",
  ].join("::");
  return createHash("sha1").update(canonical).digest("hex");
}

function lockedCooldown(
  tenantId: string,
  actionType: string,
  targetUrl: string | null,
): string {
  const canonical = [tenantId, actionType, targetUrl ?? "no_url"].join("::");
  return createHash("sha1").update(canonical).digest("hex");
}

describe("recommendation-intelligence-dedupe-key-formula", () => {
  it("dedupe key matches the 5-part sha1 formula on a concrete fixture", () => {
    const actual = buildPromotionDedupeKey({
      tenantId: "tenant-ritz-founder",
      actionType: "edit_title",
      targetUrl: "https://ritzbuilders.com/services/whole-home-remodel",
      targetElementKey: "h1-main",
      topicClusterLabel: "metadata",
    });
    const expected = lockedDedupe(
      "tenant-ritz-founder",
      "edit_title",
      "https://ritzbuilders.com/services/whole-home-remodel",
      "h1-main",
      "metadata",
    );
    expect(actual).toBe(expected);
  });

  it("dedupe sentinels resolve null targetUrl→'no_url', null elementKey→'no_key', null topic→'no_topic'", () => {
    const actual = buildPromotionDedupeKey({
      tenantId: "t",
      actionType: "edit_title",
      targetUrl: null,
      targetElementKey: null,
      topicClusterLabel: null,
    });
    const expected = createHash("sha1")
      .update("t::edit_title::no_url::no_key::no_topic")
      .digest("hex");
    expect(actual).toBe(expected);
  });

  it("cooldown key matches the 3-part sha1 formula on a concrete fixture", () => {
    const actual = buildPromotionCooldownKey({
      tenantId: "tenant-ritz-founder",
      actionType: "fix_sitemap",
      targetUrl: "https://ritzbuilders.com/services/teardown-rebuild",
    });
    const expected = lockedCooldown(
      "tenant-ritz-founder",
      "fix_sitemap",
      "https://ritzbuilders.com/services/teardown-rebuild",
    );
    expect(actual).toBe(expected);
  });

  it("cooldown sentinel resolves null targetUrl→'no_url'", () => {
    const actual = buildPromotionCooldownKey({
      tenantId: "t",
      actionType: "edit_title",
      targetUrl: null,
    });
    const expected = createHash("sha1")
      .update("t::edit_title::no_url")
      .digest("hex");
    expect(actual).toBe(expected);
  });

  it("dedupe and cooldown keys differ at the same (tenant, action, url) (different canonical shapes)", () => {
    const dedupe = buildPromotionDedupeKey({
      tenantId: "t",
      actionType: "edit_title",
      targetUrl: "https://example.com",
      targetElementKey: null,
      topicClusterLabel: null,
    });
    const cooldown = buildPromotionCooldownKey({
      tenantId: "t",
      actionType: "edit_title",
      targetUrl: "https://example.com",
    });
    expect(dedupe).not.toBe(cooldown);
  });
});
