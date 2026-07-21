/**
 * ISOLATION-CRITICAL regression — the FOUNDER's global/legacy config file
 * must NEVER serve a non-founder tenant (2026-06-15).
 *
 * LIVE LEAK (confirmed via ground-truth on /today for tenant-iranopedia):
 * the "Who AI thinks you are" descriptors block rendered the FOUNDER's brand
 * "Ritz Builders" on a CUSTOMER's surface. Iranopedia's own data was clean
 * (Persian topics, empty tracked_entities) — the leak was in CONFIG
 * RESOLUTION, not data.
 *
 * ROOT CAUSE: the legacy single-tenant resolution chain in
 * `resolveConfigForTenant` (`BEACON_BUSINESS_CONFIG_JSON` env blob +
 * `.data/business-config.json` + `.data/global/business-config.json`) — which
 * describes ONE tenant, the founder, and whose global file literally carries
 * "Ritz Builders" — was gated `tenantId === process.env.BEACON_TENANT_ID`.
 * On a per-tenant dev/CLI run (or any deploy where `BEACON_TENANT_ID` is set
 * to a CUSTOMER tenant — `.env.local` had `BEACON_TENANT_ID=tenant-iranopedia`),
 * the gate fired for the CUSTOMER and served them the founder's global file.
 * Downstream, that non-placeholder global config also pre-empted the tenant's
 * OWN `business_config` Supabase row in `hydrateBusinessConfigFromSupabase`
 * (which short-circuits on a non-placeholder sync result), so Iranopedia never
 * read its own "iranopedia" row.
 *
 * FIX: the legacy chain is now gated to the FOUNDER tenant id
 * (`tenant-ritz-founder`, overridable via `BEACON_FOUNDER_TENANT_ID`), NOT
 * "whoever `BEACON_TENANT_ID` names." A non-founder tenant therefore resolves
 * via its per-tenant file / `BEACON_BUSINESS_CONFIG_JSON_BY_TENANT` entry /
 * its own Supabase row — or the neutral placeholder — but NEVER the founder's
 * global file. With the sync chain returning placeholder for a non-founder,
 * `hydrate` correctly reaches that tenant's own Supabase row.
 *
 * This ratchet pins, simultaneously:
 *   1. With `BEACON_TENANT_ID=tenant-iranopedia` (active) + the global founder
 *      file present, `getBusinessConfig("tenant-iranopedia")` is the PLACEHOLDER
 *      — never "Ritz Builders".
 *   2. The same leak via the `BEACON_BUSINESS_CONFIG_JSON` env blob (the
 *      founder's hosted channel) also does NOT reach a non-founder tenant.
 *   3. `getBusinessConfigForCurrentTenant()` for a non-founder tenant hydrates
 *      that tenant's OWN Supabase row ("iranopedia"), never "Ritz Builders".
 *   4. The FOUNDER (`tenant-ritz-founder`) STILL resolves "Ritz Builders" from
 *      the global file — no regression to the founder.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";

// Supabase admin mock — the non-founder tenant's own `business_config` row.
// hydrateBusinessConfigFromSupabase reads `.from("business_config")
// .select("data").eq("id", tenantId).maybeSingle()`.
const _row: { data: { data: Record<string, unknown> } | null; error: unknown } =
  { data: null, error: null };
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: _row.data, error: _row.error }),
        }),
      }),
    }),
  }),
}));

import {
  getBusinessConfig,
  getBusinessConfigForCurrentTenant,
  hydrateBusinessConfigFromSupabase,
  isPlaceholderConfig,
  __resetBusinessConfigCacheForTests,
} from "@/lib/business-config";

const REPO_ROOT = process.cwd();
const TOP_LEVEL_PATH = join(REPO_ROOT, ".data", "business-config.json");
const GLOBAL_PATH = join(REPO_ROOT, ".data", "global", "business-config.json");

const FOUNDER_ID = "tenant-ritz-founder";
const CUSTOMER_ID = "tenant-iranopedia";
// The customer's OWN per-tenant file is a legitimate config source; a local
// dev worktree can have one on disk (the operator really configured
// Iranopedia). This suite pins the FOUNDER-leak invariant, so it must control
// this path too - snapshot + clear it like the other two, else the customer
// correctly resolves its own file and the placeholder expectations misfire.
const CUSTOMER_TENANT_PATH = join(
  REPO_ROOT,
  ".data",
  "tenants",
  CUSTOMER_ID,
  "business-config.json",
);

// A founder-flavored global config — the exact shape of the live leak source.
const FOUNDER_GLOBAL = {
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  industry: "home-builder",
  locations: ["Palo Alto", "Menlo Park", "Atherton"],
  services: ["custom home building"],
};

let savedTopLevel: string | null = null;
let savedGlobal: string | null = null;
let savedCustomerTenant: string | null = null;
let savedTenantId: string | undefined;
let savedEnvBlob: string | undefined;
let savedByTenant: string | undefined;
let savedFounderOverride: string | undefined;

beforeEach(() => {
  // Snapshot + clear on-disk config so we control the file chain exactly.
  savedTopLevel = existsSync(TOP_LEVEL_PATH)
    ? readFileSync(TOP_LEVEL_PATH, "utf-8")
    : null;
  savedGlobal = existsSync(GLOBAL_PATH)
    ? readFileSync(GLOBAL_PATH, "utf-8")
    : null;
  if (existsSync(TOP_LEVEL_PATH)) unlinkSync(TOP_LEVEL_PATH);
  savedCustomerTenant = existsSync(CUSTOMER_TENANT_PATH)
    ? readFileSync(CUSTOMER_TENANT_PATH, "utf-8")
    : null;
  if (existsSync(CUSTOMER_TENANT_PATH)) unlinkSync(CUSTOMER_TENANT_PATH);

  // Snapshot + clear the env vars this suite drives.
  savedTenantId = process.env.BEACON_TENANT_ID;
  savedEnvBlob = process.env.BEACON_BUSINESS_CONFIG_JSON;
  savedByTenant = process.env.BEACON_BUSINESS_CONFIG_JSON_BY_TENANT;
  savedFounderOverride = process.env.BEACON_FOUNDER_TENANT_ID;
  delete process.env.BEACON_BUSINESS_CONFIG_JSON;
  delete process.env.BEACON_BUSINESS_CONFIG_JSON_BY_TENANT;
  delete process.env.BEACON_FOUNDER_TENANT_ID;

  // Plant the founder's global file (the leak source).
  mkdirSync(join(REPO_ROOT, ".data", "global"), { recursive: true });
  writeFileSync(GLOBAL_PATH, JSON.stringify(FOUNDER_GLOBAL));

  _row.data = null;
  _row.error = null;
  __resetBusinessConfigCacheForTests();
});

afterEach(() => {
  // Restore disk.
  if (savedTopLevel === null) {
    if (existsSync(TOP_LEVEL_PATH)) unlinkSync(TOP_LEVEL_PATH);
  } else {
    writeFileSync(TOP_LEVEL_PATH, savedTopLevel);
  }
  if (savedGlobal === null) {
    if (existsSync(GLOBAL_PATH)) unlinkSync(GLOBAL_PATH);
  } else {
    mkdirSync(join(REPO_ROOT, ".data", "global"), { recursive: true });
    writeFileSync(GLOBAL_PATH, savedGlobal);
  }
  if (savedCustomerTenant === null) {
    if (existsSync(CUSTOMER_TENANT_PATH)) unlinkSync(CUSTOMER_TENANT_PATH);
  } else {
    mkdirSync(join(REPO_ROOT, ".data", "tenants", CUSTOMER_ID), { recursive: true });
    writeFileSync(CUSTOMER_TENANT_PATH, savedCustomerTenant);
  }
  // Restore env.
  const restore = (k: string, v: string | undefined) => {
    if (typeof v === "string") process.env[k] = v;
    else delete process.env[k];
  };
  restore("BEACON_TENANT_ID", savedTenantId);
  restore("BEACON_BUSINESS_CONFIG_JSON", savedEnvBlob);
  restore("BEACON_BUSINESS_CONFIG_JSON_BY_TENANT", savedByTenant);
  restore("BEACON_FOUNDER_TENANT_ID", savedFounderOverride);
  __resetBusinessConfigCacheForTests();
});

describe("business-config: founder global file never serves a non-founder tenant", () => {
  it("ACTIVE customer tenant + founder global file → PLACEHOLDER, never the founder brand", () => {
    // Simulate the live `.env.local`: BEACON_TENANT_ID points at the customer.
    process.env.BEACON_TENANT_ID = CUSTOMER_ID;
    __resetBusinessConfigCacheForTests();

    const cfg = getBusinessConfig(CUSTOMER_ID);
    expect(cfg.name).not.toBe("Ritz Builders");
    expect(isPlaceholderConfig(cfg)).toBe(true);
    expect(cfg.name).toBe("");
    // No founder geography/services bled through either.
    expect(cfg.locations).not.toContain("Palo Alto");
  });

  it("the no-arg path resolving BEACON_TENANT_ID=<customer> also does NOT leak the founder brand", () => {
    // The no-arg overload resolves the tenant from BEACON_TENANT_ID — the
    // exact path that poisoned the cache for the active customer tenant.
    process.env.BEACON_TENANT_ID = CUSTOMER_ID;
    __resetBusinessConfigCacheForTests();

    const cfg = getBusinessConfig();
    expect(cfg.name).not.toBe("Ritz Builders");
    expect(isPlaceholderConfig(cfg)).toBe(true);
  });

  it("the founder's BEACON_BUSINESS_CONFIG_JSON env blob also does NOT reach a non-founder tenant", () => {
    process.env.BEACON_TENANT_ID = CUSTOMER_ID;
    process.env.BEACON_BUSINESS_CONFIG_JSON = JSON.stringify(FOUNDER_GLOBAL);
    __resetBusinessConfigCacheForTests();

    const cfg = getBusinessConfig(CUSTOMER_ID);
    expect(cfg.name).not.toBe("Ritz Builders");
    expect(isPlaceholderConfig(cfg)).toBe(true);
  });

  it("hydrate prefers the customer's OWN Supabase row over the founder global file", async () => {
    process.env.BEACON_TENANT_ID = CUSTOMER_ID;
    _row.data = { data: { name: "iranopedia", domain: "iranopedia.com" } };
    __resetBusinessConfigCacheForTests();

    const hydrated = await hydrateBusinessConfigFromSupabase(CUSTOMER_ID);
    expect(hydrated).not.toBeNull();
    expect(hydrated!.name).toBe("iranopedia");
    expect(hydrated!.name).not.toBe("Ritz Builders");
  });

  it("getBusinessConfigForCurrentTenant (env tenant = customer) returns the customer's row, never the founder brand", async () => {
    process.env.BEACON_TENANT_ID = CUSTOMER_ID;
    _row.data = { data: { name: "iranopedia", domain: "iranopedia.com" } };
    __resetBusinessConfigCacheForTests();

    const cfg = await getBusinessConfigForCurrentTenant();
    expect(cfg.name).toBe("iranopedia");
    expect(cfg.name).not.toBe("Ritz Builders");
  });

  it("customer with NO Supabase row stays on the neutral placeholder — still never the founder brand", async () => {
    process.env.BEACON_TENANT_ID = CUSTOMER_ID;
    _row.data = null; // no per-tenant row yet
    __resetBusinessConfigCacheForTests();

    const cfg = await getBusinessConfigForCurrentTenant();
    expect(isPlaceholderConfig(cfg)).toBe(true);
    expect(cfg.name).not.toBe("Ritz Builders");
  });

  it("FOUNDER still resolves its own config from the global file — no regression", () => {
    process.env.BEACON_TENANT_ID = FOUNDER_ID;
    __resetBusinessConfigCacheForTests();

    const cfg = getBusinessConfig(FOUNDER_ID);
    expect(cfg.name).toBe("Ritz Builders");
    expect(cfg.domain).toBe("ritzbuilders.com");
    expect(cfg.locations).toContain("Palo Alto");
    expect(isPlaceholderConfig(cfg)).toBe(false);
  });

  it("FOUNDER resolves the global file even when the active env tenant is a customer (founder-id gate, not BEACON_TENANT_ID gate)", () => {
    // The gate keys off the founder id, not the ambient env tenant — so the
    // founder's own config is reachable by id regardless of which tenant the
    // deploy env happens to name.
    process.env.BEACON_TENANT_ID = CUSTOMER_ID;
    __resetBusinessConfigCacheForTests();

    const founder = getBusinessConfig(FOUNDER_ID);
    expect(founder.name).toBe("Ritz Builders");
    const customer = getBusinessConfig(CUSTOMER_ID);
    expect(isPlaceholderConfig(customer)).toBe(true);
  });

  it("BEACON_FOUNDER_TENANT_ID override re-homes the global file to a different founder id", () => {
    // A non-Ritz founder deploy can re-point the legacy chain.
    process.env.BEACON_FOUNDER_TENANT_ID = "tenant-other-founder";
    process.env.BEACON_TENANT_ID = "tenant-other-founder";
    __resetBusinessConfigCacheForTests();

    const newFounder = getBusinessConfig("tenant-other-founder");
    expect(newFounder.name).toBe("Ritz Builders"); // the planted global file
    expect(isPlaceholderConfig(newFounder)).toBe(false);
    // The default founder id no longer owns the file under the override.
    const oldFounder = getBusinessConfig(FOUNDER_ID);
    expect(isPlaceholderConfig(oldFounder)).toBe(true);
  });
});
