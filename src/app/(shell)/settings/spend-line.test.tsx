/**
 * SpendLine - the one honest "this month's spend" line folded onto /settings
 * after the dedicated /settings/spend page was retired (2026-07-21). Pins the
 * three states that matter: a real number renders plainly, a read failure
 * self-hides (never a fake $0), and a genuine zero-spend month renders
 * "$0.00" because that IS the truth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let tenantImpl: () => Promise<string> = async () => "tenant-ritz-founder";
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: () => tenantImpl(),
}));

let ledgerImpl: () => Promise<number | null> = async () => null;
vi.mock("@/lib/cost/budget-ledger-supabase", () => ({
  getTenantSpentThisMonthUsd: () => ledgerImpl(),
}));

import { SpendLine } from "./spend-line";

beforeEach(() => {
  tenantImpl = async () => "tenant-ritz-founder";
  ledgerImpl = async () => null;
});

describe("SpendLine", () => {
  it("renders this month's total spend when the ledger read succeeds", async () => {
    ledgerImpl = async () => 4.12;
    const html = renderToStaticMarkup(await SpendLine());
    expect(html).toContain("I spent $4.12 this month on AI and data calls");
    expect(html).toContain("capped and");
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("renders $0.00 for a genuinely empty month - a real zero is honest", async () => {
    ledgerImpl = async () => 0;
    const html = renderToStaticMarkup(await SpendLine());
    expect(html).toContain("I spent $0.00 this month on AI and data calls");
  });

  it("self-hides on a ledger read failure rather than showing a fake $0", async () => {
    ledgerImpl = async () => null;
    const html = renderToStaticMarkup(await SpendLine());
    expect(html).toBe("");
  });

  it("self-hides when the ledger read throws", async () => {
    ledgerImpl = async () => {
      throw new Error("boom");
    };
    const html = renderToStaticMarkup(await SpendLine());
    expect(html).toBe("");
  });

  it("self-hides when the tenant cannot be resolved", async () => {
    tenantImpl = async () => {
      throw new Error("no tenant");
    };
    const html = renderToStaticMarkup(await SpendLine());
    expect(html).toBe("");
  });
});
