/**
 * Night-shift item 1 (2026-06-11) — citation_evidence_index is
 * PER-TENANT everywhere. Pre-fix, the nightly rebuild blended every
 * tenant's observations into one global row (id='current') and the
 * app-layer store cached whichever tenant loaded first for the whole
 * process. Source pins (network code — behavior covered by
 * tests/domains/pages/citation-evidence-store.test.ts):
 *
 *   1. The cron route loops ACTIVE TENANTS and scopes observations +
 *      entities reads by tenant_id; upserts carry tenant_id with
 *      onConflict (tenant_id,id).
 *   2. The CLI rebuild script requires BEACON_TENANT_ID and scopes the
 *      same way.
 *   3. syncCitationEvidenceIndex REQUIRES a tenantId param and stamps it.
 *   4. The supabase backend exposes the scoped read; the tenant-repo
 *      wrapper prefers it.
 *   5. The app-layer store routes through the repository (no direct
 *      disk read) and keys its cache by tenant.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const DUAL = read("src/lib/persistence/dual-write.ts");
const BACKEND = read("src/lib/persistence/repositories/supabase-backend.ts");
const WRAPPER = read("src/lib/persistence/repositories/tenant-repo.ts");
const STORE = read("src/domains/pages/citation-evidence-store.ts");
const MIGRATION = read("migrations/2026-06-11_citation_evidence_index_per_tenant.sql");
const AI_MIGRATION = read("migrations/2026-06-11_answer_intelligence_index_per_tenant.sql");
const AI_STORE = read("src/domains/answer-intelligence/store.ts");

describe("citation_evidence_index — per-tenant invariants", () => {
  // De-bloat (2026-06-15): the cron rebuild route
  // (src/app/api/cron/rebuild-citation-evidence-index/route.ts) and its CLI
  // sibling (scripts/rebuild-citation-evidence-index-native.ts) were the
  // scheduled native-poll writers and were deleted with the abandoned
  // automation. The per-tenant invariants below still pin the surviving
  // write/read chain (dual-write sync, the scoped backend read, the
  // tenant-repo facade, the app-layer store cache, the migration mirror)
  // that the live Profound import-orchestrator rebuild + customer surfaces
  // depend on.
  it("syncCitationEvidenceIndex requires + stamps tenantId", () => {
    expect(DUAL).toMatch(
      /export async function syncCitationEvidenceIndex\(\s*index: CitationEvidenceIndex,\s*tenantId: string,?\s*\)/,
    );
    const fn = DUAL.slice(DUAL.indexOf("export async function syncCitationEvidenceIndex"));
    const body = fn.slice(0, fn.indexOf("export async function", 10));
    expect(body).toMatch(/tenant_id: tenantId/);
    expect(body).toMatch(/onConflict:\s*"tenant_id,id"/);
  });

  it("supabase backend exposes the scoped read; forTenant facade uses it", () => {
    expect(BACKEND).toMatch(/getCitationEvidenceIndexScoped: async \(tenantId: string\)/);
    expect(BACKEND).toMatch(/getCitationEvidenceIndexScoped!\(tenantId\)/);
  });

  it("tenant-repo wrapper prefers the scoped read", () => {
    expect(WRAPPER).toMatch(
      /base\.getCitationEvidenceIndexScoped\s*\?\s*base\.getCitationEvidenceIndexScoped\(tenantId\)\s*:\s*base\.getCitationEvidenceIndex\(\)/,
    );
  });

  it("app-layer store is repository-routed with a tenant-keyed cache", () => {
    expect(STORE).toMatch(/getRepository\(\)\.forTenant\(tenantId\)\.getCitationEvidenceIndex\(\)/);
    expect(STORE).toMatch(/Map<string, CitationEvidenceIndex \| null>/);
    expect(STORE).not.toMatch(/import.*readDotDataJson/); // docstring may mention it; the import must not
  });

  it("migration mirror exists with the composite primary key", () => {
    expect(MIGRATION).toMatch(/PRIMARY KEY \(tenant_id, id\)/);
    expect(MIGRATION).toMatch(/SET tenant_id = 'tenant-ritz-founder' WHERE tenant_id IS NULL/);
  });
});

describe("answer_intelligence_index — same per-tenant invariants (night-shift item 2)", () => {
  it("syncAnswerIntelligenceIndex requires + stamps tenantId", () => {
    expect(DUAL).toMatch(
      /export async function syncAnswerIntelligenceIndex\(\s*index: AnswerIntelligenceIndex,\s*tenantId: string,?\s*\)/,
    );
    const fn = DUAL.slice(DUAL.indexOf("export async function syncAnswerIntelligenceIndex"));
    const body = fn.slice(0, fn.indexOf("export async function", 10));
    expect(body).toMatch(/tenant_id: tenantId/);
    expect(body).toMatch(/onConflict:\s*"tenant_id,id"/);
  });

  it("backend exposes the scoped read; facade + wrapper route to it", () => {
    expect(BACKEND).toMatch(/getAnswerIntelligenceIndexScoped: async \(tenantId: string\)/);
    expect(BACKEND).toMatch(/getAnswerIntelligenceIndexScoped!\(tenantId\)/);
    expect(WRAPPER).toMatch(
      /base\.getAnswerIntelligenceIndexScoped\s*\?\s*base\.getAnswerIntelligenceIndexScoped\(tenantId\)\s*:\s*base\.getAnswerIntelligenceIndex\(\)/,
    );
  });

  it("app-layer store is repository-routed with a tenant-keyed cache", () => {
    expect(AI_STORE).toMatch(/getRepository\(\)\.forTenant\(tenantId\)\.getAnswerIntelligenceIndex\(\)/);
    expect(AI_STORE).toMatch(/Map<string, AnswerIntelligenceIndex \| null>/);
    expect(AI_STORE).not.toMatch(/import.*readDotDataJson/);
  });

  it("migration mirror exists with the composite primary key", () => {
    expect(AI_MIGRATION).toMatch(/PRIMARY KEY \(tenant_id, id\)/);
    expect(AI_MIGRATION).toMatch(/SET tenant_id = 'tenant-ritz-founder' WHERE tenant_id IS NULL/);
  });
});
