/**
 * North-star onboarding (2026-06-11) — saveSetup passthrough pins.
 *
 * The settings config action is the customer's "typed beats derived"
 * write path. Pins: contentRules + flaggedTerms ride the per-tenant
 * save (including EMPTY = explicit clear), and the save is keyed by the
 * ambient tenant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const saveBusinessConfigMock = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn(async () => "tenant-cfg-test"));

vi.mock("@/lib/business-config", () => ({
  saveBusinessConfig: saveBusinessConfigMock,
  getBusinessConfigForCurrentTenant: vi.fn(async () => ({
    yelpBusinessId: "",
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: () => tenantIdMock(),
}));
vi.mock("@/lib/connector-store", () => ({
  getYelpConnectorToken: vi.fn(async () => null),
  updateConnectorToken: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveSetup } from "@/app/(shell)/settings/config/actions";

const BASE = {
  name: "La Palma",
  domain: "lapalma.com",
  industry: "restaurant",
  locations: ["Tucson"],
  services: ["catering"],
  primaryCompetitors: [],
};

beforeEach(() => {
  saveBusinessConfigMock.mockReset();
});

describe("saveSetup — content guardrails passthrough", () => {
  it("contentRules + flaggedTerms ride the per-tenant save", async () => {
    const r = await saveSetup({
      ...BASE,
      contentRules: ["Call the language Persian, never Farsi."],
      flaggedTerms: ["Farsi"],
    });
    expect(r.success).toBe(true);
    expect(saveBusinessConfigMock).toHaveBeenCalledWith(
      "tenant-cfg-test",
      expect.objectContaining({
        contentRules: ["Call the language Persian, never Farsi."],
        flaggedTerms: ["Farsi"],
      }),
    );
  });

  it("omitted guardrails save as EMPTY arrays (explicit clear, not undefined)", async () => {
    await saveSetup({ ...BASE });
    expect(saveBusinessConfigMock).toHaveBeenCalledWith(
      "tenant-cfg-test",
      expect.objectContaining({ contentRules: [], flaggedTerms: [] }),
    );
  });
});
