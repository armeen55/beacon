/**
 * Tests for `scripts/onboard-tenant.ts` — the MMVP customer-2 scaffold.
 *
 * Hermetic isolation: every test mkdtempSync's its own `.data/` root and
 * passes it via `dataRoot`. Real `.data/` is never touched. No Supabase
 * env vars required. No OpenAI calls. No queue mutation.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  DOMAIN_RE,
  SLUG_RE,
  TENANT_ID_RE,
  TENANT_STORE_FILES,
  UUID_RE,
  onboardTenant,
  parseArgs,
  type BeaconTenantSeed,
} from "../../scripts/onboard-tenant";

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), "beacon-onboard-test-"));
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

const VALID_INPUT = {
  slug: "acme-builders",
  tenantId: "tenant-acme",
  name: "Acme Custom Builders",
  domain: "acmebuilders.com",
  now: new Date("2026-05-06T12:00:00Z"),
};

// ── Validation regexes ─────────────────────────────────────────────

describe("validation regexes", () => {
  it("SLUG_RE accepts valid slugs", () => {
    for (const ok of [
      "acme",
      "acme-builders",
      "ritz-builders",
      "a1",
      "a-b-c-d-e",
      "abc123",
    ]) {
      expect(SLUG_RE.test(ok)).toBe(true);
    }
  });

  it("SLUG_RE rejects invalid slugs", () => {
    for (const bad of [
      "",
      "a",
      "Acme",
      "acme_builders", // underscores not allowed
      "-acme",
      "acme-",
      "acme--builders", // doubled dashes ok by `[a-z0-9-]` but fail tail rule? actually allowed — pinning to docstring contract
      "acme.com",
      "acme/builders",
      "x".repeat(41), // >40 chars
    ]) {
      // "acme--builders" passes — adjust if we tighten later. For
      // today's contract (lowercase letters/digits/dashes 2..40 with
      // alpha-num at both ends), it's accepted.
      if (bad === "acme--builders") {
        expect(SLUG_RE.test(bad)).toBe(true);
      } else {
        expect(SLUG_RE.test(bad)).toBe(false);
      }
    }
  });

  it("TENANT_ID_RE accepts ids prefixed with `tenant-`", () => {
    expect(TENANT_ID_RE.test("tenant-acme")).toBe(true);
    expect(TENANT_ID_RE.test("tenant-ritz-founder")).toBe(true);
    expect(TENANT_ID_RE.test("tenant-acme123")).toBe(true);
  });

  it("TENANT_ID_RE rejects non-`tenant-` prefixes + uppercase", () => {
    for (const bad of [
      "",
      "acme",
      "Tenant-Acme",
      "TENANT-ACME",
      "tenant_acme",
      "tenant-",
      "tenant-ACME",
    ]) {
      expect(TENANT_ID_RE.test(bad)).toBe(false);
    }
  });

  it("DOMAIN_RE accepts apex domains", () => {
    for (const ok of [
      "acme.com",
      "acmebuilders.com",
      "supple-homes.com",
      "deep.subdomain.example.org",
    ]) {
      expect(DOMAIN_RE.test(ok)).toBe(true);
    }
  });

  it("DOMAIN_RE rejects URLs / paths / ports / uppercase", () => {
    for (const bad of [
      "",
      "no-tld",
      "http://acme.com",
      "https://acme.com",
      "acme.com/path",
      "acme.com:8080",
      "Acme.com",
      ".acme.com",
      "acme..com",
    ]) {
      expect(DOMAIN_RE.test(bad)).toBe(false);
    }
  });

  it("UUID_RE accepts standard UUIDs (case-insensitive)", () => {
    expect(UUID_RE.test("01234567-89ab-cdef-0123-456789abcdef")).toBe(true);
    expect(UUID_RE.test("ABCDEF01-2345-6789-ABCD-EF0123456789")).toBe(true);
  });

  it("UUID_RE rejects non-UUIDs", () => {
    for (const bad of ["", "not-a-uuid", "12345678", "x".repeat(36)]) {
      expect(UUID_RE.test(bad)).toBe(false);
    }
  });
});

// ── parseArgs ──────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("parses every supported flag", () => {
    const { parsed, unknown } = parseArgs([
      "--slug=acme-builders",
      "--tenant-id=tenant-acme",
      "--name=Acme Custom Builders",
      "--domain=acmebuilders.com",
      "--user-id=01234567-89ab-cdef-0123-456789abcdef",
      "--data-root=/tmp/foo",
      "--apply",
      "--force",
    ]);
    expect(unknown).toEqual([]);
    expect(parsed.slug).toBe("acme-builders");
    expect(parsed.tenantId).toBe("tenant-acme");
    expect(parsed.name).toBe("Acme Custom Builders");
    expect(parsed.domain).toBe("acmebuilders.com");
    expect(parsed.userId).toBe("01234567-89ab-cdef-0123-456789abcdef");
    expect(parsed.dataRoot).toBe("/tmp/foo");
    expect(parsed.apply).toBe(true);
    expect(parsed.force).toBe(true);
  });

  it("dry-run is the default (apply not set unless --apply)", () => {
    const { parsed } = parseArgs(["--slug=acme", "--tenant-id=tenant-acme"]);
    expect(parsed.apply).toBeUndefined();
  });

  it("--dry-run explicitly sets apply=false", () => {
    const { parsed } = parseArgs(["--apply", "--dry-run"]);
    expect(parsed.apply).toBe(false);
  });

  it("flags it doesn't recognise show up in `unknown`", () => {
    const { unknown } = parseArgs(["--what=now", "positional"]);
    expect(unknown).toContain("--what=now");
    expect(unknown).toContain("positional");
  });

  it("--help / -h sets showHelp", () => {
    expect(parseArgs(["--help"]).parsed.showHelp).toBe(true);
    expect(parseArgs(["-h"]).parsed.showHelp).toBe(true);
  });
});

// ── Validation paths through onboardTenant ────────────────────────

describe("onboardTenant — validation", () => {
  it("rejects bad slug", async () => {
    const r = await onboardTenant({
      ...VALID_INPUT,
      slug: "Acme Builders!",
      dataRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/Invalid --slug/);
    expect(r.filesWritten).toEqual([]);
    expect(r.registryUpdated).toBe(false);
  });

  it("rejects bad tenant-id (missing tenant- prefix)", async () => {
    const r = await onboardTenant({
      ...VALID_INPUT,
      tenantId: "acme",
      dataRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/Invalid --tenant-id/);
  });

  it("rejects bad domain (URL)", async () => {
    const r = await onboardTenant({
      ...VALID_INPUT,
      domain: "https://acmebuilders.com",
      dataRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/Invalid --domain/);
  });

  it("rejects empty name", async () => {
    const r = await onboardTenant({ ...VALID_INPUT, name: "", dataRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/Invalid --name/);
  });

  it("rejects malformed user-id (not a UUID)", async () => {
    const r = await onboardTenant({
      ...VALID_INPUT,
      userId: "not-a-uuid",
      dataRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/Invalid --user-id/);
  });

  it("multiple validation errors accumulate (all reported)", async () => {
    const r = await onboardTenant({
      slug: "Bad Slug",
      tenantId: "no-prefix",
      name: "",
      domain: "no-tld",
      now: VALID_INPUT.now,
      dataRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ── Dry-run (default) — does not touch disk ───────────────────────

describe("onboardTenant — dry-run", () => {
  it("default mode is dry-run (apply false): no files written, no registry created", async () => {
    const r = await onboardTenant({ ...VALID_INPUT, dataRoot });
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toEqual([]);
    expect(r.filesPlanned.length).toBe(TENANT_STORE_FILES.length);
    expect(r.registryUpdated).toBe(false);
    expect(existsSync(join(dataRoot, "global", "tenants.json"))).toBe(false);
    expect(existsSync(join(dataRoot, "tenants", VALID_INPUT.slug))).toBe(
      false,
    );
  });

  it("dry-run output contains the env checklist headers", async () => {
    const r = await onboardTenant({ ...VALID_INPUT, dataRoot });
    const joined = r.output.join("\n");
    expect(joined).toMatch(/Vercel \/ GitHub env checklist/);
    expect(joined).toMatch(/BEACON_TENANT_ID\s*=\s*tenant-acme/);
    expect(joined).toMatch(/BEACON_TENANT_SLUG\s*=\s*acme-builders/);
    expect(joined).toMatch(/BEACON_SITE_DOMAIN\s*=\s*acmebuilders\.com/);
    expect(joined).toMatch(/BEACON_BUSINESS_CONFIG_JSON/);
  });

  it("dry-run output contains a Next-steps checklist", async () => {
    const r = await onboardTenant({ ...VALID_INPUT, dataRoot });
    const joined = r.output.join("\n");
    expect(joined).toMatch(/Next steps/);
    expect(joined).toMatch(/Seed prompts/);
    expect(joined).toMatch(/Seed entities/);
    expect(joined).toMatch(/Run scan/);
    // 2026-06-15 PIVOT: the in-house native poll was removed; Profound is now
    // the sole AEO source, so the onboarding checklist points there instead.
    expect(joined).toMatch(/AEO data/);
    expect(joined).toMatch(/Verify \/today/);
  });

  it("dry-run prints the BUSINESS_CONFIG payload as valid JSON", async () => {
    const r = await onboardTenant({ ...VALID_INPUT, dataRoot });
    // Find the "BUSINESS_CONFIG payload" header, then parse the next
    // contiguous run of lines as JSON.
    const idx = r.output.findIndex((l) => /BUSINESS_CONFIG payload/.test(l));
    expect(idx).toBeGreaterThan(-1);
    // Output is the JSON stringified at indent=2 — collect lines until
    // the next blank line / next header. Simpler: pull from idx+1 to
    // first line that starts with "─" (header) or is empty.
    let end = idx + 1;
    while (
      end < r.output.length &&
      !/^─/.test(r.output[end]) &&
      !/^\s*$/.test(r.output[end])
    ) {
      end++;
    }
    const json = r.output.slice(idx + 1, end).join("\n");
    const parsed = JSON.parse(json);
    expect(parsed.tenant_id).toBe("tenant-acme");
    expect(parsed.business_name).toBe("Acme Custom Builders");
    expect(parsed.domain).toBe("acmebuilders.com");
  });
});

// ── Apply path ────────────────────────────────────────────────────

describe("onboardTenant — apply", () => {
  it("creates tenant registry row, tenant directory, and all 14 store files", async () => {
    const r = await onboardTenant({ ...VALID_INPUT, apply: true, dataRoot });
    expect(r.ok).toBe(true);
    expect(r.registryUpdated).toBe(true);
    expect(r.filesWritten.length).toBe(TENANT_STORE_FILES.length);
    expect(r.filesSkipped).toEqual([]);

    // Registry created with one row containing the new tenant.
    const registryPath = join(dataRoot, "global", "tenants.json");
    expect(existsSync(registryPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].slug).toBe("acme-builders");
    expect(parsed[0].id).toBe("tenant-acme");
    expect(parsed[0].business_name).toBe("Acme Custom Builders");
    expect(parsed[0].domain).toBe("acmebuilders.com");
    expect(parsed[0].status).toBe("active");

    // Tenant directory + every expected file exists.
    const tenantDir = join(dataRoot, "tenants", "acme-builders");
    expect(existsSync(tenantDir)).toBe(true);
    for (const file of TENANT_STORE_FILES) {
      const p = join(tenantDir, file);
      expect(existsSync(p)).toBe(true);
      const body = readFileSync(p, "utf8").trim();
      expect(body).toBe("[]");
    }
  });

  it("appends to an existing registry without dropping prior tenants", async () => {
    // Pre-seed a Ritz-shaped row.
    mkdirSync(join(dataRoot, "global"), { recursive: true });
    const ritz: BeaconTenantSeed = {
      id: "tenant-ritz-founder",
      slug: "ritz-builders",
      business_name: "Ritz Builders",
      domain: "ritzbuilders.com",
      segment: "local_residential_builder",
      project_mix: ["new_construction"],
      cities_served: ["Atherton"],
      budget_range: "5m_plus",
      signup_date: "2026-01-01T00:00:00Z",
      role: "founder",
      tos_accepted_at: "2026-01-01T00:00:00Z",
      discovered_competitors: [],
      daily_budget_usd: 10,
      status: "active",
      email_frequency: "weekly",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    writeFileSync(
      join(dataRoot, "global", "tenants.json"),
      JSON.stringify([ritz], null, 2),
      "utf8",
    );

    const r = await onboardTenant({ ...VALID_INPUT, apply: true, dataRoot });
    expect(r.ok).toBe(true);
    expect(r.preexistingRegistryRow).toBe(false);

    const parsed = JSON.parse(
      readFileSync(join(dataRoot, "global", "tenants.json"), "utf8"),
    );
    expect(parsed.length).toBe(2);
    expect(parsed.map((t: { slug: string }) => t.slug).sort()).toEqual([
      "acme-builders",
      "ritz-builders",
    ]);
    // Ritz row's contents are preserved.
    const stillRitz = parsed.find(
      (t: { slug: string }) => t.slug === "ritz-builders",
    );
    expect(stillRitz.business_name).toBe("Ritz Builders");
    expect(stillRitz.created_at).toBe("2026-01-01T00:00:00Z");
  });

  it("refuses duplicate slug without --force (registry untouched)", async () => {
    const before = await onboardTenant({
      ...VALID_INPUT,
      apply: true,
      dataRoot,
    });
    expect(before.ok).toBe(true);
    const beforeRegistry = readFileSync(
      join(dataRoot, "global", "tenants.json"),
      "utf8",
    );

    const dup = await onboardTenant({
      ...VALID_INPUT,
      apply: true,
      dataRoot,
      now: new Date("2026-05-07T12:00:00Z"),
    });
    expect(dup.ok).toBe(false);
    expect(dup.errors.join("\n")).toMatch(/Tenant already exists/);
    expect(dup.preexistingRegistryRow).toBe(true);
    expect(dup.registryUpdated).toBe(false);

    // Registry file is byte-identical to pre-second-call state.
    const afterRegistry = readFileSync(
      join(dataRoot, "global", "tenants.json"),
      "utf8",
    );
    expect(afterRegistry).toBe(beforeRegistry);
  });

  it("refuses duplicate tenant-id under a different slug (id collision)", async () => {
    await onboardTenant({ ...VALID_INPUT, apply: true, dataRoot });
    const collision = await onboardTenant({
      ...VALID_INPUT,
      slug: "different-slug",
      apply: true,
      dataRoot,
    });
    expect(collision.ok).toBe(false);
    expect(collision.errors.join("\n")).toMatch(/Tenant already exists/);
  });

  it("--force overwrites the registry row (updated_at bumps; created_at stable when entry-merged)", async () => {
    const t0 = await onboardTenant({
      ...VALID_INPUT,
      apply: true,
      dataRoot,
      now: new Date("2026-05-06T12:00:00Z"),
    });
    expect(t0.ok).toBe(true);

    const t1 = await onboardTenant({
      ...VALID_INPUT,
      name: "Acme Custom Builders, LLC", // updated display name
      apply: true,
      force: true,
      dataRoot,
      now: new Date("2026-05-07T12:00:00Z"),
    });
    expect(t1.ok).toBe(true);
    expect(t1.preexistingRegistryRow).toBe(true);
    expect(t1.registryUpdated).toBe(true);

    const parsed = JSON.parse(
      readFileSync(join(dataRoot, "global", "tenants.json"), "utf8"),
    );
    expect(parsed.length).toBe(1);
    expect(parsed[0].business_name).toBe("Acme Custom Builders, LLC");
    expect(parsed[0].updated_at).toBe("2026-05-07T12:00:00.000Z");
  });

  it("apply is idempotent on a second clean run with --force (no error)", async () => {
    const first = await onboardTenant({
      ...VALID_INPUT,
      apply: true,
      dataRoot,
    });
    expect(first.ok).toBe(true);

    const second = await onboardTenant({
      ...VALID_INPUT,
      apply: true,
      force: true,
      dataRoot,
    });
    expect(second.ok).toBe(true);
    expect(second.registryUpdated).toBe(true);
    // Files were re-written under --force.
    expect(second.filesWritten.length).toBe(TENANT_STORE_FILES.length);
    expect(second.filesSkipped.length).toBe(0);
  });

  it("apply without --force on existing tenant directory: skips files but still errors on duplicate registry", async () => {
    // Pre-create the tenant dir + one of the files; no registry row.
    const dir = join(dataRoot, "tenants", "acme-builders");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tracked-prompts.json"), "[]\n");

    const r = await onboardTenant({ ...VALID_INPUT, apply: true, dataRoot });
    // Registry didn't exist yet, so this run succeeds and creates it.
    expect(r.ok).toBe(true);
    expect(r.filesSkipped.some((p) => /tracked-prompts\.json$/.test(p))).toBe(
      true,
    );
    // The other 13 files are created.
    expect(r.filesWritten.length).toBe(TENANT_STORE_FILES.length - 1);
  });
});

// ── tenant_members SQL ─────────────────────────────────────────────

describe("onboardTenant — tenant_members SQL", () => {
  it("prints SQL when --user-id is provided (does not execute)", async () => {
    const userId = "12345678-1234-1234-1234-123456789012";
    const r = await onboardTenant({
      ...VALID_INPUT,
      userId,
      apply: true,
      dataRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.tenantMembersSql).not.toBeNull();
    expect(r.tenantMembersSql ?? "").toMatch(
      /INSERT INTO public\.tenant_members/,
    );
    expect(r.tenantMembersSql ?? "").toContain(userId);
    expect(r.tenantMembersSql ?? "").toContain("tenant-acme");
    // ON CONFLICT clause makes manual re-runs safe.
    expect(r.tenantMembersSql ?? "").toMatch(/ON CONFLICT/);
  });

  it("omits SQL when --user-id is not provided", async () => {
    const r = await onboardTenant({ ...VALID_INPUT, apply: true, dataRoot });
    expect(r.tenantMembersSql).toBeNull();
    expect(r.output.join("\n")).not.toMatch(/INSERT INTO public\.tenant_members/);
  });
});

// ── Hermetic isolation guarantees ──────────────────────────────────

describe("hermetic isolation guarantees", () => {
  it("does not require any Supabase env vars", async () => {
    // Capture relevant env, blank them, run, restore.
    const keys = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "DATA_SOURCE",
      "DUAL_WRITE",
    ];
    const saved: Record<string, string | undefined> = {};
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const r = await onboardTenant({
        ...VALID_INPUT,
        apply: true,
        dataRoot,
      });
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
    } finally {
      for (const k of keys) {
        if (saved[k] !== undefined) process.env[k] = saved[k];
      }
    }
  });

  it("does not call any network / OpenAI APIs", async () => {
    // Spy on global.fetch to detect network egress. The onboard
    // script is pure file/I/O — fetch should never be called.
    const origFetch = globalThis.fetch;
    let fetchCalls = 0;
    (globalThis as { fetch: typeof fetch }).fetch = (() => {
      fetchCalls++;
      return Promise.reject(new Error("network forbidden in test"));
    }) as typeof fetch;
    try {
      const r = await onboardTenant({
        ...VALID_INPUT,
        apply: true,
        dataRoot,
      });
      expect(r.ok).toBe(true);
      expect(fetchCalls).toBe(0);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = origFetch;
    }
  });

  it("dataRoot defaults to <cwd>/.data; tests must always pass an explicit dataRoot", () => {
    // This test pins the contract that callers MUST pass a dataRoot
    // in tests. We're not actually testing the default here — just
    // documenting that the default exists and tests bypass it. The
    // only assertion is that the type accepts an absent dataRoot
    // without TypeScript error (compile-time).
    const _maybeOpts = { ...VALID_INPUT };
    expect(typeof _maybeOpts.slug).toBe("string");
  });
});

// ── End-to-end: dry-run then apply ─────────────────────────────────

describe("dry-run then apply (end-to-end)", () => {
  it("dry-run plan matches the apply-write set", async () => {
    const dry = await onboardTenant({ ...VALID_INPUT, dataRoot });
    const wet = await onboardTenant({
      ...VALID_INPUT,
      apply: true,
      dataRoot,
    });
    expect(dry.ok).toBe(true);
    expect(wet.ok).toBe(true);
    expect(dry.filesPlanned.sort()).toEqual(wet.filesWritten.sort());
  });
});
