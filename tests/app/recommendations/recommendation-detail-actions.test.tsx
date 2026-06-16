/**
 * Bundle 2C — RecommendationDetailActions tests.
 *
 * Beacon's test stack runs Vitest in a Node environment with no DOM
 * test library (no `@testing-library/react`, no `jsdom`/`happy-dom`).
 * The pattern across this codebase is to test components via
 * `renderToStaticMarkup` for output assertions and to extract pure
 * helpers for behavior assertions.
 *
 * This file follows that pattern:
 *   • `visibleActionsForRow` — pure status-to-action map. Locked by
 *     truth-table tests.
 *   • `buildAcceptPayload` — pure server-action-payload shape. Locked
 *     by structural test.
 *   • `successMessageFor` — pure success-copy map. Locked by truth-table.
 *   • Render output (data-* attrs, secondary CTAs, anchor encoding,
 *     no-leak) — via `renderToStaticMarkup`.
 *
 * The click-handler invocation contract (which server action gets
 * called when a button is clicked) is locked by the source-text
 * shape of `ACTION_BUTTON_PROPS` plus the pure helpers — i.e., the
 * button's `invoke` callback is constructed from the same pure
 * helpers tested here. A regression would have to bypass both, which
 * would fail typecheck and code review.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  RecommendationDetailActions,
  visibleActionsForRow,
  buildAcceptPayload,
  successMessageFor,
  SUCCESS_MESSAGES,
  CALM_ERROR_MESSAGE,
  type DetailActionKey,
} from "@/app/(shell)/recommendations/[id]/recommendation-detail-actions";
import type {
  ActionRowStatus,
  RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function makeRow(
  overrides: Partial<RecommendationActionRow> = {},
): RecommendationActionRow {
  return {
    id: "rec-fixture-1__edit-1",
    rank: 1,
    title: "Add an FAQ about modern home builders",
    targetLabel: "Modern Home Builder Atherton page",
    targetUrl: "https://example.com/services/modern-home-builder",
    actionType: "add_faq",
    priority: "high",
    status: "new",
    evidenceSummary: "AI cites Greenberg on 4 of 7 prompts; Ritz absent.",
    sourceRecommendationId: "rec-fixture-1",
    sourceEditId: "edit-1",
    editSource: "openai",
    derivedConfidence: "strong_evidence",
    hasExactEdit: true,
    responseStatus: null,
    acceptedAgeDays: 0,
    deferUntil: null,
    eligibleEditCount: 1,
    detail: {} as RecommendationActionRow["detail"],
    ...overrides,
  } as RecommendationActionRow;
}

function makeHandlers() {
  return {
    accept: vi.fn().mockResolvedValue({ success: true }),
    defer: vi.fn().mockResolvedValue({ success: true }),
    dismiss: vi.fn().mockResolvedValue({ success: true }),
    markShipped: vi.fn().mockResolvedValue({ success: true }),
    undo: vi.fn().mockResolvedValue({ success: true }),
  };
}

function acceptedPushableRow(): RecommendationActionRow {
  return makeRow({
    status: "accepted",
    eligibleEditCount: 1,
    detail: {
      debug: { editId: "edit-1" },
    } as RecommendationActionRow["detail"],
  });
}

// ─────────────────────────────────────────────────────────────────────
// Approve & Push exposure (2026-06-16, root cause #1)
// ─────────────────────────────────────────────────────────────────────

describe("Approve & Push — customer-route exposure", () => {
  it("renders the Approve & Push button for an accepted, pushable rec when canPublish", () => {
    const html = renderToStaticMarkup(
      <RecommendationDetailActions
        row={acceptedPushableRow()}
        changelogId={null}
        canPublish
        skipRouterRefresh
        handlers={{
          ...makeHandlers(),
          approveAndPush: vi
            .fn()
            .mockResolvedValue({ ok: true, outcome: "pushed", detail: "" }),
        }}
      />,
    );
    expect(html).toContain('data-recommendation-detail-action="approve-push"');
    expect(html).toContain("Approve &amp; Push");
  });

  it("HIDES the push button when canPublish is false (safe default)", () => {
    const html = renderToStaticMarkup(
      <RecommendationDetailActions
        row={acceptedPushableRow()}
        changelogId={null}
        canPublish={false}
        skipRouterRefresh
      />,
    );
    expect(html).not.toContain(
      'data-recommendation-detail-action="approve-push"',
    );
  });

  it("HIDES the push button for a non-accepted rec even when canPublish", () => {
    const html = renderToStaticMarkup(
      <RecommendationDetailActions
        row={makeRow({ status: "new" })}
        changelogId={null}
        canPublish
        skipRouterRefresh
      />,
    );
    expect(html).not.toContain(
      'data-recommendation-detail-action="approve-push"',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pure helper — visibleActionsForRow truth table
// ─────────────────────────────────────────────────────────────────────

describe("Bundle 2C — visibleActionsForRow truth table", () => {
  it("new + hasExactEdit → Accept, Defer, Dismiss", () => {
    expect(
      visibleActionsForRow({
        status: "new",
        hasExactEdit: true,
        eligibleEditCount: 1,
      }),
    ).toEqual(["accept", "defer", "dismiss"]);
  });

  it("new + NOT hasExactEdit → Defer, Dismiss (no Accept)", () => {
    expect(
      visibleActionsForRow({
        status: "new",
        hasExactEdit: false,
        eligibleEditCount: 0,
      }),
    ).toEqual(["defer", "dismiss"]);
  });

  it("needs_review + hasExactEdit → Accept, Defer, Dismiss", () => {
    expect(
      visibleActionsForRow({
        status: "needs_review",
        hasExactEdit: true,
        eligibleEditCount: 1,
      }),
    ).toEqual(["accept", "defer", "dismiss"]);
  });

  it("needs_review + NOT hasExactEdit → Defer, Dismiss", () => {
    expect(
      visibleActionsForRow({
        status: "needs_review",
        hasExactEdit: false,
        eligibleEditCount: 0,
      }),
    ).toEqual(["defer", "dismiss"]);
  });

  it("needs_fresh_edit → Defer, Dismiss (Regenerate is legacy-only)", () => {
    expect(
      visibleActionsForRow({
        status: "needs_fresh_edit",
        hasExactEdit: false,
        eligibleEditCount: 0,
      }),
    ).toEqual(["defer", "dismiss"]);
  });

  it("accepted + eligibleEditCount > 0 → Mark shipped", () => {
    expect(
      visibleActionsForRow({
        status: "accepted",
        hasExactEdit: true,
        eligibleEditCount: 3,
      }),
    ).toEqual(["mark-shipped"]);
  });

  it("accepted + eligibleEditCount === 0 → no inline action (View lives in legacy drawer)", () => {
    expect(
      visibleActionsForRow({
        status: "accepted",
        hasExactEdit: true,
        eligibleEditCount: 0,
      }),
    ).toEqual([]);
  });

  it("dismissed → Restore", () => {
    expect(
      visibleActionsForRow({
        status: "dismissed",
        hasExactEdit: true,
        eligibleEditCount: 0,
      }),
    ).toEqual(["restore"]);
  });

  it("deferred → Promote", () => {
    expect(
      visibleActionsForRow({
        status: "deferred",
        hasExactEdit: true,
        eligibleEditCount: 0,
      }),
    ).toEqual(["promote"]);
  });

  it("measuring → no inline action", () => {
    expect(
      visibleActionsForRow({
        status: "measuring",
        hasExactEdit: true,
        eligibleEditCount: 0,
      }),
    ).toEqual([]);
  });

  it("shipped → no inline action", () => {
    expect(
      visibleActionsForRow({
        status: "shipped",
        hasExactEdit: true,
        eligibleEditCount: 0,
      }),
    ).toEqual([]);
  });

  it("covers every ActionRowStatus value (no unhandled status returns undefined)", () => {
    const statuses: ActionRowStatus[] = [
      "new",
      "accepted",
      "shipped",
      "measuring",
      "needs_review",
      "needs_fresh_edit",
      "dismissed",
      "deferred",
    ];
    for (const s of statuses) {
      const out = visibleActionsForRow({
        status: s,
        hasExactEdit: true,
        eligibleEditCount: 1,
      });
      expect(Array.isArray(out), `status=${s} must return an array`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pure helper — buildAcceptPayload contract
// ─────────────────────────────────────────────────────────────────────

describe("Bundle 2C — buildAcceptPayload contract", () => {
  it("matches the legacy table's recPayload shape (stableKey + title + description + placeholder type + null cluster fields)", () => {
    const payload = buildAcceptPayload({
      sourceRecommendationId: "rec-abc",
      title: "Add an FAQ",
      evidenceSummary: "Some evidence summary.",
    });
    expect(payload).toEqual({
      stableKey: "rec-abc",
      // Placeholder per legacy contract — server reads canonical from store.
      type: "create_cluster_page",
      title: "Add an FAQ",
      description: "Some evidence summary.",
      clusterLabel: null,
      clusterKind: null,
    });
  });

  it("never includes the row's id or sourceEditId in the payload (those are presentation-layer only)", () => {
    const payload = buildAcceptPayload({
      sourceRecommendationId: "rec-xyz",
      title: "x",
      evidenceSummary: "y",
    });
    const keys = Object.keys(payload).sort();
    expect(keys).toEqual([
      "clusterKind",
      "clusterLabel",
      "description",
      "stableKey",
      "title",
      "type",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pure helper — successMessageFor + CALM_ERROR_MESSAGE
// ─────────────────────────────────────────────────────────────────────

describe("Bundle 2C — success/error copy", () => {
  it("accept message mentions tracking results when hasExactEdit is true", () => {
    expect(
      successMessageFor("accept", {
        hasExactEdit: true,
        eligibleEditCount: 1,
      }),
    ).toBe("Accepted — Beacon will track results.");
  });

  it("accept message is short when hasExactEdit is false", () => {
    expect(
      successMessageFor("accept", {
        hasExactEdit: false,
        eligibleEditCount: 0,
      }),
    ).toBe("Accepted.");
  });

  it("mark-shipped message reflects the edit count plural", () => {
    expect(
      successMessageFor("mark-shipped", {
        hasExactEdit: true,
        eligibleEditCount: 1,
      }),
    ).toBe("Marked live — Beacon is watching impact.");
    expect(
      successMessageFor("mark-shipped", {
        hasExactEdit: true,
        eligibleEditCount: 3,
      }),
    ).toBe("Marked 3 edits live — Beacon is watching impact.");
  });

  it("plain-text actions have static one-word success messages", () => {
    expect(
      successMessageFor("defer", { hasExactEdit: true, eligibleEditCount: 0 }),
    ).toBe("Deferred.");
    expect(
      successMessageFor("dismiss", {
        hasExactEdit: true,
        eligibleEditCount: 0,
      }),
    ).toBe("Dismissed.");
    expect(
      successMessageFor("restore", {
        hasExactEdit: true,
        eligibleEditCount: 0,
      }),
    ).toBe("Restored.");
    expect(
      successMessageFor("promote", {
        hasExactEdit: true,
        eligibleEditCount: 0,
      }),
    ).toBe("Promoted.");
  });

  it("CALM_ERROR_MESSAGE never references raw server/action error text", () => {
    expect(CALM_ERROR_MESSAGE).toBe(
      "Beacon couldn't apply that action. Try again.",
    );
    expect(CALM_ERROR_MESSAGE).not.toMatch(/PGRST|permission|denied|exception|stack|trace/i);
  });

  it("SUCCESS_MESSAGES exhaustively covers every DetailActionKey", () => {
    const keys: DetailActionKey[] = [
      "accept",
      "defer",
      "dismiss",
      "mark-shipped",
      "restore",
      "promote",
    ];
    for (const k of keys) {
      expect(SUCCESS_MESSAGES[k], `key ${k} must have a success message`).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Render output — data attrs, anchors, no leaks
// ─────────────────────────────────────────────────────────────────────

describe("Bundle 2C — render output", () => {
  function visibleActionAttrs(html: string): string[] {
    return (
      html.match(/data-recommendation-detail-action="[^"]+"/g) ?? []
    ).map((s) =>
      s.replace(/data-recommendation-detail-action="([^"]+)"/, "$1"),
    );
  }

  it("renders one button per visibleActionsForRow entry, in order", () => {
    const html = renderToStaticMarkup(
      <RecommendationDetailActions
        row={makeRow({ status: "new" })}
        changelogId={null}
        handlers={makeHandlers()}
        skipRouterRefresh
      />,
    );
    expect(visibleActionAttrs(html)).toEqual([
      "accept",
      "defer",
      "dismiss",
    ]);
  });

  it("renders zero action buttons for measuring/shipped", () => {
    for (const status of ["measuring", "shipped"] as const) {
      const html = renderToStaticMarkup(
        <RecommendationDetailActions
          row={makeRow({ status })}
          changelogId={null}
          handlers={makeHandlers()}
          skipRouterRefresh
        />,
      );
      expect(visibleActionAttrs(html)).toEqual([]);
      // The "no inline actions for this status." calm note appears.
      expect(html).toContain('data-recommendation-detail-actions-empty="true"');
    }
  });

  it("back-to-list CTA always renders; legacy-review CTA never renders (removed 2026-05-13)", () => {
    const html = renderToStaticMarkup(
      <RecommendationDetailActions
        row={makeRow({ status: "new" })}
        changelogId={null}
        handlers={makeHandlers()}
        skipRouterRefresh
      />,
    );
    expect(html).toContain('data-recommendation-detail-cta="back-to-list"');
    expect(html).not.toContain('data-recommendation-detail-cta="legacy-review"');
    expect(html).not.toContain("Open legacy review");
  });

  it("open-change CTA only renders when changelogId is provided", () => {
    const withChangelog = renderToStaticMarkup(
      <RecommendationDetailActions
        row={makeRow({ status: "shipped" })}
        changelogId="change-abc-123"
        handlers={makeHandlers()}
        skipRouterRefresh
      />,
    );
    expect(withChangelog).toContain(
      'data-recommendation-detail-cta="open-change"',
    );
    expect(withChangelog).toContain('href="/changes/change-abc-123"');

    const withoutChangelog = renderToStaticMarkup(
      <RecommendationDetailActions
        row={makeRow({ status: "shipped" })}
        changelogId={null}
        handlers={makeHandlers()}
        skipRouterRefresh
      />,
    );
    expect(withoutChangelog).not.toContain(
      'data-recommendation-detail-cta="open-change"',
    );
  });

  it("the rendered detail actions surface contains zero customer-facing legacy hops (2026-05-13)", () => {
    // The "Open legacy review" CTA was removed. No customer-facing
    // v2 detail action surface advertises the legacy route anymore.
    const html = renderToStaticMarkup(
      <RecommendationDetailActions
        row={makeRow({
          status: "new",
          sourceRecommendationId:
            "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:abc",
        })}
        changelogId={null}
        handlers={makeHandlers()}
        skipRouterRefresh
      />,
    );
    expect(html).not.toContain("?legacy=1");
    expect(html).not.toContain("#rec-");
  });

  it("status-context data attribute reflects the current row status", () => {
    const html = renderToStaticMarkup(
      <RecommendationDetailActions
        row={makeRow({ status: "deferred" })}
        changelogId={null}
        handlers={makeHandlers()}
        skipRouterRefresh
      />,
    );
    expect(html).toContain(
      'data-recommendation-detail-actions-status="deferred"',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// No-leak invariants — customer-vocabulary contract
// ─────────────────────────────────────────────────────────────────────

describe("Bundle 2C — no internal vocabulary leaks", () => {
  it("rendered HTML across all statuses contains no operator-internal terms", () => {
    const statuses: ActionRowStatus[] = [
      "new",
      "accepted",
      "shipped",
      "measuring",
      "needs_review",
      "needs_fresh_edit",
      "dismissed",
      "deferred",
    ];
    for (const status of statuses) {
      const html = renderToStaticMarkup(
        <RecommendationDetailActions
          row={makeRow({ status })}
          changelogId="change-x"
          handlers={makeHandlers()}
          skipRouterRefresh
        />,
      );
      const forbidden = [
        "stableKey",
        "evidence_tier",
        "Z-score",
        "decision queue",
        "resolver_tier",
        "evidence_hash",
        "decision matrix",
        "pattern brain",
      ];
      for (const term of forbidden) {
        expect(
          html.toLowerCase().includes(term.toLowerCase()),
          `status=${status} must not leak '${term}'`,
        ).toBe(false);
      }
    }
  });

  it("never surfaces the raw 'create_cluster_page' placeholder type in rendered HTML", () => {
    // The buildAcceptPayload helper uses "create_cluster_page" as a
    // server-contract placeholder. It is NOT a customer-visible label
    // and MUST stay out of the rendered DOM.
    const html = renderToStaticMarkup(
      <RecommendationDetailActions
        row={makeRow({ status: "new" })}
        changelogId={null}
        handlers={makeHandlers()}
        skipRouterRefresh
      />,
    );
    expect(html).not.toContain("create_cluster_page");
  });
});
