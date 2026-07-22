/**
 * PLATFORM — core lib primitives (Core 100K terminal suite; merged boundary
 * cases from src/lib/copy/strip-dashes.test.ts, src/lib/single-flight.test.ts,
 * src/lib/load-with-deadline.test.ts, src/lib/url/normalize.test.ts, and the
 * per-tenant config-isolation pins of src/lib/business-config.pertenant.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

// Mocks for the business-config section only.
const syncTenantMock = vi.hoisted(() => vi.fn(async () => {}));
const syncLegacyMock = vi.hoisted(() => vi.fn(async () => {}));
const maybeSingleMock = vi.hoisted(() => vi.fn());
const tenantIdMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/persistence/dual-write", () => ({
  syncBusinessConfig: syncLegacyMock,
  syncTenantBusinessConfig: syncTenantMock,
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: () => tenantIdMock(),
}));
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: maybeSingleMock }),
      }),
    }),
  }),
}));

import { hasBannedDash, stripBannedDashes } from "@/lib/copy/strip-dashes";
import { runSingleFlight, isInFlight, inFlightCount, __resetSingleFlightForTests } from "@/lib/single-flight";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { normalizeUrl } from "@/lib/url/normalize";
import {
  saveBusinessConfig,
  getBusinessConfig,
  getBusinessConfigForCurrentTenant,
  isPlaceholderConfig,
  __resetBusinessConfigCacheForTests,
} from "@/lib/business-config";

describe("stripBannedDashes — the hard no-em-dash rule", () => {
  it("spaced dashes become commas, unspaced become hyphens, clean copy is untouched", () => {
    expect(stripBannedDashes("ranked by population — Tehran, Mashhad and more")).toBe(
      "ranked by population, Tehran, Mashhad and more",
    );
    expect(stripBannedDashes("10–20")).toBe("10-20");
    const clean = "Biggest Cities in Iran: Top 15 by Population, Ranked + Map";
    expect(stripBannedDashes(clean)).toBe(clean);
    expect(stripBannedDashes(null)).toBe("");
  });

  it("never returns a string that still contains a banned dash; hasBannedDash spots all four glyphs", () => {
    for (const s of ["a — b – c ― d ‒ e", "10–20 items", "trailing —", "— leading"]) {
      expect(hasBannedDash(stripBannedDashes(s))).toBe(false);
    }
    expect(hasBannedDash("em —")).toBe(true);
    expect(hasBannedDash("figure ‒")).toBe(true);
    expect(hasBannedDash("plain - hyphen")).toBe(false);
  });
});

describe("runSingleFlight", () => {
  afterEach(() => {
    __resetSingleFlightForTests();
  });

  it("collapses concurrent callers of the same key to ONE run; the key clears on settle", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fn = vi.fn(async () => {
      await gate;
    });
    const a = runSingleFlight("k", fn);
    const b = runSingleFlight("k", fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isInFlight("k")).toBe(true);
    expect(a).toBe(b);
    release();
    await Promise.all([a, b]);
    expect(inFlightCount()).toBe(0);
  });

  it("clears the key even when the run rejects (no permanently-stuck flight)", async () => {
    await expect(
      runSingleFlight("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(isInFlight("k")).toBe(false);
    const ok = vi.fn(async () => {});
    await runSingleFlight("k", ok);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe("loadWithDeadline / valueWithDeadline", () => {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  it("returns data on time, times out when slow, and a late rejection never crashes", async () => {
    expect(await loadWithDeadline(Promise.resolve(42), 50)).toEqual({ timedOut: false, data: 42 });
    const result = await loadWithDeadline(sleep(80).then(() => "late"), 10);
    expect(result.timedOut).toBe(true);

    let rejectLate: (e: Error) => void = () => {};
    const hung = new Promise<string>((_, reject) => {
      rejectLate = reject;
    });
    expect((await loadWithDeadline(hung, 10)).timedOut).toBe(true);
    rejectLate(new Error("late failure"));
    await sleep(5); // the helper's internal catch absorbs it

    expect(await valueWithDeadline(Promise.resolve("fresh"), "fallback", 50)).toBe("fresh");
    expect(await valueWithDeadline(sleep(80).then(() => "late"), "fallback", 10)).toBe("fallback");
  });
});

describe("normalizeUrl", () => {
  it("normalizes full URLs, hosts, trailing slashes, query/hash, and case to a lowercase path", () => {
    expect(normalizeUrl("https://www.ritzbuilders.com/services/whole-home-remodel")).toBe("/services/whole-home-remodel");
    expect(normalizeUrl("https://ritzbuilders.com/locations/los-altos/")).toBe("/locations/los-altos");
    expect(normalizeUrl("https://ritzbuilders.com/path?q=1#h")).toBe("/path");
    expect(normalizeUrl("ritzbuilders.com/locations?q=1")).toBe("/locations");
    expect(normalizeUrl("https://Ritzbuilders.com/Locations/Los-Altos")).toBe("/locations/los-altos");
    expect(normalizeUrl("/")).toBe("/");
  });

  it("maps empty inputs to null, is idempotent, and never throws on malformed input", () => {
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
    for (const input of ["https://ritzbuilders.com/locations/los-altos/", "ritzbuilders.com/locations?q=1", "/"]) {
      const once = normalizeUrl(input);
      expect(normalizeUrl(once)).toBe(once);
    }
    for (const input of ["https://", "://broken", "javascript:void(0)", "data:text/plain,hello"]) {
      expect(() => normalizeUrl(input)).not.toThrow();
    }
  });
});

describe("business-config per-tenant isolation (the founder-config-leak guard)", () => {
  const TENANT = "tenant-test-pertenant-cfg";
  const TENANT_FILE = join(process.cwd(), ".data", "tenants", TENANT, "business-config.json");

  beforeEach(() => {
    __resetBusinessConfigCacheForTests();
    syncTenantMock.mockClear();
    syncLegacyMock.mockClear();
    maybeSingleMock.mockReset();
    tenantIdMock.mockReset();
  });

  afterEach(() => {
    rmSync(join(process.cwd(), ".data", "tenants", TENANT), { recursive: true, force: true });
    __resetBusinessConfigCacheForTests();
  });

  it("saveBusinessConfig writes the per-tenant file and dual-writes the PER-TENANT row, never the legacy singleton", () => {
    saveBusinessConfig(TENANT, { name: "Taco Cielo", domain: "tacocielo.com" });
    expect(existsSync(TENANT_FILE)).toBe(true);
    expect(JSON.parse(readFileSync(TENANT_FILE, "utf-8")).name).toBe("Taco Cielo");
    expect(syncTenantMock).toHaveBeenCalledWith(TENANT, expect.objectContaining({ name: "Taco Cielo" }));
    expect(syncLegacyMock).not.toHaveBeenCalled();

    // Survives a "restart": clear the in-memory cache, resolve again.
    __resetBusinessConfigCacheForTests();
    const resolved = getBusinessConfig(TENANT);
    expect(resolved.name).toBe("Taco Cielo");
    expect(isPlaceholderConfig(resolved)).toBe(false);
  });

  it("hydrates the per-tenant Supabase row when env+files miss (the Vercel path) and memoizes a miss", async () => {
    tenantIdMock.mockResolvedValue(TENANT);
    maybeSingleMock.mockResolvedValue({
      data: { data: { name: "Hosted Taqueria", domain: "hosted.mx" } },
      error: null,
    });
    const cfg = await getBusinessConfigForCurrentTenant();
    expect(cfg.name).toBe("Hosted Taqueria");

    __resetBusinessConfigCacheForTests();
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    await getBusinessConfigForCurrentTenant();
    await getBusinessConfigForCurrentTenant();
    expect(maybeSingleMock).toHaveBeenCalledTimes(2); // 1 hit above + exactly 1 memoized miss
  });
});
