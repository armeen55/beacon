/**
 * 2026-05-20 — Slice 4.5.D.α₀a.2 — dedupe + cooldown tests.
 *
 * Locked test contracts (do not trim — see operator approval):
 * key formulas + null sentinels · full window table ·
 * not_found_after_7d=0 · decay_refire absent · no_prior=0 ·
 * status fallback · empty priors · dismissed in/out 90d ·
 * verified_live in 180d · latest-expiring binding ·
 * cross-tenant ignore · dismissed-response w/ targetPageUrl
 * fires · response w/o targetPageUrl ignored · invalid dates
 * skipped.
 */

import { describe, it, expect } from "vitest";

import {
  buildPromotionCooldownKey,
  buildPromotionDedupeKey,
  COOLDOWN_WINDOW_DAYS,
  getCooldownWindowForStatus,
  isInCooldown,
  promotionEditStatus,
  type PromotionEditAnchor,
  type PromotionResponseAnchor,
} from "@/domains/recommendation-intelligence/dedupe-cooldown";

const NOW = new Date("2026-05-20T00:00:00.000Z");
const TENANT = "tenant-x";
const URL = "https://example.com/a";
const ACTION = "edit_title" as const;

function edit(
  partial: Partial<PromotionEditAnchor> & {
    target_url?: string;
  } = {},
): PromotionEditAnchor {
  return {
    tenant_id: TENANT,
    action_type: ACTION,
    target_url: URL,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...partial,
  };
}

function cooldownKey(targetUrl: string | null = URL): string {
  return buildPromotionCooldownKey({
    tenantId: TENANT,
    actionType: ACTION,
    targetUrl,
  });
}

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

describe("buildPromotionDedupeKey", () => {
  it("deterministic + 40-char hex sha1", () => {
    const k = buildPromotionDedupeKey({
      tenantId: "t",
      actionType: ACTION,
      targetUrl: URL,
      targetElementKey: "h1-1",
      topicClusterLabel: "metadata",
    });
    expect(k).toMatch(/^[0-9a-f]{40}$/);
    const k2 = buildPromotionDedupeKey({
      tenantId: "t",
      actionType: ACTION,
      targetUrl: URL,
      targetElementKey: "h1-1",
      topicClusterLabel: "metadata",
    });
    expect(k).toBe(k2);
  });

  it("different target_element_key ⇒ different hash", () => {
    const a = buildPromotionDedupeKey({
      tenantId: "t",
      actionType: ACTION,
      targetUrl: URL,
      targetElementKey: "h1-1",
      topicClusterLabel: "metadata",
    });
    const b = buildPromotionDedupeKey({
      tenantId: "t",
      actionType: ACTION,
      targetUrl: URL,
      targetElementKey: "h2-1",
      topicClusterLabel: "metadata",
    });
    expect(a).not.toBe(b);
  });

  it("null sentinels stable across calls", () => {
    const a = buildPromotionDedupeKey({
      tenantId: "t",
      actionType: ACTION,
      targetUrl: null,
      targetElementKey: null,
      topicClusterLabel: null,
    });
    const b = buildPromotionDedupeKey({
      tenantId: "t",
      actionType: ACTION,
      targetUrl: null,
      targetElementKey: null,
      topicClusterLabel: null,
    });
    expect(a).toBe(b);
  });
});

describe("buildPromotionCooldownKey", () => {
  it("deterministic + 40-char hex sha1", () => {
    const k = buildPromotionCooldownKey({
      tenantId: "t",
      actionType: ACTION,
      targetUrl: URL,
    });
    expect(k).toMatch(/^[0-9a-f]{40}$/);
    expect(k).toBe(
      buildPromotionCooldownKey({
        tenantId: "t",
        actionType: ACTION,
        targetUrl: URL,
      }),
    );
  });

  it("coarser than dedupe key (differs at the same tenant/action/url)", () => {
    const dedupe = buildPromotionDedupeKey({
      tenantId: "t",
      actionType: ACTION,
      targetUrl: URL,
      targetElementKey: null,
      topicClusterLabel: null,
    });
    const cooldown = buildPromotionCooldownKey({
      tenantId: "t",
      actionType: ACTION,
      targetUrl: URL,
    });
    expect(dedupe).not.toBe(cooldown);
  });
});

// ---------------------------------------------------------------------------
// Window table
// ---------------------------------------------------------------------------

describe("COOLDOWN_WINDOW_DAYS + getCooldownWindowForStatus", () => {
  it.each([
    ["dismissed", 90],
    ["accepted", 30],
    ["verified_live", 180],
    ["verified_live_modified", 180],
    ["wrong_page", 14],
    ["partially_implemented", 60],
    ["needs_review", 14],
    ["recommended", 0],
    ["not_found_after_7d", 0],
    ["no_prior", 0],
  ] as const)("%s → %i days (locked)", (status, expected) => {
    expect(getCooldownWindowForStatus(status)).toBe(expected);
    expect(COOLDOWN_WINDOW_DAYS[status]).toBe(expected);
  });

  it("table contains exactly the locked key set", () => {
    expect(Object.keys(COOLDOWN_WINDOW_DAYS).sort()).toEqual(
      [
        "accepted",
        "dismissed",
        "needs_review",
        "no_prior",
        "not_found_after_7d",
        "partially_implemented",
        "recommended",
        "verified_live",
        "verified_live_modified",
        "wrong_page",
      ].sort(),
    );
  });

  it("does NOT contain verified_live_decay_refire (not a real status)", () => {
    expect(COOLDOWN_WINDOW_DAYS).not.toHaveProperty(
      "verified_live_decay_refire",
    );
  });
});

// ---------------------------------------------------------------------------
// promotionEditStatus
// ---------------------------------------------------------------------------

describe("promotionEditStatus", () => {
  it("returns explicit status when present; falls back to 'recommended' when undefined", () => {
    expect(promotionEditStatus({ implementation_status: "dismissed" })).toBe(
      "dismissed",
    );
    expect(promotionEditStatus({})).toBe("recommended");
  });
});

// ---------------------------------------------------------------------------
// isInCooldown
// ---------------------------------------------------------------------------

describe("isInCooldown", () => {
  it("empty priors → in_cooldown=false", () => {
    expect(
      isInCooldown({
        cooldownKey: cooldownKey(),
        tenantId: TENANT,
        actionType: ACTION,
        targetUrl: URL,
        recommendedEdits: [],
        recommendationResponses: [],
        now: NOW,
      }),
    ).toEqual({ in_cooldown: false, reason: null, expires_at: null });
  });

  it("dismissed 30d ago fires (90d window)", () => {
    const r = isInCooldown({
      cooldownKey: cooldownKey(),
      tenantId: TENANT,
      actionType: ACTION,
      targetUrl: URL,
      recommendedEdits: [
        edit({
          implementation_status: "dismissed",
          updated_at: "2026-04-20T00:00:00.000Z",
        }),
      ],
      recommendationResponses: [],
      now: NOW,
    });
    expect(r.in_cooldown).toBe(true);
    expect(r.expires_at).toBe("2026-07-19T00:00:00.000Z");
    expect(r.reason).toBe("cooldown_dismissed_recommended_edits");
  });

  it("dismissed 100d ago clears (window expired)", () => {
    expect(
      isInCooldown({
        cooldownKey: cooldownKey(),
        tenantId: TENANT,
        actionType: ACTION,
        targetUrl: URL,
        recommendedEdits: [
          edit({
            implementation_status: "dismissed",
            updated_at: "2026-02-10T00:00:00.000Z",
          }),
        ],
        recommendationResponses: [],
        now: NOW,
      }).in_cooldown,
    ).toBe(false);
  });

  it("verified_live 90d ago fires (180d window); live_at beats updated_at as anchor", () => {
    const r = isInCooldown({
      cooldownKey: cooldownKey(),
      tenantId: TENANT,
      actionType: ACTION,
      targetUrl: URL,
      recommendedEdits: [
        edit({
          implementation_status: "verified_live",
          live_at: "2026-02-19T00:00:00.000Z",
          updated_at: "2026-05-19T00:00:00.000Z", // newer; should NOT win
        }),
      ],
      recommendationResponses: [],
      now: NOW,
    });
    expect(r.in_cooldown).toBe(true);
    // 2026-02-19 + 180d = 2026-08-18
    expect(r.expires_at).toBe("2026-08-18T00:00:00.000Z");
  });

  it("LATEST-EXPIRING binding wins across mixed priors", () => {
    const r = isInCooldown({
      cooldownKey: cooldownKey(),
      tenantId: TENANT,
      actionType: ACTION,
      targetUrl: URL,
      recommendedEdits: [
        edit({
          implementation_status: "dismissed",
          updated_at: "2026-04-20T00:00:00.000Z", // expires 2026-07-19
        }),
        edit({
          implementation_status: "verified_live",
          live_at: "2026-04-01T00:00:00.000Z", // expires 2026-09-28 (later)
        }),
      ],
      recommendationResponses: [],
      now: NOW,
    });
    expect(r.in_cooldown).toBe(true);
    expect(r.expires_at).toBe("2026-09-28T00:00:00.000Z");
    expect(r.reason).toBe("cooldown_verified_live_recommended_edits");
  });

  it("cross-tenant priors ignored", () => {
    expect(
      isInCooldown({
        cooldownKey: cooldownKey(),
        tenantId: TENANT,
        actionType: ACTION,
        targetUrl: URL,
        recommendedEdits: [
          edit({
            tenant_id: "tenant-other",
            implementation_status: "dismissed",
            updated_at: "2026-05-15T00:00:00.000Z",
          }),
        ],
        recommendationResponses: [],
        now: NOW,
      }).in_cooldown,
    ).toBe(false);
  });

  it("priors with window=0 (recommended / not_found_after_7d) skip without binding", () => {
    const recommended = isInCooldown({
      cooldownKey: cooldownKey(),
      tenantId: TENANT,
      actionType: ACTION,
      targetUrl: URL,
      recommendedEdits: [
        edit({
          implementation_status: "recommended",
          updated_at: "2026-05-15T00:00:00.000Z",
        }),
      ],
      recommendationResponses: [],
      now: NOW,
    });
    expect(recommended.in_cooldown).toBe(false);

    const notFound = isInCooldown({
      cooldownKey: cooldownKey(),
      tenantId: TENANT,
      actionType: ACTION,
      targetUrl: URL,
      recommendedEdits: [
        edit({
          implementation_status: "not_found_after_7d",
          updated_at: "2026-05-15T00:00:00.000Z",
        }),
      ],
      recommendationResponses: [],
      now: NOW,
    });
    expect(notFound.in_cooldown).toBe(false);
  });

  it("invalid / missing anchors skipped (no anchor + malformed ISO)", () => {
    const noAnchor = isInCooldown({
      cooldownKey: cooldownKey(),
      tenantId: TENANT,
      actionType: ACTION,
      targetUrl: URL,
      recommendedEdits: [
        {
          tenant_id: TENANT,
          action_type: ACTION,
          target_url: URL,
          implementation_status: "dismissed",
          live_at: null,
        },
      ],
      recommendationResponses: [],
      now: NOW,
    });
    expect(noAnchor.in_cooldown).toBe(false);

    const malformed = isInCooldown({
      cooldownKey: cooldownKey(),
      tenantId: TENANT,
      actionType: ACTION,
      targetUrl: URL,
      recommendedEdits: [
        edit({
          implementation_status: "dismissed",
          updated_at: "not-a-date",
        }),
      ],
      recommendationResponses: [],
      now: NOW,
    });
    expect(malformed.in_cooldown).toBe(false);
  });

  // ── Response-store integration ──────────────────────────────
  it("dismissed response with matching targetPageUrl fires (90d window)", () => {
    const r = isInCooldown({
      cooldownKey: cooldownKey(),
      tenantId: TENANT,
      actionType: ACTION,
      targetUrl: URL,
      recommendedEdits: [],
      recommendationResponses: [
        {
          recId: "rec-1",
          status: "dismissed",
          respondedAt: "2026-05-10T00:00:00.000Z",
          targetPageUrl: URL,
        },
      ],
      now: NOW,
    });
    expect(r.in_cooldown).toBe(true);
    expect(r.reason).toBe("cooldown_dismissed_recommendation_responses");
  });

  it("response without targetPageUrl ignored", () => {
    expect(
      isInCooldown({
        cooldownKey: cooldownKey(),
        tenantId: TENANT,
        actionType: ACTION,
        targetUrl: URL,
        recommendedEdits: [],
        recommendationResponses: [
          {
            recId: "rec-1",
            status: "dismissed",
            respondedAt: "2026-05-10T00:00:00.000Z",
          },
        ],
        now: NOW,
      }).in_cooldown,
    ).toBe(false);
  });

  it("deferred response NOT honored even with matching targetPageUrl (α₀a.2 contract)", () => {
    expect(
      isInCooldown({
        cooldownKey: cooldownKey(),
        tenantId: TENANT,
        actionType: ACTION,
        targetUrl: URL,
        recommendedEdits: [],
        recommendationResponses: [
          {
            recId: "rec-1",
            status: "deferred",
            respondedAt: "2026-05-10T00:00:00.000Z",
            deferUntil: "2026-06-10T00:00:00.000Z",
            targetPageUrl: URL,
          },
        ],
        now: NOW,
      }).in_cooldown,
    ).toBe(false);
  });
});
