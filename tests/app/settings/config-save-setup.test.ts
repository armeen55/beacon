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

describe("saveSetup - monthly visits goal (Wave 2A)", () => {
  it("a positive integer goal rides the per-tenant save", async () => {
    const r = await saveSetup({ ...BASE, monthlyVisitGoal: 10000 });
    expect(r.success).toBe(true);
    expect(saveBusinessConfigMock).toHaveBeenCalledWith(
      "tenant-cfg-test",
      expect.objectContaining({ monthlyVisitGoal: 10000 }),
    );
  });

  it("null clears the goal", async () => {
    const r = await saveSetup({ ...BASE, monthlyVisitGoal: null });
    expect(r.success).toBe(true);
    expect(saveBusinessConfigMock).toHaveBeenCalledWith(
      "tenant-cfg-test",
      expect.objectContaining({ monthlyVisitGoal: null }),
    );
  });

  it("a non-positive or non-integer goal is rejected (no save)", async () => {
    const bad = await saveSetup({ ...BASE, monthlyVisitGoal: 0 });
    expect(bad.success).toBe(false);
    const frac = await saveSetup({ ...BASE, monthlyVisitGoal: 12.5 });
    expect(frac.success).toBe(false);
    expect(saveBusinessConfigMock).not.toHaveBeenCalled();
  });

  it("an omitted goal leaves the stored value untouched (not in the patch)", async () => {
    await saveSetup({ ...BASE });
    const patch = saveBusinessConfigMock.mock.calls[0]![1] as Record<string, unknown>;
    expect("monthlyVisitGoal" in patch).toBe(false);
  });
});
