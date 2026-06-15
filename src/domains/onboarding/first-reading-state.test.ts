/**
 * Behavioral tests — Gap F.1 first-reading-state (2026-05-07).
 *
 * Pure unit tests, no I/O. Pin the detector contract: trigger ONLY
 * when all three conditions are true (status=active + prompts > 0 +
 * observations === 0), customer-safe context, defense against bad
 * inputs.
 */

import { describe, expect, it } from "vitest";
import {
  detectFirstReadingState,
  type FirstReadingDetectorInput,
} from "./first-reading-state";

const ACTIVE_TENANT = {
  status: "active" as const,
  business_name: "Acme Builders",
  domain: "acmebuilders.com",
};

const baseInput = (
  overrides: Partial<FirstReadingDetectorInput> = {},
): FirstReadingDetectorInput => ({
  tenant: ACTIVE_TENANT,
  activePromptCount: 5,
  observationCount: 0,
  ...overrides,
});

describe("detectFirstReadingState — happy path", () => {
  it("triggers when active tenant + has prompts + zero observations", () => {
    const r = detectFirstReadingState(baseInput());
    expect(r.isFirstReading).toBe(true);
    if (r.isFirstReading) {
      expect(r.context.businessName).toBe("Acme Builders");
      expect(r.context.domain).toBe("acmebuilders.com");
      expect(r.context.promptCount).toBe(5);
      expect(r.context.nextReadingDescription).toBe(
        "once you refresh your connected data",
      );
    }
  });

  it("includes prompt count from input", () => {
    const r = detectFirstReadingState(baseInput({ activePromptCount: 25 }));
    expect(r.isFirstReading).toBe(true);
    if (r.isFirstReading) expect(r.context.promptCount).toBe(25);
  });
});

describe("detectFirstReadingState — does NOT trigger for non-active tenants", () => {
  it("pending_onboarding tenant returns false", () => {
    const r = detectFirstReadingState(
      baseInput({
        tenant: { ...ACTIVE_TENANT, status: "pending_onboarding" },
      }),
    );
    expect(r.isFirstReading).toBe(false);
  });

  it("paused tenant returns false", () => {
    const r = detectFirstReadingState(
      baseInput({ tenant: { ...ACTIVE_TENANT, status: "paused" } }),
    );
    expect(r.isFirstReading).toBe(false);
  });

  it("cancelled tenant returns false", () => {
    const r = detectFirstReadingState(
      baseInput({ tenant: { ...ACTIVE_TENANT, status: "cancelled" } }),
    );
    expect(r.isFirstReading).toBe(false);
  });

  it("null tenant returns false", () => {
    const r = detectFirstReadingState(baseInput({ tenant: null }));
    expect(r.isFirstReading).toBe(false);
  });
});

describe("detectFirstReadingState — does NOT trigger when prompts are missing", () => {
  it("zero active prompts returns false", () => {
    const r = detectFirstReadingState(baseInput({ activePromptCount: 0 }));
    expect(r.isFirstReading).toBe(false);
  });

  it("negative active prompts returns false (defensive)", () => {
    const r = detectFirstReadingState(baseInput({ activePromptCount: -1 }));
    expect(r.isFirstReading).toBe(false);
  });

  it("NaN active prompts returns false (defensive)", () => {
    const r = detectFirstReadingState(baseInput({ activePromptCount: NaN }));
    expect(r.isFirstReading).toBe(false);
  });
});

describe("detectFirstReadingState — does NOT trigger once observations exist", () => {
  it("1 observation returns false (this is what protects Ritz)", () => {
    const r = detectFirstReadingState(baseInput({ observationCount: 1 }));
    expect(r.isFirstReading).toBe(false);
  });

  it("many observations returns false (mature tenant)", () => {
    const r = detectFirstReadingState(baseInput({ observationCount: 16521 }));
    expect(r.isFirstReading).toBe(false);
  });

  it("NaN observation count returns false (defensive)", () => {
    const r = detectFirstReadingState(baseInput({ observationCount: NaN }));
    expect(r.isFirstReading).toBe(false);
  });
});

describe("detectFirstReadingState — Ritz-shaped input (regression guard)", () => {
  // Ritz is the long-running production tenant. Pin that ANY plausible
  // mature-tenant shape evaluates to false so /today rendering for Ritz
  // is byte-identical to pre-Gap-F.1.

  it("Ritz: status=active + 25 prompts + 16521 observations → false", () => {
    const r = detectFirstReadingState({
      tenant: {
        status: "active",
        business_name: "Ritz Custom Builders",
        domain: "ritzbuilders.com",
      },
      activePromptCount: 25,
      observationCount: 16521,
    });
    expect(r.isFirstReading).toBe(false);
  });

  it("active tenant with prompts but ALSO with observations: false (mature path)", () => {
    const r = detectFirstReadingState({
      tenant: ACTIVE_TENANT,
      activePromptCount: 10,
      observationCount: 100,
    });
    expect(r.isFirstReading).toBe(false);
  });
});

describe("detectFirstReadingState — context fallbacks", () => {
  it("blank business_name falls back to 'your business'", () => {
    const r = detectFirstReadingState(
      baseInput({ tenant: { ...ACTIVE_TENANT, business_name: "" } }),
    );
    expect(r.isFirstReading).toBe(true);
    if (r.isFirstReading) {
      expect(r.context.businessName).toBe("your business");
    }
  });

  it("whitespace-only business_name falls back to 'your business'", () => {
    const r = detectFirstReadingState(
      baseInput({ tenant: { ...ACTIVE_TENANT, business_name: "   " } }),
    );
    expect(r.isFirstReading).toBe(true);
    if (r.isFirstReading) {
      expect(r.context.businessName).toBe("your business");
    }
  });

  it("blank domain stays blank in context (UI decides whether to render the row)", () => {
    const r = detectFirstReadingState(
      baseInput({ tenant: { ...ACTIVE_TENANT, domain: "" } }),
    );
    expect(r.isFirstReading).toBe(true);
    if (r.isFirstReading) expect(r.context.domain).toBe("");
  });

  it("trims business_name + domain", () => {
    const r = detectFirstReadingState(
      baseInput({
        tenant: {
          ...ACTIVE_TENANT,
          business_name: "  Acme Builders  ",
          domain: "  acmebuilders.com  ",
        },
      }),
    );
    expect(r.isFirstReading).toBe(true);
    if (r.isFirstReading) {
      expect(r.context.businessName).toBe("Acme Builders");
      expect(r.context.domain).toBe("acmebuilders.com");
    }
  });
});

describe("detectFirstReadingState — customer-safe phrasing", () => {
  it("nextReadingDescription does NOT mention cron/UTC/GitHub/Supabase", () => {
    const r = detectFirstReadingState(baseInput());
    expect(r.isFirstReading).toBe(true);
    if (r.isFirstReading) {
      const phrase = r.context.nextReadingDescription;
      expect(phrase).not.toMatch(/cron/i);
      expect(phrase).not.toMatch(/UTC/);
      expect(phrase).not.toMatch(/GitHub/i);
      expect(phrase).not.toMatch(/Supabase/i);
      expect(phrase).not.toMatch(/poll/i);
      expect(phrase).not.toMatch(/07:00/);
    }
  });

  it("context never carries internal field names like account_id / tenant_id", () => {
    const r = detectFirstReadingState(baseInput());
    expect(r.isFirstReading).toBe(true);
    if (r.isFirstReading) {
      const json = JSON.stringify(r.context);
      expect(json).not.toMatch(/account_id/i);
      expect(json).not.toMatch(/tenant_id/i);
      expect(json).not.toMatch(/is_active/i);
      expect(json).not.toMatch(/observed_at/i);
    }
  });
});

// ── North-star onboarding (2026-06-11): derived-profile facts on the card ──

describe("detectFirstReadingState — derived profile pass-through", () => {
  const baseInput = {
    tenant: {
      id: "t-1",
      status: "active",
      business_name: "La Palma",
      domain: "lapalma.com",
    } as never,
    activePromptCount: 5,
    observationCount: 0,
  };

  it("carries the derived facts into the context when provided", () => {
    const r = detectFirstReadingState(baseInput, {
      industry: "restaurant",
      locations: ["Tucson", "Oro Valley"],
      serviceCount: 4,
      keyPageCount: 8,
    });
    expect(r.isFirstReading).toBe(true);
    if (r.isFirstReading) {
      expect(r.context.derived?.industry).toBe("restaurant");
      expect(r.context.derived?.locations).toEqual(["Tucson", "Oro Valley"]);
    }
  });

  it("omits the derived block entirely when nothing was derived", () => {
    const r = detectFirstReadingState(baseInput);
    expect(r.isFirstReading).toBe(true);
    if (r.isFirstReading) {
      expect("derived" in r.context).toBe(false);
    }
  });
});
