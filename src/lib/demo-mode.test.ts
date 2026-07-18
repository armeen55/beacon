import { describe, it, expect } from "vitest";

import {
  shouldServeDemoData,
  SEED_OWNER_TENANT_ID,
} from "./demo-mode";

// ---------------------------------------------------------------------------
// 2026-07-18 — verified bug: tenant-ritz-founder had GSC connected and zero
// import runs, so seed-data.server.ts served the full fixture dataset while
// layout.tsx's "no real connector" check hid the "Sample data" banner. A
// customer saw invented numbers (actual_value 18.5, fake opportunities/
// competitors/briefs) presented as real, with nothing telling them so.
//
// `shouldServeDemoData` is now the ONE predicate both call sites share:
// fixtures render ONLY when this is true, and the banner shows ONLY when
// this is true. This test exhaustively covers all 8 combinations of the
// three boolean inputs (tenant is/isn't the seed owner, has/hasn't import
// runs, has/hasn't a real connector) so the truth table can never silently
// drift between the two call sites again.
// ---------------------------------------------------------------------------

const OTHER_TENANT_ID = "tenant-iranopedia";

describe("shouldServeDemoData", () => {
  it("is exported and non-empty (sanity check the seed-owner constant resolved)", () => {
    expect(SEED_OWNER_TENANT_ID).toBe("tenant-ritz-founder");
  });

  it("true: seed owner, zero imports, no real connector — the ONLY true case", () => {
    expect(
      shouldServeDemoData({
        tenantId: SEED_OWNER_TENANT_ID,
        importRunsCount: 0,
        hasRealConnector: false,
      }),
    ).toBe(true);
  });

  it("false: seed owner, zero imports, REAL connector — the exact production bug this fixes", () => {
    // Before the fix: seed-data.server.ts served fixtures here regardless
    // of the connector, and layout.tsx's banner hid itself because a real
    // connector was present. Both were wrong. This must now be false.
    expect(
      shouldServeDemoData({
        tenantId: SEED_OWNER_TENANT_ID,
        importRunsCount: 0,
        hasRealConnector: true,
      }),
    ).toBe(false);
  });

  it("false: seed owner, has imports, no real connector", () => {
    expect(
      shouldServeDemoData({
        tenantId: SEED_OWNER_TENANT_ID,
        importRunsCount: 3,
        hasRealConnector: false,
      }),
    ).toBe(false);
  });

  it("false: seed owner, has imports, real connector", () => {
    expect(
      shouldServeDemoData({
        tenantId: SEED_OWNER_TENANT_ID,
        importRunsCount: 3,
        hasRealConnector: true,
      }),
    ).toBe(false);
  });

  it("false: other tenant, zero imports, no real connector (must get an honest empty state, never founder demo content)", () => {
    expect(
      shouldServeDemoData({
        tenantId: OTHER_TENANT_ID,
        importRunsCount: 0,
        hasRealConnector: false,
      }),
    ).toBe(false);
  });

  it("false: other tenant, zero imports, real connector", () => {
    expect(
      shouldServeDemoData({
        tenantId: OTHER_TENANT_ID,
        importRunsCount: 0,
        hasRealConnector: true,
      }),
    ).toBe(false);
  });

  it("false: other tenant, has imports, no real connector", () => {
    expect(
      shouldServeDemoData({
        tenantId: OTHER_TENANT_ID,
        importRunsCount: 5,
        hasRealConnector: false,
      }),
    ).toBe(false);
  });

  it("false: other tenant, has imports, real connector", () => {
    expect(
      shouldServeDemoData({
        tenantId: OTHER_TENANT_ID,
        importRunsCount: 5,
        hasRealConnector: true,
      }),
    ).toBe(false);
  });
});
