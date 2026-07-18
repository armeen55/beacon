import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Finding A (2026-07-18): answer-texts was a single flat cross-tenant blob
 * (`.data/answer-texts.json`) read/written GLOBAL. It is now TENANT_SCOPED —
 * cold-store routes through resolveDataPath to `.data/tenants/{slug}/
 * answer-texts.json`, keyed per tenant in-process. This pins that tenant A can
 * never observe tenant B's answer text through the fixed read/write path.
 */

const ORIG_CWD = process.cwd();
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "beacon-answer-texts-"));
  mkdirSync(join(dir, ".data", "global"), { recursive: true });
  mkdirSync(join(dir, ".data", "tenants", "alpha"), { recursive: true });
  mkdirSync(join(dir, ".data", "tenants", "beta"), { recursive: true });
  // Two tenants in the registry so slugForTenantId resolves alpha/beta.
  writeFileSync(
    join(dir, ".data", "global", "tenants.json"),
    JSON.stringify([
      { id: "tenant-alpha", slug: "alpha", name: "Alpha", role: "paid_customer" },
      { id: "tenant-beta", slug: "beta", name: "Beta", role: "paid_customer" },
    ]),
  );
  // Seed each tenant's OWN answer-texts file with a disjoint observation id.
  writeFileSync(
    join(dir, ".data", "tenants", "alpha", "answer-texts.json"),
    JSON.stringify({ "obs-alpha": "ALPHA answer text" }),
  );
  writeFileSync(
    join(dir, ".data", "tenants", "beta", "answer-texts.json"),
    JSON.stringify({ "obs-beta": "BETA answer text" }),
  );
  process.chdir(dir);
});

afterAll(() => {
  process.chdir(ORIG_CWD);
  rmSync(dir, { recursive: true, force: true });
});

describe("cold-store answer-texts — tenant isolation (finding A)", () => {
  it("reads ONLY the caller tenant's answer texts (no cross-tenant read)", async () => {
    const { loadTenantAnswerTexts } = await import("./cold-store");
    const alpha = await loadTenantAnswerTexts("tenant-alpha");
    const beta = await loadTenantAnswerTexts("tenant-beta");

    expect(alpha.get("obs-alpha")).toBe("ALPHA answer text");
    expect(alpha.get("obs-beta")).toBeUndefined(); // A cannot see B
    expect(beta.get("obs-beta")).toBe("BETA answer text");
    expect(beta.get("obs-alpha")).toBeUndefined(); // B cannot see A
  });

  it("writes route to the caller tenant's own file, leaving the other tenant untouched", async () => {
    const { writeAnswerTexts, clearCitationCache } = await import("./cold-store");
    // Invalidate the per-tenant read cache so the roundtrip reads fresh from disk.
    clearCitationCache();
    await writeAnswerTexts({ "obs-alpha-2": "second alpha text" }, "tenant-alpha");

    // Alpha's routed file was replaced with the new map; beta's is untouched.
    const alphaPath = join(dir, ".data", "tenants", "alpha", "answer-texts.json");
    const betaPath = join(dir, ".data", "tenants", "beta", "answer-texts.json");
    expect(existsSync(alphaPath)).toBe(true);
    const alphaOnDisk = JSON.parse(readFileSync(alphaPath, "utf-8"));
    expect(alphaOnDisk).toEqual({ "obs-alpha-2": "second alpha text" });
    const betaOnDisk = JSON.parse(readFileSync(betaPath, "utf-8"));
    expect(betaOnDisk).toEqual({ "obs-beta": "BETA answer text" });
  });
});
