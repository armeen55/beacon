/**
 * Multi-tenant `.data/` directory routing.
 *
 * Sprint 7 Phase 7.3 (2026-04-25): the `BEACON_TENANT` slug env var was
 * dropped (it duplicated `BEACON_TENANT_ID` at a different identifier
 * shape — slug vs id — and silently let production fall back to flat
 * `.data/` mode). Now callers pass the slug explicitly via the
 * `tenantSlug` param. Phase 7.8 will flip the flat-default to per-tenant
 * subdirectories; until then `getDataDir()` with no slug still routes
 * to the flat `.data/` for Ritz compatibility.
 *
 * Resolution paths:
 *   - Default `.data/` directory at project root  (Phase 7.3 default).
 *   - Named tenant `.data/tenants/{slug}/` when caller passes a slug.
 *
 * The active tenant ID is resolved by `currentTenantId()` in
 * tenant-context.ts; this file only handles directory layout.
 */

import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync } from "node:fs";

// Phase 7.8b-1 (2026-04-25): computed at call time so tests can
// `process.chdir()` and have path resolution follow.
const rootDataDir = (): string => join(process.cwd(), ".data");
const tenantsDir = (): string => join(rootDataDir(), "tenants");

export function getDataDir(tenantSlug?: string | null): string {
  if (!tenantSlug) return rootDataDir();

  const dir = join(tenantsDir(), tenantSlug);
  // Vercel FS read-only; skip mkdir (callers must handle missing dir).
  if (process.env.VERCEL !== "1" && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function createTenant(slug: string): string {
  const dir = join(tenantsDir(), slug);
  if (process.env.VERCEL !== "1" && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function listTenants(): string[] {
  const td = tenantsDir();
  if (!existsSync(td)) return [];
  return (readdirSync(td, { withFileTypes: true }) as { name: string; isDirectory: () => boolean }[])
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
