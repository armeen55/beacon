/**
 * 2026-06-10 — /diagnostics/dev-notes contract: operator gate, ticket
 * rendering with exact paste-ready copy, actionable-only filter, and
 * the structural Invariant-2 guarantee (read-only surface: no actions
 * module exists for this route at all).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync } from "node:fs";
import { join } from "node:path";

class NotFoundError extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
}));

let _operator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operator,
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-ritz-founder",
}));

let _edits: unknown[] = [];
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => ({ getRecommendedEdits: async () => _edits }),
  }),
}));

import DevNotesPage from "@/app/(shell)/diagnostics/dev-notes/page";

beforeEach(() => {
  _operator = true;
  _edits = [];
});

describe("/diagnostics/dev-notes", () => {
  it("404s for non-operators; empty state for none", async () => {
    _operator = false;
    await expect(
      (async () => renderToStaticMarkup(await DevNotesPage()))(),
    ).rejects.toThrow(NotFoundError);
    _operator = true;
    const html = renderToStaticMarkup(await DevNotesPage());
    expect(html).toMatch(/no actionable cards/i);
  });

  it("renders actionable cards as tickets; skips verified/dismissed", async () => {
    _edits = [
      {
        id: "e1", display_label: "Add homepage FAQ", action_type: "add_faq",
        target_url: "https://ritzbuilders.com/", target_element_key: null,
        current_text: null, proposed_text: "Who should I hire?",
        why: "prompt intent", difficulty: "low", confidence: "medium",
        risks: [], expected_impact: null, measurement_plan: null,
        created_at: "2026-06-10T00:00:00Z",
        implementation_status: "recommended",
      },
      {
        id: "e2", display_label: "Already live", action_type: "add_faq",
        target_url: "https://ritzbuilders.com/x", target_element_key: null,
        current_text: null, proposed_text: "done",
        why: "y", difficulty: "low", confidence: "medium",
        risks: [], expected_impact: null, measurement_plan: null,
        created_at: "2026-06-10T00:00:00Z",
        implementation_status: "verified_live",
      },
    ];
    const html = renderToStaticMarkup(await DevNotesPage());
    expect(html).toContain("Add homepage FAQ");
    expect(html).toContain("Who should I hire?");
    expect(html).toContain("1 actionable card");
    expect(html).not.toContain("Already live");
  });

  it("Invariant 2, structurally: the dev-notes route has NO actions module", () => {
    expect(
      existsSync(join(process.cwd(), "src/app/(shell)/diagnostics/dev-notes/actions.ts")),
    ).toBe(false);
  });
});
