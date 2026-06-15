import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/prompts",
}));

const TRACKED_PROMPTS_FIXTURE = [
  {
    id: "p-active-1",
    account_id: "ritz",
    text: "Best luxury home builder in Palo Alto?",
    topic_id: "Luxury Home Builder",
    location_scope: "Palo Alto",
    service_scope: null,
    intent_type: "recommendation",
    platforms: ["perplexity", "chatgpt"],
    tags: [],
    is_active: true,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
  },
  {
    id: "p-active-2",
    account_id: "ritz",
    text: "Bay Area teardown + rebuild builder recommendations?",
    topic_id: "Teardown Rebuild",
    location_scope: "Bay Area",
    service_scope: null,
    intent_type: "recommendation",
    platforms: ["perplexity"],
    tags: [],
    is_active: true,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
  },
  {
    id: "p-inactive",
    account_id: "ritz",
    text: "Deprecated legacy prompt example.",
    topic_id: "Legacy",
    location_scope: null,
    service_scope: null,
    intent_type: "recommendation",
    platforms: ["chatgpt"],
    tags: [],
    is_active: false,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
  },
];

// Deploy hardening (2026-05-12) — page now reads tracked_prompts via
// `getRepository().forTenant(tenantId).getTrackedPrompts()` directly
// (skipping the canonical-store seed + the 4-table fan-out of
// `loadFreshCanonicalData`). Mock the tenant repo so the smoke test
// stays untouched by the underlying data-source change.
vi.mock("@/lib/persistence/repositories", () => {
  const tenantRepo = {
    getTrackedPrompts: vi.fn(async () => TRACKED_PROMPTS_FIXTURE),
  };
  return {
    getRepository: () => ({
      forTenant: () => tenantRepo,
    }),
  };
});

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-ritz-founder"),
  currentTenant: vi.fn(async () => "tenant-ritz-founder"),
}));

describe("/settings/prompts smoke", () => {
  it("renders header count + all prompts with toggle + topic + geo tags", async () => {
    const { default: Page } = await import(
      "@/app/(shell)/settings/prompts/page"
    );
    const tree = await Page();
    const html = renderToStaticMarkup(tree as ReactElement);

    // Header: 2 active, 1 inactive.
    expect(html).toContain("Prompts");
    expect(html).toMatch(/2 prompts run the next time you refresh your connected data/);
    expect(html).toMatch(/1 inactive/);

    // Add button visible.
    expect(html).toContain("+ Add prompt");

    // Active prompts render foreground; inactive renders muted.
    expect(html).toContain("Best luxury home builder in Palo Alto?");
    expect(html).toContain("Bay Area teardown + rebuild builder recommendations?");
    expect(html).toContain("Deprecated legacy prompt example.");

    // Topic + geo pills render.
    expect(html).toContain("Luxury Home Builder");
    expect(html).toContain("Palo Alto");
    expect(html).toContain("Teardown Rebuild");
    expect(html).toContain("Bay Area");

    // Platform labels humanized.
    expect(html).toContain("Perplexity · ChatGPT");

    // Toggle buttons: actives get "Deactivate", inactives get "Activate".
    // Button text appears after ">" and ends with "<"; aria-label is a
    // separate occurrence — count button-text only.
    const deactivateCount = (html.match(/>Deactivate</g) ?? []).length;
    const activateCount = (html.match(/>Activate</g) ?? []).length;
    expect(deactivateCount).toBe(2);
    expect(activateCount).toBe(1);
  });
});
